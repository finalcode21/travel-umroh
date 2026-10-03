import Link from "next/link";
import {
  Building2,
  GitBranch,
  PackageCheck,
  PackageX,
  Users,
} from "lucide-react";
import { getCurrentUser } from "@/core/auth/session";
import { expireDueSubscriptions, getModuleAccessMap } from "@/core/modules/access";
import { syncModuleRegistry } from "@/core/modules/engine";
import { listRecentActivities, listPlatformActivities } from "@/core/activity/service";
import { getUserCounts, getBranchCount } from "@/core/auth/users-admin";
import {
  getModuleManifestSummaries,
  listPlatformCompanies,
} from "@/core/tenant/companies";
import { db } from "@/db";
import {
  count,
  eq,
} from "drizzle-orm";
import {
  moduleInstallations,
  moduleSubscriptions,
} from "@/db/schema";
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
import { formatRelative } from "@/lib/format";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {

  const user = await getCurrentUser();
  if (!user) return null;

  // opportunistic subscription sweep + registry sync (poor-man's cron)
  await Promise.all([
    user.companyId ? expireDueSubscriptions() : Promise.resolve(0),
    syncModuleRegistry(),
  ]);

  const [userCount, branchCount] = await Promise.all([
    getUserCounts(user.companyId),
    getBranchCount(user.companyId),
  ]);

  const activities = user.companyId
    ? await listRecentActivities(user.companyId, 8)
    : await listPlatformActivities(8);

  let stats = {
    installed: 0,
    activeSubs: 0,
    expired: 0,
  };
  let accessMap: Record<string, { access: string; subscriptionStatus: string }> = {};
  let companyCount = 0;

  if (user.companyId) {
    accessMap = await getModuleAccessMap(user.companyId);
    const values = Object.values(accessMap);
    stats.installed = values.filter((v) => v.access === "ACTIVE").length;
    stats.activeSubs = values.filter(
      (v) => v.subscriptionStatus === "ACTIVE" || v.subscriptionStatus === "TRIAL",
    ).length;
    stats.expired = values.filter((v) => v.subscriptionStatus === "EXPIRED").length;
  } else {
    const [{ total }] = await db
      .select({ total: count() })
      .from(moduleInstallations)
      .where(eq(moduleInstallations.status, "ACTIVE"));
    const [{ total: subs }] = await db
      .select({ total: count() })
      .from(moduleSubscriptions)
      .where(eq(moduleSubscriptions.status, "ACTIVE"));
    const [{ total: expired }] = await db
      .select({ total: count() })
      .from(moduleSubscriptions)
      .where(eq(moduleSubscriptions.status, "EXPIRED"));
    stats = { installed: Number(total), activeSubs: Number(subs), expired: Number(expired) };
    const companies = await listPlatformCompanies();
    companyCount = companies.length;
  }

  const manifests = getModuleManifestSummaries();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Ringkasan {user.companyName ?? "platform"} — modul, langganan, dan aktivitas.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={<PackageCheck className="h-4 w-4" />} label="Modul Aktif" value={stats.installed} />
        <StatCard icon={<PackageCheck className="h-4 w-4" />} label="Langganan Aktif" value={stats.activeSubs} />
        <StatCard icon={<PackageX className="h-4 w-4" />} label="Langganan Expired" value={stats.expired} />
        {user.isPlatformAdmin ? (
          <StatCard icon={<Building2 className="h-4 w-4" />} label="Companies" value={companyCount} />
        ) : (
          <StatCard icon={<Users className="h-4 w-4" />} label="Users" value={userCount} />
        )}
        <StatCard icon={<Users className="h-4 w-4" />} label="Users" value={userCount} />
        <StatCard icon={<GitBranch className="h-4 w-4" />} label="Branches" value={branchCount} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Module Registry</CardTitle>
            <CardDescription>
              Manifest terdaftar pada Module Engine. Kelola di halaman Apps.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Modul</TableHead>
                    <TableHead>Kode</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {manifests.map((m) => {
                    const access = user.companyId
                      ? accessMap[m.code]
                      : undefined;
                    return (
                      <TableRow key={m.code}>
                        <TableCell className="font-medium">
                          <Link href={`/apps/${m.code}`} className="hover:underline">
                            {m.name}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{m.code}</TableCell>
                        <TableCell>{m.version}</TableCell>
                        <TableCell>
                          {user.companyId && access ? (
                            <AccessBadge access={access.access} />
                          ) : (
                            <Badge variant="outline">registry</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aktivitas Terbaru</CardTitle>
            <CardDescription>Activity log terakhir</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {activities.length === 0 && (
              <p className="text-sm text-muted-foreground">Belum ada aktivitas.</p>
            )}
            {activities.map((a) => (
              <div key={a.id} className="border-b pb-3 text-sm last:border-0 last:pb-0">
                <p>{a.message}</p>
                <p className="text-xs text-muted-foreground">
                  {a.userName ?? "sistem"} · {formatRelative(a.createdAt)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
          {icon}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold leading-none">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AccessBadge({ access }: { access: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    ACTIVE: { label: "Aktif", variant: "default" },
    SUBSCRIBED: { label: "Subscribed", variant: "secondary" },
    DISABLED: { label: "Disabled", variant: "outline" },
    PAUSED: { label: "Paused", variant: "destructive" },
    UNINSTALLED: { label: "Uninstalled", variant: "outline" },
    NOT_SUBSCRIBED: { label: "Belum subscribe", variant: "outline" },
  };
  const item = map[access] ?? { label: access, variant: "outline" as const };
  return <Badge variant={item.variant}>{item.label}</Badge>;
}
