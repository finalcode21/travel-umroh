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
import { Switch } from "@/components/ui/switch";
import type { ModuleSettingDef } from "@/types";
import { saveModuleSettingsAction } from "../actions";

export function ModuleSettingsForm({
  moduleCode,
  defs,
  initialValues,
  disabled,
}: {
  moduleCode: string;
  defs: ModuleSettingDef[];
  initialValues: Record<string, unknown>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = React.useState<Record<string, unknown>>(initialValues);
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    const result = await saveModuleSettingsAction({ moduleCode, values });
    setBusy(false);
    if (result.ok) {
      toast.success("Pengaturan modul disimpan");
      router.refresh();
    } else {
      toast.error(`Gagal: ${result.error.message}`);
    }
  };

  return (
    <div className="space-y-4">
      {defs.map((def) => {
        const value = values[def.key] ?? def.defaultValue;
        return (
          <div key={def.key} className="space-y-1.5">
            {def.type === "boolean" ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor={def.key}>{def.label}</Label>
                  {def.description && (
                    <p className="text-xs text-muted-foreground">{def.description}</p>
                  )}
                </div>
                <Switch
                  id={def.key}
                  checked={Boolean(value)}
                  onCheckedChange={(checked) =>
                    setValues((v) => ({ ...v, [def.key]: checked }))
                  }
                  disabled={disabled}
                />
              </div>
            ) : def.type === "select" ? (
              <div>
                <Label htmlFor={def.key}>{def.label}</Label>
                <Select
                  value={String(value ?? "")}
                  onValueChange={(v) => setValues((prev) => ({ ...prev, [def.key]: v }))}
                  disabled={disabled}
                >
                  <SelectTrigger id={def.key} className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(def.options ?? []).map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {def.description && (
                  <p className="text-xs text-muted-foreground">{def.description}</p>
                )}
              </div>
            ) : (
              <div>
                <Label htmlFor={def.key}>{def.label}</Label>
                <Input
                  id={def.key}
                  type={def.type === "number" ? "number" : "text"}
                  value={String(value ?? "")}
                  onChange={(e) =>
                    setValues((prev) => ({
                      ...prev,
                      [def.key]:
                        def.type === "number" ? Number(e.target.value) : e.target.value,
                    }))
                  }
                  disabled={disabled}
                  className="mt-1"
                />
                {def.description && (
                  <p className="text-xs text-muted-foreground">{def.description}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
      <Button onClick={save} disabled={disabled || busy} size="sm">
        {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        Simpan Pengaturan
      </Button>
    </div>
  );
}
