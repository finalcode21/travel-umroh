"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { NoteDTO } from "../../notes/service";

export default function NotesProPage() {
  const [notes, setNotes] = React.useState<NoteDTO[] | null>(null);
  const [limit, setLimit] = React.useState(5);

  React.useEffect(() => {
    (async () => {
      const { listNotesAction } = await import("../../notes/actions");
      const result = await listNotesAction();
      if (result.ok) setNotes(result.data);
      else toast.error(result.error.message);
    })();
  }, []);

  const open = (notes ?? []).filter((n) => n.status === "OPEN");
  const high = open.filter((n) => n.priority === "HIGH");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="h-4 w-4 text-amber-500" /> Notes Pro
          <Badge variant="secondary">dependency: notes</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">
          Modul lanjutan yang membaca data modul Notes — bukti dependency chain
          berfungsi (uninstall Notes diblokir selama modul ini aktif).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Catatan Terbuka</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{open.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Prioritas Tinggi</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-destructive">{high.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Catatan</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{notes?.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Ringkasan</CardTitle>
              <CardDescription>{limit} catatan terbaru</CardDescription>
            </div>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              {[5, 10, 20].map((n) => (
                <option key={n} value={n}>
                  {n} item
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {notes === null ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
            </div>
          ) : notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada catatan — buka modul Notes untuk membuat.
            </p>
          ) : (
            <ul className="space-y-2">
              {notes.slice(0, limit).map((n) => (
                <li key={n.id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0 last:pb-0">
                  <span>
                    {n.title}{" "}
                    <Badge
                      variant={n.priority === "HIGH" ? "destructive" : "secondary"}
                      className="ml-1 text-[10px]"
                    >
                      {n.priority}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(n.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
