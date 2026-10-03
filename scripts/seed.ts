// Must be first: loads .env.local before src/db reads process.env.
import "./load-env";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { CORE_PERMISSIONS, PLATFORM_ROLE } from "../src/core/permissions";
import { moduleManifests } from "../src/modules/registry";
import { SYSTEM_SETTINGS_DEFAULTS } from "../src/core/settings/service";
import { signUp } from "../src/core/auth/sessions";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const db = drizzle(pool, { schema, casing: "snake_case" });

const DEFAULT_SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? "admin@demo.com";
const DEFAULT_SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? "admin12345";
const DEFAULT_SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME ?? "Platform Super Admin";

async function main() {
  console.log("Seeding core data…");

  // 1. core permissions
  for (const p of CORE_PERMISSIONS) {
    await db
      .insert(schema.permissions)
      .values({ code: p.code, name: p.name, description: p.description, moduleCode: null, isSystem: true })
      .onConflictDoUpdate({
        target: schema.permissions.code,
        set: { name: p.name, description: p.description },
      });
  }
  console.log(`✔ ${CORE_PERMISSIONS.length} core permissions`);

  // 2. platform Super Admin role (companyId = null)
  let [platformRole] = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.code, PLATFORM_ROLE.code));
  if (!platformRole) {
    [platformRole] = await db
      .insert(schema.roles)
      .values({
        companyId: null,
        code: PLATFORM_ROLE.code,
        name: PLATFORM_ROLE.name,
        description: PLATFORM_ROLE.description,
        isSystem: true,
      })
      .returning();
    console.log("✔ Platform Super Admin role");
  }

  // 3. bind all known permissions to Super Admin
  const allPerms = await db.select().from(schema.permissions);
  for (const p of allPerms) {
    await db
      .insert(schema.rolePermissions)
      .values({ roleId: platformRole.id, permissionId: p.id })
      .onConflictDoNothing();
  }

  // 3b. Bootstrap the platform Super Admin account (local email+password auth).
  // Must run AFTER the SUPER_ADMIN role exists — signUp() binds that role.
  const [existingAdmin] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, DEFAULT_SUPER_ADMIN_EMAIL));
  if (existingAdmin) {
    console.log(`⚠ Super Admin ${DEFAULT_SUPER_ADMIN_EMAIL} already exists — skipping bootstrap.`);
  } else {
    const { user } = await signUp({
      name: DEFAULT_SUPER_ADMIN_NAME,
      email: DEFAULT_SUPER_ADMIN_EMAIL,
      password: DEFAULT_SUPER_ADMIN_PASSWORD,
    });
    console.log(`✔ Super Admin ${DEFAULT_SUPER_ADMIN_EMAIL} created (isPlatformAdmin=${user.isPlatformAdmin})`);
  }

  // 4. module registry from manifests
  for (const m of moduleManifests) {
    await db
      .insert(schema.modules)
      .values({
        code: m.code,
        name: m.name,
        version: m.version,
        description: m.description,
        category: m.category,
        author: m.author,
        priceMonthly: m.priceMonthly ?? 0,
        billingCycle: m.billingCycle ?? "MONTHLY",
        trialDays: m.trialDays,
      })
      .onConflictDoUpdate({
        target: schema.modules.code,
        set: {
          name: m.name,
          version: m.version,
          description: m.description,
          category: m.category,
          priceMonthly: m.priceMonthly ?? 0,
          trialDays: m.trialDays,
        },
      });
    for (const dep of m.dependencies ?? []) {
      await db
        .insert(schema.moduleDependencies)
        .values({ moduleCode: m.code, dependsOnCode: dep })
        .onConflictDoNothing();
    }
    for (const p of m.permissions) {
      await db
        .insert(schema.permissions)
        .values({ code: p.code, name: p.name, description: p.description, moduleCode: m.code, isSystem: true })
        .onConflictDoUpdate({
          target: schema.permissions.code,
          set: { name: p.name, moduleCode: m.code },
        });
    }
  }
  console.log(`✔ ${moduleManifests.length} modules registered (notes, notes-pro)`);

  // 5. system settings defaults
  for (const [key, value] of Object.entries(SYSTEM_SETTINGS_DEFAULTS)) {
    await db
      .insert(schema.systemSettings)
      .values({ key, value: value as never })
      .onConflictDoNothing();
  }
  console.log("✔ system settings defaults");

  console.log("\nSelesai.");
  console.log("🌐 Login di /login dengan:");
  console.log(`   Email    : ${DEFAULT_SUPER_ADMIN_EMAIL}`);
  console.log(`   Password : ${DEFAULT_SUPER_ADMIN_PASSWORD}`);
  console.log("   (Set SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD untuk mengubah default.)");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
