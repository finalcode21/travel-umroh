import { clerkClient } from "@clerk/nextjs/server";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  branches,
  companies,
  rolePermissions,
  roles,
  userRoles,
  users,
  type users as usersTable,
} from "@/db/schema";
import {
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLES,
  PLATFORM_ROLE,
} from "@/core/permissions";
import { recordActivity } from "@/core/activity/service";
import type { InferSelectModel } from "drizzle-orm";

type UserRow = InferSelectModel<typeof usersTable>;

interface ClerkUserData {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

async function readClerkUser(clerkUserId: string): Promise<ClerkUserData> {
  const client = await clerkClient();
  const clerkUser = await client.users.getUser(clerkUserId);
  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error("Clerk user has no email address");
  return {
    id: clerkUser.id,
    email,
    name:
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      clerkUser.username ||
      email,
    avatarUrl: clerkUser.imageUrl ?? null,
  };
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "company"
  );
}

/** Creates the per-company default roles and binds core permissions. */
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

/** Company admin gets every registered core + module permission. */
async function grantAllPermissionsToRole(roleId: string) {
  const allPerms = await db.query.permissions.findMany();
  for (const p of allPerms) {
    await db
      .insert(rolePermissions)
      .values({ roleId, permissionId: p.id })
      .onConflictDoNothing();
  }
}

/**
 * Sync a Clerk user into the local database.
 * - first user ever  → platform Super Admin
 * - later users      → own new tenant (company + branch + Company Admin role)
 * Idempotent: returns the existing row when the user is already synced.
 */
export async function provisionUserFromClerk(clerkUserId: string): Promise<UserRow> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.externalId, clerkUserId))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const clerkData = await readClerkUser(clerkUserId);
  const [{ total }] = await db
    .select({ total: count() })
    .from(users);
  const isFirstUser = Number(total) === 0;

  if (isFirstUser) {
    // Platform role (companyId = null)
    let [platformRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.code, PLATFORM_ROLE.code))
      .limit(1);
    if (!platformRole) {
      [platformRole] = await db
        .insert(roles)
        .values({
          companyId: null,
          code: PLATFORM_ROLE.code,
          name: PLATFORM_ROLE.name,
          description: PLATFORM_ROLE.description,
          isSystem: true,
        })
        .returning();
      await grantAllPermissionsToRole(platformRole.id);
    }

    const [user] = await db
      .insert(users)
      .values({
        externalId: clerkData.id,
        email: clerkData.email,
        name: clerkData.name,
        avatarUrl: clerkData.avatarUrl,
        isPlatformAdmin: true,
        allBranches: true,
        status: "ACTIVE",
        createdBy: null,
      })
      .returning();
    await db
      .insert(userRoles)
      .values({ userId: user.id, roleId: platformRole.id })
      .onConflictDoNothing();
    await recordActivity({
      companyId: null,
      userId: user.id,
      type: "user.provision",
      message: `${user.name} terdaftar sebagai Super Admin platform`,
    });
    return user;
  }

  // Self-serve tenant onboarding
  const companyName = `${clerkData.name.split(" ")[0]}'s Travel`;
  let slug = slugify(companyName);
  const slugTaken = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.slug, slug))
    .limit(1);
  if (slugTaken.length > 0) slug = `${slug}-${Date.now().toString(36)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: companyName, slug, createdBy: null })
    .returning();

  const [branch] = await db
    .insert(branches)
    .values({ companyId: company.id, name: "Kantor Pusat", code: "HQ" })
    .returning();

  await createDefaultRolesForCompany(company.id);

  const [companyAdminRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.companyId, company.id))
    .limit(1);

  const [user] = await db
    .insert(users)
    .values({
      externalId: clerkData.id,
      email: clerkData.email,
      name: clerkData.name,
      avatarUrl: clerkData.avatarUrl,
      companyId: company.id,
      branchId: branch.id,
      allBranches: true,
      status: "ACTIVE",
    })
    .returning();

  if (companyAdminRole) {
    await db
      .insert(userRoles)
      .values({ userId: user.id, roleId: companyAdminRole.id })
      .onConflictDoNothing();
    // Company Admin receives every permission registered so far
    const rolePerms = await db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, companyAdminRole.id))
      .limit(1);
    if (rolePerms.length === 0) await grantAllPermissionsToRole(companyAdminRole.id);
  }

  await recordActivity({
    companyId: company.id,
    userId: user.id,
    type: "company.created",
    message: `Perusahaan ${company.name} dibuat melalui registrasi ${user.email}`,
  });
  return user;
}

/** Webhook handler: user.updated */
export async function updateLocalUserFromClerk(clerkUserId: string) {
  const clerkData = await readClerkUser(clerkUserId);
  await db
    .update(users)
    .set({
      email: clerkData.email,
      name: clerkData.name,
      avatarUrl: clerkData.avatarUrl,
    })
    .where(eq(users.externalId, clerkUserId));
}

/** Webhook handler: user.deleted → soft-deactivate. */
export async function deactivateLocalUser(clerkUserId: string) {
  await db
    .update(users)
    .set({ status: "INACTIVE" })
    .where(eq(users.externalId, clerkUserId));
}
