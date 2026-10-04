/**
 * Shared test-tenant setup for Phase 2 integration tests.
 * Creates (idempotently):
 *   - Company A (slug phase2-company-a) + user a-admin@test.local (module perms)
 *   - Company B (slug phase2-company-b) + user b-admin@test.local (module perms)
 *   - Company B staff user b-staff@test.local (module.view only → FORBIDDEN tests)
 * Returns synthetic CurrentUser objects usable directly with engine functions.
 */
import { and, eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, pool } from "../../src/db";
import {
  companies,
  moduleInstallations,
  moduleSettings,
  moduleSubscriptions,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "../../src/db/schema";
import { DEFAULT_ROLE_PERMISSIONS } from "../../src/core/permissions";
import type { CurrentUser } from "../../src/types";

const MODULE_PERMS = [
  "module.view",
  "module.manage",
  "module.install",
  "module.enable",
  "module.disable",
  "module.upgrade",
  "module.uninstall",
  "module.subscribe",
  "module.configure",
  "module.read",
  "subscription.view",
  "subscription.manage",
  "company.view",
  "notification.view",
  // module-registered permissions (notes / notes-pro)
  "notes.view",
  "notes.create",
  "notes.update",
  "notes.delete",
  "notes-pro.view",
];

/** Shared password for all test accounts (login via /api/auth/login). */
export const TEST_PASSWORD = "Phase2Pass!2026";

interface TenantHandles {
  companyA: { id: string; name: string };
  companyB: { id: string; name: string };
  userA: CurrentUser;
  userB: CurrentUser;
  userStaff: CurrentUser;
}

function toCurrentUser(
  row: { id: string; name: string; email: string },
  companyId: string | null,
  companyName: string | null,
  perms: string[],
): CurrentUser {
  return {
    id: row.id,
    externalId: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: null,
    status: "ACTIVE",
    isPlatformAdmin: false,
    companyId,
    companyName,
    companyStatus: companyId ? "ACTIVE" : null,
    branchId: null,
    allBranches: false,
    accessibleBranchIds: [],
    roles: [],
    permissions: perms,
    moduleAccess: {},
  };
}

export async function ensureTestTenants(): Promise<TenantHandles> {
  // 1. companies
  async function ensureCompany(name: string, slug: string) {
    const [existing] = await db.select().from(companies).where(eq(companies.slug, slug));
    if (existing) return existing;
    const [created] = await db.insert(companies).values({ name, slug }).returning();
    return created;
  }
  const companyA = await ensureCompany("Phase2 Company A", "phase2-company-a");
  const companyB = await ensureCompany("Phase2 Company B", "phase2-company-b");

  // 2. permissions registry must contain the module perms (sync normally does
  //    this; scripts bypass the app so upsert here)
  for (const code of MODULE_PERMS) {
    await db
      .insert(permissions)
      .values({ code, name: code, isSystem: true })
      .onConflictDoNothing();
  }
  const permRows = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, MODULE_PERMS));

  // 3. roles per company
  async function ensureRole(companyId: string, code: string, name: string, permCodes: string[]) {
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.companyId, companyId), eq(roles.code, code)));
    const role =
      existing ??
      (
        await db
          .insert(roles)
          .values({ companyId, code, name, isSystem: true })
          .returning()
      )[0];
    const bindings = permCodes
      .map((c) => permRows.find((p) => p.code === c))
      .filter((p): p is { id: string; code: string } => p !== undefined)
      .map((p) => ({ roleId: role.id, permissionId: p.id }));
    if (bindings.length > 0) {
      await db.insert(rolePermissions).values(bindings).onConflictDoNothing();
    }
    return role;
  }

  const roleA = await ensureRole(companyA.id, "COMPANY_ADMIN", "Company Admin", MODULE_PERMS);
  const roleB = await ensureRole(companyB.id, "COMPANY_ADMIN", "Company Admin", MODULE_PERMS);
  const roleStaff = await ensureRole(
    companyB.id,
    "STAFF",
    "Staff",
    DEFAULT_ROLE_PERMISSIONS.STAFF,
  );

  // 4. users
  async function ensureUser(
    email: string,
    name: string,
    companyId: string | null,
    roleId: string,
    perms: string[],
  ) {
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing && (!existing.passwordHash?.startsWith("$2") || !existing.passwordSalt)) {
      // upgrade placeholder/legacy credentials so HTTP login works for API tests
      const salt = bcrypt.genSaltSync(12);
      await db
        .update(users)
        .set({ passwordHash: bcrypt.hashSync(TEST_PASSWORD, salt), passwordSalt: salt })
        .where(eq(users.id, existing.id));
    }
    const salt = bcrypt.genSaltSync(12);
    const user =
      existing ??
      (
        await db
          .insert(users)
          .values({
            email,
            name,
            externalId: crypto.randomUUID(),
            passwordHash: bcrypt.hashSync(TEST_PASSWORD, salt),
            passwordSalt: salt,
            companyId,
          })
          .returning()
      )[0];
    await db.insert(userRoles).values({ userId: user.id, roleId }).onConflictDoNothing();
    return toCurrentUser(user, companyId, companyId ? (companyId === companyA.id ? companyA.name : companyB.name) : null, perms);
  }

  const userA = await ensureUser(
    "a-admin@test.local",
    "Admin A",
    companyA.id,
    roleA.id,
    MODULE_PERMS,
  );
  const userB = await ensureUser(
    "b-admin@test.local",
    "Admin B",
    companyB.id,
    roleB.id,
    MODULE_PERMS,
  );
  const userStaff = await ensureUser(
    "b-staff@test.local",
    "Staff B",
    companyB.id,
    roleStaff.id,
    DEFAULT_ROLE_PERMISSIONS.STAFF,
  );

  return {
    companyA: { id: companyA.id, name: companyA.name },
    companyB: { id: companyB.id, name: companyB.name },
    userA,
    userB,
    userStaff,
  };
}

/** Deletes all module lifecycle state for the given companies (fresh runs). */
export async function resetCompanyModuleState(...companyIds: string[]): Promise<void> {
  for (const companyId of companyIds) {
    await db.delete(moduleInstallations).where(eq(moduleInstallations.companyId, companyId));
    await db.delete(moduleSubscriptions).where(eq(moduleSubscriptions.companyId, companyId));
    await db.delete(moduleSettings).where(eq(moduleSettings.companyId, companyId));
  }
}

export async function cleanupTestTenants(): Promise<void> {
  // deleting companies cascades installations/subscriptions/settings/audit
  await db.delete(companies).where(inArray(companies.slug, ["phase2-company-a", "phase2-company-b"]));
  await db.delete(users).where(inArray(users.email, ["a-admin@test.local", "b-admin@test.local", "b-staff@test.local"]));
}

export { pool };
