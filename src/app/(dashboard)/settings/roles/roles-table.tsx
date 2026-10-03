"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DataTable } from "@/components/data-table/data-table";
import type { DataTableColumn } from "@/components/data-table/data-table";
import type { RoleRow, PermissionGroup } from "@/core/rbac/service";
import {
  createRoleAction,
  deleteRoleAction,
  updateRoleAction,
} from "./actions";

export function RolesTableClient({
  roles,
  groups,
  canManage,
}: {
  roles: RoleRow[];
  groups: PermissionGroup[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [matrixRole, setMatrixRole] = React.useState<RoleRow | null>(null);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);

  const openMatrix = (r: RoleRow) => {
    setMatrixRole(r);
    setChecked(new Set(r.permissionCodes));
  };

  const saveCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await createRoleAction({ name, description });
    setBusy(false);
    if (result.ok) {
      toast.success("Role dibuat");
      setCreateOpen(false);
      setName("");
      setDescription("");
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  const saveMatrix = async () => {
    if (!matrixRole) return;
    setBusy(true);
    const result = await updateRoleAction(matrixRole.id, {
      permissionCodes: [...checked],
    });
    setBusy(false);
    if (result.ok) {
      toast.success(`Permission role ${matrixRole.name} diperbarui`);
      setMatrixRole(null);
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  const remove = async (r: RoleRow) => {
    const result = await deleteRoleAction(r.id);
    if (result.ok) {
      toast.success("Role dihapus");
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  const columns: DataTableColumn<RoleRow>[] = [
    {
      key: "name",
      header: "Role",
      sortable: true,
      searchValue: (r) => `${r.name} ${r.code} ${r.description ?? ""}`,
      render: (r) => (
        <div>
          <p className="font-medium">
            {r.name} {r.isSystem && <Badge variant="outline" className="ml-1 text-[10px]">sistem</Badge>}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">{r.code}</p>
        </div>
      ),
    },
    {
      key: "description",
      header: "Deskripsi",
      searchValue: (r) => r.description ?? "",
      render: (r) => <span className="text-xs text-muted-foreground">{r.description ?? "-"}</span>,
    },
    {
      key: "userCount",
      header: "Pengguna",
      sortable: true,
      searchValue: (r) => String(r.userCount),
      render: (r) => r.userCount,
    },
    {
      key: "permissionCodes",
      header: "Permissions",
      sortable: true,
      searchValue: (r) => String(r.permissionCodes.length),
      render: (r) => (
        <Badge variant="secondary">{r.permissionCodes.length} permission</Badge>
      ),
    },
  ];

  const toggle = (code: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  return (
    <>
      <DataTable
        columns={columns}
        rows={roles}
        getRowId={(r) => r.id}
        searchPlaceholder="Cari role…"
        toolbar={
          canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Role Baru
            </Button>
          ) : null
        }
        rowActions={(r) =>
          canManage ? (
            <div className="flex justify-end gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => openMatrix(r)}
                aria-label="Permission matrix"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={async () => {
                  const newName = window.prompt("Nama role baru", r.name);
                  if (!newName) return;
                  const result = await updateRoleAction(r.id, { name: newName });
                  if (result.ok) {
                    toast.success("Role diperbarui");
                    router.refresh();
                  } else toast.error(result.error.message);
                }}
                aria-label="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {!r.isSystem && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      aria-label="Hapus"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Hapus role {r.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Role yang masih dipakai pengguna tidak dapat dihapus.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Batal</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => remove(r)}
                      >
                        Hapus
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ) : null
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={saveCreate} className="space-y-3">
            <DialogHeader>
              <DialogTitle>Role Baru</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <Label>Nama *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </div>
            <div className="space-y-1">
              <Label>Deskripsi</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Simpan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={matrixRole !== null} onOpenChange={(v) => !v && setMatrixRole(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Permission Matrix — {matrixRole?.name}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[50vh] pr-3">
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.moduleCode} className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.moduleName}
                  </p>
                  {g.permissions.map((p) => (
                    <label key={p.code} className="flex items-start gap-2 rounded-md border p-2 text-sm hover:bg-accent/50">
                      <Checkbox
                        className="mt-0.5"
                        checked={checked.has(p.code)}
                        onCheckedChange={() => toggle(p.code)}
                      />
                      <span>
                        <span className="font-mono text-xs">{p.code}</span>
                        <span className="block text-xs text-muted-foreground">{p.name}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatrixRole(null)}>
              Batal
            </Button>
            <Button onClick={saveMatrix} disabled={busy}>
              {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Simpan Permission ({checked.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
