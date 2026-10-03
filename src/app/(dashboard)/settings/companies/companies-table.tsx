"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, Plus, Power } from "lucide-react";
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
import type { PlatformCompanyRow } from "@/core/tenant/companies";
import {
  createPlatformCompanyAction,
  setCompanyStatusAction,
} from "./actions";

export function PlatformCompaniesTable({ rows }: { rows: PlatformCompanyRow[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    legalName: "",
    address: "",
    phone: "",
    email: "",
    status: "ACTIVE" as "ACTIVE" | "SUSPENDED",
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await createPlatformCompanyAction(form);
    setBusy(false);
    if (result.ok) {
      toast.success("Perusahaan dibuat (cabang HQ + default roles ikut dibuat)");
      setOpen(false);
      setForm({ name: "", legalName: "", address: "", phone: "", email: "", status: "ACTIVE" });
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  const setStatus = async (row: PlatformCompanyRow) => {
    const next = row.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const result = await setCompanyStatusAction(row.id, next);
    if (result.ok) {
      toast.success(`Status perusahaan ${row.name} → ${next}`);
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  const columns: DataTableColumn<PlatformCompanyRow>[] = [
    {
      key: "name",
      header: "Perusahaan",
      sortable: true,
      searchValue: (r) => `${r.name} ${r.slug} ${r.legalName ?? ""}`,
      render: (r) => (
        <div>
          <p className="font-medium">{r.name}</p>
          <p className="font-mono text-[10px] text-muted-foreground">{r.slug}</p>
        </div>
      ),
    },
    {
      key: "userCount",
      header: "Users",
      sortable: true,
      searchValue: (r) => String(r.userCount),
      render: (r) => r.userCount,
    },
    {
      key: "branchCount",
      header: "Cabang",
      sortable: true,
      searchValue: (r) => String(r.branchCount),
      render: (r) => r.branchCount,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      searchValue: (r) => r.status,
      render: (r) =>
        r.status === "ACTIVE" ? <Badge>Aktif</Badge> : <Badge variant="destructive">Suspended</Badge>,
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        searchPlaceholder="Cari perusahaan…"
        toolbar={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Company Baru
          </Button>
        }
        rowActions={(r) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setStatus(r)}
          >
            <Power className="mr-1 h-3 w-3" />
            {r.status === "ACTIVE" ? "Suspend" : "Aktifkan"}
          </Button>
        )}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={save} className="space-y-3">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="h-4 w-4" /> Company Baru
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label>Nama *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  minLength={2}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Legal Name</Label>
                <Input
                  value={form.legalName}
                  onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Telepon</Label>
                <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Alamat</Label>
                <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v as "ACTIVE" | "SUSPENDED" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Aktif</SelectItem>
                    <SelectItem value="SUSPENDED">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Buat
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
