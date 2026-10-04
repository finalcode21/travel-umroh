import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  moduleInstallations,
  moduleSubscriptions,
  modules,
} from "@/db/schema";
import { isUpdateAvailable } from "@/lib/semver";
import type { ModuleAccess, ModuleAccessState } from "@/types";

interface RawRow {
  code: string;
  installStatus: string | null;
  subStatus: string | null;
  subExpiresAt: Date | null;
  installedVersion?: string | null;
  lastError?: string | null;
  availableVersion?: string | null;
}

/**
 * Compute the effective access state for one module.
 *
 *   subscription missing        → NOT_SUBSCRIBED
 *   subscription active/trial   → install status decides (ACTIVE/DISABLED/…)
 *   subscription expired/cancel → installation is effectively PAUSED
 */
export function computeModuleAccess(row: RawRow): ModuleAccess {
  const subStatus = (row.subStatus ?? "NOT_SUBSCRIBED") as ModuleAccess["subscriptionStatus"];
  const installStatus = (row.installStatus ?? "NOT_INSTALLED") as ModuleAccess["installStatus"];

  const subscriptionLapsed =
    row.subExpiresAt !== null && row.subExpiresAt.getTime() < Date.now();

  const subEffective: ModuleAccess["subscriptionStatus"] =
    subStatus === "TRIAL" || subStatus === "ACTIVE"
      ? subscriptionLapsed
        ? "EXPIRED"
        : subStatus
      : subStatus;

  let access: ModuleAccessState;
  if (subStatus === null || subStatus === "NOT_SUBSCRIBED") {
    access = "NOT_SUBSCRIBED";
  } else if (subEffective === "EXPIRED" || subEffective === "CANCELLED") {
    access = "PAUSED";
  } else {
    switch (installStatus) {
      case "ACTIVE":
        access = "ACTIVE";
        break;
      case "DISABLED":
        access = "DISABLED";
        break;
      case "UNINSTALLED":
        access = "UNINSTALLED";
        break;
      default:
        access = "SUBSCRIBED";
    }
  }

  const availableVersion = row.availableVersion ?? undefined;
  const installedVersion = row.installStatus ? (row.installedVersion ?? null) : undefined;
  const updateAvailable =
    installedVersion != null && availableVersion != null
      ? isUpdateAvailable(installedVersion, availableVersion)
      : false;

  return {
    moduleCode: row.code,
    subscriptionStatus: subEffective,
    subscriptionExpiresAt: row.subExpiresAt?.toISOString() ?? null,
    installStatus,
    access,
    availableVersion,
    installedVersion: installedVersion ?? null,
    updateAvailable,
    lastError: row.lastError ?? null,
  };
}

/** Load the module access map for a company (used by ACL + navigation). */
export async function getModuleAccessMap(
  companyId: string,
): Promise<Record<string, ModuleAccess>> {
  const rows = await db
    .select({
      code: modules.code,
      installStatus: moduleInstallations.status,
      subStatus: moduleSubscriptions.status,
      subExpiresAt: moduleSubscriptions.expiresAt,
      installedVersion: moduleInstallations.installedVersion,
      lastError: moduleInstallations.lastError,
      availableVersion: modules.version,
    })
    .from(modules)
    .leftJoin(
      moduleInstallations,
      and(
        eq(moduleInstallations.moduleId, modules.id),
        eq(moduleInstallations.companyId, companyId),
      ),
    )
    .leftJoin(
      moduleSubscriptions,
      and(
        eq(moduleSubscriptions.moduleId, modules.id),
        eq(moduleSubscriptions.companyId, companyId),
      ),
    )
    .orderBy(desc(moduleSubscriptions.createdAt));

  const map: Record<string, ModuleAccess> = {};
  for (const row of rows) {
    // keep the newest subscription per module (rows ordered by created desc)
    if (map[row.code]) continue;
    map[row.code] = computeModuleAccess(row);
  }
  return map;
}

/**
 * Sweep: expire due subscriptions and pause their installations.
 * Called opportunistically from dashboard/apps pages (poor-man's cron).
 */
export async function expireDueSubscriptions(): Promise<number> {
  const expired = await db
    .update(moduleSubscriptions)
    .set({ status: "EXPIRED" })
    .where(
      and(
        or(
          eq(moduleSubscriptions.status, "ACTIVE"),
          eq(moduleSubscriptions.status, "TRIAL"),
        ),
        lt(moduleSubscriptions.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: moduleSubscriptions.id, moduleId: moduleSubscriptions.moduleId, companyId: moduleSubscriptions.companyId });

  if (expired.length > 0) {
    // pause affected installations per company (expiry is per company/module)
    for (const e of expired) {
      await db
        .update(moduleInstallations)
        .set({ status: "PAUSED" })
        .where(
          and(
            eq(moduleInstallations.companyId, e.companyId),
            eq(moduleInstallations.moduleId, e.moduleId),
            eq(moduleInstallations.status, "ACTIVE"),
          ),
        );
    }
  }
  return expired.length;
}
