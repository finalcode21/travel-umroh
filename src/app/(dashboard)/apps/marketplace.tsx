"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatIDR } from "@/lib/format";
import type { ModuleAccess } from "@/types";
import { ModuleActions } from "./module-actions";

export interface MarketplaceItem {
  code: string;
  name: string;
  description: string;
  version: string;
  category: string;
  author?: string;
  priceMonthly: number;
  trialDays: number;
  dependencies: { module: string; version?: string }[];
  permissions: string[];
  access: ModuleAccess;
  dependents: string[];
  uninstallPolicy: string;
}

export type MarketplaceFilter =
  | "ALL"
  | "INSTALLED"
  | "NOT_INSTALLED"
  | "ENABLED"
  | "DISABLED"
  | "UPDATES";

const FILTERS: { key: MarketplaceFilter; label: string }[] = [
  { key: "ALL", label: "Semua" },
  { key: "INSTALLED", label: "Installed" },
  { key: "NOT_INSTALLED", label: "Belum ter-install" },
  { key: "ENABLED", label: "Enabled" },
  { key: "DISABLED", label: "Disabled" },
  { key: "UPDATES", label: "Update tersedia" },
];

function matchesFilter(item: MarketplaceItem, filter: MarketplaceFilter): boolean {
  const s = item.access.installStatus;
  switch (filter) {
    case "ALL":
      return true;
    case "INSTALLED":
      return s !== "NOT_INSTALLED" && s !== "UNINSTALLED";
    case "NOT_INSTALLED":
      return s === "NOT_INSTALLED" || s === "UNINSTALLED";
    case "ENABLED":
      return item.access.access === "ACTIVE";
    case "DISABLED":
      return s === "DISABLED";
    case "UPDATES":
      return item.access.updateAvailable === true;
  }
}

export const ACCESS_BADGE: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  ACTIVE: { label: "Aktif", variant: "default" },
  SUBSCRIBED: { label: "Siap install", variant: "secondary" },
  DISABLED: { label: "Disabled", variant: "outline" },
  PAUSED: { label: "Paused (expired)", variant: "destructive" },
  UNINSTALLED: { label: "Uninstalled", variant: "outline" },
  NOT_SUBSCRIBED: { label: "Belum subscribe", variant: "outline" },
};

export function AccessBadge({ access }: { access: string }) {
  const item = ACCESS_BADGE[access] ?? { label: access, variant: "outline" as const };
  return <Badge variant={item.variant}>{item.label}</Badge>;
}

export function MarketplaceBrowser({
  items,
}: {
  items: MarketplaceItem[];
}) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<MarketplaceFilter>("ALL");

  const q = query.trim().toLowerCase();
  const visible = items.filter(
    (item) =>
      matchesFilter(item, filter) &&
      (q === "" ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)),
  );

  const counts = React.useMemo(() => {
    const map = {} as Record<MarketplaceFilter, number>;
    for (const f of FILTERS) {
      map[f.key] = items.filter((i) => matchesFilter(i, f.key)).length;
    }
    return map;
  }, [items]);

  const nameByCode = React.useMemo(
    () => Object.fromEntries(items.map((i) => [i.code, i.name])),
    [items],
  );
  const accessByCode = React.useMemo(
    () => Object.fromEntries(items.map((i) => [i.code, i.access])),
    [items],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari modul (nama / deskripsi)…"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              className={cn("h-8 px-3 text-xs")}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="ml-1 text-[10px] opacity-70">{counts[f.key]}</span>
            </Button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Tidak ada modul yang cocok dengan filter/pencarian.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => (
            <MarketplaceCard
              key={item.code}
              item={item}
              nameByCode={nameByCode}
              accessByCode={accessByCode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MarketplaceCard({
  item,
  nameByCode,
  accessByCode,
}: {
  item: MarketplaceItem;
  nameByCode: Record<string, string>;
  accessByCode: Record<string, ModuleAccess>;
}) {
  const access = item.access;
  const depNames = new Map(Object.entries(nameByCode));
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">
            <Link href={`/apps/${item.code}`} className="hover:underline">
              {item.name}
            </Link>
          </CardTitle>
          <div className="flex items-center gap-1">
            {access.updateAvailable && <Badge variant="secondary">Update v{item.version}</Badge>}
            <AccessBadge access={access.access} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{item.description}</p>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 pb-3">
        <div>
          <p className="text-lg font-semibold">
            {item.priceMonthly ? (
              <>
                {formatIDR(item.priceMonthly)}
                <span className="text-sm font-normal text-muted-foreground"> / bulan</span>
              </>
            ) : (
              "Gratis"
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Trial {item.trialDays} hari · v{item.version} · {item.category}
            {access.installedVersion ? ` · ter-install v${access.installedVersion}` : ""}
          </p>
        </div>
        {access.lastError && (
          <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            Error terakhir: {access.lastError}
          </p>
        )}
        <Separator />
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Dependencies</p>
          {item.dependencies.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {item.dependencies.map((dep) => {
                const depAccess = accessByCode[dep.module];
                const ok = depAccess?.access === "ACTIVE";
                return (
                  <Badge key={dep.module} variant={ok ? "secondary" : "outline"} className="text-xs">
                    {depNames.get(dep.module) ?? dep.module}
                    {dep.version ? ` (${dep.version})` : ""}
                    {!ok && " (belum aktif)"}
                  </Badge>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Tidak ada</p>
          )}
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-2 border-t pt-3">
        <Link
          href={`/apps/${item.code}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Detail <ArrowRight className="h-3 w-3" />
        </Link>
        <ModuleActions
          moduleCode={item.code}
          moduleName={item.name}
          access={access}
          uninstallPolicy={item.uninstallPolicy}
          requiredBy={item.dependents}
        />
      </CardFooter>
    </Card>
  );
}
