import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Notes module table. The CREATE TABLE statement lives in the module
 * manifest migration (applied by the Module Engine on install); this Drizzle
 * definition mirrors it for typed queries.
 */
export const notes = pgTable(
  "notes",
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid().notNull(),
    branchId: uuid(),
    createdBy: uuid(),
    title: text().notNull(),
    content: text(),
    priority: text().notNull().default("MEDIUM"),
    status: text().notNull().default("OPEN"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("notes_company_idx").on(t.companyId, t.createdAt),
    index("notes_branch_idx").on(t.branchId),
  ],
);

export const notesRelations = relations(notes, () => ({}));
