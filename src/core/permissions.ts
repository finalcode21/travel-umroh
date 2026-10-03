import type { ModulePermissionDef } from "@/types";

/**
 * Core permissions. Business modules register their own permissions via their
 * manifests — Core must never hard-code module permissions.
 */
export const CORE_PERMISSIONS: ModulePermissionDef[] = [
  { code: "company.view", name: "Lihat Perusahaan" },
  { code: "company.manage", name: "Kelola Perusahaan" },
  { code: "branch.view", name: "Lihat Cabang" },
  { code: "branch.manage", name: "Kelola Cabang" },
  { code: "user.view", name: "Lihat Pengguna" },
  { code: "user.manage", name: "Kelola Pengguna" },
  { code: "role.view", name: "Lihat Role" },
  { code: "role.manage", name: "Kelola Role & Permission" },
  { code: "module.view", name: "Lihat Apps Marketplace" },
  { code: "module.manage", name: "Kelola Modul (subscribe/install/uninstall)" },
  { code: "subscription.view", name: "Lihat Langganan" },
  { code: "subscription.manage", name: "Kelola Langganan" },
  { code: "settings.manage", name: "Kelola Pengaturan" },
  { code: "audit.view", name: "Lihat Audit Log" },
  { code: "notification.view", name: "Lihat Notifikasi" },
];

/** Permissions every authenticated company user gets implicitly. */
export const BASE_PERMISSIONS = ["notification.view", "company.view"];

export const PLATFORM_ROLE = {
  code: "SUPER_ADMIN",
  name: "Super Admin",
  description: "Akses penuh ke seluruh platform",
} as const;

export const DEFAULT_ROLES = [
  {
    code: "COMPANY_ADMIN",
    name: "Company Admin",
    description: "Administrator perusahaan",
  },
  {
    code: "BRANCH_MANAGER",
    name: "Branch Manager",
    description: "Manajer cabang",
  },
  { code: "STAFF", name: "Staff", description: "Staff operasional" },
] as const;

/** Which core permissions each seeded default role receives. */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  COMPANY_ADMIN: CORE_PERMISSIONS.map((p) => p.code),
  BRANCH_MANAGER: [
    "company.view",
    "branch.view",
    "branch.manage",
    "user.view",
    "module.view",
    "subscription.view",
    "notification.view",
    "audit.view",
  ],
  STAFF: ["company.view", "branch.view", "module.view", "notification.view"],
};
