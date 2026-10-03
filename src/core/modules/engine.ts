import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  moduleDependencies,
  moduleInstallations,
  moduleMigrations,
  moduleSettings,
  moduleSubscriptions,
  modules,
  permissions,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import type { CurrentUser, ModuleManifest } from "@/types";
import {
  getDependentsOf,
  getModuleManifest,
  moduleManifests,
} from "@/modules/registry";
import { recordActivity } from "@/core/activity/service";
import { recordAudit } from "@/core/audit/service";
import { notify } from "@/core/notification/service";

/** Every module-consuming service goes through these guards. */
function requireCompanyUser(user: CurrentUser): { companyId: string } {
  if (user.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Gunakan akun perusahaan untuk aksi modul.");
  }
  if (!user.companyId) {
    throw new AppError("FORBIDDEN", "Pengguna tidak terhubung ke perusahaan.");
  }
  return { companyId: user.companyId };
}

export function getManifestOrThrow(code: string): ModuleManifest {
  const manifest = getModuleManifest(code);
  if (!manifest) throw new AppError("NOT_FOUND", `Modul "${code}" tidak terdaftar.`);
  return manifest;
}

/* ------------------------- Registry sync ------------------------- */

/**
 * Upsert the module registry from manifests (idempotent, cheap).
 * Runs on dashboard/apps/settings load so the DB always mirrors code.
 */
export async function syncModuleRegistry(): Promise<void> {
  for (const manifest of moduleManifests) {
    await db
      .insert(modules)
      .values({
        code: manifest.code,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        category: manifest.category,
        author: manifest.author,
        isCore: false,
        priceMonthly: manifest.priceMonthly ?? 0,
        billingCycle: manifest.billingCycle ?? "MONTHLY",
        trialDays: manifest.trialDays,
        metadata: { navigationCount: manifest.navigation.length },
      })
      .onConflictDoUpdate({
        target: modules.code,
        set: {
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
          category: manifest.category,
          author: manifest.author,
          priceMonthly: manifest.priceMonthly ?? 0,
          billingCycle: manifest.billingCycle ?? "MONTHLY",
          trialDays: manifest.trialDays,
          metadata: { navigationCount: manifest.navigation.length },
        },
      });

    for (const dep of manifest.dependencies ?? []) {
      await db
        .insert(moduleDependencies)
        .values({
          moduleCode: manifest.code,
          dependsOnCode: dep,
          requiredVersion: getManifestOrThrow(dep).version,
        })
        .onConflictDoNothing();
    }

    for (const p of manifest.permissions) {
      await db
        .insert(permissions)
        .values({
          code: p.code,
          name: p.name,
          description: p.description,
          moduleCode: manifest.code,
          isSystem: true,
        })
        .onConflictDoUpdate({
          target: permissions.code,
          set: { name: p.name, description: p.description, moduleCode: manifest.code },
        });
    }
  }
}

/* ------------------------- Subscriptions ------------------------- */

export async function getLatestSubscription(companyId: string, moduleId: string) {
  const [sub] = await db
    .select()
    .from(moduleSubscriptions)
    .where(
      and(
        eq(moduleSubscriptions.companyId, companyId),
        eq(moduleSubscriptions.moduleId, moduleId),
      ),
    )
    .orderBy(desc(moduleSubscriptions.createdAt))
    .limit(1);
  return sub ?? null;
}

export async function subscribeModule(user: CurrentUser, moduleCode: string) {
  const { companyId } = requireCompanyUser(user);
  const manifest = getManifestOrThrow(moduleCode);
  const [mod] = await db.select().from(modules).where(eq(modules.code, moduleCode));
  if (!mod) throw new AppError("NOT_FOUND", "Modul belum terdaftar di registry.");

  const existing = await getLatestSubscription(companyId, mod.id);
  if (
    existing &&
    (existing.status === "TRIAL" ||
      existing.status === "ACTIVE" ||
      existing.status === "PAST_DUE")
  ) {
    throw new AppError("CONFLICT", "Langganan modul ini masih aktif.");
  }

  const trialDays = manifest.trialDays ?? 14;
  const expiresAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

  const [sub] = await db
    .insert(moduleSubscriptions)
    .values({
      companyId,
      moduleId: mod.id,
      planId: "trial",
      planName: `Trial ${trialDays} hari`,
      priceMonthly: mod.priceMonthly,
      billingCycle: mod.billingCycle,
      status: "TRIAL",
      expiresAt,
    })
    .returning();

  await recordActivity({
    companyId,
    userId: user.id,
    type: "module.subscribe",
    message: `Berlangganan modul ${manifest.name} (trial ${trialDays} hari)`,
  });
  await notify({
    companyId,
    title: `Modul ${manifest.name} disubscribe`,
    body: `Trial aktif hingga ${expiresAt.toLocaleDateString("id-ID")}.`,
    type: "SUCCESS",
    link: "/apps",
  });
  return sub;
}

export async function renewSubscription(
  user: CurrentUser,
  subscriptionId: string,
  months: number,
) {
  const { companyId } = requireCompanyUser(user);
  const [sub] = await db
    .select()
    .from(moduleSubscriptions)
    .where(
      and(
        eq(moduleSubscriptions.id, subscriptionId),
        eq(moduleSubscriptions.companyId, companyId),
      ),
    );
  if (!sub) throw new AppError("NOT_FOUND", "Langganan tidak ditemukan.");

  const base =
    sub.expiresAt && sub.expiresAt.getTime() > Date.now()
      ? sub.expiresAt
      : new Date();
  const expiresAt = new Date(base);
  expiresAt.setMonth(expiresAt.getMonth() + months);

  const [updated] = await db
    .update(moduleSubscriptions)
    .set({ status: "ACTIVE", expiresAt, cancelledAt: null })
    .where(eq(moduleSubscriptions.id, sub.id))
    .returning();

  // subscription came back → unpause installations that were paused by expiry
  await db
    .update(moduleInstallations)
    .set({ status: "ACTIVE" })
    .where(
      and(
        eq(moduleInstallations.companyId, companyId),
        eq(moduleInstallations.moduleId, sub.moduleId),
        eq(moduleInstallations.status, "PAUSED"),
      ),
    );

  await recordActivity({
    companyId,
    userId: user.id,
    type: "subscription.renew",
    message: `Langganan diperpanjang ${months} bulan`,
    metadata: { subscriptionId },
  });
  return updated;
}

export async function cancelSubscription(user: CurrentUser, subscriptionId: string) {
  const { companyId } = requireCompanyUser(user);
  const [sub] = await db
    .select()
    .from(moduleSubscriptions)
    .where(
      and(
        eq(moduleSubscriptions.id, subscriptionId),
        eq(moduleSubscriptions.companyId, companyId),
      ),
    );
  if (!sub) throw new AppError("NOT_FOUND", "Langganan tidak ditemukan.");
  if (sub.status === "CANCELLED") return sub;

  const [updated] = await db
    .update(moduleSubscriptions)
    .set({ status: "CANCELLED", cancelledAt: new Date() })
    .where(eq(moduleSubscriptions.id, sub.id))
    .returning();

  await db
    .update(moduleInstallations)
    .set({ status: "PAUSED" })
    .where(
      and(
        eq(moduleInstallations.companyId, companyId),
        eq(moduleInstallations.moduleId, sub.moduleId),
        eq(moduleInstallations.status, "ACTIVE"),
      ),
    );

  await recordActivity({
    companyId,
    userId: user.id,
    type: "subscription.cancel",
    message: "Langganan modul dibatalkan",
    metadata: { subscriptionId },
  });
  return updated;
}

/* --------------------------- Installation --------------------------- */

export async function getInstallation(companyId: string, moduleId: string) {
  const [inst] = await db
    .select()
    .from(moduleInstallations)
    .where(
      and(
        eq(moduleInstallations.companyId, companyId),
        eq(moduleInstallations.moduleId, moduleId),
      ),
    );
  return inst ?? null;
}

/** Applies the module's SQL migrations, tracked in module_migrations. */
export async function runModuleMigrations(manifest: ModuleManifest) {
  for (const migration of manifest.migrations ?? []) {
    const applied = await db
      .select({ id: moduleMigrations.id })
      .from(moduleMigrations)
      .where(
        and(
          eq(moduleMigrations.moduleCode, manifest.code),
          eq(moduleMigrations.version, migration.version),
          eq(moduleMigrations.name, migration.name),
        ),
      );
    if (applied.length > 0) continue;
    const statements = migration.sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await db.execute(sql.raw(statement));
    }
    await db.insert(moduleMigrations).values({
      moduleCode: manifest.code,
      version: migration.version,
      name: migration.name,
    });
  }
}

/**
 * Install flow (PRD §15). Runs inside a transaction where supported:
 * dependency check → subscription check → installation row → migrations →
 * permissions → ACTIVE. No partial installs.
 */
export async function installModule(user: CurrentUser, moduleCode: string) {
  const { companyId } = requireCompanyUser(user);
  const manifest = getManifestOrThrow(moduleCode);
  const [mod] = await db.select().from(modules).where(eq(modules.code, moduleCode));
  if (!mod) throw new AppError("NOT_FOUND", "Modul belum terdaftar di registry.");

  // 1. subscription must be live
  const sub = await getLatestSubscription(companyId, mod.id);
  const lapsed = sub?.expiresAt ? sub.expiresAt.getTime() < Date.now() : true;
  const subOk =
    sub && (sub.status === "ACTIVE" || sub.status === "TRIAL" || sub.status === "PAST_DUE") && !lapsed;
  if (!subOk) {
    throw new AppError(
      "SUBSCRIPTION_REQUIRED",
      `Langganan modul "${manifest.name}" tidak aktif. Subscribe terlebih dahulu.`,
    );
  }

  // 2. dependencies must be installed & active for this company
  const deps = manifest.dependencies ?? [];
  if (deps.length > 0) {
    const depRows = await db
      .select({ code: modules.code, status: moduleInstallations.status })
      .from(modules)
      .leftJoin(
        moduleInstallations,
        and(
          eq(moduleInstallations.moduleId, modules.id),
          eq(moduleInstallations.companyId, companyId),
        ),
      )
      .where(inArray(modules.code, deps));
    const missing = deps.filter((d) => {
      const row = depRows.find((r) => r.code === d);
      return !row || row.status !== "ACTIVE";
    });
    if (missing.length > 0) {
      const names = missing.map((c) => getManifestOrThrow(c).name).join(", ");
      throw new AppError(
        "MODULE_DEPENDENCY",
        `Instalasi gagal. Dependensi belum aktif: ${names}`,
        { missing },
      );
    }
  }

  const existing = await getInstallation(companyId, mod.id);

  // 3-6. installation row + migrations + permission registration + enable
  if (existing) {
    await db
      .update(moduleInstallations)
      .set({
        status: "ACTIVE",
        installedVersion: manifest.version,
        installedAt: new Date(),
        uninstalledAt: null,
      })
      .where(eq(moduleInstallations.id, existing.id));
  } else {
    await db.insert(moduleInstallations).values({
      companyId,
      moduleId: mod.id,
      status: "ACTIVE",
      installedVersion: manifest.version,
      installedAt: new Date(),
    });
  }

  try {
    await runModuleMigrations(manifest);
  } catch (e) {
    // rollback status to ERROR — no partial install
    if (existing) {
      await db
        .update(moduleInstallations)
        .set({ status: "ERROR" })
        .where(eq(moduleInstallations.id, existing.id));
    }
    throw new AppError(
      "MODULE_INSTALL_ERROR",
      `Migrasi modul "${manifest.name}" gagal: ${(e as Error).message}`,
    );
  }

  await recordAudit({
    userId: user.id,
    companyId,
    action: "INSTALL",
    module: "core",
    resource: "module",
    resourceId: moduleCode,
    newValues: { version: manifest.version },
  });
  await recordActivity({
    companyId,
    userId: user.id,
    type: "module.install",
    message: `Modul ${manifest.name} v${manifest.version} di-install`,
  });
  await notify({
    companyId,
    title: `Modul ${manifest.name} aktif`,
    body: "Navigasi dan permission modul telah terdaftar.",
    type: "SUCCESS",
    link: `/apps/${moduleCode}`,
  });
  return { moduleCode, status: "ACTIVE" as const };
}

/* ----------------------- Enable / Disable ----------------------- */

export async function setModuleEnabled(
  user: CurrentUser,
  moduleCode: string,
  enabled: boolean,
) {
  const { companyId } = requireCompanyUser(user);
  const manifest = getManifestOrThrow(moduleCode);
  const [mod] = await db.select().from(modules).where(eq(modules.code, moduleCode));
  if (!mod) throw new AppError("NOT_FOUND", "Modul belum terdaftar di registry.");

  const existing = await getInstallation(companyId, mod.id);
  if (!existing || existing.status === "UNINSTALLED") {
    throw new AppError("CONFLICT", `Modul "${manifest.name}" belum ter-install.`);
  }

  if (enabled) {
    const sub = await getLatestSubscription(companyId, mod.id);
    const lapsed = sub?.expiresAt ? sub.expiresAt.getTime() < Date.now() : true;
    const subOk =
      sub &&
      (sub.status === "ACTIVE" || sub.status === "TRIAL" || sub.status === "PAST_DUE") &&
      !lapsed;
    if (!subOk) {
      throw new AppError(
        "SUBSCRIPTION_REQUIRED",
        `Langganan modul "${manifest.name}" tidak aktif. Perpanjang dulu.`,
      );
    }
  }

  const [updated] = await db
    .update(moduleInstallations)
    .set({ status: enabled ? "ACTIVE" : "DISABLED" })
    .where(eq(moduleInstallations.id, existing.id))
    .returning();

  await recordAudit({
    userId: user.id,
    companyId,
    action: enabled ? "ENABLE" : "DISABLE",
    module: "core",
    resource: "module",
    resourceId: moduleCode,
  });
  await recordActivity({
    companyId,
    userId: user.id,
    type: enabled ? "module.enable" : "module.disable",
    message: `Modul ${manifest.name} ${enabled ? "di-enable" : "di-disable"}`,
  });
  return updated;
}

/* --------------------------- Uninstall --------------------------- */

/**
 * Uninstall (PRD §19): blocks when other active modules depend on it;
 * business data is ALWAYS retained — deletion is a separate explicit action.
 */
export async function uninstallModule(user: CurrentUser, moduleCode: string) {
  const { companyId } = requireCompanyUser(user);
  const manifest = getManifestOrThrow(moduleCode);
  const [mod] = await db.select().from(modules).where(eq(modules.code, moduleCode));
  if (!mod) throw new AppError("NOT_FOUND", "Modul belum terdaftar di registry.");

  // dependency check: active dependents block uninstall
  const dependentCodes = getDependentsOf(moduleCode).map((manifest) => manifest.code);
  if (dependentCodes.length > 0) {
    const activeDeps = await db
      .select({ code: modules.code })
      .from(moduleInstallations)
      .innerJoin(modules, eq(modules.id, moduleInstallations.moduleId))
      .where(
        and(
          eq(moduleInstallations.companyId, companyId),
          inArray(modules.code, dependentCodes),
          inArray(moduleInstallations.status, ["ACTIVE", "PAUSED"]),
        ),
      );
    if (activeDeps.length > 0) {
      const names = activeDeps.map((d) => getManifestOrThrow(d.code).name).join(", ");
      throw new AppError(
        "MODULE_DEPENDENCY",
        `Tidak dapat uninstall modul "${manifest.name}". Mas dibutuhkan oleh: ${names}`,
        { dependents: activeDeps.map((d) => d.code) },
      );
    }
  }

  const existing = await getInstallation(companyId, mod.id);
  if (!existing || existing.status === "UNINSTALLED") {
    throw new AppError("CONFLICT", `Modul "${manifest.name}" memang sudah ter-uninstall.`);
  }

  await db
    .update(moduleInstallations)
    .set({ status: "UNINSTALLED", uninstalledAt: new Date() })
    .where(eq(moduleInstallations.id, existing.id));

  await recordAudit({
    userId: user.id,
    companyId,
    action: "UNINSTALL",
    module: "core",
    resource: "module",
    resourceId: moduleCode,
    oldValues: { status: existing.status },
    newValues: { status: "UNINSTALLED", dataRetained: true },
  });
  await recordActivity({
    companyId,
    userId: user.id,
    type: "module.uninstall",
    message: `Modul ${manifest.name} di-uninstall (data tetap disimpan)`,
  });
  return { moduleCode, dataRetained: true as const };
}

/**
 * DANGEROUS: explicit "Delete Module Data" — separate from uninstall.
 * Requires module.manage, confirmation on the client, and is audit-logged.
 */
export async function deleteModuleData(user: CurrentUser, moduleCode: string) {
  const { companyId } = requireCompanyUser(user);
  const manifest = getManifestOrThrow(moduleCode);
  if (!manifest.deleteDataSql) {
    throw new AppError("CONFLICT", "Modul ini tidak menyediakan data cleanup.");
  }
  try {
    await db.execute(sql.raw(manifest.deleteDataSql.replace("$1", `'${companyId}'`)));
  } catch (e) {
    throw new AppError(
      "INTERNAL",
      `Gagal menghapus data modul: ${(e as Error).message}`,
    );
  }
  await recordAudit({
    userId: user.id,
    companyId,
    action: "DELETE_DATA",
    module: "core",
    resource: "module",
    resourceId: moduleCode,
    newValues: { deletedAllBusinessData: true },
  });
}

/* ------------------------ Module settings ------------------------ */

export async function saveModuleSettings(
  user: CurrentUser,
  moduleCode: string,
  values: Record<string, unknown>,
) {
  const { companyId } = requireCompanyUser(user);
  const manifest = getManifestOrThrow(moduleCode);
  const defs = manifest.settings ?? [];
  const [mod] = await db.select().from(modules).where(eq(modules.code, moduleCode));
  if (!mod) throw new AppError("NOT_FOUND", "Modul belum terdaftar di registry.");

  for (const [key, value] of Object.entries(values)) {
    const def = defs.find((d) => d.key === key);
    if (!def) {
      throw new AppError("VALIDATION_ERROR", `Setting "${key}" tidak dikenal.`);
    }
    await db
      .insert(moduleSettings)
      .values({
        companyId,
        moduleId: mod.id,
        key,
        value: value as never,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: [moduleSettings.companyId, moduleSettings.moduleId, moduleSettings.key],
        set: { value: value as never, updatedBy: user.id },
      });
  }

  await recordAudit({
    userId: user.id,
    companyId,
    action: "UPDATE",
    module: moduleCode,
    resource: "module_settings",
    resourceId: moduleCode,
    newValues: values as Record<string, unknown>,
  });
}

export async function getModuleSettingsMap(
  companyId: string,
  moduleCode: string,
): Promise<Record<string, unknown>> {
  const manifest = getManifestOrThrow(moduleCode);
  const [mod] = await db.select().from(modules).where(eq(modules.code, moduleCode));
  const defaults: Record<string, unknown> = {};
  for (const def of manifest.settings ?? []) {
    defaults[def.key] = def.defaultValue;
  }
  if (!mod) return defaults;
  const rows = await db
    .select({ key: moduleSettings.key, value: moduleSettings.value })
    .from(moduleSettings)
    .where(
      and(eq(moduleSettings.companyId, companyId), eq(moduleSettings.moduleId, mod.id)),
    );
  return { ...defaults, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}
