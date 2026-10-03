"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveSystemSettingsAction } from "./actions";

const FIELDS: { key: string; label: string; type: string }[] = [
  { key: "app.name", label: "Nama Aplikasi", type: "text" },
  { key: "app.locale", label: "Locale default (id/en)", type: "text" },
  { key: "app.currency", label: "Mata uang default", type: "text" },
  { key: "app.timezone", label: "Zona waktu default", type: "text" },
  { key: "app.trialDaysDefault", label: "Trial hari (default)", type: "number" },
];

export function SystemSettingsForm({
  initial,
}: {
  initial: Record<string, string | number>;
}) {
  const router = useRouter();
  const [values, setValues] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    const result = await saveSystemSettingsAction({ values });
    setBusy(false);
    if (result.ok) {
      toast.success("System settings disimpan");
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  return (
    <div className="space-y-3">
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label htmlFor={f.key}>{f.label}</Label>
          <Input
            id={f.key}
            type={f.type}
            value={String(values[f.key] ?? "")}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value,
              }))
            }
          />
        </div>
      ))}
      <Button onClick={save} size="sm" disabled={busy}>
        {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        Simpan
      </Button>
    </div>
  );
}
