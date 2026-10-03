import { getCurrentUser } from "@/core/auth/session";
import { listRoles, listPermissionGroups } from "@/core/rbac/service";
import { hasPermission } from "@/core/auth/session-helpers";
import { RolesTableClient } from "./roles-table";

export const dynamic = "force-dynamic";

export default async function RolesSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [roles, groups] = await Promise.all([
    listRoles(user),
    listPermissionGroups(),
  ]);

  return (
    <RolesTableClient
      roles={roles}
      groups={groups}
      canManage={hasPermission(user, "role.manage")}
    />
  );
}
