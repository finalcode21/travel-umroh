import "server-only";
import { toPublicError } from "@/lib/errors";
import { assertPermission } from "@/core/acl";
import { requireUserWithFullProfile } from "@/core/auth/session";
import type { ActionResult, CurrentUser } from "@/types";

export { requireUser } from "@/core/auth/session";
export { assertPermission, canAccessBranch } from "@/core/acl";
export { getRequestMeta } from "@/core/auth/session";

/**
 * Wraps a server action body: resolves the current user, enforces a
 * permission, and converts thrown errors into structured results.
 *
 * The resolved user is the full {@link CurrentUser} profile (roles,
 * permissions, module access, accessible branches), which is what the
 * core services and the ACL operate on.
 */
export async function runAction<T>(
  permission: string | null,
  fn: (user: CurrentUser) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const user = await requireUserWithFullProfile();
    if (permission) assertPermission(user, permission);
    const data = await fn(user);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: toPublicError(e) };
  }
}

/** For pages: guard that throws on missing permission. */
export async function requirePermission(permission: string): Promise<CurrentUser> {
  const user = await requireUserWithFullProfile();
  assertPermission(user, permission);
  return user;
}