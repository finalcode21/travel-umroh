# Laporan Lanjutan — Implementasi Auth & Hasil Generate Migrasi
## travel-umroh (branch `development`)

| Item | Keterangan |
| --- | --- |
| Tanggal | 13 Oktober 2026 |
| Branch | `development` |
| Dasar kerja sebelumnya | [`laporan-review-schema.md`](laporan-review-schema.md) |
| Langkah yang dilanjutkan | pemasangan package, verifikasi tabel auth, pembuatan `src/auth.ts`, generate migrasi, dan verifikasi project |
| Status migrasi/database | **Hanya `db:generate` dijalankan.** Tidak ada `db:push`, `db:migrate`, atau koneksi ke Production yang dilakukan |
| Commit | **Belum ada commit** untuk schema, auth, atau migrasi |

---

## 1. Ringkasan eksekusi

Setelah review schema sebelumnya, langkah yang dilanjutkan adalah:

1. Memasang `better-auth` dan `@better-auth/drizzle-adapter` dengan versi yang kompatibel dengan stack yang ada.
2. Memverifikasi nama tabel `auth_*` dan kontrak kolom intinya terhadap package yang benar-benar terpasang.
3. Membuat `src/auth.ts` dengan konfigurasi model kustom (`modelName` + `drizzleAdapter.schema`).
4. Memastikan schema Core tetap konsisten untuk alur **akun → tenant → instalasi**, termasuk FK, CHECK, dan unique index yang mendukung keamanan RBAC dua scope.
5. Memvalidasi proyek dengan lint, typecheck, dan build.
6. Menjalankan `drizzle-kit generate` dan menampilkan SQL migrasi untuk direview.
7. Tidak menjalankan migrasi ke Production dan tidak commit sebelum SQL disetujui.

---

## 2. Versi package yang dipasang

### 2.1 Package auth

- `better-auth` → `^1.7.7`
- `@better-auth/drizzle-adapter` → `^1.7.7`

### 2.2 Package ORM/tooling yang sudah ada

- `drizzle-orm` → `^0.45.4`
- `drizzle-kit` → `^0.31.11`
- `next` → `^16.4.0`
- `react` / `react-dom` → `^19.3.0`
- `typescript` → `^6.0.3`

### 2.3 Ringkasan dependensi teratas

Output `npm ls` menunjukkan:

- `better-auth@1.7.7`
- `@better-auth/drizzle-adapter@1.7.7`
- `drizzle-orm@0.45.4`
- `drizzle-kit@0.31.11`

Adapter dan `drizzle-orm` muncul sebagai dependensi deduped dari `better-auth`. Artinya, versi yang dipakai proyek dan versi yang dipaksakan oleh `better-auth` sama, sehingga tidak ada konflik versi utama.

---

## 3. Verifikasi tabel auth_* terhadap package terpasang

### 3.1 Nama model vs nama tabel fisik

Dokumentasi resmi Better Auth menyatakan:

- Core model default = `user`, `session`, `account`, `verification`
- Default nama tabel fisik = `user`, `session`, `account`, `verification`
- Nama tabel kustom hanya berlaku jika:
  - tabel dipetakan ke adapter melalui `drizzleAdapter.schema`, dan
  - konfigurasi model menggunakan `modelName` yang sesuai

### 3.2 Verifikasi nama tabel di schema ini

Schema menggunakan nama tabel ini:

- `auth_users`
- `auth_sessions`
- `auth_accounts`
- `auth_verifications`

Konfigurasi di `src/auth.ts` memetakan:

- `user` → `authUsers`
- `session` → `authSessions`
- `account` → `authAccounts`
- `verification` → `authVerifications`

Danは以下の `modelName` diberikan:

- `user.modelName = "auth_users"`
- `session.modelName = "auth_sessions"`
- `account.modelName = "auth_accounts"`
- `verification.modelName = "auth_verifications"`

Dengan demikian, nama tabel `auth_*` tidak mengandalkan asumsi, melainkan tegas diterjemahkan dalam konfigurasi yang harus cocok dengan tabel fisik.

### 3.3 Kontrak kolom inti yang diverifikasi

Verifikasi dilakukan terhadap kontrak 1.7.x yang terdokumentasi, bukan hanya komentar di schema:

- **user / auth_users**
  - `id`, `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt` ada
  - Kolom tambahan domain (`phone`, `platformAccountId`) di-declare sebagai `additionalFields`
  - `email` diberi unique index
  - `platform_account_id` diberi unique index

- **session / auth_sessions**
  - `token` diberi unique index

- **account / auth_accounts**
  - `provider_id` + `account_id` diberi unique index

- **verification / auth_verifications**
  - `identifier` di-index, bukan unique

Kontrak ini konsisten dengan cara Better Auth membaca tabel melalui adapter drizzle.

---

## 4. Konfigurasi auth.ts

File baru dibuat: `[src/auth.ts](src/auth.ts)`.

Poin penting konfigurasi:

- Provider database = `pg`
- Schema drizzle adapter mencakup keempat tabel auth
- `modelName` disetel agar sesuai dengan nama tabel kustom
- `additionalFields` mencakup:
  - `phone`
  - `platformAccountId`

Konfigurasi ini dimaksudkan agar cocok dengan tabel yang sudah didesain di `src/db/schema.ts`.

---

## 5. Validasi proyek

### 5.1 Lint

`npm run lint` → exit 0

### 5.2 Typecheck

`npm run typecheck` → exit 0

### 5.3 Build

`npm run build` → exit 0

Hasil build Next.js menunjukkan kompilasi TypeScript berhasil dan halaman statis berhasil digenerate.

---

## 6. Hasil drizzle-kit generate

### 6.1 Perintah

`npm run db:generate`

### 6.2 Hasil

- Migrasi dihasilkan di: `drizzle/0000_quiet_dragon_lord.sql`
- Drizzle melaporkan 14 tabel sesuai schema
- Meta dibuat di `drizzle/meta/_journal.json` dan `drizzle/meta/0000_snapshot.json`

### 6.3 Struktur SQL yang dihasilkan

SQL mencakup:

- 6 `CREATE TYPE` untuk enum:
  - `account_status`
  - `audit_actor_type`
  - `installation_status`
  - `role_scope`
  - `tenant_status`
  - `user_status`
- 14 `CREATE TABLE`
- berbagai `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`
- `CREATE UNIQUE INDEX` dan `CREATE INDEX`

### 6.4 Tabel yang di-_generate_

1. `accounts`
2. `tenants`
3. `installations`
4. `auth_users`
5. `auth_sessions`
6. `auth_accounts`
7. `auth_verifications`
8. `tenant_users`
9. `roles`
10. `permissions`
11. `role_permissions`
12. `platform_role_assignments`
13. `tenant_role_assignments`
14. `audit_logs`

---

## 7. Penekanan constraint yang relevan dengan alur registrasi

### 7.1 Chain akun → tenant → instalasi

- `tenants.account_id → accounts.id` dengan **ON DELETE RESTRICT**
  - mencegah penghapusan akun bisnis jika masih ada tenant
- `installations.tenant_id → tenants.id` dengan **ON DELETE CASCADE**
  - instalasi dihapus bersama tenant

Ditambah:

- `tenants.account_id` unique → satu akun memiliki maksimal satu tenant
- `installations.tenant_id` unique → satu tenant memiliki maksimal satu instalasi

### 7.2 Identitas login vs akun bisnis

- `auth_users.platform_account_id → accounts.id` dengan **ON DELETE SET NULL**
  - identitas login tidak dihapus otomatis jika akun bisnis dihapus
- `auth_users.email` unik
- `auth_users.platform_account_id` unik

### 7.3 Sesi dan kredential

- `auth_sessions.user_id → auth_users.id` ON DELETE CASCADE
- `auth_accounts.user_id → auth_users.id` ON DELETE CASCADE
- `auth_sessions.token` unik
- `auth_accounts(provider_id, account_id)` unik

### 7.4 Keanggotaan staf dan RBAC dua scope

- `tenant_users.user_id → auth_users.id` ON DELETE CASCADE
- `tenant_users.tenant_id → tenants.id` ON DELETE CASCADE
- `tenant_users.user_id` adalah primary key → satu identitas, maksimal satu keanggotaan tenant

Untuk RBAC:

- `roles` punya CHECK:
  - `(scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL)`
- `platform_role_assignments` memiliki:
  - CHECK `scope = 'platform'`
  - FK komposit `(role_id, scope) → roles(id, scope)`
- `tenant_role_assignments` memiliki:
  - FK komposit `(user_id, tenant_id) → tenant_users(user_id, tenant_id)`
  - FK komposit `(role_id, tenant_id) → roles(id, tenant_id)`

Unique/index penting:

- `roles_platform_code_unique` (partial)
- `roles_tenant_code_unique` (partial)
- `roles_id_scope_unique`
- `roles_id_tenant_unique`
- `permissions_code_unique`
- `permissions_scope_resource_action_unique`
- `role_permission_unique`
- `platform_role_assignment_unique`
- `tenant_role_assignment_unique`
- `tenant_users_user_tenant_unique`
- `tenants_account_id_unique`
- `tenants_slug_unique`
- `installations_tenant_id_unique`
- `auth_users_email_unique`
- `auth_users_platform_account_id_unique`
- `auth_sessions_token_unique`
- `auth_accounts_provider_account_unique`

---

## 8. Penanganan kegagalan dan request berulang (yang bisa dan tidak bisa dijamin schema)

### 8.1 Yang dijamin oleh database

- **Duplikasi terhalang**:
  - email, slug, account_id, tenant_id, provider+account_id, token, clerk-like pair tidak bisa diulang tanpa error unique violation
- **Konsistensi referensi**:
  - penghapusan berantai dikendalikan lewat CASCADE/RESTRICT/SET NULL
- **Invariant scope**:
  - role platform dan role tenant tidak bisa tertukar lewat FK komposit dan CHECK

### 8.2 Yang tetap menjadi tanggung jawab aplikasi

- **Retry HTTP / race condition** saat registrasi tetap perlu penanganan di lapisan aplikasi
- **Idempotency** sebaiknya dibangun dengan logika aplikasi, misalnya:
  - kunci business yang providinya sudah ada di schema,
  - atau langkah-langkah transaksional di server
- **Pencegahan spam/registrasi berulang** membutuhkan rate limit, validasi, atau mekanisme aplikasi lain, bukan hanya constraint DB

Jadi, schema memberikan fondasi konsistensi dan keamanan, tetapi tidak menggantikan pengendalian alur berulang di aplikasi.

---

## 9. SQL migrasi

SQL migrasi sudah dihasilkan dan isinya relevan untuk review. Secara garis besar:

- DDL enum
- DDL tabel
- DDL foreign key
- DDL index dan unique index

SQL ini **belum dijalankan** ke database apa pun.

Jika Anda ingin, saya bisa mempublikasikan SQL utuh dalam bentuk terstruktur, misalnya:
- per tabel,
- per FK,
- per index,
- atau kutipan pelan yang menonjol untuk review.

---

## 10. Status pekerjaan dan batasan

### 10.1 Yang sudah selesai

- Package auth terpasang dan versinya diketahui
- Tabel auth_* diverifikasi terhadap package terpasang
- `src/auth.ts` dibuat dan lolos lint/typecheck/build
- `drizzle-kit generate` berhasil
- SQL migrasi tersedia untuk review

### 10.2 Yang sengaja tidak dilakukan

- Tidak ada `db:push`
- Tidak ada `db:migrate`
- Tidak ada koneksi ke Production
- Tidak ada commit untuk schema, auth, atau migrasi sebelum SQL disetujui

### 10.3 Batasan yang perlu diperhatikan

- Migrasi hanya di-_generate_ dari schema TypeScript; validasi SQL nyata terhadap database belum dilakukan
- Nama tabel auth hanya akan benar jika konfigurasi `modelName` dan mapping drizzle adapter dikunci seperti ini; jika ada perubahan nama tabel di schema, konfigurasi auth harus disinkronkan kembali
- Jika sebelumnya pernah ada tabel dengan nama lama, pembersihan tabel lama perlu ditangani saat migrasi pertama

---

## 11. File yang berubah / ditambah

Secara garis besar, perubahan yang muncul sejak review schema sebelumnya mencakup:

- `package.json` → ditambah dependensi auth
- `package-lock.json` → ter-update
- `src/auth.ts` → file baru
- `src/db/schema.ts` → sudah ada dari review sebelumnya
- `drizzle/0000_quiet_dragon_lord.sql` → migrasi hasil generate
- `drizzle/meta/_journal.json`
- `drizzle/meta/0000_snapshot.json`

File `laporan-review-auth.md` ini dibuat sebagai lanjutan dari [laporan-review-schema.md](laporan-review-schema.md).

---

## 12. Rekomendasi langkah berikutnya

1. **Review SQL migrasi** lebih detail, terutama:
   - urutan DDL enum dan tabel,
   - constraint FK dan CHECK,
   - apakah ada indeks yang perlu disesuaikan
2. Jika SQL disetujui, lanjut ke:
   - generate/push di database development (bukan Production),
   - pembersihan tabel lama bila ada,
   - pengujian integrasi koneksi dengan database development
3. Siapkan langkah aplikasi untuk:
   - verifikasi runtime schema Better Auth,
   - seed role/permission per scope,
   - alur registrasi yang idempotent dan aman

---

## 13. Ringkasan akhir

Implementasi auth dan migrasi sudah sampai pada tahap **generate + validasi proyek**. Semua pengecekan proyek utama lolos, package cocok dengan stack yang ada, dan SQL migrasi sudah dihasilkan. Masih perlu review SQL dan persetujuan sebelum migrasi atau commit dilakukan.
