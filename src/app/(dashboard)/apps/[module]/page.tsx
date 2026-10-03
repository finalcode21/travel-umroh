import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/core/auth/session";
import { getModuleAccessMap } from "@/core/modules/access";
import { getModuleSettingsMap } from "@/core/modules/engine";
import { moduleManifests } from "@/modules/registry";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatIDR } from "@/lib/format";
import { DeleteModuleDataButton, ModuleActions } from "../module-actions";
import { ModuleSettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function ModuleDetailPage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module: moduleCode } = await params;
  const user = await getCurrentUser();
  if (!user) return null;

  const manifest = moduleManifests.find((m) => m.code === moduleCode);
  if (!manifest) notFound();

  const access = user.companyId
    ? (await getModuleAccessMap(user.companyId))[manifest.code]
    : undefined;
  const settings = user.companyId
    ? await getModuleSettingsMap(user.companyId, manifest.code)
    : {};

  const statusValue =
    access?.access ?? (user.isPlatformAdmin ? "REGISTRY_ONLY" : "NOT_SUBSCRIBED");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/apps"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Kembali ke Apps
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{manifest.name}</h1>
            <p className="text-sm text-muted-foreground">{manifest.description}</p>
          </div>
          {user.companyId && access && (
            <ModuleActions
              moduleCode={manifest.code}
              moduleName={manifest.name}
              access={access}
              size="default"
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informasi Modul</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Kode" value={<span className="font-mono text-xs">{manifest.code}</span>} />
            <Row label="Versi" value={manifest.version} />
            <Row label="Kategori" value={manifest.category} />
            <Row
              label="Harga"
              value={
                manifest.priceMonthly
                  ? `${formatIDR(manifest.priceMonthly)} / bulan`
                  : "Gratis"
              }
            />
            <Row label="Trial" value={`${manifest.trialDays ?? 14} hari`} />
            <Row label="Status di perusahaan Anda" value={<StatusBadge access={statusValue} />} />
            {access?.subscriptionExpiresAt && (
              <Row
                label="Berlaku sampai"
                value={new Date(access.subscriptionExpiresAt).toLocaleDateString("id-ID")}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dependencies</CardTitle>
            <CardDescription>
              Modul lain yang harus aktif sebelum modul ini bisa di-install.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {manifest.dependencies && manifest.dependencies.length > 0 ? (
              <div className="space-y-2">
                {manifest.dependencies.map((dep) => {
                  const depManifest = moduleManifests.find((m) => m.code === dep);
                  const depAccess = user.moduleAccess[dep];
                  const ok = depAccess?.access === "ACTIVE";
                  return (
                    <div
                      key={dep}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span>
                        {depManifest?.name ?? dep}{" "}
                        <span className="font-mono text-xs text-muted-foreground">v{depManifest?.version}</span>
                      </span>
                      <Badge variant={ok ? "secondary" : "outline"}>
                        {ok ? "aktif" : "belum aktif"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Tidak ada dependency.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Permissions
            </CardTitle>
            <CardDescription>
              Terdaftar otomatis saat install dan dikontrol lewat Role.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Kode</TableHead>
                    <TableHead>Nama</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {manifest.permissions.map((p) => (
                    <TableRow key={p.code}>
                      <TableCell className="font-mono text-xs">{p.code}</TableCell>
                      <TableCell>{p.name}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pengaturan Modul</CardTitle>
            <CardDescription>Settings khusus modul (tersimpan per perusahaan).</CardDescription>
          </CardHeader>
          <CardContent>
            {manifest.settings && manifest.settings.length > 0 ? (
              <ModuleSettingsForm
                moduleCode={manifest.code}
                defs={manifest.settings}
                initialValues={settings}
                disabled={!access || access.access !== "ACTIVE"}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Modul ini tidak memiliki pengaturan.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Uninstall tidak menghapus data. Penghapusan data bersifat permanen dan
            terpisah dari uninstall.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {manifest.deleteDataSql ? (
            <DeleteModuleDataButton moduleCode={manifest.code} moduleName={manifest.name} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Modul ini tidak menyimpan data bisnis sendiri.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function StatusBadge({ access }: { access: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    ACTIVE: { label: "Aktif", variant: "default" },
    SUBSCRIBED: { label: "Subscribed, belum install", variant: "secondary" },
    DISABLED: { label: "Disabled", variant: "outline" },
    PAUSED: { label: "Paused — langganan berakhir", variant: "destructive" },
    UNINSTALLED: { label: "Uninstalled (data disimpan)", variant: "outline" },
    NOT_SUBSCRIBED: { label: "Belum subscribe", variant: "outline" },
    REGISTRY_ONLY: { label: "Lihat dari platform admin", variant: "outline" },
  };
  const item = map[access] ?? { label: access, variant: "outline" as const };
  return <Badge variant={item.variant}>{item.label}</Badge>;
}
