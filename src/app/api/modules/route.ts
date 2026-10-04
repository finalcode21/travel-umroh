import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/core/auth/session";
import { assertAnyPermission } from "@/core/acl";
import { expireDueSubscriptions, getModuleAccessMap } from "@/core/modules/access";
import { syncModuleRegistry } from "@/core/modules/engine";
import { getDependentManifests, normalizeDependency } from "@/core/modules/dependency";
import { moduleManifests } from "@/modules/registry";
import { toPublicError } from "@/lib/errors";
import type { ModuleAccess } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/modules?q=&category=&status=
 * Module catalog with per-company access state (PRD §6, §24, §35).
 * Response contract: ActionResult (PRD §55 — same standard as server actions).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: { code: "UNAUTHENTICATED", message: "Sesi berakhir." } },
        { status: 401 },
      );
    }
    assertAnyPermission(user, ["module.view", "module.read", "module.manage"]);

    await Promise.all([syncModuleRegistry(), expireDueSubscriptions()]);

    const accessMap = user.companyId ? await getModuleAccessMap(user.companyId) : {};

    const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const category = req.nextUrl.searchParams.get("category");
    const status = req.nextUrl.searchParams.get("status");

    const items = moduleManifests
      .filter((m) => !category || m.category === category)
      .map((m) => {
        const access =
          accessMap[m.code] ??
          ({
            moduleCode: m.code,
            subscriptionStatus: "NOT_SUBSCRIBED",
            subscriptionExpiresAt: null,
            installStatus: "NOT_INSTALLED",
            access: "NOT_SUBSCRIBED",
            availableVersion: m.version,
            installedVersion: null,
            updateAvailable: false,
            lastError: null,
          } satisfies ModuleAccess);
        const dependents = getDependentManifests(m.code, moduleManifests)
          .filter((d) => {
            const st = accessMap[d.code]?.installStatus;
            return st !== undefined && st !== "NOT_INSTALLED" && st !== "UNINSTALLED";
          })
          .map((d) => d.code);
        return {
          code: m.code,
          name: m.name,
          description: m.description,
          version: m.version,
          category: m.category,
          author: m.author ?? null,
          priceMonthly: m.priceMonthly ?? 0,
          trialDays: m.trialDays ?? 14,
          uninstallPolicy: m.uninstallPolicy ?? "KEEP_DATA",
          dependencies: (m.dependencies ?? []).map(normalizeDependency),
          permissions: m.permissions.map((p) => p.code),
          access,
          dependents,
        };
      })
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q))
      .filter((m) => !status || m.access.access === status);

    return NextResponse.json({ ok: true, data: { modules: items, total: items.length } });
  } catch (e) {
    const { code, message, details } = toPublicError(e);
    return NextResponse.json(
      { ok: false, error: { code, message, details } },
      { status: code === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}
