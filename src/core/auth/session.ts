import { cache } from "react";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import {
  companies,
  permissions,
  rolePermissions,
  roles,
  userBranches,
  userRoles,
} from "@/db/schema";
import { isAuthenticated, requireUser, getCurrentUser as getSessionUser } from "./sessions";
import { getModuleAccessMap } from "@/core/modules/access";
import type { CurrentUser } from "@/types";

/**
 * Resolve the authenticated user with a fully flattened profile.
 *
 * Loads (in one request):
 *   - roles bound to the user
 *   - flattened permission codes across all the user's roles
 *   - module access map for the user's company (if any)
 *   - primary + granted extra branches
 *
 * This is the single place where the "CurrentUser" shape is produced,
 * so any downstream ACL / navigation / action code reads one source of truth.
 */
async function loadUserProfile(
  sessionUser: Awaited<ReturnType<typeof getSessionUser>>,
): Promise<CurrentUser | null> {
  if (!sessionUser) return null;

  const [roleRows] = await Promise.all([
    db
      .select({ id: roles.id, code: roles.code, name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, sessionUser.id)),
  ]);

  let permissionCodes: string[] = [];
  if (roleRows.length > 0) {
    const allPermRows = await db
      .select({ code: permissions.code })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, sessionUser.id));
    permissionCodes = [...new Set(allPermRows.map((p) => p.code))];
  }

  const moduleAccess = sessionUser.companyId
    ? await getModuleAccessMap(sessionUser.companyId)
    : {};

  const [companyRow] = sessionUser.companyId
    ? await db
        .select({ name: companies.name, status: companies.status })
        .from(companies)
        .where(eq(companies.id, sessionUser.companyId))
        .limit(1)
    : [];

  const [extraBranchRows] = await Promise.all([
    db
      .select({ branchId: userBranches.branchId })
      .from(userBranches)
      .where(eq(userBranches.userId, sessionUser.id)),
  ]);

  return {
    id: sessionUser.id,
    externalId: sessionUser.externalId,
    name: sessionUser.name,
    email: sessionUser.email,
    avatarUrl: sessionUser.avatarUrl,
    status: sessionUser.status,
    isPlatformAdmin: sessionUser.isPlatformAdmin,
    companyId: sessionUser.companyId,
    companyName: companyRow?.name ?? null,
    companyStatus: companyRow?.status ?? null,
    branchId: sessionUser.branchId,
    allBranches: sessionUser.allBranches,
    roles: roleRows,
    permissions: permissionCodes,
    moduleAccess,
    accessibleBranchIds: [
      ...(sessionUser.branchId ? [sessionUser.branchId] : []),
      ...extraBranchRows.map((b) => b.branchId),
    ],
  } satisfies CurrentUser;
}

/** For server actions & route handlers: throws 401 when not signed in. */
export async function requireUserWithFullProfile(): Promise<CurrentUser> {
  const user = await requireUser();
  return (
    await loadUserProfile(user)
  ) ?? {
    id: "",
    externalId: "",
    name: "",
    email: "",
    avatarUrl: null,
    status: "ACTIVE",
    isPlatformAdmin: false,
    companyId: null,
    companyName: null,
    companyStatus: null,
    branchId: null,
    allBranches: false,
    accessibleBranchIds: [],
    roles: [],
    permissions: [],
    moduleAccess: {},
  };
}

/** Resolve the current authenticated user with full profile (request-cached). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  return loadUserProfile(await getSessionUser());
});

/** Client IP / user-agent for audit trails. */
export async function getRequestMeta(): Promise<{ ip?: string; userAgent?: string }> {
  try {
    const h = await headers();
    return {
      ip: h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean)[0] ?? undefined,
      userAgent: h.get("user-agent") ?? undefined,
    };
  } catch {
    return {};
  }
}

export { isAuthenticated, requireUser };
