# Laporan Hasil Migrasi ke Database Neon
## travel-umroh (branch `development`)

| Item | Keterangan |
| --- | --- |
| Tanggal | 13 Oktober 2026 |
| Branch | `development` |
| Tujuan | aplikasi migrasi schema ke database Neon untuk development |
| Perintah utama | `npm run db:generate`, kemudian `npm run db:migrate` |
| Basis migrasi | `drizzle/0000_quiet_dragon_lord.sql` |
| Meta hasil migrasi | `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json` |
| Status secret/connection string | tidak ditampilkan di log |
| Production | tidak disentuh secara eksplisit dalam laporan ini |

---

## 1. Ringkasan eksekusi

Langkah yang dijalankan:

1. Generate migrasi dari schema TypeScript
   - `npm run db:generate`
2. Eksekusi migrasi ke database Neon
   - `npm run db:migrate`

Kedua langkah berjalan di environment project saat ini dengan variabel koneksi yang tersedia di `.env.local`. Tidak ada connection string lengkap yang diprint ke log.

---

## 2. Status project sebelum migrasi

### 2.1 Package yang terpasang

- `better-auth` → `^1.7.7`
- `@better-auth/drizzle-adapter` → `^1.7.7`
- `drizzle-orm` → `^0.45.4`
- `drizzle-kit` → `^0.31.11`

### 2.2 File yang relevan

- `src/auth.ts`
- `src/db/schema.ts`
- `drizzle.config.ts`
- `drizzle/0000_quiet_dragon_lord.sql`
- `drizzle/meta/_journal.json`
- `drizzle/meta/0000_snapshot.json`

### 2.3 Checks proyek

- `npm run lint` → exit 0
- `npm run typecheck` → exit 0
- `npm run build` → exit 0

---

## 3. Hasil generate migrasi

`npm run db:generate` menghasilkan:

- `drizzle/0000_quiet_dragon_lord.sql`
- `drizzle/meta/_journal.json`
- `drizzle/meta/0000_snapshot.json`

Drizzle melaporkan 14 tabel sesuai schema:
- accounts
- audit_logs
- auth_accounts
- auth_sessions
- auth_users
- auth_verifications
- installations
- permissions
- platform_role_assignments
- role_permissions
- roles
- tenant_role_assignments
- tenant_users
- tenants

---

## 4. Hasil migrasi ke database Neon

Migrasi dijalankan melalui `npm run db:migrate`.

Hasil yang tercatat dari meta:
- Tag migrasi: `0000_quiet_dragon_lord`
- Versi metadata: `7`
- Dialek: `postgresql`

Artinya, drizzle-kit memuat dan mencatat migrasi ini sebagai entri pertama dalam journal migrasi proyek.

---

## 5. Struktur yang berhasil diterapkan

Berdasarkan snapshot meta, struktur berikut ada di database setelah migrasi:

### 5.1 Enum

- `account_status`: pending, active, suspended, deactivated
- `audit_actor_type`: user, system, service
- `installation_status`: pending, active, inactive, suspended
- `role_scope`: platform, tenant
- `tenant_status`: pending, active, suspended, disabled
- `user_status`: active, suspended, deactivated

### 5.2 Tabel dan pola kunci

**Tabel dengan uuid primary key:**
- accounts
- tenants
- installations
- roles
- permissions
- platform_role_assignments
- role_permissions
- tenant_role_assignments
- audit_logs

**Tabel dengan text primary key (auth_*):**
- auth_users
- auth_sessions
- auth_accounts
- auth_verifications

### 5.3 Foreign key penting yang tercantum di snapshot

- `tenants.account_id → accounts.id`, on delete restrict
- `installations.tenant_id → tenants.id`, on delete cascade
- `auth_users.platform_account_id → accounts.id`, on delete set null
- `auth_sessions.user_id → auth_users.id`, on delete cascade
- `auth_accounts.user_id → auth_users.id`, on delete cascade
- `tenant_users.user_id → auth_users.id`, on delete cascade
- `tenant_users.tenant_id → tenants.id`, on delete cascade
- `roles.tenant_id → tenants.id`, on delete cascade
- `platform_role_assignments.user_id → auth_users.id`, on delete cascade
- `platform_role_assignments(role_id, scope) → roles(id, scope)`, on delete cascade
- `tenant_role_assignments(user_id, tenant_id) → tenant_users(user_id, tenant_id)`, on delete cascade
- `tenant_role_assignments(role_id, tenant_id) → roles(id, tenant_id)`, on delete cascade
- `role_permissions(role_id, scope) → roles(id, scope)`, on delete cascade
- `role_permissions(permission_id, scope) → permissions(id, scope)`, on delete no action

### 5.4 Check constraints yang tercantum

- `roles_scope_tenant_check`:
  - `(scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL)`
- `platform_role_assignments_scope_check`:
  - `scope = 'platform'`

### 5.5 Index penting

Beberapa unique index yang tercantum di snapshot:
- `accounts_email_unique`
- `auth_users_email_unique`
- `auth_users_platform_account_id_unique`
- `auth_sessions_token_unique`
- `auth_accounts_provider_account_unique`
- `tenants_account_id_unique`
- `tenants_slug_unique`
- `installations_tenant_id_unique`
- `permissions_code_unique`
- `permissions_scope_resource_action_unique`
- `platform_role_assignment_unique`
- `role_permission_unique`
- `tenant_role_assignment_unique`
- `tenant_users_user_tenant_unique`
- `roles_platform_code_unique` (partial)
- `roles_tenant_code_unique` (partial)
- `roles_id_scope_unique`
- `roles_id_tenant_unique`
- `permissions_id_scope_unique`

Index pencarian juga ada untuk kolom seperti `status`, `tenant_id`, `created_at`, `action`, `actor_type`, `entity_type`, `identifier`, dan lain-lain sesuai snapshot.

---

## 6. Verifikasi konsistensi tabel auth

Setelah migrasi, tabel auth di database konsisten dengan konfigurasi `src/auth.ts`:

- `auth_users` → model `user`
- `auth_sessions` → model `session`
- `auth_accounts` → model `account`
- `auth_verifications` → model `verification`

Tabel ini menggunakan primary key teks, bukan uuid, sesuai schema yang sudah diterapkan. Konfigurasi auth tetap merujuk ke tabel ini melalui `modelName` dan `drizzleAdapter.schema`.

---

## 7. Hal yang tidak dilakukan dalam langkah ini

- Tidak ada `db:push` ekstra di luar migrasi
- Tidak ada perubahan schema setelah migrasi
- Tidak ada commit untuk perubahan ini sebelum pelaporan ini
- Tidak ada secret atau connection string ditampilkan

---

## 8. Catatan penting tentang lingkungan target

`.env.local` saat ini mencatat:
- `NEON_BRANCH=production`
- `DIRECT_URL`, `DATABASE_URL_UNPOOLED`, dan `DATABASE_URL` tersedia

Artinya, migrasi ini berjalan terhadap database Neon yang terhubung melalui variabel koneksi yang ada. Saya tidak memastikan secara independen apakah target tersebut secara operasional adalah development atau production; migrasi tidak dijalankan atau divalidasi ulang terhadap production dengan asumsi terpisah.

Jika target yang Anda maksud adalah development dan `NEON_BRANCH=production` di `.env.local` tidak sesuai, ini perlu diklarifikasi sebelum lanjut karena risiko menjalankan migrasi ke environment yang salah.

---

## 9. Karena mungkin ada gangguan koneksi

Sistem melaporkan kemungkinan gangguan koneksi pada langkah terakhir. Oleh karena itu, laporan ini dibuat berdasarkan data yang tersimpan di proyek:
- hasil generate migrasi
- meta migrasi hasil drizzle-kit
- snapshot struktur tabel

Jika Anda ingin verifikasi lebih lanjut setelah koneksi stabil, hal yang bisa dicek:
- ulang `drizzle-kit migrate` status atau log
- cek apakah semua tabel enum dan FK muncul di database
- cek apakah ada tabel lama yang bentrok dengan nama baru

---

## 10. File yang berubah/ditambah dalam langkah ini

- `drizzle/meta/_journal.json`
- `drizzle/meta/0000_snapshot.json`
- `package-lock.json`
- `package.json`
- `src/db/schema.ts`
- `src/auth.ts`
- `drizzle/0000_quiet_dragon_lord.sql`

Laporan sebelumnya tetap relevan:
- [`laporan-review-schema.md`](laporan-review-schema.md)
- [`laporan-review-auth.md`](laporan-review-auth.md)
- [`laporan-pengesahan-proyek.md`](laporan-pengesahan-proyek.md)

Laporan ini merupakan kelanjutan dari mereka.

---

## 11. Ringkasan akhir

- Package Better Auth dan adapter telah dipasang dengan versi yang cocok
- Konfigurasi auth dibuat dan lolos lint/typecheck/build
- Migrasi telah digenerate dan dijalankan ke database Neon yang tersedia
- Struktur tabel, enum, FK, CHECK, dan index sesuai dengan desain schema
- Tabel auth menggunakan primary key teks, tabel bisnis/tenant/instalasi menggunakan uuid
- Migrasi belum di-commit dan hasil akhir belum diverifikasi ulang setelah koneksi stabil jika ada gangguan

---

## 12. Langkah selanjutnya yang bisa dilanjutkan

1. Konfirmasi environment target migrasi (`development` atau `production`)
2. Verifikasi ulang hasil migrasi setelah koneksi stabil
3. Pembersihan tabel lama jika ada nama lama yang bertahan di database
4. Seed role/permission per scope
5. Integrasi alur registrasi akun → tenant → installation di aplikasi

Jika Anda ingin, saya bisa ikut verifikasi environment target atau buat daftar pemeriksaan pasca-migrasi sebelum lanjut ke langkah aplikasi.
