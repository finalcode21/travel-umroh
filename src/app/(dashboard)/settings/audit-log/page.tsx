import { getCurrentUser } from "@/core/auth/session";
import { listAuditLogs, listAuditActions } from "@/core/audit/service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Log" };

const ACTION_BADGE: Record<string, string> = {
  CREATE: "bg-emerald-500/15 text-emerald-700",
  UPDATE: "bg-blue-500/15 text-blue-700",
  DELETE: "bg-red-500/15 text-red-700",
  INSTALL: "bg-violet-500/15 text-violet-700",
  UNINSTALL: "bg-amber-500/15 text-amber-700",
  ENABLE: "bg-emerald-500/15 text-emerald-700",
  DISABLE: "bg-amber-500/15 text-amber-700",
  DELETE_DATA: "bg-red-500/15 text-red-700",
  PASSWORD_RESET: "bg-orange-500/15 text-orange-700",
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const action = typeof sp.action === "string" ? sp.action : undefined;
  const moduleFilter = typeof sp.module === "string" ? sp.module : undefined;

  const [result, actions] = await Promise.all([
    listAuditLogs({
      companyId: user.isPlatformAdmin ? null : user.companyId,
      q,
      action,
      module: moduleFilter,
      pageSize: 25,
    }),
    listAuditActions(),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audit Log</CardTitle>
        <CardDescription>
          Jejak perubahan penting — tidak dapat dihapus oleh pengguna biasa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form className="flex flex-wrap items-center gap-2" action="/settings/audit-log">
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Cari resource / id / user…"
            className="h-8 w-56"
          />
          <Select name="action" defaultValue={action ?? "all"}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder="Semua aksi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua aksi</SelectItem>
              {actions.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" type="submit" variant="outline">
            Filter
          </Button>
        </form>

        <div className="erp-table overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Waktu</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Aksi</TableHead>
                <TableHead>Modul</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Perubahan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                    Belum ada aktivitas audit.
                  </TableCell>
                </TableRow>
              )}
              {result.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs">{row.userName ?? "sistem"}</TableCell>
                  <TableCell>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ACTION_BADGE[row.action] ?? "bg-muted"}`}
                    >
                      {row.action}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.module}</TableCell>
                  <TableCell className="text-xs">
                    {row.resource}
                    {row.resourceId && (
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {row.resourceId}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-64">
                    <DiffCell oldValues={row.oldValues} newValues={row.newValues} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          {result.total} entri · halaman {result.page}
        </p>
      </CardContent>
    </Card>
  );
}

function DiffCell({
  oldValues,
  newValues,
}: {
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}) {
  const entries = Object.entries(newValues ?? {}).slice(0, 3);
  if (entries.length === 0) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <div className="space-y-0.5 text-[11px] leading-tight">
      {entries.map(([key, value]) => {
        const old = oldValues?.[key];
        return (
          <p key={key} className="truncate">
            <span className="font-medium">{key}</span>:{" "}
            {old !== undefined && (
              <span className="text-destructive line-through">{String(old)} → </span>
            )}
            <span>{String(value)}</span>
          </p>
        );
      })}
    </div>
  );
}
