import type { CurrentUser } from "@/types";

/** Pure check usable in server components (no throw). */
export function hasPermission(user: CurrentUser, permission: string): boolean {
  if (user.isPlatformAdmin) return true;
  return user.permissions.includes(permission);
}
