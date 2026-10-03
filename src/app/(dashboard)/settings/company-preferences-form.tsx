"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateCompanyAction } from "./company/actions";

export function CompanyPreferencesForm({
  companyId,
  initial,
}: {
  companyId: string;
  initial: { currency: string; timezone: string; locale: string };
}) {
  const router = useRouter();
  const [values, setValues] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    const result = await updateCompanyAction(companyId, {
      currency: values.currency,
      timezone: values.timezone,
      locale: values.locale as "id" | "en",
    });
    setBusy(false);
    if (result.ok) {
      toast.success("Preferensi disimpan");
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Mata uang</Label>
        <Input
          value={values.currency}
          onChange={(e) => setValues((v) => ({ ...v, currency: e.target.value.toUpperCase() }))}
          maxLength={8}
        />
      </div>
      <div className="space-y-1">
        <Label>Zona waktu</Label>
        <Select
          value={values.timezone}
          onValueChange={(v) => setValues((prev) => ({ ...prev, timezone: v }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "UTC"].map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Bahasa</Label>
        <Select
          value={values.locale}
          onValueChange={(v) => setValues((prev) => ({ ...prev, locale: v }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="id">Indonesia</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button onClick={save} size="sm" disabled={busy}>
        {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        Simpan
      </Button>
    </div>
  );
}
