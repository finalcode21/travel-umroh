"use client";

import * as React from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/data-table/data-table";
import type { DataTableColumn } from "@/components/data-table/data-table";
import { formatDateTime } from "@/lib/format";
import type { NoteDTO } from "../service";
import {
  createNoteAction,
  deleteNoteAction,
  listNotesAction,
  setNoteStatusAction,
} from "../actions";

const PRIORITY_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  LOW: { label: "Rendah", variant: "secondary" },
  MEDIUM: { label: "Sedang", variant: "default" },
  HIGH: { label: "Tinggi", variant: "destructive" },
};

export default function NotesPage() {
  const [notes, setNotes] = React.useState<NoteDTO[] | null>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ title: "", content: "", priority: "MEDIUM" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listNotesAction();
      if (cancelled) return;
      if (result.ok) setNotes(result.data);
      else toast.error(result.error.message);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await createNoteAction(form);
    setBusy(false);
    if (result.ok) {
      toast.success("Catatan dibuat");
      setOpen(false);
      setForm({ title: "", content: "", priority: "MEDIUM" });
      setNotes((prev) => [result.data, ...(prev ?? [])]);
    } else {
      toast.error(result.error.message);
    }
  };

  const toggleStatus = async (note: NoteDTO) => {
    const nextStatus = note.status === "OPEN" ? "DONE" : "OPEN";
    const result = await setNoteStatusAction({
      noteId: note.id,
      status: nextStatus,
    });
    if (result.ok) {
      setNotes((prev) =>
        (prev ?? []).map((n) => (n.id === note.id ? { ...n, status: nextStatus } : n)),
      );
    } else {
      toast.error(result.error.message);
    }
  };

  const remove = async (note: NoteDTO) => {
    const result = await deleteNoteAction({ noteId: note.id });
    if (result.ok) {
      toast.success("Catatan dihapus");
      setNotes((prev) => (prev ?? []).filter((n) => n.id !== note.id));
    } else {
      toast.error(result.error.message);
    }
  };

  const columns: DataTableColumn<NoteDTO>[] = [
    {
      key: "title",
      header: "Judul",
      sortable: true,
      searchValue: (r) => r.title,
      render: (r) => (
        <div>
          <p className="font-medium">{r.title}</p>
          {r.content && (
            <p className="line-clamp-1 text-xs text-muted-foreground">{r.content}</p>
          )}
        </div>
      ),
    },
    {
      key: "priority",
      header: "Prioritas",
      sortable: true,
      searchValue: (r) => r.priority,
      render: (r) => {
        const p = PRIORITY_BADGE[r.priority] ?? { label: r.priority, variant: "secondary" as const };
        return <Badge variant={p.variant}>{p.label}</Badge>;
      },
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      searchValue: (r) => r.status,
      render: (r) => (
        <button
          type="button"
          onClick={() => toggleStatus(r)}
          className="text-xs underline-offset-2 hover:underline"
        >
          {r.status === "OPEN" ? "🟠 Terbuka" : "✅ Selesai"}
        </button>
      ),
    },
    {
      key: "createdAt",
      header: "Dibuat",
      sortable: true,
      searchValue: (r) => r.createdAt,
      render: (r) => <span className="text-xs">{formatDateTime(r.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Catatan</h1>
          <p className="text-sm text-muted-foreground">
            Modul contoh — memvalidasi siklus hidup modul (subscribe → install → aktif).
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-3.5 w-3.5" /> Catatan Baru
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <form onSubmit={submit} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Catatan Baru</DialogTitle>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="note-title">Judul</Label>
                <Input
                  id="note-title"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Cek dokumen jamaah"
                  required
                  minLength={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="note-content">Isi</Label>
                <Textarea
                  id="note-content"
                  value={form.content}
                  onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Prioritas</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Rendah</SelectItem>
                    <SelectItem value="MEDIUM">Sedang</SelectItem>
                    <SelectItem value="HIGH">Tinggi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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

      {notes === null ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={notes}
          getRowId={(r) => r.id}
          searchPlaceholder="Cari catatan…"
          rowActions={(r) => (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() => remove(r)}
              aria-label="Hapus catatan"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        />
      )}
    </div>
  );
}
