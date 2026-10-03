import { getCurrentUser } from "@/core/auth/session";
import { listBranches } from "@/core/tenant/branches";
import { hasPermission } from "@/core/auth/session-helpers";
import { BranchTableClient } from "./branch-table";

export const dynamic = "force-dynamic";

export default async function BranchesSettingsPage() {
  const user = await getCurrentUser();
  if (!user || !user.companyId) return null;
  const branches = await listBranches(user);
  const canManage = hasPermission(user, "branch.manage");

  return (
    <BranchTableClient
      branches={branches}
      canManage={canManage}
      canDelete={canManage && branches.length > 1}
    />
  );
}
