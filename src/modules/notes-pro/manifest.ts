import type { ModuleManifest } from "@/types";

/**
 * Sample module: Notes Pro.
 * Depends on "notes" to demonstrate dependency validation (PRD §16):
 * cannot install without Notes, cannot uninstall Notes while this is active.
 */
export const notesProManifest: ModuleManifest = {
  code: "notes-pro",
  name: "Notes Pro",
  version: "1.0.0",
  description:
    "Fitur lanjutan untuk Notes: ringkasan, tag, dan analitik penggunaan.",
  category: "COLLABORATION",
  author: "Travel Umroh Platform",
  priceMonthly: 99_000,
  billingCycle: "MONTHLY",
  trialDays: 7,
  dependencies: ["notes"],
  permissions: [
    { code: "notes-pro.view", name: "Lihat Notes Pro" },
  ],
  navigation: [
    {
      code: "notes-pro.dashboard",
      label: "Notes Pro",
      icon: "sparkles",
      href: "/m/notes-pro",
      permission: "notes-pro.view",
      order: 2,
    },
  ],
  settings: [
    {
      key: "summaryLimit",
      label: "Jumlah item pada ringkasan",
      type: "number",
      defaultValue: 5,
    },
  ],
  migrations: [],
};
