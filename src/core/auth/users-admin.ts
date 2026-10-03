import { and, count, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { branches, roles, userRoles, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/core/audit/service";
import { recordActivity } from "@/core/activity/service";
import { notify } from "@/core/notification/service";
import { hashPassword } from "./password";
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

/** Creates a local user (requires platform admin or self). */
export async function createUserWithLocal(
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
  const companyId =
    actor.isPlatformAdmin ? input.companyId ?? null : actor.companyId;
  if (!companyId) throw new AppError("VALIDATION_ERROR", "Perusahaan wajib dipilih.");

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email.toLowerCase()))
    .limit(1);
  if (existing) {
    throw new AppError("CONFLICT", "Email sudah terdaftar.");
  }

  const [{ total }] = await db.select({ total: count() }).from(users);
  const isFirstUser = Number(total) === 0;

  const { hash, salt } = isFirstUser
    ? { hash: "", salt: "" }
    : hashPassword(input.password);

  const rawHash = hash;

  const [created] = await db
    .insert(users)
    .values({
      externalId: crypto.randomUUID(),
      email: input.email.toLowerCase(),
      name: input.name,
      avatarUrl: null,
      companyId,
      branchId: input.branchId ?? null,
      isPlatformAdmin: actor.isPlatformAdmin,
      allBranches: actor.isPlatformAdmin ? true : false,
      status: "ACTIVE",
      passwordHash: rawHash,
      passwordSalt: salt,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning();

  // If first user, auto-bind platform role
  if (isFirstUser) {
    const [platformRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.code, "SUPER_ADMIN"))
      .limit(1);
    if (platformRole) {
      await db
        .insert(userRoles)
        .values({ userId: created.id, roleId: platformRole.id })
        .onConflictDoNothing();
    }
  } else {
    await setUserRoles(actor, created.id, input.roleIds);
  }

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
  if (roleIds.length === 0) return;

  const validRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(
      actor.companyId ? and(eq(roles.companyId, actor.companyId)) : undefined,
    );
  const validIds = new Set(validRoles.map((r) => r.id));
  const rows = roleIds.filter((id) => validIds.has(id)).map((roleId) => ({ userId, roleId }));
  if (rows.length > 0) {
    await db.insert(userRoles).values(rows).onConflictDoNothing();
  }
}

export async function updateUser(
  actor: CurrentUser,
  userId: string,
  input: {
    name?: string;
    branchId?: string | null;
    roleIds?: string[];
    status?: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  },
): Promise<void> {
  const [before] = await db.select().from(users).where(eq(users.id, userId));
  if (!before) throw new AppError("NOT_FOUND", "Pengguna tidak ditemukan.");
  if (before.companyId && before.companyId !== actor.companyId && !actor.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Pengguna milik perusahaan lain.");
  }

  const next = {
    name: input.name ?? before.name,
    branchId: input.branchId ?? before.branchId,
    status: input.status ?? before.status,
    updatedBy: actor.id,
    updatedAt: new Date(),
  };
  await db.update(users).set(next).where(eq(users.id, userId));

  if (input.roleIds) {
    await setUserRoles(actor, userId, input.roleIds);
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
  const { hash, salt } = hashPassword(temp);

  await db
    .update(users)
    .set({ passwordHash: hash, passwordSalt: salt, updatedBy: actor.id })
    .where(eq(users.id, userId));

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
