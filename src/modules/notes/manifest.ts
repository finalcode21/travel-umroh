import type { ModuleManifest } from "@/types";

/**
 * Sample module: Notes.
 * Demonstrates the full module contract: permissions, navigation, settings,
 * migration and data cleanup. Used for architecture validation (PRD §48):
 * subscribe → install → enable → disable → uninstall with data retained.
 */
export const notesManifest: ModuleManifest = {
  code: "notes",
  name: "Notes",
  version: "1.0.0",
  description:
    "Catatan internal perusahaan. Modul contoh untuk memvalidasi siklus hidup modul.",
  category: "COLLABORATION",
  author: "Travel Umroh Platform",
  priceMonthly: 49_000,
  billingCycle: "MONTHLY",
  trialDays: 14,
  dependencies: [],
  permissions: [
    { code: "notes.view", name: "Lihat Catatan" },
    { code: "notes.create", name: "Buat Catatan" },
    { code: "notes.update", name: "Ubah Catatan" },
    { code: "notes.delete", name: "Hapus Catatan" },
  ],
  navigation: [
    {
      code: "notes.list",
      label: "Catatan",
      icon: "sticky-note",
      href: "/m/notes",
      permission: "notes.view",
      order: 1,
    },
  ],
  settings: [
    {
      key: "maxNotesPerUser",
      label: "Maksimal catatan per pengguna",
      type: "number",
      description: "Batas jumlah catatan aktif per pengguna.",
      defaultValue: 100,
    },
    {
      key: "defaultPriority",
      label: "Prioritas default",
      type: "select",
      options: [
        { value: "LOW", label: "Rendah" },
        { value: "MEDIUM", label: "Sedang" },
        { value: "HIGH", label: "Tinggi" },
      ],
      defaultValue: "MEDIUM",
    },
    {
      key: "requireBranch",
      label: "Wajib pilih cabang",
      type: "boolean",
      description: "Catatan harus terkait dengan satu cabang.",
      defaultValue: false,
    },
  ],
  migrations: [
    {
      version: "1.0.0",
      name: "create_notes",
      sql: `
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid,
  created_by uuid,
  title text NOT NULL,
  content text,
  priority text NOT NULL DEFAULT 'MEDIUM',
  status text NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_company_idx ON notes (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notes_branch_idx ON notes (branch_id);
--> statement-breakpoint
`,
    },
  ],
  deleteDataSql: "DELETE FROM notes WHERE company_id = $1",
};
