import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { AppError } from "@/lib/errors";
import { getModuleSettingsMap } from "@/core/modules/engine";
import type { CurrentUser } from "@/types";
import { notes } from "./schema";

export interface NoteDTO {
  id: string;
  title: string;
  content: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "DONE";
  branchId: string | null;
  createdAt: string;
}

export function toNoteDTO(row: typeof notes.$inferSelect): NoteDTO {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    priority: row.priority as NoteDTO["priority"],
    status: row.status as NoteDTO["status"],
    branchId: row.branchId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotes(user: CurrentUser): Promise<NoteDTO[]> {
  if (!user.companyId) return [];
  const rows = await db
    .select()
    .from(notes)
    .where(eq(notes.companyId, user.companyId))
    .orderBy(desc(notes.createdAt))
    .limit(500);
  return rows.map(toNoteDTO);
}

export async function createNote(
  user: CurrentUser,
  input: {
    title: string;
    content?: string;
    priority: "LOW" | "MEDIUM" | "HIGH";
    branchId?: string | null;
  },
): Promise<NoteDTO> {
  if (!user.companyId) throw new AppError("FORBIDDEN", "Tidak ada perusahaan aktif.");

  const settings = await getModuleSettingsMap(user.companyId, "notes");
  const maxPerUser = Number(settings.maxNotesPerUser ?? 100);

  const userNotes = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.companyId, user.companyId), eq(notes.createdBy, user.id)));
  if (userNotes.length >= maxPerUser) {
    throw new AppError(
      "CONFLICT",
      `Batas ${maxPerUser} catatan per pengguna tercapai (aturan setting modul).`,
    );
  }

  const [row] = await db
    .insert(notes)
    .values({
      companyId: user.companyId,
      branchId: input.branchId ?? user.branchId,
      createdBy: user.id,
      title: input.title,
      content: input.content,
      priority: input.priority,
      status: "OPEN",
    })
    .returning();
  return toNoteDTO(row);
}

export async function updateNoteStatus(
  user: CurrentUser,
  noteId: string,
  status: "OPEN" | "DONE",
): Promise<NoteDTO> {
  const [before] = await db.select().from(notes).where(eq(notes.id, noteId));
  if (!before) throw new AppError("NOT_FOUND", "Catatan tidak ditemukan.");
  if (before.companyId !== user.companyId && !user.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Catatan milik perusahaan lain.");
  }
  if (before.createdBy !== user.id && !user.isPlatformAdmin) {
    // sample rule: only author or platform admin edits
    throw new AppError("FORBIDDEN", "Hanya pembuat catatan yang dapat mengubah.");
  }
  const [after] = await db
    .update(notes)
    .set({ status })
    .where(eq(notes.id, noteId))
    .returning();
  return toNoteDTO(after);
}

export async function deleteNote(user: CurrentUser, noteId: string): Promise<void> {
  const [before] = await db.select().from(notes).where(eq(notes.id, noteId));
  if (!before) throw new AppError("NOT_FOUND", "Catatan tidak ditemukan.");
  if (before.companyId !== user.companyId && !user.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Catatan milik perusahaan lain.");
  }
  await db.delete(notes).where(eq(notes.id, noteId));
}
