import "server-only";
import { toPublicError } from "@/lib/errors";
import { assertPermission } from "@/core/acl";
import { requireUser } from "@/core/auth/session";
import type { ActionResult } from "@/types";

export { requireUser } from "@/core/auth/session";
export { assertPermission, canAccessBranch } from "@/core/acl";
export { getRequestMeta } from "@/core/auth/session";

/**
 * Wraps a server action body: resolves the current user, enforces a
 * permission, and converts thrown errors into structured results.
 */
export async function runAction<T>(
  permission: string | null,
  fn: (user: Awaited<ReturnType<typeof requireUser>>) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const user = await requireUser();
    if (permission) assertPermission(user, permission);
    const data = await fn(user);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: toPublicError(e) };
  }
}

/** For pages: redirect-style guard that throws on missing permission. */
export async function requirePermission(permission: string) {
  const user = await requireUser();
  assertPermission(user, permission);
  return user;
}
