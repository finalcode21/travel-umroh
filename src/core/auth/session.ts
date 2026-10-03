import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { companies, permissions, rolePermissions, roles, userBranches, userRoles, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { getModuleAccessMap } from "@/core/modules/access";
import { provisionUserFromClerk } from "./provision";
import type { CurrentUser } from "@/types";

export function isClerkConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}

async function loadUserByExternalId(externalId: string): Promise<CurrentUser | null> {
  const [row] = await db
    .select({
      user: users,
      company: companies,
    })
    .from(users)
    .leftJoin(companies, eq(companies.id, users.companyId))
    .where(eq(users.externalId, externalId))
    .limit(1);
  if (!row) return null;

  const [roleRows, extraBranchRows] = await Promise.all([
    db
      .select({ id: roles.id, code: roles.code, name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, row.user.id)),
    db
      .select({ branchId: userBranches.branchId })
      .from(userBranches)
      .where(eq(userBranches.userId, row.user.id)),
  ]);

  let permissionCodes: string[] = [];
  if (roleRows.length > 0) {
    const allPermRows = await db
      .select({ code: permissions.code })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, row.user.id));
    permissionCodes = [...new Set(allPermRows.map((p) => p.code))];
  }

  const moduleAccess = row.user.companyId
    ? await getModuleAccessMap(row.user.companyId)
    : {};

  return {
    id: row.user.id,
    externalId: row.user.externalId,
    name: row.user.name,
    email: row.user.email,
    avatarUrl: row.user.avatarUrl,
    status: row.user.status,
    isPlatformAdmin: row.user.isPlatformAdmin,
    companyId: row.user.companyId,
    companyName: row.company?.name ?? null,
    companyStatus: row.company?.status ?? null,
    branchId: row.user.branchId,
    allBranches: row.user.allBranches,
    roles: roleRows,
    permissions: permissionCodes,
    moduleAccess,
    accessibleBranchIds: [
      ...(row.user.branchId ? [row.user.branchId] : []),
      ...extraBranchRows.map((b) => b.branchId),
    ],
  } satisfies CurrentUser;
}

/**
 * Resolve the current authenticated user (request-cached).
 * Returns null when not signed in or when the local record cannot be synced.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (!isClerkConfigured()) return null;
  const { userId } = await auth();
  if (!userId) return null;

  let user = await loadUserByExternalId(userId);
  if (!user) {
    // webhook may lag behind first login — provision inline as a fallback
    try {
      await provisionUserFromClerk(userId);
      user = await loadUserByExternalId(userId);
    } catch (e) {
      console.error("[auth] inline provisioning failed", e);
      return null;
    }
  }

  if (user) {
    // opportunistic last-login stamp (at most once per hour per request path)
    const now = Date.now();
    void db
      .update(users)
      .set({ lastLoginAt: new Date(now) })
      .where(eq(users.id, user.id))
      .catch(() => undefined);
  }
  return user;
});

/** For server actions & route handlers: throws 401 when not signed in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Sesi berakhir. Silakan login kembali.");
  if (user.status !== "ACTIVE") {
    throw new AppError("FORBIDDEN", "Akun Anda tidak aktif. Hubungi administrator.");
  }
  return user;
}

/** Client IP / user-agent for audit trails. */
export async function getRequestMeta(): Promise<{ ip?: string; userAgent?: string }> {
  try {
    const h = await headers();
    return {
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: h.get("user-agent") ?? undefined,
    };
  } catch {
    return {};
  }
}
