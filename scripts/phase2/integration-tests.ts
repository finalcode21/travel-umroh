/**
 * Phase 2 INTEGRATION tests (PRD §45, §58): lifecycle matrix + scenarios A–G
 * against the real engine + Neon DB. Run: npx tsx scripts/phase2/integration-tests.ts
 */
import "../load-env";
import { and, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditLogs,
  moduleDependencies,
  moduleInstallations,
  moduleMigrations,
  moduleSubscriptions,
  modules,
  permissions,
} from "../../src/db/schema";
import {
  getInstallation,
  getLatestSubscription,
  installModule,
  saveModuleSettings,
  setModuleEnabled,
  subscribeModule,
  uninstallModule,
  upgradeModule,
  syncModuleRegistry,
  getModuleSettingsMap,
} from "../../src/core/modules/engine";
import { getModuleAccessMap } from "../../src/core/modules/access";
import { buildNavigation } from "../../src/core/navigation/build";
import { AppError } from "../../src/lib/errors";
import { moduleManifests } from "../../src/modules/registry";
import { ensureTestTenants, pool, resetCompanyModuleState, type TenantHandles } from "./test-tenants";
import { expect, expectEqual, printSummary, test } from "./harness";
import type { ModuleManifest } from "../../src/types";

let failed = 0;
let t: TenantHandles;

function expectAppError(fn: () => Promise<unknown>, code: string, label: string) {
  return (async () => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof AppError) {
        expectEqual(e.code, code, label);
        return;
      }
      throw new Error(`${label}: non-AppError thrown: ${e}`);
    }
    throw new Error(`${label}: expected AppError ${code}, but operation succeeded`);
  })();
}

async function latestAudit(companyId: string, action: string, resourceId: string) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.companyId, companyId),
        eq(auditLogs.action, action),
        eq(auditLogs.resourceId, resourceId),
      ),
    );
  return rows;
}

async function main() {
  t = await ensureTestTenants();
  await resetCompanyModuleState(t.companyA.id);
  await resetCompanyModuleState(t.companyB.id);
  await syncModuleRegistry();

  /* ------------------------- Registry (PRD §6) ------------------------- */

  await test("registry: modules synced with correct versions", async () => {
    const rows = await db.select().from(modules).where(inArray(modules.code, ["notes", "notes-pro"]));
    expectEqual(rows.length, 2, "both modules in registry");
    const notes = rows.find((r) => r.code === "notes");
    const pro = rows.find((r) => r.code === "notes-pro");
    expectEqual(notes?.version, "1.0.0", "notes version");
    expectEqual(pro?.version, "1.0.0", "notes-pro version");
  });

  await test("registry: dependency row carries version constraint (PRD §27)", async () => {
    const [dep] = await db
      .select()
      .from(moduleDependencies)
      .where(and(eq(moduleDependencies.moduleCode, "notes-pro"), eq(moduleDependencies.dependsOnCode, "notes")));
    expect(dep !== undefined, "dependency row exists");
    expectEqual(dep!.requiredVersion, ">=1.0.0 <2.0.0", "constraint stored");
  });

  await test("registry: module permissions registered (PRD §22)", async () => {
    const rows = await db
      .select()
      .from(permissions)
      .where(inArray(permissions.code, ["notes.view", "notes.create", "notes-pro.view"]));
    expectEqual(rows.length, 3, "module permissions present");
    expect(rows.every((r) => r.moduleCode !== null), "permissions carry module ownership");
  });

  /* --------------------- Subscription gate (PRD §12) --------------------- */

  await test("subscription: install without subscription blocked (PRD §45)", async () => {
    await expectAppError(
      () => installModule(t.userB, "notes"),
      "MODULE_SUBSCRIPTION_REQUIRED",
      "install without subscription",
    );
  });

  await test("subscription: subscribe creates TRIAL (Scenario A step 1)", async () => {
    const sub = await subscribeModule(t.userA, "notes");
    expectEqual(sub.status, "TRIAL", "trial status");
    await expectAppError(
      () => subscribeModule(t.userA, "notes"),
      "CONFLICT",
      "duplicate subscribe rejected",
    );
  });

  /* --------------- Scenario A: install → enable → configure --------------- */

  await test("Scenario A: install Notes → ACTIVE (PRD §58)", async () => {
    const result = await installModule(t.userA, "notes");
    expectEqual(result.status, "ACTIVE", "install result");
    const inst = await getInstallation(t.companyA.id, (await moduleByCode("notes")).id);
    expect(inst !== null, "installation row exists");
    expectEqual(inst!.status, "ACTIVE", "installation ACTIVE");
    expectEqual(inst!.installedVersion, "1.0.0", "installed version tracked (§26)");
  });

  await test("installation: duplicate install is idempotent, single row (PRD §15/§37)", async () => {
    await installModule(t.userA, "notes");
    await installModule(t.userA, "notes");
    const mod = await moduleByCode("notes");
    const inst = await getInstallation(t.companyA.id, mod.id);
    expectEqual(inst!.installedVersion, "1.0.0", "same version");
    const all = await db
      .select()
      .from(moduleInstallations)
      .where(and(eq(moduleInstallations.companyId, t.companyA.id), eq(moduleInstallations.moduleId, mod.id)));
    expectEqual(all.length, 1, "exactly one installation row");
  });

  await test("audit: MODULE_INSTALL_STARTED + MODULE_INSTALLED recorded (PRD §32)", async () => {
    const started = await latestAudit(t.companyA.id, "MODULE_INSTALL_STARTED", "notes");
    const done = await latestAudit(t.companyA.id, "MODULE_INSTALLED", "notes");
    expect(started.length > 0, "STARTED audit present");
    expect(done.length > 0, "INSTALLED audit present");
  });

  await test("configuration: save valid settings (Scenario A configure)", async () => {
    await saveModuleSettings(t.userA, "notes", { maxNotesPerUser: 50, defaultPriority: "HIGH" });
    const map = await getModuleSettingsMap(t.companyA.id, "notes");
    expectEqual(map.maxNotesPerUser, 50, "saved number");
    expectEqual(map.defaultPriority, "HIGH", "saved select");
    const audits = await latestAudit(t.companyA.id, "MODULE_CONFIGURATION_UPDATED", "notes");
    expect(audits.length > 0, "configuration audited (§32)");
  });

  await test("configuration: invalid select value rejected (PRD §23)", async () => {
    await expectAppError(
      () => saveModuleSettings(t.userA, "notes", { defaultPriority: "URGENT" }),
      "MODULE_CONFIGURATION_INVALID",
      "invalid select value",
    );
  });

  await test("configuration: unknown setting key rejected (PRD §23)", async () => {
    await expectAppError(
      () => saveModuleSettings(t.userA, "notes", { hackerKey: true }),
      "MODULE_CONFIGURATION_INVALID",
      "unknown key",
    );
  });

  /* --------------- Scenario B: dependency chain (PRD §58) --------------- */

  await test("Scenario B: Notes Pro install auto-installs subscribed dependency", async () => {
    await subscribeModule(t.userA, "notes-pro");
    const result = await installModule(t.userA, "notes-pro");
    expectEqual(result.status, "ACTIVE", "notes-pro installed");
    const notesMod = await moduleByCode("notes");
    const inst = await getInstallation(t.companyA.id, notesMod.id);
    expectEqual(inst!.status, "ACTIVE", "dependency Notes still ACTIVE");
  });

  /* --------------- Tenant isolation (PRD §46, §58G) --------------- */

  await test("isolation: Company B cannot see Company A subscription/install", async () => {
    const subB = await getLatestSubscription(t.companyB.id, (await moduleByCode("notes")).id);
    expectEqual(subB, null, "B has no subscription for notes");
    const accessB = await getModuleAccessMap(t.companyB.id);
    expectEqual(accessB["notes"]?.access, "NOT_SUBSCRIBED", "B sees notes as not subscribed");
  });

  await test("isolation: Company B lifecycle ops cannot touch Company A state", async () => {
    await expectAppError(
      () => setModuleEnabled(t.userB, "notes", true),
      "MODULE_NOT_INSTALLED",
      "B enable sees only B's installations",
    );
    await expectAppError(
      () => uninstallModule(t.userB, "notes"),
      "MODULE_NOT_INSTALLED",
      "B uninstall sees only B's installations",
    );
    const mod = await moduleByCode("notes");
    const instA = await getInstallation(t.companyA.id, mod.id);
    expectEqual(instA!.status, "ACTIVE", "A installation untouched by B's attempts");
  });

  /* ---------- Dependency uninstall protection (PRD §11, §58D) ---------- */

  await test("Scenario D: uninstall Notes blocked while Notes Pro installed", async () => {
    await expectAppError(
      () => uninstallModule(t.userA, "notes"),
      "MODULE_UNINSTALL_BLOCKED",
      "uninstall blocked",
    );
    const mod = await moduleByCode("notes");
    const inst = await getInstallation(t.companyA.id, mod.id);
    expectEqual(inst!.status, "ACTIVE", "no data/state change on blocked uninstall");
    const audits = await latestAudit(t.companyA.id, "MODULE_UNINSTALL_STARTED", "notes");
    expect(audits.length > 0, "attempted operation audited (§58D)");
  });

  /* ---------------- Scenario C: disable (PRD §17, §58C) ---------------- */

  await test("Scenario C: disable Notes Pro — data retained, state DISABLED", async () => {
    const updated = await setModuleEnabled(t.userA, "notes-pro", false);
    expectEqual(updated.status, "DISABLED", "status DISABLED");
    const mod = await moduleByCode("notes-pro");
    const inst = await getInstallation(t.companyA.id, mod.id);
    expect(inst !== null, "installation record preserved");
    expectEqual(inst!.installedVersion, "1.0.0", "version preserved");
  });

  await test("disable: already-disabled module rejected deterministically", async () => {
    await expectAppError(
      () => setModuleEnabled(t.userA, "notes-pro", false),
      "MODULE_ALREADY_DISABLED",
      "double disable",
    );
  });

  await test("enable: dependency gate — Notes Pro needs Notes ACTIVE (PRD §16)", async () => {
    await setModuleEnabled(t.userA, "notes", false);
    await expectAppError(
      () => setModuleEnabled(t.userA, "notes-pro", true),
      "MODULE_DEPENDENCY_DISABLED",
      "enable with disabled dependency blocked",
    );
    await setModuleEnabled(t.userA, "notes", true);
    const updated = await setModuleEnabled(t.userA, "notes-pro", true);
    expectEqual(updated.status, "ACTIVE", "enable works after dependency re-enabled");
  });

  await test("enable: already-enabled module rejected deterministically (PRD §31)", async () => {
    await expectAppError(
      () => setModuleEnabled(t.userA, "notes-pro", true),
      "MODULE_ALREADY_ENABLED",
      "double enable",
    );
  });

  await test("navigation: hidden when disabled, visible when enabled (PRD §21)", async () => {
    await setModuleEnabled(t.userA, "notes-pro", false);
    const accessMap = await getModuleAccessMap(t.companyA.id);
    const userWithState = { ...t.userA, moduleAccess: accessMap };
    let nav = buildNavigation(userWithState).flatMap((s) => s.items.map((i) => i.href));
    expect(!nav.includes("/m/notes-pro"), "nav hidden when disabled");
    expect(nav.includes("/m/notes"), "nav visible for enabled module");

    await setModuleEnabled(t.userA, "notes-pro", true);
    const accessMap2 = await getModuleAccessMap(t.companyA.id);
    nav = buildNavigation({ ...userWithState, moduleAccess: accessMap2 }).flatMap((s) => s.items.map((i) => i.href));
    expect(nav.includes("/m/notes-pro"), "nav reappears when enabled");
  });

  /* ---------------- Scenario E: uninstall notes-pro (PRD §58E) ---------------- */

  await test("Scenario E: uninstall Notes Pro — Notes remains, audit retained", async () => {
    const result = await uninstallModule(t.userA, "notes-pro");
    expectEqual(result.dataRetained, true, "data retained (KEEP_DATA)");
    const notesMod = await moduleByCode("notes");
    const notesInst = await getInstallation(t.companyA.id, notesMod.id);
    expectEqual(notesInst!.status, "ACTIVE", "Notes remains installed");
    const audits = await latestAudit(t.companyA.id, "MODULE_UNINSTALLED", "notes-pro");
    expect(audits.length > 0, "uninstall audited");
  });

  await test("uninstall: already-uninstalled rejected deterministically (PRD §45)", async () => {
    await expectAppError(
      () => uninstallModule(t.userA, "notes-pro"),
      "MODULE_NOT_INSTALLED",
      "double uninstall",
    );
  });

  /* ---------- KEEP_DATA uninstall + audit retention (PRD §19/§20) ---------- */

  await test("uninstall Notes (KEEP_DATA): business rows survive uninstall", async () => {
    // insert a business row into the notes table created by the module migration
    const marker = `retention-check-${Date.now()}`;
    await db.execute(sql`
      INSERT INTO notes (company_id, title, content)
      VALUES (${t.companyA.id}, ${marker}, 'data must survive uninstall')
    `);
    const result = await uninstallModule(t.userA, "notes");
    expectEqual(result.dataRetained, true, "KEEP_DATA policy");
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM notes WHERE company_id = ${t.companyA.id} AND title = ${marker}`,
    );
    const n = (rows.rows as { n: number }[])[0]?.n ?? 0;
    expectEqual(n, 1, "business data retained after uninstall");
    // audit history retained (§20: uninstall preserves audit log)
    const audits = await latestAudit(t.companyA.id, "MODULE_UNINSTALLED", "notes");
    expect(audits.length > 0, "audit retained");
  });

  /* ------------------- Scenario F: upgrade (PRD §58F) ------------------- */

  await test("Scenario F: upgrade runs pending migrations and updates version", async () => {
    // reinstall notes, then simulate an old installed version
    await installModule(t.userA, "notes");
    const mod = await moduleByCode("notes");
    await db
      .update(moduleInstallations)
      .set({ installedVersion: "0.9.0", status: "ACTIVE" })
      .where(and(eq(moduleInstallations.companyId, t.companyA.id), eq(moduleInstallations.moduleId, mod.id)));

    const result = await upgradeModule(t.userA, "notes");
    expectEqual(result.fromVersion, "0.9.0", "from version");
    expectEqual(result.toVersion, "1.0.0", "to version");
    const inst = await getInstallation(t.companyA.id, mod.id);
    expectEqual(inst!.installedVersion, "1.0.0", "version updated in DB");
    const audits = await latestAudit(t.companyA.id, "MODULE_UPGRADED", "notes");
    expect(audits.length > 0, "upgrade audited");
  });

  await test("upgrade: no update available → deterministic rejection (PRD §26)", async () => {
    await expectAppError(
      () => upgradeModule(t.userA, "notes"),
      "CONFLICT",
      "no update available",
    );
  });

  await test("upgrade: downgrade attempt blocked (PRD §28)", async () => {
    const mod = await moduleByCode("notes");
    await db
      .update(moduleInstallations)
      .set({ installedVersion: "2.0.0" })
      .where(and(eq(moduleInstallations.companyId, t.companyA.id), eq(moduleInstallations.moduleId, mod.id)));
    await expectAppError(
      () => upgradeModule(t.userA, "notes"),
      "CONFLICT",
      "downgrade blocked",
    );
    await db
      .update(moduleInstallations)
      .set({ installedVersion: "1.0.0" })
      .where(and(eq(moduleInstallations.companyId, t.companyA.id), eq(moduleInstallations.moduleId, mod.id)));
  });

  /* ------------------- Concurrency (PRD §37) ------------------- */

  await test("concurrency: parallel installs produce exactly one installation", async () => {
    await subscribeModule(t.userB, "notes");
    const results = await Promise.allSettled([
      installModule(t.userB, "notes"),
      installModule(t.userB, "notes"),
    ]);
    const mod = await moduleByCode("notes");
    const rows = await db
      .select()
      .from(moduleInstallations)
      .where(and(eq(moduleInstallations.companyId, t.companyB.id), eq(moduleInstallations.moduleId, mod.id)));
    expectEqual(rows.length, 1, "no duplicate installation under concurrency");
    expectEqual(rows[0]!.status, "ACTIVE", "installation ACTIVE");
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    expect(fulfilled === 2, `both concurrent installs resolved (idempotent): ${JSON.stringify(results.map(r => r.status === "rejected" ? String(r.reason) : "ok"))}`);
  });

    /* -------- Failed install: transactional rollback (PRD §14/§30) -------- */

  await test("install failure: migration error rolls back, INSTALL_FAILED persisted", async () => {
    const broken: ModuleManifest = {
      code: "phase2-broken",
      name: "Phase2 Broken",
      version: "1.0.0",
      description: "synthetic failing module for rollback validation",
      category: "EXTENSION",
      permissions: [{ code: "phase2-broken.view", name: "view" }],
      navigation: [],
      migrations: [
        {
          version: "1.0.0",
          name: "breaks_midway",
          sql: `
CREATE TABLE IF NOT EXISTS phase2_broken_start (id int);
--> statement-breakpoint
INSERT INTO definitely_missing_table_xyz VALUES (1);
`,
        },
      ],
    };
    moduleManifests.push(broken);
    try {
      await syncModuleRegistry();
      await subscribeModule(t.userA, "phase2-broken");
      await expectAppError(
        () => installModule(t.userA, "phase2-broken"),
        "MODULE_INSTALL_FAILED",
        "failing migration surfaces MODULE_INSTALL_FAILED",
      );

      // failure state persisted for the administrator (PRD §30)
      const mod = await moduleByCode("phase2-broken");
      const inst = await getInstallation(t.companyA.id, mod.id);
      expect(inst !== null, "failed installation row exists");
      expectEqual(inst!.status, "INSTALL_FAILED", "INSTALL_FAILED persisted");
      expect(inst!.lastError !== null && inst!.lastError.length > 0, "lastError actionable");

      // transaction rolled back: first migration statement must NOT persist
      const probe = await db.execute(
        sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'phase2_broken_start'`,
      );
      const n = (probe.rows as { n: number }[])[0]?.n ?? 1;
      expectEqual(n, 0, "partial migration rolled back (atomic install)");

      const audits = await latestAudit(t.companyA.id, "MODULE_INSTALL_FAILED", "phase2-broken");
      expect(audits.length > 0, "failure audited");

      // retry from INSTALL_FAILED is allowed (deterministic)
      await expectAppError(
        () => installModule(t.userA, "phase2-broken"),
        "MODULE_INSTALL_FAILED",
        "retry still fails with same error",
      );
    } finally {
      moduleManifests.splice(moduleManifests.findIndex((m) => m.code === "phase2-broken"), 1);
      await db.delete(moduleInstallations).where(eq(moduleInstallations.companyId, t.companyA.id));
      await db.delete(moduleSubscriptions).where(eq(moduleSubscriptions.companyId, t.companyA.id));
      await db.delete(modules).where(eq(modules.code, "phase2-broken"));
      await db.delete(permissions).where(eq(permissions.moduleCode, "phase2-broken"));
      await db.delete(moduleMigrations).where(eq(moduleMigrations.moduleCode, "phase2-broken"));
    }
  });

  /* -------- DELETE_DATA retention policy + confirmation (PRD §19) -------- */

  await test("retention: DELETE_DATA policy requires explicit confirmation", async () => {
    const risky: ModuleManifest = {
      code: "phase2-risky",
      name: "Phase2 Risky",
      version: "1.0.0",
      description: "synthetic module with DELETE_DATA policy",
      category: "EXTENSION",
      permissions: [{ code: "phase2-risky.view", name: "view" }],
      navigation: [],
      uninstallPolicy: "DELETE_DATA",
      migrations: [
        {
          version: "1.0.0",
          name: "create_risky",
          sql: `CREATE TABLE IF NOT EXISTS phase2_risky_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, title text NOT NULL);`,
        },
      ],
      deleteDataSql: "DELETE FROM phase2_risky_items WHERE company_id = $1",
    };
    moduleManifests.push(risky);
    try {
      await syncModuleRegistry();
      await subscribeModule(t.userA, "phase2-risky");
      await installModule(t.userA, "phase2-risky");
      await db.execute(
        sql`INSERT INTO phase2_risky_items (company_id, title) VALUES (${t.companyA.id}, 'delete-me')`,
      );

      // without confirmation → blocked (§19)
      await expectAppError(
        () => uninstallModule(t.userA, "phase2-risky"),
        "MODULE_UNINSTALL_CONFIRMATION_REQUIRED",
        "uninstall without confirm blocked",
      );
      let rows = await db.execute(sql`SELECT count(*)::int AS n FROM phase2_risky_items WHERE company_id = ${t.companyA.id}`);
      expectEqual(((rows.rows as { n: number }[])[0]?.n ?? 0), 1, "data still present without confirm");

      // with confirmation → data deleted + uninstall completes
      const result = await uninstallModule(t.userA, "phase2-risky", { confirmDataLoss: true });
      expectEqual(result.dataRetained, false, "DELETE_DATA executed");
      rows = await db.execute(sql`SELECT count(*)::int AS n FROM phase2_risky_items WHERE company_id = ${t.companyA.id}`);
      expectEqual(((rows.rows as { n: number }[])[0]?.n ?? 0), 0, "data deleted after confirmation");
    } finally {
      moduleManifests.splice(moduleManifests.findIndex((m) => m.code === "phase2-risky"), 1);
      await db.delete(moduleInstallations).where(eq(moduleInstallations.companyId, t.companyA.id));
      await db.delete(moduleSubscriptions).where(eq(moduleSubscriptions.companyId, t.companyA.id));
      await db.delete(modules).where(eq(modules.code, "phase2-risky"));
      await db.delete(permissions).where(eq(permissions.moduleCode, "phase2-risky"));
      await db.delete(moduleMigrations).where(eq(moduleMigrations.moduleCode, "phase2-risky"));
      await db.execute(sql`DROP TABLE IF EXISTS phase2_risky_items`);
    }
  });

  /* ------------------------------- done ------------------------------- */

  await resetCompanyModuleState(t.companyA.id);
  await resetCompanyModuleState(t.companyB.id);
}

async function moduleByCode(code: string) {
  const [mod] = await db.select().from(modules).where(eq(modules.code, code));
  if (!mod) throw new Error(`module ${code} not found in registry table`);
  return mod;
}

main()
  .then(async () => {
    failed += printSummary("INTEGRATION TESTS");
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(async (e) => {
    console.error("INTEGRATION FATAL:", e);
    failed += printSummary("INTEGRATION TESTS (incomplete)");
    await pool.end();
    process.exit(1);
  });

// __BROKEN_MODULE__
