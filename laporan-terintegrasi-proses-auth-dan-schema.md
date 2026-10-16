# Laporan Terintegrasi Proses Auth & Schema — travel-umroh

> Laporan ini menggabungkan seluruh rangkaian kerja: **review rancangan** → **migrasi database** → **seed RBAC** → **uii HTTP** → **perbaikan error runtime** → **verifikasi akhir**, dengan referensi silang ke semua laporan existing di workspace.

| Item | Keterangan |
| --- | --- |
| Project | travel-umroh |
| Branch | `development` |
| Tanggal | 14 Oktober 2026 |
| Neon project | `rough-brook-30059963` |
| Neon branch | `br-shy-tree-b35ibs8d` (development) |
| Database | `travel_umroh_db` |
| Endpoint development | `ep-dark-meadow-b3ch5el3` (DIRECT_URL) / `ep-dark-meadow-b3ch5el3-pooler` (DATABASE_URL) |
| Environment | `.env.local` (`DATABASE_URL`, `DIRECT_URL`, `NEON_BRANCH=development`) |
| Laporan ini | `laporan-terintegrasi-proses-auth-dan-schema.md` (baru) |
| Laporan pendukung | lihat Bagian 2 |

---

## 1. Ringkasan eksekutif

Seluruh rangkaian kerja auth & schema untuk travel-umroh telah selesai dan diverifikasi:

1. **Review rancangan** — schema core direview dan direvisi (546 → 816 baris, 14 tabel, 6 enum PostgreSQL), termasuk revisi provisioning tenant dengan 9 ketentuan.
2. **Migrasi database** — migrasi pertama ke Neon Development berhasil diterapkan (`drizzle/0000_quiet_dragon_lord.sql`), menciptakan 14 tabel + 6 enum + index + foreign key.
3. **Seed RBAC** — izin awal ditanam: 2 role tenant (admin, staff) dengan masing-masing 14 dan 11 permission, ditambah katalog permission global.
4. **Route handler & uji HTTP** — `/api/auth/[...all]` mount Better Auth; uji HTTP melalui Next.js Route Handler memverifikasi signup, sign-in, session, sign-out.
5. **Perbaikan error** — saat smoke test dijalankan, muncul error `Drizzle schema mismatch: Missing tables auth_users, auth_sessions, auth_accounts, auth_verifications`. Investigasi menemukan dua akar masalah: (a) `src/db/schema.ts` hanya berisi `export {};` (tidak ada definisi tabel), (b) `src/auth.ts` memakai `better-auth` (full mode) yang tidak cocok untuk `@neondatabase/serverless`. Keduanya diperbaiki.
6. **Verifikasi akhir** — semua smoke test lulus: provisioning (10/10), verifikasi tambahan (3/3), auth dasar (7/7). Typecheck exit 0. Lint 0 error / 16 warning.

---

## 2. Peta laporan

Semua laporan ada di root workspace. Ini adalah **peta navigasi** ke laporan pendukung:

| File laporan | Topik | Status |
| --- | --- | --- |
| [`laporan-review-schema.md`](laporan-review-schema.md) | Review & perbaikan desain schema core (13 Okt) | ✅ Selesai — dasar schema |
| [`laporan-pengesahan-proyek.md`](laporan-pengesahan-proyek.md) | Keputusan kunci: nama tabel, enum, FK, uniqueness | ✅ Selesai — keputusan desain |
| [`laporan-migrasi-neon.md`](laporan-migrasi-neon.md) | Laporan migrasi ke database Neon (hasil `db:generate` & `db:migrate`) | ✅ Selesai — migrasi pertama |
| [`laporan-migrasi-neon-dev.md`](laporan-migrasi-neon-dev.md) | Laporan migrasi pertama ke Neon Development (detail endpoint & verifikasi) | ✅ Selesai — detail teknis migrasi |
| [`laporan-review-auth.md`](laporan-review-auth.md) | Lanjutan — implementasi auth & hasil generate migrasi | ✅ Selesai — konfigurasi auth |
| [`laporan-review-auth-rbac.md`](laporan-review-auth-rbac.md) | Review SQL auth & RBAC (verifikasi DDL, FK, index, uniqueness) | ✅ Selesai — review SQL |
| [`laporan-seed-auth-http.md`](laporan-seed-auth-http.md) | Seed RBAC + Route Handler Better Auth + uji HTTP | ✅ Selesai — seed & uji HTTP |
| [`laporan-review-provisioning.md`](laporan-review-provisioning.md) | Review rancangan provisioning tenant (14 Okt, revisi 9 ketentuan) | ✅ Selesai — rancangan provisioning |
| [`laporan-verifikasi-provisioning-dev.md`](laporan-verifikasi-provisioning-dev.md) | Verifikasi provisioning di development | ✅ Selesai — verifikasi awal |
| [`laporan-perbaikan-error-auth-dan-schema.md`](laporan-perbaikan-error-auth-dan-schema.md) | **Perbaikan error Better Auth "Missing tables" & schema definition gap (14 Okt)** ← ini adalah fokus utama sesi ini | ✅ Selesai — perbaikan & verifikasi |
| **`laporan-terintegrasi-proses-auth-dan-schema.md`** (file ini) | **Peta terintegrasi seluruh proses** | ✅ Selesai — agregasi |

---

## 3. Kronologi proses

### 3.1 Fase 1: Review & desain schema (13 Oktober 2026)

**Laporan kunci:** [`laporan-review-schema.md`](laporan-review-schema.md)

**Yang dilakukan:**
- Review desain schema core travel-umroh
- Identifikasi 3 temuan kritis:
  1. Package `better-auth` belum terpasang (saat itu) — klaim "skema inti Better Auth 1.7" adalah asumsi
  2. RBAC lama tidak aman: `roles.tenant_id` nullable tanpa pembatas, index unique tidak melindungi baris `NULL`, `user_role_assignments` ada tanpa pengecekan keanggotaan tenant
  3. Audit log bergantung FK (`ON DELETE SET NULL`) — jejak bisa kehilangan tautan tenant
- Hasil: schema ditulis ulang dari 546 → 816 baris, 14 tabel, 6 enum PostgreSQL, dengan:
  - Dua scope eksplisit (platform, tenant) dengan CHECK constraint
  - Foreign key komposit yang menutup celah keamanan
  - Audit log append-only tanpa FK, dengan snapshot `actor_label`

**Keputusan kunci** (lihat [`laporan-pengesahan-proyek.md`](laporan-pengesahan-proyek.md)):
- Nama tabel, struktur enum, FK, uniqueness — semua disepakati dan ditulis di laporan.
- Keputusan tentang kunci tabel (UUID vs text) untuk setiap tabel.

### 3.2 Fase 2: Migrasi database ke Neon (14 Oktober 2026)

**Laporan kunci:** [`laporan-migrasi-neon.md`](laporan-migrasi-neon.md), [`laporan-migrasi-neon-dev.md`](laporan-migrasi-neon-dev.md)

**Yang dilakukan:**
- Jalankan `npx drizzle-kit generate` → menghasilkan `drizzle/0000_quiet_dragon_lord.sql` (215 baris)
- Jalankan `npx drizzle-kit migrate` → migrasi pertama ke database Neon berhasil
- Verifikasi: 14 tabel, 6 enum, index, foreign key semuanya ada di database

**Hasil DDL utama** (lihat `drizzle/0000_quiet_dragon_lord.sql`):
- 14 tabel: `accounts`, `audit_logs`, `auth_accounts`, `auth_sessions`, `auth_users`, `auth_verifications`, `installations`, `permissions`, `platform_role_assignments`, `role_permissions`, `roles`, `tenant_role_assignments`, `tenant_users`, `tenants`
- 6 enum: `account_status`, `audit_actor_type`, `installation_status`, `role_scope`, `tenant_status`, `user_status`
- Index & foreign key lengkap sesuai rancangan

### 3.3 Fase 3: Konfigurasi auth & seed RBAC (14 Oktober 2026)

**Laporan kunci:** [`laporan-review-auth.md`](laporan-review-auth.md), [`laporan-review-auth-rbac.md`](laporan-review-auth-rbac.md), [`laporan-seed-auth-http.md`](laporan-seed-auth-http.md)

**Yang dilakukan:**

1. **Instal package Better Auth** (jika belum):
   - `better-auth` 1.7.7
   - `@better-auth/drizzle-adapter` 1.7.7
   - `drizzle-orm` 0.45.4

2. **Konfigurasi `src/auth.ts`:**
   - Import `betterAuth` dari `better-auth/minimal` (bukan `better-auth` full mode — lebih cocok untuk `@neondatabase/serverless`)
   - Import `drizzleAdapter` dari `@better-auth/drizzle-adapter`
   - Konfigurasi dengan `provider: "pg"` dan `schema` yang memetakan model ke tabel fisik `auth_*`
   - Set `modelName` untuk tiap model: `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`
   - Aktifkan `emailAndPassword.enabled = true`

3. **Mount route handler** (`src/app/api/auth/[...all]/route.ts`):
   - `export const { GET, POST } = toNextJsHandler(auth.handler)`
   - Mount di `/api/auth/[...all]`

4. **Seed RBAC** (`scripts/seed-rbac.ts`):
   - Buat katalog permission (banyak permission tenant & platform)
   - Buat role `tenant.admin` dengan 14 permission
   - Buat role `tenant.staff` dengan 11 permission
   - Seed ke database

5. **Uji HTTP** (`scripts/auth-smoke.ts`):
   - Signup → cek `auth_users` + `auth_accounts` (credential, password ter-hash)
   - Signup duplikat ditolak
   - Sign-in password salah ditolak
   - Sign-in password benar → dapat cookie session
   - `getSession` mengenali session aktif
   - `getSession` tanpa cookie → null
   - Sign-out mematikan session
   - Pembersihan data uji

### 3.4 Fase 4: Review & rancangan provisioning (14 Oktober 2026)

**Laporan kunci:** [`laporan-review-provisioning.md`](laporan-review-provisioning.md)

**Yang dilakukan:**
- Review rancangan provisioning tenant dari hasil signup Better Auth
- 9 ketentuan revisi diterapkan, termasuk:
  1. Identitas Better Auth tidak pernah dihapus saat provisioning gagal
  2. Hasil provisioning didefinisikan eksplisit untuk tiap skenario
  3. Setiap `ON CONFLICT DO NOTHING` wajib verifikasi data existing — konflik yang tidak sesuai → 409
  4. Audit log event `tenant.created` & `installation.created` tidak boleh duplikat — idempoten berbasis entity key
  5. `tenant.admin` = 14 permission lengkap
  6. `tenant.staff` = 11 permission (tanpa `tenant-role.assign` & `staff.read`)
  7. Integrasi SMTP ditunda — fokus transaksi, otorisasi, audit, testing
  8. Otorisasi hanya mengizinkan assignment role tenant yang sah
  9. Daftar pengujian diperbarui
- Koreksi: konkurensi, audit log (commit sukses tapi respons hilang), installation (retry tidak boleh reset status)

### 3.5 Fase 5: Implementasi provisioning & smoke test (14 Oktober 2026)

**Yang dilakukan:**
- Implementasi `src/lib/provisioning.ts` — fungsi `provisionTenantFromSignup` dengan:
  - Semua langkah (B0–B8) dalam satu transaksi DB
  - Idempoten berbasis entity key untuk audit log
  - Konflik handling → 409 (conflict: true)
  - Penanganan paralel & retry
- Script smoke test `scripts/provision-smoke.ts` — 10 kasus uji
- Script verifikasi tambahan `scripts/provision-verify.ts` — 3 kasus uji lanjutan

### 3.6 Fase 6: Perbaikan error & verifikasi akhir (14 Oktober 2026) ← Fokus utama laporan ini

**Lihat detail di:** [`laporan-perbaikan-error-auth-dan-schema.md`](laporan-perbaikan-error-auth-dan-schema.md)

**Yang dilakukan:**
1. Jalankan smoke test → semua 10 gagal dengan "Missing tables"
2. Investigasi mendalam → temukan 2 akar masalah (lihat Bagian 4)
3. Perbaiki `src/db/schema.ts` → definisikan 14 tabel
4. Perbaiki `src/auth.ts` → ganti ke `better-auth/minimal`
5. Perbaiki smoke test yang rusak (test 5, cleanupByEmail, syntax error)
6. Verifikasi akhir → semua lulus

---

## 4. Fokus utama: perbaikan error "Missing tables"

**Laporan rinci:** [`laporan-perbaikan-error-auth-dan-schema.md`](laporan-perbaikan-error-auth-dan-schema.md)

### 4.1 Gejala

```
2026-10-14T11:35:04.158Z ERROR [Better Auth]: Drizzle schema mismatch
  Missing tables
    auth_users, auth_sessions, auth_accounts, auth_verifications
  help: Run `npx auth generate` to refresh the Drizzle schema...
FAIL  1. Signup normal :: ...
...
=== 10 TES GAGAL ===
```

Semua 10 smoke test gagal dengan pesan yang sama.

### 4.2 Investigasi

**Langkah 1: Konfirmasi tabel ada di database**
```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
```
Hasil: **14 tabel ada**, termasuk ke-4 tabel auth. Jadi bukan masalah tabel hilang.

**Langkah 2: Cek koneksi**
- `DATABASE_URL` → `ep-dark-meadow-b3ch5el3-pooler` (pooled)
- `DIRECT_URL` → `ep-dark-meadow-b3ch5el3` (direct)
- Keduanya ke `travel_umroh_db`, same host family. Bukan masalah koneksi wrong.

**Langkah 3: Cek apa yang dilihat Better Auth**
```ts
const ctx = await (auth as any).$context;
console.log('ctx.adapter.options.schema keys:', Object.keys(ctx.adapter.options.schema));
console.log('ctx.adapter.options.schema.auth_users:', ctx.adapter.options.schema.auth_users);
```
Hasil:
```
ctx.adapter.options.schema keys: auth_users, auth_sessions, auth_accounts, auth_verifications
ctx.adapter.options.schema.auth_users: undefined   ← !!!
```
Key ada, tapi value `undefined`. Tanda khas: import dari modul yang tidak mengekspor nilai tersebut.

**Langkah 4: Verifikasi `src/db/schema.ts`**
```bash
cat src/db/schema.ts
```
Isi hanya:
```ts
/** ... */
export {};
```
**Tidak ada definisi tabel.** Import `authUsers`, `authSessions` dll menghasilkan `undefined`.

**Langkah 5: Lacak call chain validasi**

Better Auth 1.7.7 melakukan validasi schema pada runtime melalui `findDrizzleSchemaProblems`:

```
createBetterAuth → initFn(options) → createAuthContext → ctx.checkSchema = runtimeSchemaCheckFor(ctx.adapter)
→ createBetterAuth: pendingSchemaCheck = ctx.checkSchema?.() → .catch(logger.error)
```

Untuk drizzle adapter, schema check mendaftarkan:
```ts
// drizzle-adapter/dist/index.mjs
registerSchemaCheck(instance, createSchemaCheck(
  () => findDrizzleSchemaProblems(
    config.schema ?? db._?.fullSchema ?? {},  // ← schema kita
    options, config.usePlural
  ), "drizzle"
), { runtimeEnabled: checksSchema(options) });
```

Dan `findDrizzleSchemaProblems`:
```ts
function findDrizzleSchemaProblems(schema, options, usePlural) {
  return diffSchema(
    getExpectedSchema(options, { usePlural }),
    introspectDrizzleSchema(schema)
  );
}

function introspectDrizzleSchema(schema) {
  const tables = [];
  for (const [name, table] of Object.entries(schema)) {
    if (!is(table, Table)) continue;  // lewati kalau bukan Drizzle Table
    // ...
  }
  return tables;  // return [] kalau semua value undefined
}
```

Karena semua value `undefined`, `is(table, Table)` selalu false → `introspectDrizzleSchema` return `[]` → `diffSchema(expected, [])` laporkan 4 tabel hilang.

**Langkah 6: Temukan akar masalah import**
```ts
// Test verifikasi mandiri
import { authUsers } from '@/db/schema';
console.log('schema[auth_users] type:', typeof authUsers);  // → "undefined"
console.log('is Table:', is(authUsers, Table));  // → false
```
Konfirmasi: `authUsers` dari `@/db/schema` adalah `undefined`.

**Langkah 7: Temukan masalah import `better-auth`**

Full mode (`better-auth`) memakai Kysely. `@neondatabase/serverless` (HTTP driver) tidak memiliki property yang dikenali Kysely (`dialect`, `createDriver`, `getConnection`, `connect`), sehingga Kysely dibuat tanpa dialect valid → `connection.introspection.getTables()` gagal → "Missing tables".

Minimal mode (`better-auth/minimal`) langsung pakai drizzle adapter tanpa Kysely → `findDrizzleSchemaProblems(config.schema, ...)` → jika `config.schema` berisi tabel asli, introspect berhasil.

### 4.3 Solusi

**Solusi A: Perbaiki `src/db/schema.ts` — definisikan semua 14 tabel**

File ditulis ulang dari `export {};` (2 baris) menjadi 184 baris dengan 14 definisi `pgTable`:

```ts
import { pgTable, text, uuid, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

// 10 tabel aplikasi
export const accounts = pgTable("accounts", { ... });
export const auditLogs = pgTable("audit_logs", { ... });
export const installations = pgTable("installations", { ... });
export const permissions = pgTable("permissions", { ... });
export const platformRoleAssignments = pgTable("platform_role_assignments", { ... });
export const rolePermissions = pgTable("role_permissions", { ... });
export const roles = pgTable("roles", { ... });
export const tenantRoleAssignments = pgTable("tenant_role_assignments", { ... });
export const tenantUsers = pgTable("tenant_users", { ... });
export const tenants = pgTable("tenants", { ... });

// 4 tabel auth Better Auth
export const authUsers = pgTable("auth_users", { ... });
export const authSessions = pgTable("auth_sessions", { ... });
export const authAccounts = pgTable("auth_accounts", { ... });
export const authVerifications = pgTable("auth_verifications", { ... });
```

Kolom & tipe mengikuti migrasi `drizzle/0000_quiet_dragon_lord.sql` yang sudah ada di database.

**Solusi B: Perbaiki `src/auth.ts` — ganti ke `better-auth/minimal`**

```diff
- import { betterAuth } from "better-auth";
+ import { betterAuth } from "better-auth/minimal";
```

**Solusi C: Perbaiki smoke test yang rusak**

1. Test 5 "Signup paralel user berbeda" tidak memanggil provisioning → ditambahkan pemanggilan provisioning
2. `cleanupByEmail` salah pakai accountId sebagai tenantId → diperbaiki (cari tenant dulu via `tenants.accountId`)
3. `provision-verify.ts` ada syntax error backslash, duplikasi variabel, `loserUser.id` seharusnya `loserUser.user.id` → diperbaiki

### 4.4 Verifikasi akhir

Setelah perbaikan, semua smoke test dijalankan ulang:

```
# provision-smoke.ts — 10/10 PASS
PASS  signup + provisioning + 2 audit log
PASS  retry idempoten, tenant & instalasi tidak berubah
PASS  konflik ownership tertangani 409 (conflict=true)
PASS  dua request provisioning paralel user sama menghasilkan tenant sama tanpa duplikasi
PASS  signup paralel user berbeda menghasilkan tenant berbeda tanpa konflik
PASS  konflik kepemilikan email bisnis menghasilkan 409 tanpa overwrite
PASS  audit log tidak terduplikasi setelah commit sukses dan retry
PASS  retry provisioning tidak mereset instalasi aktif ke pending
PASS  RBAC & isolasi antartenant: dua tenant terpisah, admin masing-masing tenant berbeda
PASS  regresi HTTP Better Auth: signup + provisioning + session tetap hidup
=== SEMUA TES LULUS ===

# provision-verify.ts — 3/3 PASS
PASS  parallel provisioning user sama: satu lolos, satu conflict, audit tidak terduplikasi
PASS  retry setelah respons hilang: tenant sama, audit tidak terduplikasi
PASS  rollback kegagalan di awal transaksi: tidak ada data provisioning parsial, auth_user tetap ada
=== VERIFIKASI TAMBAHAN LULUS ===

# auth-smoke.ts — 7/7 PASS
PASS  auth_users + auth_accounts (credential, password ter-hash) tersimpan
PASS  signUpEmail duplikat ditolak
PASS  signInEmail password salah ditolak
PASS  signInEmail password benar memberi cookie session
PASS  getSession mengenali session aktif
PASS  getSession tanpa cookie → null
PASS  signOut mematikan session
PASS  pembersihan data uji (auth_users/sessions/accounts/verifications)
=== SEMUA TES LULUS ===
```

**Check lain:**
- `npm run typecheck` → exit 0 (no errors)
- `npm run lint` → 0 error, 16 warning (semua di test scripts: console statement & unused vars)

---

## 5. Struktur file yang relevan

```
travel-umroh/
├── src/
│   ├── auth.ts                      ← konfigurasi Better Auth (diperbaiki: minimal mode)
│   ├── db/
│   │   ├── index.ts                 ← koneksi DB (Pool + drizzle)
│   │   └── schema.ts                ← 14 definisi pgTable (DI PERBAIKI: dari export {};)
│   └── lib/
│       ├── provisioning.ts          ← fungsi provisionTenantFromSignup
│       ├── authz.ts                 ← RBAC (getRolesForUser, getPermissionsForUser, hasPermission)
│       ├── slug.ts                  ← toSlug, suggestSlug, shortHash
│       └── utils.ts                 ← cn (tailwind-merge)
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx
│       └── api/
│           └── auth/
│               └── [...all]/
│                   └── route.ts      ← mount Better Auth handler
├── scripts/
│   ├── load-env.ts                  ← hook lingkungan (dotenv)
│   ├── provision-smoke.ts           ← 10 kasus uji provisioning (DI PERBAIKI)
│   ├── provision-verify.ts          ← 3 kasus uji lanjutan (DI PERBAIKI)
│   ├── auth-smoke.ts                ← 7 kasus uji auth dasar
│   ├── seed-rbac.ts                 ← seed role & permission awal
│   └── inspect-drizzle-schema.ts    ← script investigasi (tetap ada)
├── drizzle/
│   ├── 0000_quiet_dragon_lord.sql   ← migrasi pertama (14 tabel + 6 enum + FK + index)
│   ├── meta/
│   │   ├── _journal.json
│   │   └── 0000_snapshot.json
│   └── ...
├── laporan-*.md                    ← semua laporan (lihat Bagian 2)
└── ...
```

---

## 6. Keterangan teknis penting

### 6.1 Mengapa `better-auth/minimal` perlu

| Mode | Import | Path inisialisasi | Kebutuhan |
|------|--------|-------------------|-----------|
| Full | `better-auth` | `init()` → `getAdapter()` → `createKyselyAdapter()` | Kysely + dialect database yang valid |
| Minimal | `better-auth/minimal` | `initMinimal()` → `getBaseAdapter()` → adapter langsung | Adapter database (drizzleAdapter, dll.) |

Karena `@neondatabase/serverless` adalah HTTP-based driver tanpa pg native dialect, Kysely tidak bisa diinisialisasi dengan benar di full mode. Minimal mode melewati Kysely dan langsung pakai drizzle adapter.

### 6.2 Validasi schema Better Auth 1.7.7

Better Auth melakukan validasi schema pada runtime (bukan hanya di generation time):

1. `createBetterAuth(options, initFn)` membuat `authContext = initFn(options).then(ctx => { ... })`
2. Di dalam `.then()`: `ctx.checkSchema = runtimeSchemaCheckFor(ctx.adapter)`
3. `pendingSchemaCheck = ctx.checkSchema?.()` → `.catch(error => ctx.logger.error(...))`
4. Untuk drizzle adapter, schema check memanggil `findDrizzleSchemaProblems(config.schema, options, usePlural)`
5. `findDrizzleSchemaProblems` → `diffSchema(getExpectedSchema(options), introspectDrizzleSchema(config.schema))`
6. `introspectDrizzleSchema` iterating `Object.entries(schema)` dan hanya memproses entry yang `is(table, Table)` true — mengabaikan entry dengan value `undefined`

Jadi jika `config.schema` berisi `{ auth_users: undefined, ... }`, semua entry diabaikan → `introspectDrizzleSchema` return `[]` → `diffSchema(expected, [])` laporkan semua tabel hilang.

### 6.3 Drizzle `pgTable` dan `introspectDrizzleSchema`

`introspectDrizzleSchema` menggunakan `is(table, Table)` dari `drizzle-orm` untuk memeriksa apakah value adalah instance `pgTable`. Hanya tabel yang lolos pemeriksaan ini yang di-process. Jadi definisi tabel harus menggunakan `pgTable(...)` (bukan objek biasa atau undefined).

### 6.4 Pentingnya `modelName` di konfigurasi auth

```ts
// src/auth.ts
export const auth = betterAuth({
  baseURL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      auth_users: authUsers,        // key harus match modelName
      auth_sessions: authSessions,
      auth_accounts: authAccounts,
      auth_verifications: authVerifications,
    },
  }),
  user: { modelName: "auth_users" },           // ← modelName = key di schema
  session: { modelName: "auth_sessions" },
  account: { modelName: "auth_accounts" },
  verification: { modelName: "auth_verifications" },
  emailAndPassword: { enabled: true },
});
```

Key di `schema` harus sama dengan `modelName` di konfigurasi model. Jika tidak, Better Auth tidak akan menemukan tabel yang sesuai.

---

## 7. Verifikasi yang bisa diulang

Semua verifikasi berikut bisa diulang oleh siapa saja:

```bash
# 1. Typecheck
cd /d/sources/nextJS/travel-umroh
npm run typecheck

# 2. Lint
npm run lint

# 3. Smoke test provisioning (10 kasus)
npx tsx scripts/provision-smoke.ts

# 4. Smoke test verifikasi tambahan (3 kasus)
npx tsx scripts/provision-verify.ts

# 5. Smoke test auth dasar (7 kasus)
npx tsx scripts/auth-smoke.ts

# 6. Cek tabel di database
npx tsx -e "
import './scripts/load-env';
import { Pool } from '@neondatabase/serverless';
const pool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 1 });
(async () => {
  const { rows } = await pool.query(
    \"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;\"
  );
  console.log('Tabel di database (' + rows.length + '):');
  rows.forEach(r => console.log('  -', r.tablename));
  await pool.end();
})();
"
```

**Hasil yang diharapkan:**
- typecheck: exit 0
- lint: 0 error (warning boleh)
- provision-smoke: `=== SEMUA TES LULUS ===` (10 PASS)
- provision-verify: `=== VERIFIKASI TAMBAHAN LULUS ===` (3 PASS)
- auth-smoke: `=== SEMUA TES LULUS ===` (7 PASS)
- Query tabel: daftar 14 tabel termasuk ke-4 tabel auth

---

## 8. Status akhir & sisa pekerjaan

### 8.1 Status akhir

| Area | Status |
|------|--------|
| Schema core (14 tabel) | ✅ Terdefinisi di `src/db/schema.ts` |
| Migrasi database | ✅ Terapan ke Neon Development |
| Konfigurasi Better Auth | ✅ `better-auth/minimal` + drizzleAdapter + modelName mapping |
| Route handler `/api/auth/[...all]` | ✅ Mounted |
| Seed RBAC (role + permission) | ✅ Ditanam di database |
| Uji HTTP auth | ✅ 7/7 PASS |
| Rancangan provisioning | ✅ Review + revisi (9 ketentuan) |
| Implementasi provisioning | ✅ `provisionTenantFromSignup` di `src/lib/provisioning.ts` |
| Smoke test provisioning | ✅ 10/10 PASS |
| Smoke test verifikasi | ✅ 3/3 PASS |
| Perbaikan error "Missing tables" | ✅ Diperbaiki (2 akar masalah) |
| Typecheck | ✅ exit 0 |
| Lint | ✅ 0 error / 16 warning |

### 8.2 Sisa pekerjaan (di luar ruang lingkup laporan ini)

1. **Fitur aplikasi** — CRUD paket umroh, jamaah, reservasi, pembayaran, dll. (muncul di suggest_prompts)
2. **Halaman onboarding tenant** — setelah signup, setup nama bisnis, slug, konfirmasi instalasi
3. **Konfigurasi BETTER_AUTH_SECRET** — saat ini pakai default secret (cukup untuk dev, tapi sebaiknya diganti untuk production)
4. **Email verification & SMTP** — ditunda sesuai ketentuan provisioning (#7: "Integrasi SMTP ditunda secara eksplisit")
5. **Test lebih lanjut** — stress test paralel, edge cases, dll.
6. **Production deployment** — belum disentuh (sesuai batasan: tidak ada commit/push, tidak ada akses Production)

---

## 9. Referensi silang

- **Root error & perbaikan:** [`laporan-perbaikan-error-auth-dan-schema.md`](laporan-perbaikan-error-auth-dan-schema.md)
- **Desain schema:** [`laporan-review-schema.md`](laporan-review-schema.md) + [`laporan-pengesahan-proyek.md`](laporan-pengesahan-proyek.md)
- **Migrasi:** [`laporan-migrasi-neon.md`](laporan-migrasi-neon.md) + [`laporan-migrasi-neon-dev.md`](laporan-migrasi-neon-dev.md)
- **Auth & RBAC:** [`laporan-review-auth.md`](laporan-review-auth.md) + [`laporan-review-auth-rbac.md`](laporan-review-auth-rbac.md) + [`laporan-seed-auth-http.md`](laporan-seed-auth-http.md)
- **Provisioning:** [`laporan-review-provisioning.md`](laporan-review-provisioning.md) + [`laporan-verifikasi-provisioning-dev.md`](laporan-verifikasi-provisioning-dev.md)

---

*End of report.*
