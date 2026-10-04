import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/core/auth/session";
import { getModuleAccessMap } from "@/core/modules/access";
import { getModuleSettingsMap } from "@/core/modules/engine";
import { getDependentManifests, normalizeDependency } from "@/core/modules/dependency";
import { listModuleLifecycleAudit } from "@/core/audit/service";
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

  const accessMap = user.companyId ? await getModuleAccessMap(user.companyId) : {};
  const access = accessMap[manifest.code];
  const settings = user.companyId
    ? await getModuleSettingsMap(user.companyId, manifest.code)
    : {};
  const audit = user.companyId
    ? await listModuleLifecycleAudit(user.companyId, manifest.code)
    : [];

  const statusValue =
    access?.access ?? (user.isPlatformAdmin ? "REGISTRY_ONLY" : "NOT_SUBSCRIBED");

  // installed dependents for THIS company (any state ≠ UNINSTALLED)
  const dependents = getDependentManifests(manifest.code, moduleManifests)
    .filter((dep) => {
      const st = accessMap[dep.code]?.installStatus;
      return st !== undefined && st !== "NOT_INSTALLED" && st !== "UNINSTALLED";
    })
    .map((dep) => dep.name);

  const dependencies = (manifest.dependencies ?? []).map(normalizeDependency);

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
            <h1 className="text-xl font-semibold">
              {manifest.name}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                v{manifest.version}
              </span>
            </h1>
            <p className="text-sm text-muted-foreground">{manifest.description}</p>
          </div>
          {user.companyId && access && (
            <ModuleActions
              moduleCode={manifest.code}
              moduleName={manifest.name}
              access={access}
              size="default"
              uninstallPolicy={manifest.uninstallPolicy ?? "KEEP_DATA"}
              requiredBy={dependents}
            />
          )}
        </div>
      </div>

      {access?.lastError && (
        <Card className="border-destructive/50">
          <CardContent className="pt-4 text-sm text-destructive">
            <strong>Error terakhir:</strong> {access.lastError}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informasi Modul</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Kode" value={<span className="font-mono text-xs">{manifest.code}</span>} />
            <Row label="Versi tersedia" value={`v${manifest.version}`} />
            <Row
              label="Versi ter-install"
              value={
                access?.installedVersion
                  ? `v${access.installedVersion}${access.updateAvailable ? " (update tersedia)" : ""}`
                  : "—"
              }
            />
            <Row label="Kategori" value={manifest.category} />
            <Row label="Author" value={manifest.author ?? "—"} />
            <Row
              label="Harga"
              value={
                manifest.priceMonthly
                  ? `${formatIDR(manifest.priceMonthly)} / bulan`
                  : "Gratis"
              }
            />
            <Row label="Trial" value={`${manifest.trialDays ?? 14} hari`} />
            <Row label="Status di perusahaan Anda" value={<StatusBadge status={statusValue} />} />
            {access?.subscriptionExpiresAt && (
              <Row
                label="Berlaku sampai"
                value={new Date(access.subscriptionExpiresAt).toLocaleDateString("id-ID")}
              />
            )}
            <Row
              label="Kebijakan uninstall"
              value={<Badge variant="outline">{manifest.uninstallPolicy ?? "KEEP_DATA"}</Badge>}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dependencies</CardTitle>
            <CardDescription>
              Modul lain yang harus aktif (dengan versi yang kompatibel) sebelum
              modul ini bisa di-install.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dependencies.length > 0 ? (
              <div className="space-y-2">
                {dependencies.map((dep) => {
                  const depManifest = moduleManifests.find((m) => m.code === dep.module);
                  const depAccess = accessMap[dep.module];
                  const ok = depAccess?.access === "ACTIVE";
                  return (
                    <div
                      key={dep.module}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span>
                        {depManifest?.name ?? dep.module}{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          v{depManifest?.version}
                          {dep.version ? ` (${dep.version})` : ""}
                        </span>
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
            {dependents.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
                <strong>Required by:</strong> {dependents.join(", ")} — modul ini
                tidak dapat di-uninstall selama modul tersebut masih ter-install.
              </div>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aktivitas (Audit)</CardTitle>
          <CardDescription>
            Riwayat lifecycle operation modul ini untuk perusahaan Anda.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada aktivitas.</p>
          ) : (
            <div className="space-y-1.5">
              {audit.map((row) => {
                const meta = (row.newValues ?? {}) as Record<string, unknown>;
                const versionInfo =
                  meta.fromVersion && meta.toVersion
                    ? ` (v${String(meta.fromVersion)} → v${String(meta.toVersion)})`
                    : meta.version
                      ? ` (v${String(meta.version)})`
                      : "";
                return (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs"
                  >
                    <span>
                      <span className="font-mono">{row.action}</span>
                      {versionInfo}
                      {meta.errorCode ? (
                        <span className="text-destructive"> — {String(meta.errorCode)}</span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground">
                      {row.userName ?? "—"} ·{" "}
                      {new Date(row.createdAt).toLocaleString("id-ID")}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Uninstall tidak menghapus data (policy {manifest.uninstallPolicy ?? "KEEP_DATA"}).
            Penghapusan data bersifat permanen dan terpisah dari uninstall.
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
  > = {
    ACTIVE: { label: "Aktif", variant: "default" },
    SUBSCRIBED: { label: "Subscribed, belum install", variant: "secondary" },
    DISABLED: { label: "Disabled", variant: "outline" },
    PAUSED: { label: "Paused — langganan berakhir", variant: "destructive" },
    UNINSTALLED: { label: "Uninstalled (data disimpan)", variant: "outline" },
    NOT_SUBSCRIBED: { label: "Belum subscribe", variant: "outline" },
    REGISTRY_ONLY: { label: "Lihat dari platform admin", variant: "outline" },
  };
  const item = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={item.variant}>{item.label}</Badge>;
}
