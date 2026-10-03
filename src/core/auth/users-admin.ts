import { clerkClient } from "@clerk/nextjs/server";
import { and, count, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { branches, roles, userRoles, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/core/audit/service";
import { recordActivity } from "@/core/activity/service";
import { notify } from "@/core/notification/service";
import type { CurrentUser } from "@/types";

export interface AdminUserRow {
  id: string;
  externalId: string;
  name: string;
  email: string;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  isPlatformAdmin: boolean;
  branchId: string | null;
  branchName: string | null;
  allBranches: boolean;
  roles: { id: string; code: string; name: string }[];
  createdAt: string;
}

export async function listUsers(
  user: CurrentUser,
  opts: { q?: string; status?: string } = {},
): Promise<AdminUserRow[]> {
  if (!user.companyId && !user.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Tidak ada perusahaan aktif.");
  }
  const conditions: SQL[] = [];
  if (user.companyId) conditions.push(eq(users.companyId, user.companyId));
  if (opts.q) {
    const like = `%${opts.q}%`;
    const cond = or(ilike(users.name, like), ilike(users.email, like));
    if (cond) conditions.push(cond);
  }
  if (opts.status === "ACTIVE" || opts.status === "INACTIVE" || opts.status === "SUSPENDED") {
    conditions.push(eq(users.status, opts.status));
  }

  const rows = await db.query.users.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    with: {
      branch: { columns: { name: true } },
      roles: { with: { role: { columns: { id: true, code: true, name: true } } } },
    },
    orderBy: (u, { desc }) => [desc(u.createdAt)],
    limit: 200,
  });

  return rows.map((u) => ({
    id: u.id,
    externalId: u.externalId,
    name: u.name,
    email: u.email,
    status: u.status,
    isPlatformAdmin: u.isPlatformAdmin,
    branchId: u.branchId,
    branchName: u.branch?.name ?? null,
    allBranches: u.allBranches,
    roles: u.roles.map((ur) => ur.role),
    createdAt: u.createdAt.toISOString(),
  }));
}

/** Creates a Clerk account AND the local user. Returns the local user. */
export async function createUserWithClerk(
  actor: CurrentUser,
  input: {
    name: string;
    email: string;
    password: string;
    companyId?: string;
    branchId?: string | null;
    roleIds: string[];
  },
): Promise<AdminUserRow> {
  const companyId = actor.isPlatformAdmin ? input.companyId ?? null : actor.companyId;
  if (!companyId) throw new AppError("VALIDATION_ERROR", "Perusahaan wajib dipilih.");

  const client = await clerkClient();
  let clerkUser;
  try {
    clerkUser = await client.users.createUser({
      emailAddress: [input.email],
      password: input.password,
      firstName: input.name.split(" ")[0],
      lastName: input.name.split(" ").slice(1).join(" ") || undefined,
    });
  } catch (e) {
    const message = (e as { errors?: { message?: string }[] })?.errors?.[0]?.message;
    throw new AppError(
      "CONFLICT",
      `Gagal membuat akun Clerk: ${message ?? (e as Error).message}`,
    );
  }

  const email = clerkUser.primaryEmailAddress?.emailAddress ?? input.email;
  const [created] = await db
    .insert(users)
    .values({
      externalId: clerkUser.id,
      email,
      name: input.name,
      avatarUrl: clerkUser.imageUrl ?? null,
      companyId,
      branchId: input.branchId ?? null,
      status: "ACTIVE",
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning();

  await setUserRoles(actor, created.id, input.roleIds);

  await recordAudit({
    userId: actor.id,
    companyId,
    action: "CREATE",
    module: "core",
    resource: "user",
    resourceId: created.id,
    newValues: { name: created.name, email: created.email },
  });
  await recordActivity({
    companyId,
    userId: actor.id,
    type: "user.create",
    message: `Pengguna ${created.name} dibuat`,
  });
  await notify({
    companyId,
    title: "Pengguna baru ditambahkan",
    body: `${created.name} (${created.email}) bergabung.`,
    type: "INFO",
    link: "/settings/users",
  });

  return (await listUsers(actor)).find((u) => u.id === created.id)!;
}

async function setUserRoles(actor: CurrentUser, userId: string, roleIds: string[]) {
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  if (roleIds.length > 0) {
    // role must belong to the actor's company (or be the platform role)
    const validRoles = await db
      .select({ id: roles.id })
      .from(roles)
      .where(
        actor.companyId
          ? and(eq(roles.companyId, actor.companyId))
          : undefined,
      );
    const validIds = new Set(validRoles.map((r) => r.id));
    const rows = roleIds
      .filter((id) => validIds.has(id))
      .map((roleId) => ({ userId, roleId }));
    if (rows.length > 0) {
      await db.insert(userRoles).values(rows).onConflictDoNothing();
    }
  }
  void actor;
}

export async function updateUser(
  actor: CurrentUser,
  userId: string,
  input: { name?: string; branchId?: string | null; roleIds?: string[]; status?: "ACTIVE" | "INACTIVE" | "SUSPENDED" },
): Promise<void> {
  const [before] = await db.select().from(users).where(eq(users.id, userId));
  if (!before) throw new AppError("NOT_FOUND", "Pengguna tidak ditemukan.");
  if (before.companyId && before.companyId !== actor.companyId && !actor.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Pengguna milik perusahaan lain.");
  }

  await db
    .update(users)
    .set({
      name: input.name ?? before.name,
      branchId: input.branchId === undefined ? before.branchId : input.branchId,
      status: input.status ?? before.status,
      updatedBy: actor.id,
    })
    .where(eq(users.id, userId));

  if (input.roleIds) {
    await setUserRoles(actor, userId, input.roleIds);
  }

  // suspend/activate also affects the Clerk account
  if (input.status && input.status !== before.status) {
    const client = await clerkClient();
    try {
      if (input.status === "SUSPENDED" && before.status !== "SUSPENDED") {
        await client.users.banUser(before.externalId);
        await revokeAllClerkSessions(client, before.externalId);
      } else if (input.status !== "SUSPENDED" && before.status === "SUSPENDED") {
        await client.users.unbanUser(before.externalId);
      }
    } catch (e) {
      console.error("[users] clerk sync failed", e);
    }
  }

  await recordAudit({
    userId: actor.id,
    companyId: before.companyId,
    action: "UPDATE",
    module: "core",
    resource: "user",
    resourceId: userId,
    oldValues: { name: before.name, status: before.status, branchId: before.branchId },
    newValues: {
      name: input.name ?? before.name,
      status: input.status ?? before.status,
      branchId: input.branchId ?? before.branchId,
    },
  });
  await recordActivity({
    companyId: before.companyId,
    userId: actor.id,
    type: "user.update",
    message: `Pengguna ${before.name} diperbarui`,
  });
}

/** Admin-triggered password reset: sets a new temp password + revokes sessions. */
export async function resetUserPassword(
  actor: CurrentUser,
  userId: string,
): Promise<string> {
  const [target] = await db.select().from(users).where(eq(users.id, userId));
  if (!target) throw new AppError("NOT_FOUND", "Pengguna tidak ditemukan.");
  const temp = `Tu-${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 90 + 10)}!`;
  const client = await clerkClient();
  try {
    await client.users.updateUser(target.externalId, { password: temp });
    await revokeAllClerkSessions(client, target.externalId);
  } catch (e) {
    throw new AppError("INTERNAL", `Gagal reset password: ${(e as Error).message}`);
  }
  await recordAudit({
    userId: actor.id,
    companyId: target.companyId,
    action: "PASSWORD_RESET",
    module: "core",
    resource: "user",
    resourceId: userId,
  });
  return temp;
}

/** Clerk v7 has no bulk revoke — list sessions then revoke each. */
async function revokeAllClerkSessions(
  client: Awaited<ReturnType<typeof clerkClient>>,
  clerkUserId: string,
) {
  try {
    const { data: sessions } = await client.sessions.getSessionList({
      userId: clerkUserId,
      limit: 50,
    });
    for (const session of sessions) {
      if (session.status === "active") {
        await client.sessions.revokeSession(session.id);
      }
    }
  } catch (e) {
    console.error("[users] session revoke failed", e);
  }
}

export async function getUserCounts(companyId: string | null): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(companyId ? eq(users.companyId, companyId) : undefined);
  return Number(total);
}

export async function getBranchCount(companyId: string | null): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(branches)
    .where(companyId ? eq(branches.companyId, companyId) : undefined);
  return Number(total);
}
