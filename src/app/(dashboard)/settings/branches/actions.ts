"use server";

import { runAction } from "@/lib/action";
import { parseWith, branchSchema, branchUpdateSchema } from "@/lib/validation";
import { createBranch, deleteBranch, updateBranch } from "@/core/tenant/branches";

export async function createBranchAction(input: unknown) {
  return runAction("branch.manage", async (user) => {
    const data = parseWith(branchSchema, input);
    return createBranch(user, data);
  });
}

export async function updateBranchAction(branchId: string, input: unknown) {
  return runAction("branch.manage", async (user) => {
    const data = parseWith(branchUpdateSchema, input);
    return updateBranch(user, branchId, data);
  });
}

export async function deleteBranchAction(branchId: string) {
  return runAction("branch.manage", async (user) => {
    await deleteBranch(user, branchId);
    return { branchId };
  });
}
