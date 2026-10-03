"use server";

import { z } from "zod";
import { runAction } from "@/lib/action";
import { parseWith } from "@/lib/validation";
import { createNote, deleteNote, listNotes, updateNoteStatus } from "./service";

const createNoteSchema = z.object({
  title: z.string().min(2, "Judul minimal 2 karakter").max(160).trim(),
  content: z.string().max(4000).trim().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  branchId: z.string().uuid().nullable().optional(),
});

const noteIdSchema = z.object({ noteId: z.string().uuid() });
const noteStatusSchema = noteIdSchema.extend({
  status: z.enum(["OPEN", "DONE"]),
});

export async function listNotesAction() {
  return runAction(null, async (user) => listNotes(user));
}

export async function createNoteAction(input: unknown) {
  return runAction("notes.create", async (user) => {
    const data = parseWith(createNoteSchema, input);
    return createNote(user, data);
  });
}

export async function setNoteStatusAction(input: unknown) {
  return runAction("notes.update", async (user) => {
    const { noteId, status } = parseWith(noteStatusSchema, input);
    return updateNoteStatus(user, noteId, status);
  });
}

export async function deleteNoteAction(input: unknown) {
  return runAction("notes.delete", async (user) => {
    const { noteId } = parseWith(noteIdSchema, input);
    await deleteNote(user, noteId);
    return { noteId };
  });
}
