import { getCurrentUser } from "@/core/auth/session";
import { listUsers } from "@/core/auth/users-admin";
import { listRoles } from "@/core/rbac/service";
import { listBranches } from "@/core/tenant/branches";
import { hasPermission } from "@/core/auth/session-helpers";
import { UsersTableClient } from "./users-table";

export const dynamic = "force-dynamic";

export default async function UsersSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [users, roles, branches] = await Promise.all([
    listUsers(user),
    listRoles(user),
    user.companyId ? listBranches(user) : Promise.resolve([]),
  ]);

  return (
    <UsersTableClient
      users={users}
      roles={roles.map((r) => ({ id: r.id, name: r.name }))}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      canManage={hasPermission(user, "user.manage")}
    />
  );
}
