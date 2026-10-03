import type { ComponentType } from "react";
import NotesPage from "./notes/views/notes-page";
import NotesProPage from "./notes-pro/views/notes-pro-page";

/**
 * Static map (required for Next.js code splitting) from module code to the
 * module's top-level UI page. The dynamic route /m/[module] resolves here.
 */
export const moduleUIRegistry: Record<string, ComponentType> = {
  notes: NotesPage,
  "notes-pro": NotesProPage,
};
