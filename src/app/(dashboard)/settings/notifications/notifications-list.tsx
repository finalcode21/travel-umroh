"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/format";
import type { NotificationItem } from "@/components/layout/app-shell";
import { markAllNotificationsReadAction } from "../actions";

const TYPE_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  INFO: "secondary",
  SUCCESS: "default",
  WARNING: "outline",
  ERROR: "destructive",
};

export function NotificationsList({ rows }: { rows: NotificationItem[] }) {
  const router = useRouter();

  const markAll = async () => {
    const result = await markAllNotificationsReadAction();
    if (result.ok) {
      toast.success("Semua notifikasi ditandai dibaca");
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={markAll}>
          <CheckCheck className="mr-1 h-3.5 w-3.5" /> Tandai semua dibaca
        </Button>
      </div>
      {rows.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">Belum ada notifikasi.</p>
      )}
      {rows.map((n) => (
        <div
          key={n.id}
          className={`rounded-md border p-3 ${!n.readAt ? "bg-accent/40" : ""}`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{n.title}</p>
            <Badge variant={TYPE_BADGE[n.type] ?? "secondary"}>{n.type}</Badge>
          </div>
          {n.body && <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>}
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatRelative(n.createdAt)}</span>
            {n.link && (
              <Link href={n.link} className="hover:underline">
                Buka
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
