# Laporan Review SQL — Auth — RBAC
travel-umroh · branch `development` · Neon project `rough-brook-30059963` · 14 Oktober 2026

Target database semua pengujian: **Neon Development** (`br-shy-tree-b35ibs8d`, `travel_umroh_db`) via `DATABASE_URL`/`DIRECT_URL` di `.env.local`. Production tidak diakses. Tidak ada commit/push.

---

# Tahap 1 — Review diff SQL migrasi

Skema SQL maupun `src/db/schema.ts` masih **untracked** di Git (belum pernah dicommit), jadi `git diff` tidak memuat isinya; review dilakukan dengan memeriksa isi `[drizzle/0000_quiet_dragon_lord.sql](drizzle/0000_quiet_dragon_lord.sql)` langsung:

- Perubahan yang tersisa dari perbaikan migrasi DULU: **4 statement `CREATE UNIQUE INDEX` dipindahkan** (`roles_id_scope_unique`, `roles_id_tenant_unique`, `permissions_id_scope_unique`, `tenant_users_user_tenant_unique`) ke baris 163–166, tepat sebelum blok `ALTER TABLE ... FOREIGN KEY` (tidak ada titik koma ulang). Setiap nama muncul tepat satu kali; tidak ada duplikat; isi statement tidak diubah. Total statement-breakpoint = 73 (naik 1 karena penanda komentar `--> statement-breakpoint` tambahan yang tidak berdampak SQL).
- `drizzle-kit check` sudah lulus setelah perbaikan; state DB development cocok dengan laporan migrasi (6 enum/14 tabel/14 FK/2 CHECK/52 index).
- Struktur DB-level juga terlihat di [scripts/auth-smoke.ts](scripts/auth-smoke.ts) saat akses `auth_users`/`auth_sessions`/`auth_accounts`.

**Kesimpulan**: perubahan SQL hanya mengatur urutan unique index sebelum FK — tidak ada perubahan schema.

Perubahan lain yang ikut ter-record di working tree (sebelumnya sudah perlu di-review):
- [drizzle.config.ts](drizzle.config.ts): wajibkan `DIRECT_URL` (tanpa fallback) — meningkat tegas target migrasi.
- [package.json](package.json): menambah `better-auth@^1.7.7` dan `@better-auth/drizzle-adapter@^1.7.7` (terverifikasi di node_modules).

---

# Tahap 2 — Review & uji Better Auth

## 2.1 Cakupan review statis
- [src/auth.ts](src/auth.ts): mapping model Better Auth 1.7.7 ke tabel kustom `auth_users`/`auth_sessions`/`auth_accounts`/`auth_verifications` + additionalFields `phone` & `platformAccountId`.
- [src/db/schema.ts](src/db/schema.ts) untuk tabel `auth_*`: kolom inti, unique index, dan FK sesuai kontrak inti Better Auth yang dijelaskan di komentar header.
- **Route handler**: belum ada file `src/**/route.ts` — `src/auth.ts` belum terpasang ke jalur HTTP apapun. Pengujian di 2.2 memakai API object `auth` langsung (jalur yang dipakai server).
- Konfigurasi session (burst dari smoke test).

## 2.2 Temuan & perbaikan yang SUDAH diterapkan
1. **Pemetaan key drizzleAdapter salah** — memicu `Drizzle schema mismatch: Missing tables auth_users, …` (validasi runtime adapter 1.7.7 membandingkan `modelName` dengan kunci schema; key model sebelumnya juga dipakai untuk lookup tabel di jalur query, jadi kuncinya harus mencerminkan nama fisik). **Fix**: key pada `drizzleAdapter.schema` diganti ke nama fisik (`auth_users: authUsers, …`) di [src/auth.ts](src/auth.ts).
2. **Email & password login belum diaktifkan** — `signUpEmail` menolak dengan "Email and password sign up is not enabled". **Fix** di [src/auth.ts](src/auth.ts): `emailAndPassword: { enabled: true }`.
3. **BaseURL belum diset** — Better Auth memperingatkan kehabisan `baseURL`/`BETTER_AUTH_URL`. Belum diubah di kode (menunggu keputusan URL publik produksi); untuk pengujian non-HTTP tidak berdampak. Terdaftar sebagai tema selanjutnya ketika route handler dibuat.

## 2.3 Hasil smoke test (Neon Development)
Skrip: [scripts/auth-smoke.ts](scripts/auth-smoke.ts) (`npx -y tsx scripts/auth-smoke.ts`, data uji dengan akhiran acak `umroh-smoke-<ts>@example.test`). **8/8 tes LULUS (exit 0)**:

1. `signUpEmail` membuat akun uji
2. Credential tersimpan: `auth_users` + `auth_accounts` (provider `credential`, password ter-hash)
3. Registrasi duplikat ditolak
4. `signInEmail` password salah ditolak
5. `signInEmail` password benar memberi cookie session
6. `getSession` mengenali session aktif
7. `getSession` tanpa cookie → null
8. `signOut` mematikan session + data uji dibersihkan penuh

Output tidak pernah menampilkan password, token, cookie, atau connection string. `npm run typecheck` exit 0; `npm run lint` exit 0 (3 warning no-console di skrip CLI — wajar untuk skrip uji).

---

# Tahap 3 — Rancangan RBAC & seed (DIBUAT, BELUM DIJALANKAN)

## 3.1 Rancangan
- **Katalog `permissions`** (22 izin awal; `scope` diwariskan kembali di baris tabel):
  - platform: `tenant.create/read/update/suspend`, `installation.create/read/update`, `platform.role.assign`
  - tenant: `package.create/read/update`, `jamaah.create/read/update`, `reservation.create/read/cancel`, `payment.create/read`, `staff.read`, `tenant-role.assign`, `installation.own.read`
- **Role platform** (`scope='platform'`, `tenant_id NULL`, `is_system=true`):
  - `platform.superadmin` — seluruh izin platform di atas
  - `platform.support` — `tenant.read/update`, `installation.read/update/create`
  - `platform.operator` — `tenant.create/read`, `installation.create/read`
- **Role tenant** (dibuat saat provisioning): `tenant.admin`, `tenant.staff` — dibuat per-tenant oleh provisioning (bukan oleh seed global) karena `roles.tenant_id` wajib terisi. Template perannya:
  - `tenant.admin` — seluruh izin scope tenant di atas (termasuk `tenant-role.assign`, `staff.read`)
  - `tenant.staff` — subset operasional (jamaah, reservasi, pembayaran, package.read, installation.own.read)
- Baris `role_permissions` selalu menyenetaskan `scope` yang sama dengan role dan permission-nya (sudah dipaksa oleh FK komposit di level DB).
- Tidak ada jalur seed yang menautkan role platform ke sesi registrasi publik.

## 3.2 Implementasi seed
**File**: [scripts/seed-rbac.ts](scripts/seed-rbac.ts) — **dibuat, lulus typecheck, TIDAK dijalankan** sesuai instruksi "jangan sebelum review dampak".

Sifat idempoten:
- Permission: `onConflictDoNothing()` di `permissions_code_unique` + fallback SELECT (aman balapan).
- Role platform: `onConflictDoNothing()` di `roles_platform_code_unique`.
- `role_permissions`: `onConflictDoNothing()` di `role_permission_unique`.
- Tidak pernah menghapus/mengubah data; tidak membuat `platform_role_assignments`.

Dampak bila dijalankan: menambah baris di `permissions`, `roles`, `role_permissions` saja. Benar-benar rendah risiko dan dapat diulang.

---

# Tahap 4 — Usulan desain Provisioning (BELUM diimplementasikan)

Rute: `POST /api/auth/sign-up` (atau Server Action) yang memanggil `auth.api.signUpEmail`, lalu transaksi database:

1. `BEGIN` (read committed cukup; idempotensi dirangai unique constraint, bukan jebakan lock).
2. **`accounts`**: INSERT … `ON CONFLICT (email) DO NOTHING` + re-SELECT; jika baris sudah ada milik registrasi lain → HTTP 409. Retry-safe.
3. **`tenants`**: pilih slug unik (dibersihkan dari nama bisnis + deterministik antiredup); INSERT → `ON CONFLICT (slug) DO NOTHING` lalu re-SELECT; tambah suffix bila tetap berbentuk milik bisnis lain, atau 409. Idempotensi tenant menjamin slug unique.
4. **`auth_users.platform_account_id`** (unique): UPDATE hanya bila NULL saat ini; bila sudah tertaut ke akun lain → 409 „user sudah diprovision".
5. **`tenant_users`**: per-PK `user_id`: INSERT `ON CONFLICT DO NOTHING`; bila sudah tergabung tenant lain → 409 (memenuhi "identitas staf terikat tepat satu tenant").
6. **Role tenant**: buat `tenant.admin` & `tenant.staff` (`scope='tenant'`, `tenant_id=<id baru>`, `is_system=true`) + `role_permissions` tenant sesuai template hasil seed katalog (idempoten per pasangan).
7. **`tenant_role_assignments`**: pasang admin (`ON CONFLICT (user_id, role_id) DO NOTHING`); FK komposit menjamin user dan role benar-benar milik tenant yang sama.
8. **`installations`** (unique `tenant_id`, default `status='pending'`) + `audit_logs` (actor platform/registration, jenis create-installation).
9. **`COMMIT**` lalu kirim email notifikasi ke email akun bisnis (bukan email staf) — aturannya **sesudah commit**, dengan strategi at-least-once (bisa dikirim ulang dengan aman karena hanya berisi salinan ringkasan, bukan keputusan state).

Kenapa ini aman terhadap retry & concurrent:
- Setiap langkah memakai unique constraint sebagai jangkar idempotensi: request paralel yang kalah gagal bersih di langkah pertama yang diulang, dan retry selalu melihat state yang telah tersimpan.
- Tidak ada lock eksplisit; deadlock minim karena insert melalui satu jalur fungsional dengan urutan FK konsisten.
- Semua langkah di **satu transaksi**: tidak ada tenant tanpa installations, tidak ada tenant tanpa admin, tidak ada auth_users dengan platformAccountId menggantung.

---

# Status kerja: SELESAI vs USULAN

| Item | Status |
| --- | --- |
| Review git diff/status & SQL migrasi | ✅ SELESAI (perubahan hanya reorder unique index) |
| Review src/auth.ts, schema auth_* , konfigurasi session | ✅ SELESAI |
| Perbaikan pemetaan drizzleAdapter + emailAndPassword | ✅ SELESAI |
| Typecheck & lint | ✅ exit 0 |
| Smoke test auth (registrasi/login/session/logout, negatif, cleanup) | ✅ 8/8 LULUS di Neon Development |
| Rancangan RBAC + file seed idempotent | ✅ DIBUAT; ⛔ **belum dijalankan** (menunggu review dampak) |
| Route handler & konfigurasi baseURL produksi | ⏳ BELUM (tidak ada `route.ts` terpasang) |
| Desain provisioning akun→tenant→installation | 🟡 USULAN (implementasi belum) |
| Commit/push | Tidak dilakukan (instruksi) |

# Rekomendasi berikutnya

1. Jalankan `npx tsx scripts/seed-rbac.ts` setelah seed di-review (output hanya menambah baris, idempotent).
2. Buat route handler `src/app/api/auth/[...all]/route.ts` yang mengekspos handler Better Auth + set `baseURL` dari `BETTER_AUTH_URL` saat deploy.
3. Implementasi provisioning per desain Tahap 4, menjaga dua jalur tetap terpisah: provisioning registrasi dan pemberian role platform — jangan sekali-kali memberikan role platform kepada pelanggan yang mendaftar.
4. Set `BETTER_AUTH_SECRET` di `.env.local` sebelum pengujian lanjutan/produksi; jangan disimpan di Git.
