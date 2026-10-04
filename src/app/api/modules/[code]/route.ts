import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/core/auth/session";
import { assertAnyPermission } from "@/core/acl";
import { getModuleAccessMap } from "@/core/modules/access";
import { getModuleSettingsMap } from "@/core/modules/engine";
import { getDependentManifests, normalizeDependency } from "@/core/modules/dependency";
import { listModuleLifecycleAudit } from "@/core/audit/service";
import { moduleManifests } from "@/modules/registry";
import { AppError, toPublicError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/modules/[code] — module detail (manifest + company access state +
 * dependents + settings + lifecycle audit). PRD §25, §42, §46.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: { code: "UNAUTHENTICATED", message: "Sesi berakhir." } },
        { status: 401 },
      );
    }
    assertAnyPermission(user, ["module.view", "module.read", "module.manage"]);

    const { code } = await params;
    const manifest = moduleManifests.find((m) => m.code === code);
    if (!manifest) {
      throw new AppError("MODULE_NOT_FOUND", `Modul \"${code}\" tidak terdaftar.`);
    }

    const accessMap = user.companyId ? await getModuleAccessMap(user.companyId) : {};
    const access = accessMap[manifest.code] ?? null;
    const settings = user.companyId
      ? await getModuleSettingsMap(user.companyId, manifest.code)
      : {};
    const audit = user.companyId
      ? await listModuleLifecycleAudit(user.companyId, manifest.code, 15)
      : [];
    const dependents = getDependentManifests(manifest.code, moduleManifests).map(
      (d) => d.code,
    );

    return NextResponse.json({
      ok: true,
      data: {
        module: {
          code: manifest.code,
          name: manifest.name,
          description: manifest.description,
          version: manifest.version,
          category: manifest.category,
          author: manifest.author ?? null,
          priceMonthly: manifest.priceMonthly ?? 0,
          trialDays: manifest.trialDays ?? 14,
          uninstallPolicy: manifest.uninstallPolicy ?? "KEEP_DATA",
          dependencies: (manifest.dependencies ?? []).map(normalizeDependency),
          permissions: manifest.permissions,
          navigation: manifest.navigation,
          settings: manifest.settings ?? [],
        },
        access,
        dependents,
        settings,
        audit,
      },
    });
  } catch (e) {
    const { code, message, details } = toPublicError(e);
    const status =
      code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : code === "MODULE_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
  }
}
