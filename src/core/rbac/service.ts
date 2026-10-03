import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  modules,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/core/audit/service";
import { recordActivity } from "@/core/activity/service";
import type { CurrentUser } from "@/types";

export interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissionCodes: string[];
}

export async function listRoles(user: CurrentUser): Promise<RoleRow[]> {
  const companyRoles = await db.query.roles.findMany({
    where: user.companyId ? eq(roles.companyId, user.companyId) : undefined,
    with: {
      users: { columns: { userId: true } },
      permissions: { with: { permission: { columns: { code: true } } } },
    },
    orderBy: (r, { asc: a }) => [a(r.name)],
  });
  return companyRoles.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    userCount: r.users.length,
    permissionCodes: r.permissions.map((rp) => rp.permission.code),
  }));
}

export async function createRole(
  actor: CurrentUser,
  input: { name: string; code?: string; description?: string },
): Promise<RoleRow> {
  if (!actor.companyId) {
    throw new AppError("FORBIDDEN", "Platform role dikelola khusus oleh sistem.");
  }
  const code =
    input.code ??
    input.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const [dup] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.companyId, actor.companyId), eq(roles.code, code)));
  if (dup) throw new AppError("CONFLICT", `Role dengan kode "${code}" sudah ada.`);

  const [role] = await db
    .insert(roles)
    .values({
      companyId: actor.companyId,
      code,
      name: input.name,
      description: input.description,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning();

  await recordAudit({
    userId: actor.id,
    companyId: actor.companyId,
    action: "CREATE",
    module: "core",
    resource: "role",
    resourceId: role.id,
    newValues: { code: role.code, name: role.name },
  });
  return { ...role, isSystem: false, userCount: 0, permissionCodes: [] };
}

export async function updateRole(
  actor: CurrentUser,
  roleId: string,
  input: { name?: string; description?: string; permissionCodes?: string[] },
): Promise<void> {
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId));
  if (!role) throw new AppError("NOT_FOUND", "Role tidak ditemukan.");
  if (role.companyId !== actor.companyId && !actor.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Role milik perusahaan lain.");
  }
  if (role.code === "SUPER_ADMIN" && !actor.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Role Super Admin tidak dapat diubah.");
  }

  await db
    .update(roles)
    .set({
      name: input.name ?? role.name,
      description: input.description ?? role.description,
      updatedBy: actor.id,
    })
    .where(eq(roles.id, roleId));

  if (input.permissionCodes) {
    await setRolePermissions(actor, roleId, input.permissionCodes);
  } else {
    await recordAudit({
      userId: actor.id,
      companyId: role.companyId,
      action: "UPDATE",
      module: "core",
      resource: "role",
      resourceId: roleId,
      newValues: { name: input.name ?? role.name },
    });
  }
}

export async function deleteRole(actor: CurrentUser, roleId: string): Promise<void> {
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId));
  if (!role) throw new AppError("NOT_FOUND", "Role tidak ditemukan.");
  if (role.companyId !== actor.companyId && !actor.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Role milik perusahaan lain.");
  }
  if (role.isSystem) {
    throw new AppError("CONFLICT", "Role bawaan sistem tidak dapat dihapus.");
  }
  const [{ id: assignedUser }] = await db
    .select({ id: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.roleId, roleId))
    .limit(1);
  if (assignedUser) {
    throw new AppError(
      "CONFLICT",
      "Role masih dipakai oleh pengguna. Lepas role terlebih dahulu.",
    );
  }
  await db.delete(roles).where(eq(roles.id, roleId));
  await recordAudit({
    userId: actor.id,
    companyId: role.companyId,
    action: "DELETE",
    module: "core",
    resource: "role",
    resourceId: roleId,
    oldValues: { code: role.code, name: role.name },
  });
}

/** Replaces the role's permission set in one shot (matrix editor). */
export async function setRolePermissions(
  actor: CurrentUser,
  roleId: string,
  permissionCodes: string[],
): Promise<void> {
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId));
  if (!role) throw new AppError("NOT_FOUND", "Role tidak ditemukan.");
  if (role.companyId !== actor.companyId && !actor.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Role milik perusahaan lain.");
  }

  const permRows =
    permissionCodes.length > 0
      ? await db.select().from(permissions)
      : [];
  const byCode = new Map(permRows.map((p) => [p.code, p.id]));

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  const bindings = permissionCodes
    .map((code) => {
      const id = byCode.get(code);
      return id ? { roleId, permissionId: id } : null;
    })
    .filter((v): v is { roleId: string; permissionId: string } => v !== null);
  if (bindings.length > 0) {
    await db.insert(rolePermissions).values(bindings).onConflictDoNothing();
  }

  await recordAudit({
    userId: actor.id,
    companyId: role.companyId,
    action: "UPDATE",
    module: "core",
    resource: "role_permissions",
    resourceId: roleId,
    newValues: { permissionCodes },
  });
  await recordActivity({
    companyId: role.companyId,
    userId: actor.id,
    type: "role.permissions",
    message: `Permission role ${role.name} diperbarui (${permissionCodes.length} permission)`,
  });
}

export async function assignUserRoles(
  actor: CurrentUser,
  userId: string,
  roleIds: string[],
): Promise<void> {
  const [target] = await db.select().from(users).where(eq(users.id, userId));
  if (!target) throw new AppError("NOT_FOUND", "Pengguna tidak ditemukan.");
  if (target.companyId !== actor.companyId && !actor.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Pengguna milik perusahaan lain.");
  }
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  if (roleIds.length > 0) {
    await db
      .insert(userRoles)
      .values(roleIds.map((roleId) => ({ userId, roleId })))
      .onConflictDoNothing();
  }
  await recordAudit({
    userId: actor.id,
    companyId: target.companyId,
    action: "UPDATE",
    module: "core",
    resource: "user_roles",
    resourceId: userId,
    newValues: { roleIds },
  });
}

/* ------------------------ Permission catalog ------------------------ */

export interface PermissionGroup {
  moduleCode: string;
  moduleName: string;
  permissions: { code: string; name: string; description: string | null }[];
}

/** All registered permissions grouped by module (core group included). */
export async function listPermissionGroups(): Promise<PermissionGroup[]> {
  const rows = await db
    .select({
      code: permissions.code,
      name: permissions.name,
      description: permissions.description,
      moduleCode: permissions.moduleCode,
      moduleName: modules.name,
    })
    .from(permissions)
    .leftJoin(modules, eq(modules.code, permissions.moduleCode))
    .orderBy(asc(permissions.code));

  const groups = new Map<string, PermissionGroup>();
  for (const row of rows) {
    const key = row.moduleCode ?? "core";
    if (!groups.has(key)) {
      groups.set(key, {
        moduleCode: key,
        moduleName: row.moduleName ?? "Core",
        permissions: [],
      });
    }
    groups.get(key)!.permissions.push({
      code: row.code,
      name: row.name,
      description: row.description,
    });
  }
  return [...groups.values()];
}
