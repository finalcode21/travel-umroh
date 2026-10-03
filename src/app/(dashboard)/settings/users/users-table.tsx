"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Plus, ShieldX, UserCheck } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/data-table/data-table";
import type { DataTableColumn } from "@/components/data-table/data-table";
import type { AdminUserRow } from "@/core/auth/users-admin";
import {
  createUserAction,
  resetUserPasswordAction,
  updateUserAction,
} from "./actions";

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive"> = {
  ACTIVE: "default",
  INACTIVE: "secondary",
  SUSPENDED: "destructive",
};

export function UsersTableClient({
  users,
  roles,
  branches,
  canManage,
}: {
  users: AdminUserRow[];
  roles: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AdminUserRow | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    email: "",
    password: "",
    branchId: "none",
    roleIds: [] as string[],
  });

  const openCreate = () => {
    setForm({ name: "", email: "", password: "", branchId: "none", roleIds: roles.slice(0, 1).map((r) => r.id) });
    setCreateOpen(true);
  };
  const openEdit = (u: AdminUserRow) => {
    setEditing(u);
    setForm({
      name: u.name,
      email: u.email,
      password: "",
      branchId: u.branchId ?? "none",
      roleIds: u.roles.map((r) => r.id),
    });
    setCreateOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const branchValue = form.branchId === "none" ? null : form.branchId;
    const result = editing
      ? await updateUserAction(editing.id, {
          name: form.name,
          branchId: branchValue,
          roleIds: form.roleIds,
        })
      : await createUserAction({
          name: form.name,
          email: form.email,
          password: form.password,
          branchId: branchValue,
          roleIds: form.roleIds,
        });
    setBusy(false);
    if (result.ok) {
      toast.success(editing ? "Pengguna diperbarui" : "Pengguna baru berhasil dibuat.");
      setCreateOpen(false);
      setEditing(null);
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  const setStatus = async (u: AdminUserRow, status: "ACTIVE" | "SUSPENDED") => {
    const result = await updateUserAction(u.id, { status });
    if (result.ok) {
      toast.success(status === "SUSPENDED" ? "Pengguna dinonaktifkan" : "Pengguna diaktifkan");
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  const resetPassword = async (u: AdminUserRow) => {
    const result = await resetUserPasswordAction({ userId: u.id });
    if (result.ok) {
      toast.info(`Password sementara: ${result.data}`, { duration: 15000 });
    } else {
      toast.error(result.error.message);
    }
  };

  const columns: DataTableColumn<AdminUserRow>[] = [
    {
      key: "name",
      header: "Nama",
      sortable: true,
      searchValue: (u) => `${u.name} ${u.email}`,
      render: (u) => (
        <div>
          <p className="font-medium">{u.name}</p>
          <p className="text-xs text-muted-foreground">{u.email}</p>
        </div>
      ),
    },
    {
      key: "branch",
      header: "Cabang",
      sortable: true,
      searchValue: (u) => u.branchName ?? "",
      render: (u) => (u.allBranches ? "Semua cabang" : (u.branchName ?? "-")),
    },
    {
      key: "roles",
      header: "Role",
      searchValue: (u) => u.roles.map((r) => r.name).join(" "),
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.roles.length === 0 && <span className="text-xs text-muted-foreground">-</span>}
          {u.roles.map((r) => (
            <Badge key={r.id} variant="secondary" className="text-[10px]">
              {r.name}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      searchValue: (u) => u.status,
      render: (u) => <Badge variant={STATUS_BADGE[u.status] ?? "secondary"}>{u.status}</Badge>,
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={users}
        getRowId={(u) => u.id}
        searchPlaceholder="Cari nama atau email…"
        toolbar={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Pengguna Baru
            </Button>
          ) : null
        }
        rowActions={(u) =>
          canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                  Aksi
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(u)}>Edit / Assign Role</DropdownMenuItem>
                {u.status === "ACTIVE" ? (
                  <DropdownMenuItem onClick={() => setStatus(u, "SUSPENDED")}>
                    <ShieldX className="mr-1 h-3.5 w-3.5" /> Disable (suspend)
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => setStatus(u, "ACTIVE")}>
                    <UserCheck className="mr-1 h-3.5 w-3.5" /> Enable
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => resetPassword(u)}>
                  <KeyRound className="mr-1 h-3.5 w-3.5" /> Reset Password
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />

      <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={save} className="space-y-3">
            <DialogHeader>
              <DialogTitle>{editing ? `Edit ${editing.name}` : "Pengguna Baru"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Nama *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  minLength={2}
                />
              </div>
              {!editing && (
                <>
                  <div className="space-y-1">
                    <Label>Email *</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Password sementara *</Label>
                    <Input
                      type="text"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      required
                      minLength={8}
                    />
                    <p className="text-xs text-muted-foreground">
                      Password dibuat langsung di database; minta pengguna mengganti.
                    </p>
                  </div>
                </>
              )}
              <div className="space-y-1">
                <Label>Cabang</Label>
                <Select
                  value={form.branchId}
                  onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Tanpa cabang —</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <div className="max-h-32 space-y-1.5 overflow-y-auto rounded-md border p-2">
                  {roles.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.roleIds.includes(r.id)}
                        onCheckedChange={(checked) =>
                          setForm((f) => ({
                            ...f,
                            roleIds: checked
                              ? [...f.roleIds, r.id]
                              : f.roleIds.filter((id) => id !== r.id),
                          }))
                        }
                      />
                      {r.name}
                    </label>
                  ))}
                </div>
              </div>
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
    </>
  );
}
