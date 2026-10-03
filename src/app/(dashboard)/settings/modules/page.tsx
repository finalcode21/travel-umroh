import { getCurrentUser } from "@/core/auth/session";
import { getModuleAccessMap, expireDueSubscriptions } from "@/core/modules/access";
import { syncModuleRegistry } from "@/core/modules/engine";
import { moduleManifests } from "@/modules/registry";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ModuleActions } from "@/app/(dashboard)/apps/module-actions";
import { formatIDR } from "@/lib/format";
import type { ModuleAccess } from "@/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Modul" };

export default async function ModulesSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  if (user.isPlatformAdmin || !user.companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modul</CardTitle>
          <CardDescription>
            Instalasi modul berlaku per perusahaan — kelola dari akun perusahaan.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  await Promise.all([syncModuleRegistry(), expireDueSubscriptions()]);
  const accessMap = await getModuleAccessMap(user.companyId);

  return (
    <div className="space-y-3">
      {moduleManifests.map((manifest) => {
        const access: ModuleAccess =
          accessMap[manifest.code] ?? {
            moduleCode: manifest.code,
            subscriptionStatus: "NOT_SUBSCRIBED",
            subscriptionExpiresAt: null,
            installStatus: "NOT_INSTALLED",
            access: "NOT_SUBSCRIBED",
          };
        return (
          <Card key={manifest.code}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{manifest.name}</CardTitle>
                  <CardDescription>
                    v{manifest.version} ·{" "}
                    {manifest.priceMonthly ? `${formatIDR(manifest.priceMonthly)}/bln` : "gratis"} ·
                    sub: {access.subscriptionStatus} · install: {access.installStatus}
                  </CardDescription>
                </div>
                <ModuleActions
                  moduleCode={manifest.code}
                  moduleName={manifest.name}
                  access={access}
                />
              </div>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-[11px] text-muted-foreground">
                {manifest.permissions.map((p) => p.code).join(" · ")}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
