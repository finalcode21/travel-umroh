"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/data-table/data-table";
import type { DataTableColumn } from "@/components/data-table/data-table";
import type { BranchDTO } from "@/core/tenant/branches";
import {
  createBranchAction,
  deleteBranchAction,
  updateBranchAction,
} from "./actions";

interface FormState {
  name: string;
  code: string;
  address: string;
  phone: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
}

const EMPTY: FormState = {
  name: "",
  code: "",
  address: "",
  phone: "",
  email: "",
  status: "ACTIVE",
};

export function BranchTableClient({
  branches,
  canManage,
}: {
  branches: BranchDTO[];
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BranchDTO | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [busy, setBusy] = React.useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };
  const openEdit = (b: BranchDTO) => {
    setEditing(b);
    setForm({
      name: b.name,
      code: b.code,
      address: b.address ?? "",
      phone: b.phone ?? "",
      email: b.email ?? "",
      status: b.status,
    });
    setDialogOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = editing
      ? await updateBranchAction(editing.id, form)
      : await createBranchAction(form);
    setBusy(false);
    if (result.ok) {
      toast.success(editing ? "Cabang diperbarui" : "Cabang dibuat");
      setDialogOpen(false);
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  const remove = async (b: BranchDTO) => {
    const result = await deleteBranchAction(b.id);
    if (result.ok) {
      toast.success("Cabang dihapus");
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  const columns: DataTableColumn<BranchDTO>[] = [
    {
      key: "name",
      header: "Nama",
      sortable: true,
      searchValue: (b) => `${b.name} ${b.code} ${b.address ?? ""}`,
      render: (b) => (
        <div>
          <p className="font-medium">{b.name}</p>
          <p className="text-xs text-muted-foreground">{b.address ?? "-"}</p>
        </div>
      ),
    },
    {
      key: "code",
      header: "Kode",
      sortable: true,
      searchValue: (b) => b.code,
      render: (b) => <span className="font-mono text-xs">{b.code}</span>,
    },
    {
      key: "contact",
      header: "Kontak",
      searchValue: (b) => `${b.phone ?? ""} ${b.email ?? ""}`,
      render: (b) => (
        <div className="text-xs">
          <p>{b.phone ?? "-"}</p>
          <p className="text-muted-foreground">{b.email ?? "-"}</p>
        </div>
      ),
    },
    {
      key: "userCount",
      header: "Pengguna",
      sortable: true,
      searchValue: (b) => String(b.userCount),
      render: (b) => b.userCount,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      searchValue: (b) => b.status,
      render: (b) =>
        b.status === "ACTIVE" ? (
          <Badge>Aktif</Badge>
        ) : (
          <Badge variant="outline">Nonaktif</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <DataTable
        columns={columns}
        rows={branches}
        getRowId={(b) => b.id}
        searchPlaceholder="Cari cabang…"
        toolbar={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Cabang Baru
            </Button>
          ) : null
        }
        rowActions={(b) =>
          canManage ? (
            <div className="flex justify-end gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => openEdit(b)}
                aria-label="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
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
                    <AlertDialogTitle>Hapus cabang {b.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Cabang yang masih memiliki pengguna tidak dapat dihapus.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => remove(b)}
                    >
                      Hapus
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={save} className="space-y-3">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Cabang" : "Cabang Baru"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Nama *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  minLength={2}
                />
              </div>
              <div className="space-y-1">
                <Label>Kode *</Label>
                <Input
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                  }
                  required
                  minLength={2}
                  maxLength={16}
                  placeholder="JKT"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Alamat</Label>
                <Input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Telepon</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, status: v as FormState["status"] }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Aktif</SelectItem>
                    <SelectItem value="INACTIVE">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
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
    </div>
  );
}
