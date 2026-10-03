import { db } from "@/db";
import { rolePermissions, roles } from "@/db/schema";
import {
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLES,
} from "@/core/permissions";

/**
 * Creates the per-company default roles and binds their core permissions.
 * Called whenever a new company is provisioned.
 */
export async function createDefaultRolesForCompany(
  companyId: string,
  createdBy?: string,
) {
  const allPerms = await db.query.permissions.findMany();

  for (const roleDef of DEFAULT_ROLES) {
    const [role] = await db
      .insert(roles)
      .values({
        companyId,
        code: roleDef.code,
        name: roleDef.name,
        description: roleDef.description,
        isSystem: true,
        createdBy,
      })
      .returning();

    const permCodes = DEFAULT_ROLE_PERMISSIONS[roleDef.code] ?? [];
    const bindings = permCodes
      .map((code) => {
        const perm = allPerms.find((p) => p.code === code);
        return perm ? { roleId: role.id, permissionId: perm.id } : null;
      })
      .filter((v): v is { roleId: string; permissionId: string } => v !== null);

    if (bindings.length > 0) {
      await db.insert(rolePermissions).values(bindings).onConflictDoNothing();
    }
  }
}