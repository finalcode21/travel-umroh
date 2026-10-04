import { AppError } from "@/lib/errors";
import { permissionModuleMap } from "@/modules/registry";
import type { CurrentUser } from "@/types";

export interface PermissionDecision {
  allowed: boolean;
  /** why access was denied (shown to user / logged) */
  reason?: string;
  /** the layer that rejected, per PRD §11 */
  layer:
    | "USER_STATUS"
    | "COMPANY_STATUS"
    | "MODULE_SUBSCRIPTION"
    | "PERMISSION";
}

/**
 * Layered server-side authorization:
 *   User → Company → Module Subscription → Module Permission → Permission
 * Platform admins (Super Admin) bypass tenant checks by design.
 */
export function checkPermission(
  user: CurrentUser,
  permission: string,
): PermissionDecision {
  if (user.isPlatformAdmin) return { allowed: true };

  if (user.status !== "ACTIVE") {
    return { allowed: false, reason: "Akun tidak aktif.", layer: "USER_STATUS" };
  }

  if (user.companyStatus && user.companyStatus !== "ACTIVE") {
    return {
      allowed: false,
      reason: "Perusahaan dinonaktifkan.",
      layer: "COMPANY_STATUS",
    };
  }

  // module subscription layer
  const permissionModule = permissionModuleMap.get(permission) ?? null;
  if (permissionModule) {
    const access = user.moduleAccess[permissionModule];
    if (!access || access.access !== "ACTIVE") {
      return {
        allowed: false,
        reason: "Langganan modul tidak aktif.",
        layer: "MODULE_SUBSCRIPTION",
      };
    }
  }

  if (!user.permissions.includes(permission)) {
    return {
      allowed: false,
      reason: "Anda tidak memiliki permission ini.",
      layer: "PERMISSION",
    };
  }
  return { allowed: true };
}

/** Throws AppError suitable for server actions / route handlers. */
export function assertPermission(
  user: CurrentUser,
  permission: string,
): void {
  const decision = checkPermission(user, permission);
  if (!decision.allowed) {
    if (decision.layer === "MODULE_SUBSCRIPTION") {
      throw new AppError(
        "SUBSCRIPTION_REQUIRED",
        decision.reason ?? "Langganan modul tidak aktif.",
      );
    }
    throw new AppError("FORBIDDEN", decision.reason ?? "Akses ditolak.");
  }
}

/**
 * Any-of permission OR: succeeds if the user holds at least one of the
 * listed permissions or module subscriptions (OR across the list, first
 * match wins). Fails with FORBIDDEN only when none of the alternatives
 * is satisfied. Returns normally when at least one alternative passes.
 *
 * Used by API routes and server actions that need a union of rights
 * (e.g. "edit your own record OR edit any record in the company").
 */
export function assertAnyPermission(
  user: CurrentUser,
  permissions: readonly string[],
): void {
  if (!permissions.length) return;
  for (const permission of permissions) {
    const decision = checkPermission(user, permission);
    if (decision.allowed) return;
  }
  // every alternative denied — build a single FORBIDDEN so the caller
  // can re-throw with the aggregate reason instead of the first one.
  const denied = permissions.map((p) =>
    checkPermission(user, p),
  );
  const reasons = new Set<string>();
  for (const d of denied) {
    if (d.reason) reasons.add(d.reason);
  }
  throw new AppError(
    "FORBIDDEN",
    reasons.size
      ? Array.from(reasons).join("; ")
      : "Akses ditolak.",
  );
}

/**
 * Branch-scope check for resources tied to a branch.
 * Rules: platform admins unrestricted; allBranches users unrestricted;
 * otherwise the branch must be the primary or explicitly granted.
 */
export function canAccessBranch(
  user: CurrentUser,
  branchId: string | null | undefined,
): boolean {
  if (!branchId) return true;
  if (user.isPlatformAdmin || user.allBranches) return true;
  return user.accessibleBranchIds.includes(branchId);
}

export function assertBranchAccess(
  user: CurrentUser,
  branchId: string | null | undefined,
): void {
  if (!canAccessBranch(user, branchId)) {
    throw new AppError("FORBIDDEN", "Anda tidak memiliki akses ke cabang ini.");
  }
}
