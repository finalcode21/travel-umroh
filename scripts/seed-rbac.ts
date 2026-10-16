/**
 * Seed RBAC — travel-umroh (HANYA Neon Development bila dijalankan).
 *
 * IDEMPOTEN: berjalan berulang tanpa duplikat (ON CONFLICT DO NOTHING),
 * tidak menghapus data apa pun, dan TIDAK membuat platform_role_assignments —
 * pemberian role platform selalu keputusan aplikasi berotoritas, sekaligus
 * memenuhi larangan "memberi role platform otomatis kepada registrasi pelanggan".
 *
 * Status: USULAN. Belum pernah dijalankan ke database (lihat laporan).
 * Jalankan manual: BETTER_AUTH_SECRET tidak diperlukan di sini.
 *   npx tsx scripts/seed-rbac.ts
 */
import "./load-env";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";

type PermScope = "platform" | "tenant";
type PermSeed = { scope: PermScope; code: string; resource: string; action: string; description: string };

/** Katalog izin awal — perluasan menyusul fitur aplikasi. */
const PERMISSIONS: PermSeed[] = [
  // Scope platform: titik kawal paket bisnis/isiwa dari latar.
  { scope: "platform", code: "tenant.create", resource: "tenant", action: "create", description: "Membuat tenant bisnis baru" },
  { scope: "platform", code: "tenant.read", resource: "tenant", action: "read", description: "Melihat daftar/detail tenant" },
  { scope: "platform", code: "tenant.update", resource: "tenant", action: "update", description: "Mengubah data tenant" },
  { scope: "platform", code: "tenant.suspend", resource: "tenant", action: "suspend", description: "Mengubah status tenant" },
  { scope: "platform", code: "installation.create", resource: "installation", action: "create", description: "Membuat instalasi untuk tenant" },
  { scope: "platform", code: "installation.read", resource: "installation", action: "read", description: "Melihat instalasi lintas tenant" },
  { scope: "platform", code: "installation.update", resource: "installation", action: "update", description: "Mengubah instalasi" },
  { scope: "platform", code: "platform.role.assign", resource: "platform-role", action: "assign", description: "Memberikan role platform kepada identitas" },

  // Scope tenant: operasi harian bisnis pemberangkatan.
  { scope: "tenant", code: "package.create", resource: "package", action: "create", description: "Membuat paket umroh/haji" },
  { scope: "tenant", code: "package.read", resource: "package", action: "read", description: "Melihat paket" },
  { scope: "tenant", code: "package.update", resource: "package", action: "update", description: "Mengubah paket" },
  { scope: "tenant", code: "jamaah.create", resource: "jamaah", action: "create", description: "Mendaftar jamaah" },
  { scope: "tenant", code: "jamaah.read", resource: "jamaah", action: "read", description: "Melihat data jamaah" },
  { scope: "tenant", code: "jamaah.update", resource: "jamaah", action: "update", description: "Mengubah data jamaah" },
  { scope: "tenant", code: "jamaah.deactivate", resource: "jamaah", action: "deactivate", description: "Menonaktifkan jamaah" },
  { scope: "tenant", code: "reservation.create", resource: "reservation", action: "create", description: "Membuat reservasi" },
  { scope: "tenant", code: "reservation.read", resource: "reservation", action: "read", description: "Melihat reservasi" },
  { scope: "tenant", code: "reservation.cancel", resource: "reservation", action: "cancel", description: "Membatalkan reservasi" },
  { scope: "tenant", code: "payment.create", resource: "payment", action: "create", description: "Mencatat pembayaran" },
  { scope: "tenant", code: "payment.read", resource: "payment", action: "read", description: "Melihat pembayaran" },
  { scope: "tenant", code: "staff.read", resource: "staff", action: "read", description: "Melihat daftar staf tenant" },
  { scope: "tenant", code: "tenant-role.assign", resource: "tenant-role", action: "assign", description: "Memberikan role tenant kepada staf" },
  { scope: "tenant", code: "installation.own.read", resource: "installation-own", action: "read", description: "Melihat instalasi tenant sendiri" },
];

/** Role platform (silang tenant = wajib satu baris per scope, tenant_id NULL). */
const PLATFORM_ROLES: { code: string; name: string; permissions: string[] }[] = [
  {
    code: "platform.superadmin",
    name: "Superadmin Platform",
    permissions: PERMISSIONS.filter((p) => p.scope === "platform").map((p) => p.code),
  },
  {
    code: "platform.support",
    name: "Support Platform",
    permissions: ["tenant.read", "tenant.update", "installation.read", "installation.update", "installation.create"],
  },
  {
    code: "platform.operator",
    name: "Operator Platform",
    permissions: ["tenant.create", "tenant.read", "installation.create", "installation.read"],
  },
];

async function upsertPermission(p: PermSeed): Promise<string> {
  const existing = await db
    .select({ id: schema.permissions.id })
    .from(schema.permissions)
    .where(and(eq(schema.permissions.code, p.code), eq(schema.permissions.scope, p.scope)))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [row] = await db
    .insert(schema.permissions)
    .values({ scope: p.scope, code: p.code, resource: p.resource, action: p.action, description: p.description })
    .onConflictDoNothing()
    .returning({ id: schema.permissions.id });
  if (row) return row.id;
  // Balapan dengan writer lain — ambil kembali.
  const [again] = await db
    .select({ id: schema.permissions.id })
    .from(schema.permissions)
    .where(and(eq(schema.permissions.code, p.code), eq(schema.permissions.scope, p.scope)))
    .limit(1);
  if (!again) throw new Error(`permission ${p.code} gagal di-upsert`);
  return again.id;
}

async function main() {
  let created = 0;

  // 1. Katalog permission.
  const permIds = new Map<string, string>();
  for (const p of PERMISSIONS) {
    const before = await db.select({ id: schema.permissions.id }).from(schema.permissions).where(eq(schema.permissions.code, p.code)).limit(1);
    const id = await upsertPermission(p);
    if (before.length === 0) created++;
    permIds.set(p.code, id);
  }

  // 2. Role platform + pemetaan role_permissions (idempoten per pasangan).
  for (const role of PLATFORM_ROLES) {
    const [existing] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(eq(schema.roles.scope, "platform"), eq(schema.roles.code, role.code)))
      .limit(1);
    let roleId = existing?.id;
    if (!roleId) {
      const [row] = await db
        .insert(schema.roles)
        .values({ scope: "platform", tenantId: null, code: role.code, name: role.name, isSystem: true })
        .onConflictDoNothing()
        .returning({ id: schema.roles.id });
      roleId = row?.id ?? existing?.id;
      if (roleId) created++;
    }
    if (!roleId) throw new Error(`role ${role.code} gagal di-upsert`);
    for (const code of role.permissions) {
      await db
        .insert(schema.rolePermissions)
        .values({ roleId, permissionId: permIds.get(code)!, scope: "platform" })
        .onConflictDoNothing();
    }
    console.log(`role platform ${role.code}: id=${roleId}, izin=${role.permissions.length}`);
  }

  console.log(`seed selesai idempoten: ${created} objek baru, sisanya dipertahankan`);
}

main()
  .catch((e) => {
    console.error("seed GAGAL:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
    if (client?.end) await client.end();
  });
