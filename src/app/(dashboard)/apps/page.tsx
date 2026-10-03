import Link from "next/link";
import { ArrowRight, Boxes } from "lucide-react";
import { getCurrentUser, isClerkConfigured } from "@/core/auth/session";
import { expireDueSubscriptions } from "@/core/modules/access";
import { syncModuleRegistry } from "@/core/modules/engine";
import { moduleManifests } from "@/modules/registry";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatIDR } from "@/lib/format";
import { ModuleActions } from "./module-actions";
import { SetupNotice } from "@/components/setup-notice";

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
  if (!isClerkConfigured()) return null;
  const user = await getCurrentUser();
  if (!user) return null;

  await Promise.all([syncModuleRegistry(), expireDueSubscriptions()]);

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
          <Boxes className="h-3 w-3" /> {moduleManifests.length} modul terdaftar
        </Badge>
      </div>

      {user.isPlatformAdmin ? (
        <SetupNotice
          title="Akses dari akun perusahaan"
          description="Marketplace modul berlaku per perusahaan. Gunakan akun perusahaan (bukan Platform Admin) untuk subscribe/install modul."
          missing={[]}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {moduleManifests.map((manifest) => {
            const access =
              user.moduleAccess[manifest.code] ?? {
                moduleCode: manifest.code,
                subscriptionStatus: "NOT_SUBSCRIBED",
                subscriptionExpiresAt: null,
                installStatus: "NOT_INSTALLED",
                access: "NOT_SUBSCRIBED",
              };
            return (
              <Card key={manifest.code} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">
                      <Link href={`/apps/${manifest.code}`} className="hover:underline">
                        {manifest.name}
                      </Link>
                    </CardTitle>
                    <AccessBadge access={access.access} />
                  </div>
                  <p className="text-sm text-muted-foreground">{manifest.description}</p>
                </CardHeader>
                <CardContent className="flex-1 space-y-3 pb-3">
                  <div>
                    <p className="text-lg font-semibold">
                      {manifest.priceMonthly ? (
                        <>
                          {formatIDR(manifest.priceMonthly)}
                          <span className="text-sm font-normal text-muted-foreground">
                            {" "}
                            / bulan
                          </span>
                        </>
                      ) : (
                        "Gratis"
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Trial {manifest.trialDays ?? 14} hari · v{manifest.version} ·{" "}
                      {CATEGORY_LABEL[manifest.category] ?? manifest.category}
                    </p>
                  </div>
                  <Separator />
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Dependencies
                    </p>
                    {manifest.dependencies && manifest.dependencies.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {manifest.dependencies.map((dep) => {
                          const depAccess = user.moduleAccess[dep];
                          const ok = depAccess?.access === "ACTIVE";
                          return (
                            <Badge key={dep} variant={ok ? "secondary" : "outline"} className="text-xs">
                              {moduleManifests.find((m) => m.code === dep)?.name ?? dep}
                              {!ok && " (belum aktif)"}
                            </Badge>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Tidak ada</p>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Permissions</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {manifest.permissions.map((p) => p.code).join(", ")}
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="justify-between gap-2 border-t pt-3">
                  <Link
                    href={`/apps/${manifest.code}`}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Detail <ArrowRight className="h-3 w-3" />
                  </Link>
                  <ModuleActions
                    moduleCode={manifest.code}
                    moduleName={manifest.name}
                    access={access}
                  />
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AccessBadge({ access }: { access: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    ACTIVE: { label: "Aktif", variant: "default" },
    SUBSCRIBED: { label: "Siap install", variant: "secondary" },
    DISABLED: { label: "Disabled", variant: "outline" },
    PAUSED: { label: "Paused (expired)", variant: "destructive" },
    UNINSTALLED: { label: "Uninstalled", variant: "outline" },
    NOT_SUBSCRIBED: { label: "Belum subscribe", variant: "outline" },
  };
  const item = map[access] ?? { label: access, variant: "outline" as const };
  return <Badge variant={item.variant}>{item.label}</Badge>;
}
