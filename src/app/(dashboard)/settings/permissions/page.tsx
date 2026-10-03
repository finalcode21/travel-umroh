import { getCurrentUser } from "@/core/auth/session";
import { listPermissionGroups } from "@/core/rbac/service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Permissions" };

export default async function PermissionsSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const groups = await listPermissionGroups();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((g) => (
        <Card key={g.moduleCode}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {g.moduleName}
              <Badge variant="outline" className="font-mono text-[10px]">
                {g.moduleCode}
              </Badge>
            </CardTitle>
            <CardDescription>
              {g.moduleCode === "core"
                ? "Permission bawaan Core System."
                : "Terdaftar otomatis dari manifest modul saat install."}
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
                  {g.permissions.map((p) => (
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
      ))}
    </div>
  );
}
