"use server";

import { runAction } from "@/lib/action";
import { parseWith, roleSchema, roleUpdateSchema, setRolePermissionsSchema } from "@/lib/validation";
import {
  createRole,
  deleteRole,
  setRolePermissions,
  updateRole,
} from "@/core/rbac/service";

export async function createRoleAction(input: unknown) {
  return runAction("role.manage", async (user) => {
    const data = parseWith(roleSchema, input);
    return createRole(user, data);
  });
}

export async function updateRoleAction(roleId: string, input: unknown) {
  return runAction("role.manage", async (user) => {
    const data = parseWith(roleUpdateSchema, input);
    await updateRole(user, roleId, data);
    return { roleId };
  });
}

export async function deleteRoleAction(roleId: string) {
  return runAction("role.manage", async (user) => {
    await deleteRole(user, roleId);
    return { roleId };
  });
}

export async function setRolePermissionsAction(input: unknown) {
  return runAction("role.manage", async (user) => {
    const data = parseWith(setRolePermissionsSchema, input);
    await setRolePermissions(user, data.roleId, data.permissionCodes);
    return { roleId: data.roleId };
  });
}
