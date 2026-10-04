import { Boxes } from "lucide-react";
import { getCurrentUser } from "@/core/auth/session";
import { expireDueSubscriptions, getModuleAccessMap } from "@/core/modules/access";
import { syncModuleRegistry } from "@/core/modules/engine";
import { getDependentManifests, normalizeDependency } from "@/core/modules/dependency";
import { moduleManifests } from "@/modules/registry";
import { Badge } from "@/components/ui/badge";
import { SetupNotice } from "@/components/setup-notice";
import {
  MarketplaceBrowser,
  type MarketplaceItem,
} from "./marketplace";

export const metadata = { title: "Apps" };
export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  CORE: "Core",
  CRM: "CRM",
  SALES: "Sales",
  OPERATIONS: "Operasional",
  FINANCE: "Keuangan",
  COLLABORATION: "Kolaborasi",
  AI: "AI",
  EXTENSION: "Ekstensi",
};

export default async function AppsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  await Promise.all([syncModuleRegistry(), expireDueSubscriptions()]);

  const accessMap = user.companyId ? await getModuleAccessMap(user.companyId) : {};

  const items: MarketplaceItem[] = moduleManifests.map((manifest) => {
    const access = accessMap[manifest.code] ?? {
      moduleCode: manifest.code,
      subscriptionStatus: "NOT_SUBSCRIBED" as const,
      subscriptionExpiresAt: null,
      installStatus: "NOT_INSTALLED" as const,
      access: "NOT_SUBSCRIBED" as const,
      availableVersion: manifest.version,
      installedVersion: null,
      updateAvailable: false,
      lastError: null,
    };

    // installed dependents (any state ≠ UNINSTALLED) — shown as "Required by"
    const dependents = getDependentManifests(manifest.code, moduleManifests)
      .filter((dep) => {
        const st = accessMap[dep.code]?.installStatus;
        return st !== undefined && st !== "NOT_INSTALLED" && st !== "UNINSTALLED";
      })
      .map((dep) => dep.code);

    return {
      code: manifest.code,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      category: CATEGORY_LABEL[manifest.category] ?? manifest.category,
      author: manifest.author,
      priceMonthly: manifest.priceMonthly ?? 0,
      trialDays: manifest.trialDays ?? 14,
      dependencies: (manifest.dependencies ?? []).map(normalizeDependency),
      permissions: manifest.permissions.map((p) => p.code),
      access,
      dependents,
      uninstallPolicy: manifest.uninstallPolicy ?? "KEEP_DATA",
    };
  });

  const installedCount = items.filter(
    (i) =>
      i.access.installStatus !== "NOT_INSTALLED" &&
      i.access.installStatus !== "UNINSTALLED",
  ).length;
  const updatesCount = items.filter((i) => i.access.updateAvailable).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Apps</h1>
          <p className="text-sm text-muted-foreground">
            Marketplace modul — subscribe, install, dan kelola modul untuk{" "}
            {user.companyName ?? "perusahaan Anda"}.
          </p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Boxes className="h-3 w-3" /> {moduleManifests.length} modul ·{" "}
          {installedCount} installed · {updatesCount} update
        </Badge>
      </div>

      {user.isPlatformAdmin ? (
        <SetupNotice
          title="Akses dari akun perusahaan"
          description="Marketplace modul berlaku per perusahaan. Gunakan akun perusahaan (bukan Platform Admin) untuk subscribe/install modul."
          missing={[]}
        />
      ) : (
        <MarketplaceBrowser items={items} />
      )}
    </div>
  );
}
