"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/data-table/data-table";
import type { DataTableColumn } from "@/components/data-table/data-table";
import { formatDate, formatIDR } from "@/lib/format";
import {
  cancelSubscriptionAdminAction,
  renewSubscriptionAdminAction,
} from "../actions";

export interface SubscriptionRow {
  id: string;
  moduleCode: string;
  moduleName: string;
  planName: string;
  priceMonthly: number | null;
  status: string;
  startedAt: string;
  expiresAt: string | null;
  cancelledAt: string | null;
}

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  TRIAL: "secondary",
  ACTIVE: "default",
  PAST_DUE: "destructive",
  EXPIRED: "destructive",
  CANCELLED: "outline",
};

export function SubscriptionsTable({
  rows,
  canManage,
}: {
  rows: SubscriptionRow[];
  canManage: boolean;
}) {
  const router = useRouter();

  const renew = async (row: SubscriptionRow, months: number) => {
    const result = await renewSubscriptionAdminAction({
      subscriptionId: row.id,
      months,
    });
    if (result.ok) {
      toast.success(`Langganan ${row.moduleName} diperpanjang ${months} bulan`);
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  const cancel = async (row: SubscriptionRow) => {
    const result = await cancelSubscriptionAdminAction({ subscriptionId: row.id });
    if (result.ok) {
      toast.success(`Langganan ${row.moduleName} dibatalkan — modul dipause`);
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  const columns: DataTableColumn<SubscriptionRow>[] = [
    {
      key: "moduleName",
      header: "Modul",
      sortable: true,
      searchValue: (r) => `${r.moduleName} ${r.moduleCode} ${r.planName}`,
      render: (r) => (
        <div>
          <p className="font-medium">{r.moduleName}</p>
          <p className="text-xs text-muted-foreground">{r.planName}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      searchValue: (r) => r.status,
      render: (r) => <Badge variant={STATUS_BADGE[r.status] ?? "outline"}>{r.status}</Badge>,
    },
    {
      key: "priceMonthly",
      header: "Harga",
      sortable: true,
      searchValue: (r) => String(r.priceMonthly ?? 0),
      render: (r) => (r.priceMonthly ? `${formatIDR(r.priceMonthly)}/bln` : "-"),
    },
    {
      key: "expiresAt",
      header: "Berlaku s/d",
      sortable: true,
      searchValue: (r) => r.expiresAt ?? "",
      render: (r) => (r.expiresAt ? formatDate(r.expiresAt) : "-"),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      searchPlaceholder="Cari langganan…"
      rowActions={(r) =>
        canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                Aksi
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="flex items-center gap-1 text-xs">
                <CalendarClock className="h-3 w-3" /> Perpanjang
              </DropdownMenuLabel>
              {[1, 3, 6, 12].map((m) => (
                <DropdownMenuItem key={m} onClick={() => renew(r, m)}>
                  {m} bulan
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => cancel(r)}
                disabled={r.status === "CANCELLED" || r.status === "EXPIRED"}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" /> Batalkan
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      }
    />
  );
}
