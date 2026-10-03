"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CompanyDTO } from "@/core/tenant/companies";
import { updateCompanyAction } from "./actions";

export function CompanyProfileForm({
  company,
  disabled,
}: {
  company: CompanyDTO;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = React.useState({
    name: company.name,
    legalName: company.legalName ?? "",
    address: company.address ?? "",
    phone: company.phone ?? "",
    email: company.email ?? "",
    website: company.website ?? "",
    logoUrl: company.logoUrl ?? "",
    taxInfo: company.taxInfo ?? "",
  });
  const [busy, setBusy] = React.useState(false);

  const set = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await updateCompanyAction(company.id, form);
    setBusy(false);
    if (result.ok) {
      toast.success("Profil perusahaan disimpan");
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label>Nama *</Label>
        <Input value={form.name} onChange={set("name")} required minLength={2} disabled={disabled} />
      </div>
      <div className="space-y-1">
        <Label>Legal Name</Label>
        <Input value={form.legalName} onChange={set("legalName")} disabled={disabled} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label>Alamat</Label>
        <Input value={form.address} onChange={set("address")} disabled={disabled} />
      </div>
      <div className="space-y-1">
        <Label>Telepon</Label>
        <Input value={form.phone} onChange={set("phone")} disabled={disabled} />
      </div>
      <div className="space-y-1">
        <Label>Email</Label>
        <Input type="email" value={form.email} onChange={set("email")} disabled={disabled} />
      </div>
      <div className="space-y-1">
        <Label>Website</Label>
        <Input value={form.website} onChange={set("website")} disabled={disabled} />
      </div>
      <div className="space-y-1">
        <Label>Logo URL</Label>
        <Input value={form.logoUrl} onChange={set("logoUrl")} disabled={disabled} />
      </div>
      <div className="space-y-1">
        <Label>Informasi Pajak (NPWP)</Label>
        <Input value={form.taxInfo} onChange={set("taxInfo")} disabled={disabled} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={disabled || busy}>
          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Simpan Profil
        </Button>
      </div>
    </form>
  );
}
