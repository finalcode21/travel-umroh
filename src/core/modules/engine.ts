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
import { compare as semverCompare, isUpdateAvailable } from "@/lib/semver";
import type { CurrentUser, ModuleManifest } from "@/types";
import {
  checkVersionCompatibility,
  getDependentManifests,
  normalizeDependencies,
  resolveInstallOrder,
} from "./dependency";
import { assertManifestsValid } from "./manifest";
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Server-side guard before any SQL substitution with the tenant id. */
function assertUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) {
    throw new AppError("VALIDATION_ERROR", `${label} tidak valid.`);
  }
  return value;
}

export function getManifestOrThrow(code: string): ModuleManifest {
  const manifest = moduleManifests.find((m) => m.code === code);
  if (!manifest) {
    throw new AppError("MODULE_NOT_FOUND", `Modul "${code}" tidak terdaftar.`);
  }
  return manifest;
}

import { moduleManifests } from "@/modules/registry";

/** Transient in-flight states — conflicting lifecycle ops are rejected (§37). */
const TRANSIENT_STATUSES = ["INSTALLING", "UPGRADING", "UNINSTALLING"] as const;
/** A transient claim older than this is considered dead and may be reclaimed. */
const STALE_TRANSITION_MS = 5 * 60 * 1000;

interface LifecycleContext {
  companyId: string;
  userId: string;
  moduleCode: string;
  operation: string;
}

/** Structured lifecycle log (PRD §53) — no secrets, ids + codes only. */
function logLifecycle(
  ctx: LifecycleContext,
  event: string,
  extra?: Record<string, unknown>,
) {
  console.info(
    `[module-engine] ${event} module=${ctx.moduleCode} company=${ctx.companyId} user=${ctx.userId} operation=${ctx.operation}`,
    extra ?? {},
  );
}

interface LifecycleAuditMeta {
  version?: string;
  fromVersion?: string;
  toVersion?: string;
  status?: string;
  dataPolicy?: string;
  errorCode?: string;
  errorMessage?: string;
  [key: string]: unknown;
}

async function auditLifecycleEvent(
  ctx: LifecycleContext,
  action: string,
  status: "STARTED" | "SUCCESS" | "FAILED",
  meta: LifecycleAuditMeta = {},
) {
  await recordAudit({
    userId: ctx.userId,
    companyId: ctx.companyId,
    action,
    module: "core",
    resource: "module",
    resourceId: ctx.moduleCode,
    newValues: { ...meta, status },
  });
}

async function auditLifecycleFailure(
  ctx: LifecycleContext,
  action: string,
  error: unknown,
) {
  const appError = error instanceof AppError ? error : null;
  await auditLifecycleEvent(ctx, action, "FAILED", {
    errorCode: appError?.code ?? "INTERNAL",
    errorMessage: error instanceof Error ? error.message : String(error),
  });
  logLifecycle(ctx, "failed", {
    error_code: appError?.code ?? "INTERNAL",
    error_message: error instanceof Error ? error.message : String(error),
  });
}

/** Loads the module row (registry) by technical name. */
async function getModuleRow(code: string) {
  const [mod] = await db.select().from(modules).where(eq(modules.code, code));
  return mod ?? null;
}

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

/**
 * Subscription gate (PRD §12): install/enable require a live subscription.
 * Throws MODULE_SUBSCRIPTION_REQUIRED when absent/expired/cancelled.
 */
async function requireActiveSubscription(companyId: string, mod: { id: string; name: string }) {
  const sub = await getLatestSubscription(companyId, mod.id);
  const lapsed = sub?.expiresAt ? sub.expiresAt.getTime() < Date.now() : true;
  const ok =
    sub &&
    (sub.status === "ACTIVE" || sub.status === "TRIAL" || sub.status === "PAST_DUE") &&
    !lapsed;
  if (!ok) {
    throw new AppError(
      "MODULE_SUBSCRIPTION_REQUIRED",
      `Langganan modul "${mod.name}" tidak aktif. Subscribe atau perpanjang terlebih dahulu.`,
    );
  }
  return sub;
}

/* ------------------------- Registry sync (§6-8) ------------------------- */

/**
 * Upsert the module registry from manifests (idempotent, cheap).
 * Validates all manifests first (PRD §8) — an invalid manifest fails loudly.
 * Runs on dashboard/apps/settings load so the DB always mirrors code.
 */
export async function syncModuleRegistry(): Promise<void> {
  assertManifestsValid(moduleManifests);

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

    for (const dep of normalizeDependencies(manifest)) {
      const depManifest = getManifestOrThrow(dep.module);
      await db
        .insert(moduleDependencies)
        .values({
          moduleCode: manifest.code,
          dependsOnCode: dep.module,
          requiredVersion: dep.version ?? depManifest.version,
        })
        .onConflictDoUpdate({
          target: [moduleDependencies.moduleCode, moduleDependencies.dependsOnCode],
          set: { requiredVersion: dep.version ?? depManifest.version },
        });
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

/* ----------------------- Subscriptions (§12-13) ----------------------- */

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
  const mod = await getModuleRow(moduleCode);
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

  await auditLifecycleEvent(
    { companyId, userId: user.id, moduleCode, operation: "subscribe" },
    "MODULE_SUBSCRIBED",
    "SUCCESS",
    { plan: "trial", expiresAt: expiresAt.toISOString() },
  );
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

/* --------------------- Installation engine (§14-15) --------------------- */

/**
 * Applies a module's SQL migrations, tracked in module_migrations (§29).
 * When `tx` is given the statements run inside the caller's transaction.
 * `minVersion` restricts to migrations for versions > minVersion (upgrades).
 */
export async function runModuleMigrations(
  manifest: ModuleManifest,
  options: {
    tx?: Parameters<Parameters<typeof db.transaction>[0]>[0];
    minVersion?: string;
  } = {},
) {
  const executor = options.tx ?? db;
  const ordered = [...(manifest.migrations ?? [])].sort(
    (a, b) => compareVersionPair(a.version, b.version),
  );
  for (const migration of ordered) {
    if (options.minVersion && compareVersionPair(migration.version, options.minVersion) <= 0) {
      continue; // already covered by the installed version
    }
    const applied = await executor
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
      await executor.execute(sql.raw(statement));
    }
    await executor.insert(moduleMigrations).values({
      moduleCode: manifest.code,
      version: migration.version,
      name: migration.name,
    });
  }
}

function compareVersionPair(a: string, b: string): number {
  return semverCompare(a, b) ?? 0;
}

/**
 * Install flow (PRD §14): validate → subscription → dependency chain →
 * transactional {installation row + migrations} → commit. Idempotent (§15):
 * re-install is a deterministic no-op at the same version; an older installed
 * version is upgraded in place. Concurrent installs serialize on the row lock
 * and the unique (company_id, module_id) constraint (§37).
 */
export async function installModule(user: CurrentUser, moduleCode: string) {
  const { companyId } = requireCompanyUser(user);
  const manifest = getManifestOrThrow(moduleCode);
  const ctx: LifecycleContext = {
    companyId,
    userId: user.id,
    moduleCode,
    operation: "install",
  };
  const mod = await getModuleRow(moduleCode);
  if (!mod) throw new AppError("NOT_FOUND", "Modul belum terdaftar di registry.");

  // 1. subscription must be live (own + every dependency in the chain)
  await requireActiveSubscription(companyId, mod);

  // 2. dependency chain in install order (PRD §9): deps first, self last
  const order = resolveInstallOrder(moduleCode, moduleManifests);
  if (!order) {
    throw new AppError("MODULE_CIRCULAR_DEPENDENCY", "Dependensi modul membentuk lingkaran.");
  }

  const existing = await getInstallation(companyId, mod.id);
  const isFreshInstall =
    !existing ||
    existing.status === "UNINSTALLED" ||
    existing.status === "INSTALL_FAILED" ||
    existing.status === "UNINSTALLING";
  const alreadyCurrent =
    existing &&
    existing.status === "ACTIVE" &&
    existing.installedVersion === manifest.version;

  if (!alreadyCurrent && !isFreshInstall && existing) {
    // installed but disabled/paused/error at older or equal version → continue
    // (install re-activates); stale transient claims are reclaimed below.
  }

  if (alreadyCurrent) {
    logLifecycle(ctx, "idempotent-install");
    return { moduleCode, status: "ACTIVE" as const, idempotent: true as const };
  }

  await auditLifecycleEvent(ctx, "MODULE_INSTALL_STARTED", "STARTED", {
    version: manifest.version,
  });

  // 3. ensure every dependency is installed & active (auto-chain, deps first)
  for (const depCode of order) {
    if (depCode === moduleCode) continue;
    const depManifest = getManifestOrThrow(depCode);
    const depMod = await getModuleRow(depCode);
    if (!depMod) {
      throw new AppError(
        "MODULE_DEPENDENCY_MISSING",
        `Dependensi "${depManifest.name}" belum terdaftar di registry.`,
        { missing: [depCode] },
      );
    }
    const depInst = await getInstallation(companyId, depMod.id);
    const depActive = depInst && depInst.status === "ACTIVE";
    if (depActive) {
      // version compatibility (PRD §27)
      const issues = checkVersionCompatibility(normalizeDependencies(manifest).filter(
        (d) => d.module === depCode,
      ), (c) => (c === depCode ? depInst.installedVersion : undefined));
      if (issues.length > 0) {
        throw new AppError(
          "MODULE_DEPENDENCY_VERSION_MISMATCH",
          `Dependensi "${depManifest.name}" v${depInst.installedVersion} tidak memenuhi constraint "${issues[0].constraint}".`,
          issues,
        );
      }
      continue;
    }
    // dependency present but not active → install it (requires its subscription)
    try {
      await installModule(user, depCode);
    } catch (e) {
      if (e instanceof AppError && e.code === "MODULE_SUBSCRIPTION_REQUIRED") {
        throw new AppError(
          "MODULE_DEPENDENCY_MISSING",
          `Dependensi "${depManifest.name}" belum ter-subscribe/aktif.`,
          { missing: [depCode] },
        );
      }
      throw e;
    }
  }

  return performInstallTransaction(ctx, manifest, mod.id, existing?.id ?? null);
}

async function performInstallTransaction(
  ctx: LifecycleContext,
  manifest: ModuleManifest,
  moduleId: string,
  existingId: string | null,
) {
  try {
    await db.transaction(async (tx) => {
      // claim: lock the installation row (serializes concurrent lifecycle ops)
      let row = existingId
        ? (
            await tx
              .select()
              .from(moduleInstallations)
              .where(eq(moduleInstallations.id, existingId))
              .for("update")
          )[0] ?? null
        : null;

      if (row && TRANSIENT_STATUSES.includes(row.status as (typeof TRANSIENT_STATUSES)[number])) {
        const stale =
          row.updatedAt === null ||
          Date.now() - row.updatedAt.getTime() > STALE_TRANSITION_MS;
        if (!stale) {
          throw new AppError(
            "MODULE_OPERATION_IN_PROGRESS",
            "Operasi modul sedang berlangsung. Coba beberapa saat lagi.",
          );
        }
        logLifecycle(ctx, "reclaim-stale-claim", { previous: row.status });
      }

      if (row) {
        await tx
          .update(moduleInstallations)
          .set({ status: "INSTALLING", lastError: null })
          .where(eq(moduleInstallations.id, row.id));
      } else {
        // unique (company_id, module_id) guards concurrent fresh installs (§37)
        const inserted = await tx
          .insert(moduleInstallations)
          .values({
            companyId: ctx.companyId,
            moduleId,
            status: "INSTALLING",
            installedVersion: manifest.version,
            installedAt: new Date(),
          })
          .onConflictDoNothing()
          .returning();
        row = inserted[0] ?? null;
        if (!row) {
          // lost the race: another request created the row → take its lock
          row =
            (
              await tx
                .select()
                .from(moduleInstallations)
                .where(
                  and(
                    eq(moduleInstallations.companyId, ctx.companyId),
                    eq(moduleInstallations.moduleId, moduleId),
                  ),
                )
                .for("update")
            )[0] ?? null;
        }
      }

      // migrations INSIDE the transaction — DDL rolls back atomically (§14, §52)
      await runModuleMigrations(manifest, { tx });

      await tx
        .update(moduleInstallations)
        .set({
          status: "ACTIVE",
          installedVersion: manifest.version,
          installedAt: new Date(),
          uninstalledAt: null,
          lastError: null,
        })
        .where(eq(moduleInstallations.id, row!.id));
    });
  } catch (e) {
    await persistLifecycleFailure(ctx, "INSTALL_FAILED", e, moduleId, manifest.version, existingId === null);
    await auditLifecycleFailure(ctx, "MODULE_INSTALL_FAILED", e);
    await recordActivity({
      companyId: ctx.companyId,
      userId: ctx.userId,
      type: "module.install.failed",
      message: `Instalasi modul ${manifest.name} gagal: ${
        e instanceof Error ? e.message : String(e)
      }`,
    });
    if (e instanceof AppError) throw e;
    throw new AppError(
      "MODULE_INSTALL_FAILED",
      `Instalasi modul "${manifest.name}" gagal: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  await auditLifecycleEvent(ctx, "MODULE_INSTALLED", "SUCCESS", {
    version: manifest.version,
  });
  await recordActivity({
    companyId: ctx.companyId,
    userId: ctx.userId,
    type: "module.install",
    message: `Modul ${manifest.name} v${manifest.version} di-install`,
  });
  await notify({
    companyId: ctx.companyId,
    title: `Modul ${manifest.name} aktif`,
    body: "Navigasi dan permission modul telah terdaftar.",
    type: "SUCCESS",
    link: `/apps/${ctx.moduleCode}`,
  });
  logLifecycle(ctx, "installed", { version: manifest.version });
  return { moduleCode: ctx.moduleCode, status: "ACTIVE" as const };
}

/**
 * Persist a failed lifecycle transition (PRD §5/§30): INSTALL_FAILED /
 * UPGRADE_FAILED on the row + actionable lastError. Fresh installs insert a
 * failed row so the administrator can see and retry.
 */
async function persistLifecycleFailure(
  ctx: LifecycleContext,
  failedStatus: "INSTALL_FAILED" | "UPGRADE_FAILED",
  error: unknown,
  moduleId: string,
  attemptedVersion: string,
  freshInstall: boolean,
) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    if (failedStatus === "INSTALL_FAILED" && freshInstall) {
      await db
        .insert(moduleInstallations)
        .values({
          companyId: ctx.companyId,
          moduleId,
          status: failedStatus,
          installedVersion: attemptedVersion,
          lastError: message,
        })
        .onConflictDoUpdate({
          target: [moduleInstallations.companyId, moduleInstallations.moduleId],
          set: { status: failedStatus, lastError: message },
        });
      return;
    }
    await db
      .update(moduleInstallations)
      .set({ status: failedStatus, lastError: message })
      .where(
        and(
          eq(moduleInstallations.companyId, ctx.companyId),
          eq(moduleInstallations.moduleId, moduleId),
        ),
      );
  } catch (persistError) {
    console.error("[module-engine] failed to persist failure state", persistError);
  }
}

/* ----------------------- Enable / Disable (§16-17) ----------------------- */

export async function setModuleEnabled(
  user: CurrentUser,
  moduleCode: string,
  enabled: boolean,
) {
  const { companyId } = requireCompanyUser(user);
  const manifest = getManifestOrThrow(moduleCode);
  const ctx: LifecycleContext = {
    companyId,
    userId: user.id,
    moduleCode,
    operation: enabled ? "enable" : "disable",
  };
  const mod = await getModuleRow(moduleCode);
  if (!mod) throw new AppError("NOT_FOUND", "Modul belum terdaftar di registry.");

  try {
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(moduleInstallations)
        .where(
          and(
            eq(moduleInstallations.companyId, companyId),
            eq(moduleInstallations.moduleId, mod.id),
          ),
        )
        .for("update");

      if (
        !row ||
        row.status === "UNINSTALLED" ||
        row.status === "INSTALL_FAILED" ||
        row.status === "UPGRADE_FAILED"
      ) {
        throw new AppError(
          "MODULE_NOT_INSTALLED",
          `Modul "${manifest.name}" belum ter-install.`,
        );
      }
      if (TRANSIENT_STATUSES.includes(row.status as (typeof TRANSIENT_STATUSES)[number])) {
        const stale =
          row.updatedAt === null ||
          Date.now() - row.updatedAt.getTime() > STALE_TRANSITION_MS;
        if (!stale) {
          throw new AppError(
            "MODULE_OPERATION_IN_PROGRESS",
            "Operasi modul sedang berlangsung. Coba beberapa saat lagi.",
          );
        }
      }

      if (enabled) {
        if (row.status === "ACTIVE") {
          throw new AppError(
            "MODULE_ALREADY_ENABLED",
            `Modul "${manifest.name}" sudah aktif.`,
          );
        }
        // subscription gate (§16)
        const sub = await getLatestSubscription(companyId, mod.id);
        const lapsed = sub?.expiresAt ? sub.expiresAt.getTime() < Date.now() : true;
        const subOk =
          sub &&
          (sub.status === "ACTIVE" || sub.status === "TRIAL" || sub.status === "PAST_DUE") &&
          !lapsed;
        if (!subOk) {
          throw new AppError(
            "MODULE_SUBSCRIPTION_REQUIRED",
            `Langganan modul "${manifest.name}" tidak aktif. Perpanjang dulu.`,
          );
        }
        // dependency gate: required deps must be ACTIVE at runtime (§16, §27)
        const deps = normalizeDependencies(manifest);
        if (deps.length > 0) {
          const depRows = await tx
            .select({ code: modules.code, status: moduleInstallations.status, version: moduleInstallations.installedVersion })
            .from(moduleInstallations)
            .innerJoin(modules, eq(modules.id, moduleInstallations.moduleId))
            .where(
              and(
                eq(moduleInstallations.companyId, companyId),
                inArray(modules.code, deps.map((d) => d.module)),
              ),
            );
          const inactive = deps.filter((d) => {
            const r = depRows.find((row2) => row2.code === d.module);
            return !r || r.status !== "ACTIVE";
          });
          if (inactive.length > 0) {
            const names = inactive.map((c) => getManifestOrThrow(c.module).name).join(", ");
            throw new AppError(
              "MODULE_DEPENDENCY_DISABLED",
              `Dependensi belum aktif: ${names}`, 
              { missing: inactive.map((c) => c.module) },
            );
          }
          const issues = checkVersionCompatibility(
            deps,
            (c) => depRows.find((row2) => row2.code === c)?.version ?? undefined,
          );
          if (issues.length > 0) {
            throw new AppError(
              "MODULE_DEPENDENCY_VERSION_MISMATCH",
              `Versi dependensi tidak kompatibel: ${issues
                .map((i) => `${i.module} (butuh ${i.constraint}, terpasang ${i.actualVersion})`)
                .join(", ")}`,
              issues,
            );
          }
        }
      } else if (row.status === "DISABLED") {
        throw new AppError(
          "MODULE_ALREADY_DISABLED",
          `Modul "${manifest.name}" sudah nonaktif.`,
        );
      }

      // Disable preserves data, configuration, installation record (§17)
      const [updated] = await tx
        .update(moduleInstallations)
        .set({ status: enabled ? "ACTIVE" : "DISABLED", lastError: null })
        .where(eq(moduleInstallations.id, row.id))
        .returning();
      return updated;
    });

    await auditLifecycleEvent(
      ctx,
      enabled ? "MODULE_ENABLED" : "MODULE_DISABLED",
      "SUCCESS",
      { version: result.installedVersion ?? undefined },
    );
    await recordActivity({
      companyId,
      userId: user.id,
      type: enabled ? "module.enable" : "module.disable",
      message: `Modul ${manifest.name} ${enabled ? "di-enable" : "di-disable"} — data tetap disimpan`,
    });
    logLifecycle(ctx, enabled ? "enabled" : "disabled");
    return result;
  } catch (e) {
    if (
      e instanceof AppError &&
      [
        "MODULE_NOT_INSTALLED",
        "MODULE_ALREADY_ENABLED",
        "MODULE_ALREADY_DISABLED",
        "MODULE_SUBSCRIPTION_REQUIRED",
        "MODULE_DEPENDENCY_DISABLED",
        "MODULE_DEPENDENCY_VERSION_MISMATCH",
        "MODULE_OPERATION_IN_PROGRESS",
      ].includes(e.code)
    ) {
      throw e; // deterministic business rejection — not a lifecycle failure
    }
    await auditLifecycleFailure(
      ctx,
      enabled ? "MODULE_ENABLED" : "MODULE_DISABLED",
      e,
    );
    throw e instanceof AppError ? e : new AppError("INTERNAL", "Operasi modul gagal.");
  }
}

/* --------------------- Uninstall + retention (§18-20) --------------------- */

/** Dependents of `moduleCode` installed by the company (any state ≠ UNINSTALLED). */
async function getInstalledDependents(companyId: string, moduleCode: string) {
  const dependentManifests = getDependentManifests(moduleCode, moduleManifests);
  if (dependentManifests.length === 0) return [];
  const dependentCodes = dependentManifests.map((m) => m.code);
  const rows = await db
    .select({ code: modules.code, name: modules.name, status: moduleInstallations.status })
    .from(moduleInstallations)
    .innerJoin(modules, eq(modules.id, moduleInstallations.moduleId))
    .where(
      and(
        eq(moduleInstallations.companyId, companyId),
        inArray(modules.code, dependentCodes),
      ),
    );
  return rows.filter((r) => r.status !== "UNINSTALLED");
}

/**
 * Uninstall (PRD §18-20). Dependency consumers block uninstall (§11).
 * Data retention follows the manifest policy — default KEEP_DATA, so
 * uninstall NEVER destroys business data unless explicitly declared.
 */
export async function uninstallModule(
  user: CurrentUser,
  moduleCode: string,
  options: { confirmDataLoss?: boolean } = {},
) {
  const { companyId } = requireCompanyUser(user);
  const manifest = getManifestOrThrow(moduleCode);
  const ctx: LifecycleContext = {
    companyId,
    userId: user.id,
    moduleCode,
    operation: "uninstall",
  };
  const mod = await getModuleRow(moduleCode);
  if (!mod) throw new AppError("NOT_FOUND", "Modul belum terdaftar di registry.");

  const existing = await getInstallation(companyId, mod.id);
  if (!existing || existing.status === "UNINSTALLED") {
    throw new AppError(
      "MODULE_NOT_INSTALLED",
      `Modul "${manifest.name}" memang sudah ter-uninstall.`,
    );
  }
  if (
    TRANSIENT_STATUSES.includes(existing.status as (typeof TRANSIENT_STATUSES)[number]) &&
    existing.updatedAt &&
    Date.now() - existing.updatedAt.getTime() <= STALE_TRANSITION_MS
  ) {
    throw new AppError(
      "MODULE_OPERATION_IN_PROGRESS",
      "Operasi modul sedang berlangsung. Coba beberapa saat lagi.",
    );
  }

  // 0. the ATTEMPT is audited before any blocking decision (PRD §58D)
  await auditLifecycleEvent(ctx, "MODULE_UNINSTALL_STARTED", "STARTED", {
    status: existing.status,
    dataPolicy: manifest.uninstallPolicy ?? "KEEP_DATA",
  });

  // 1. dependency consumers block uninstall (PRD §11) — any installed state
  const dependents = await getInstalledDependents(companyId, moduleCode);
  if (dependents.length > 0) {
    const names = dependents.map((d) => d.name).join(", ");
    await auditLifecycleEvent(ctx, "MODULE_UNINSTALL_FAILED", "FAILED", {
      errorCode: "MODULE_UNINSTALL_BLOCKED",
      errorMessage: `Required by: ${names}`,
      dependents: dependents.map((d) => d.code),
    });
    throw new AppError(
      "MODULE_UNINSTALL_BLOCKED",
      `Tidak dapat uninstall modul "${manifest.name}". Masih dibutuhkan oleh: ${names}`,
      { dependents: dependents.map((d) => d.code), requiredBy: names },
    );
  }

  // 2. data retention policy (PRD §19)
  const policy = manifest.uninstallPolicy ?? "KEEP_DATA";
  if (policy === "DELETE_DATA" && !options.confirmDataLoss) {
    throw new AppError(
      "MODULE_UNINSTALL_CONFIRMATION_REQUIRED",
      `Modul "${manifest.name}" menggunakan kebijakan DELETE_DATA. Konfirmasi penghapusan data wajib.`,
      { policy, tables: manifest.deleteDataSql ? [manifest.code] : [] },
    );
  }

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(moduleInstallations)
        .where(eq(moduleInstallations.id, existing.id))
        .for("update");
      if (!row || row.status === "UNINSTALLED") {
        throw new AppError(
          "MODULE_NOT_INSTALLED",
          `Modul "${manifest.name}" sudah ter-uninstall.`,
        );
      }

      if (policy === "ARCHIVE_DATA") {
        if (!manifest.archiveSql) {
          throw new AppError(
            "MODULE_CONFIGURATION_INVALID",
            "Policy ARCHIVE_DATA butuh archiveSql pada manifest.",
          );
        }
        await tx.execute(sql.raw(assertUuid(ctx.companyId, "company") && manifest.archiveSql.replace("$1", `'${ctx.companyId}'`)));
      } else if (policy === "DELETE_DATA") {
        if (!manifest.deleteDataSql) {
          throw new AppError(
            "MODULE_CONFIGURATION_INVALID",
            "Policy DELETE_DATA butuh deleteDataSql pada manifest.",
          );
        }
        await tx.execute(sql.raw(manifest.deleteDataSql.replace("$1", `'${ctx.companyId}'`)));
      }

      await tx
        .update(moduleInstallations)
        .set({ status: "UNINSTALLED", uninstalledAt: new Date(), lastError: null })
        .where(eq(moduleInstallations.id, row.id));
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "MODULE_NOT_INSTALLED") throw e;
    await auditLifecycleFailure(ctx, "MODULE_UNINSTALL_FAILED", e);
    throw e instanceof AppError
      ? e
      : new AppError("INTERNAL", `Uninstall gagal: ${e instanceof Error ? e.message : String(e)}`);
  }

  await auditLifecycleEvent(ctx, "MODULE_UNINSTALLED", "SUCCESS", {
    status: "UNINSTALLED",
    dataPolicy: policy,
    dataRetained: policy === "KEEP_DATA",
  });
  await recordActivity({
    companyId,
    userId: user.id,
    type: "module.uninstall",
    message:
      policy === "KEEP_DATA"
        ? `Modul ${manifest.name} di-uninstall (data tetap disimpan)`
        : `Modul ${manifest.name} di-uninstall (policy ${policy})`,
  });
  logLifecycle(ctx, "uninstalled", { policy });
  return { moduleCode, dataRetained: policy === "KEEP_DATA", policy };
}

/**
 * DANGEROUS: explicit "Delete Module Data" — separate from uninstall (§20).
 * Requires module lifecycle permission, client confirmation, and is audit-logged.
 */
export async function deleteModuleData(user: CurrentUser, moduleCode: string) {
  const { companyId } = requireCompanyUser(user);
  const manifest = getManifestOrThrow(moduleCode);
  if (!manifest.deleteDataSql) {
    throw new AppError("CONFLICT", "Modul ini tidak menyediakan data cleanup.");
  }
  const safeCompanyId = assertUuid(companyId, "company");
  const ctx: LifecycleContext = {
    companyId,
    userId: user.id,
    moduleCode,
    operation: "delete-data",
  };
  await auditLifecycleEvent(ctx, "MODULE_DATA_DELETE_STARTED", "STARTED");
  try {
    await db.execute(sql.raw(manifest.deleteDataSql.replace("$1", `'${safeCompanyId}'`)));
  } catch (e) {
    await auditLifecycleFailure(ctx, "MODULE_DATA_DELETED", e);
    throw new AppError("INTERNAL", `Gagal menghapus data modul: ${e instanceof Error ? e.message : String(e)}`);
  }
  await auditLifecycleEvent(ctx, "MODULE_DATA_DELETED", "SUCCESS", {
    deletedAllBusinessData: true,
  });
  await recordActivity({
    companyId,
    userId: user.id,
    type: "module.data.delete",
    message: `Seluruh data bisnis modul ${manifest.name} dihapus permanen`,
  });
}

/* ------------------------ Upgrade engine (§26-30) ------------------------ */

/**
 * Upgrade an installed module to the registry's current version.
 * Flow: detect update → validate compatibility (own deps AND dependents)
 * → transactional {pending migrations + version bump} → previous state kept.
 */
export async function upgradeModule(user: CurrentUser, moduleCode: string) {
  const { companyId } = requireCompanyUser(user);
  const manifest = getManifestOrThrow(moduleCode);
  const ctx: LifecycleContext = {
    companyId,
    userId: user.id,
    moduleCode,
    operation: "upgrade",
  };
  const mod = await getModuleRow(moduleCode);
  if (!mod) throw new AppError("NOT_FOUND", "Modul belum terdaftar di registry.");

  const existing = await getInstallation(companyId, mod.id);
  if (
    !existing ||
    existing.status === "UNINSTALLED" ||
    !existing.installedVersion
  ) {
    throw new AppError(
      "MODULE_NOT_INSTALLED",
      `Modul "${manifest.name}" belum ter-install — gunakan Install.`,
    );
  }
  if (
    TRANSIENT_STATUSES.includes(existing.status as (typeof TRANSIENT_STATUSES)[number]) &&
    existing.updatedAt &&
    Date.now() - existing.updatedAt.getTime() <= STALE_TRANSITION_MS
  ) {
    throw new AppError(
      "MODULE_OPERATION_IN_PROGRESS",
      "Operasi modul sedang berlangsung. Coba beberapa saat lagi.",
    );
  }

  const fromVersion = existing.installedVersion;
  if (!isUpdateAvailable(fromVersion, manifest.version)) {
    throw new AppError(
      "CONFLICT",
      `Modul "${manifest.name}" sudah versi terbaru (${manifest.version}).`,
      { fromVersion, toVersion: manifest.version },
    );
  }

  await requireActiveSubscription(companyId, mod);
  await auditLifecycleEvent(ctx, "MODULE_UPGRADE_STARTED", "STARTED", {
    fromVersion,
    toVersion: manifest.version,
  });

  // own dependencies: must be ACTIVE and satisfy the NEW manifest constraints
  const deps = normalizeDependencies(manifest);
  if (deps.length > 0) {
    const depRows = await db
      .select({ code: modules.code, status: moduleInstallations.status, version: moduleInstallations.installedVersion })
      .from(moduleInstallations)
      .innerJoin(modules, eq(modules.id, moduleInstallations.moduleId))
      .where(
        and(
          eq(moduleInstallations.companyId, companyId),
          inArray(modules.code, deps.map((d) => d.module)),
        ),
      );
    const inactive = deps.filter((d) => {
      const r = depRows.find((row) => row.code === d.module);
      return !r || r.status !== "ACTIVE";
    });
    if (inactive.length > 0) {
      throw new AppError(
        "MODULE_DEPENDENCY_DISABLED",
        `Dependensi belum aktif: ${inactive.map((c) => getManifestOrThrow(c.module).name).join(", ")}`,
        { missing: inactive.map((c) => c.module) },
      );
    }
    const issues = checkVersionCompatibility(
      deps,
      (c) => depRows.find((row) => row.code === c)?.version ?? undefined,
    );
    if (issues.length > 0) {
      throw new AppError(
        "MODULE_DEPENDENCY_VERSION_MISMATCH",
        `Upgrade diblokir: dependensi tidak kompatibel dengan v${manifest.version}.`,
        issues,
      );
    }
  }

  // dependents: constraints must hold against the NEW version (PRD §28)
  const dependents = getDependentManifests(moduleCode, moduleManifests);
  for (const dependent of dependents) {
    const depSpecs = normalizeDependencies(dependent).filter((d) => d.module === moduleCode);
    const issues = checkVersionCompatibility(depSpecs, () => manifest.version);
    if (issues.length > 0) {
      throw new AppError(
        "MODULE_DEPENDENCY_VERSION_MISMATCH",
        `Upgrade diblokir: "${dependent.name}" membutuhkan ${issues[0].constraint}.`,
        issues,
      );
    }
  }

  const previousStatus = existing.status;
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(moduleInstallations)
        .where(eq(moduleInstallations.id, existing.id))
        .for("update");
      if (!row || row.installedVersion !== fromVersion) {
        throw new AppError(
          "CONFLICT",
          "Versi ter-install berubah saat upgrade. Muat ulang halaman.",
        );
      }

      // claim UPGRADING (§5) — final state written below in the same tx
      await tx
        .update(moduleInstallations)
        .set({ status: "UPGRADING" })
        .where(eq(moduleInstallations.id, row.id));

      // pending migrations only (PRD §29): version > installedVersion
      await runModuleMigrations(manifest, { tx, minVersion: fromVersion });

      await tx
        .update(moduleInstallations)
        .set({
          status: previousStatus === "ACTIVE" ? "ACTIVE" : previousStatus,
          installedVersion: manifest.version,
          lastError: null,
        })
        .where(eq(moduleInstallations.id, row.id));
    });
  } catch (e) {
    // rollback preserved previous version + data (PRD §30)
    await persistLifecycleFailure(ctx, "UPGRADE_FAILED", e, mod.id, manifest.version, false);
    await auditLifecycleFailure(ctx, "MODULE_UPGRADE_FAILED", e);
    await recordActivity({
      companyId,
      userId: user.id,
      type: "module.upgrade.failed",
      message: `Upgrade modul ${manifest.name} dari v${fromVersion} gagal: ${
        e instanceof Error ? e.message : String(e)
      }`,
    });
    throw e instanceof AppError
      ? e
      : new AppError(
          "MODULE_UPGRADE_FAILED",
          `Upgrade modul "${manifest.name}" gagal: ${e instanceof Error ? e.message : String(e)}`,
        );
  }

  await auditLifecycleEvent(ctx, "MODULE_UPGRADED", "SUCCESS", {
    fromVersion,
    toVersion: manifest.version,
    status: previousStatus,
  });
  await recordActivity({
    companyId,
    userId: user.id,
    type: "module.upgrade",
    message: `Modul ${manifest.name} di-upgrade dari v${fromVersion} ke v${manifest.version}`,
  });
  await notify({
    companyId,
    title: `Modul ${manifest.name} di-upgrade`,
    body: `v${fromVersion} → v${manifest.version}`,
    type: "SUCCESS",
    link: `/apps/${moduleCode}`,
  });
  logLifecycle(ctx, "upgraded", { fromVersion, toVersion: manifest.version });
  return { moduleCode, fromVersion, toVersion: manifest.version, status: previousStatus };
}

/* --------------------- Module configuration (§23) --------------------- */

/**
 * Save module settings for the company. Values are validated against the
 * manifest setting definitions (type-safe, §23); invalid input is rejected
 * with MODULE_CONFIGURATION_INVALID.
 */
export async function saveModuleSettings(
  user: CurrentUser,
  moduleCode: string,
  values: Record<string, unknown>,
) {
  const { companyId } = requireCompanyUser(user);
  const manifest = getManifestOrThrow(moduleCode);
  const defs = manifest.settings ?? [];
  const mod = await getModuleRow(moduleCode);
  if (!mod) throw new AppError("NOT_FOUND", "Modul belum terdaftar di registry.");

  for (const [key, value] of Object.entries(values)) {
    const def = defs.find((d) => d.key === key);
    if (!def) {
      throw new AppError(
        "MODULE_CONFIGURATION_INVALID",
        `Setting "${key}" tidak dikenal.`,
      );
    }
    const invalid = (reason: string) =>
      new AppError(
        "MODULE_CONFIGURATION_INVALID",
        `Setting "${key}": ${reason}`,
        { field: key, expectedType: def.type },
      );
    if (def.type === "number" && typeof value !== "number") throw invalid("harus number");
    if (def.type === "boolean" && typeof value !== "boolean") throw invalid("harus boolean");
    if (def.type === "text" && (typeof value !== "string" || value.length > 500)) {
      throw invalid("harus teks maksimal 500 karakter");
    }
    if (def.type === "select") {
      const allowed = (def.options ?? []).map((o) => o.value);
      if (typeof value !== "string" || !allowed.includes(value)) {
        throw invalid(`harus salah satu dari: ${allowed.join(", ")}`);
      }
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

  await auditLifecycleEvent(
    { companyId, userId: user.id, moduleCode, operation: "configure" },
    "MODULE_CONFIGURATION_UPDATED",
    "SUCCESS",
    { keys: Object.keys(values) },
  );
  await recordActivity({
    companyId,
    userId: user.id,
    type: "module.configure",
    message: `Konfigurasi modul ${manifest.name} diperbarui`,
    metadata: { keys: Object.keys(values) },
  });
}

export async function getModuleSettingsMap(
  companyId: string,
  moduleCode: string,
): Promise<Record<string, unknown>> {
  const manifest = getManifestOrThrow(moduleCode);
  const mod = await getModuleRow(moduleCode);
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
