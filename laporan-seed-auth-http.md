# Laporan Seed RBAC + Route Handler Better Auth + Uji HTTP
travel-umroh · branch `development` · Neon project `rough-brook-30059963` · 14 Oktober 2026

Target database seluruh operasi: **Neon Development**. Sebelum seed, endpoint `DATABASE_URL`
(`ep-dark-meadow-b3ch5el3-pooler`) diverifikasi kembali sebagai endpoint branch development
(`br-shy-tree-b35ibs8d`, database `travel_umroh_db`) dan `DIRECT_URL` menunjuk endpoint yang sama.
Production tidak disentuh. Tidak ada commit/push, tidak ada `db:generate`/`db:push`/migrasi baru,
tidak ada perubahan schema — seed berjalan hanya dengan INSERT.

---

## 1. Review seed sebelum eksekusi

File: [scripts/seed-rbac.ts](scripts/seed-rbac.ts)

- **Tidak ada pemberian role platform ke pendaftar publik**: tidak ada statement INSERT ke
  `platform_role_assignments` sama sekali; seed hanya mengisi katalog `permissions`,
  role platform (3), dan pemetaan `role_permissions`.
- **Idempotensi**: `ON CONFLICT DO NOTHING` + fallback SELECT pada tiga tabel
  (`permissions_code_unique`, `roles_platform_code_unique`, `role_permission_unique`);
  fallback SELECT menangani balapan race writer; data existing tidak pernah diubah/dihapus.
- **Perluasan tanpa perubahan schema**: menambah izin/role baru cukup menaikkan array
  `PERMISSIONS`/`PLATFORM_ROLES` — inilah dampak tepatnya seed ke 3 tabel tsb, dan tidak
  menyentuh tabel lain.
- Tidak ditemukan masalah; tidak ada perubahan schema — tidak perlu persetujuan khusus.

## 2. Eksekusi seed (Neon Development)

Perintah: `npx -y tsx scripts/seed-rbac.ts`

- Jalankan 1: exit 0 — "seed selesai idempoten: 25 objek baru"
  (22 permission + 3 role; pemetaan role_permissions ikut dibuat).
- Jalankan 2 (bukti idempoten): exit 0 — "0 objek baru, sisanya dipertahankan".
- Role tercetak dengan izin: superadmin=8, support=5, operator=4.

## 3. Verifikasi hasil (query read-only)

- `permissions`: **platform=8, tenant=14** (total 22)
- `roles` scope platform (semua `is_system=true`):
  `platform.superadmin` → 8 izin; `platform.support` → 5 izin; `platform.operator` → 4 izin
- **Pemetaan `role_permissions` (17 pasangan, terbaca lengkap):
  - superadmin: `tenant.create/read/update/suspend`, `installation.create/read/update`, `platform.role.assign`
  - support: `tenant.read/update`, `installation.create/read/update`
  - operator: `tenant.create/read`, `installation.create/read`
- `platform_role_assignments` = **0** (tidak ada penugasan otomatis) ✔
- `roles` scope tenant = **0** (role tenant akan dibuat provisioning) ✔

## 4. Route handler + baseURL per environment

Perubahan file:
- **Baru**: [src/app/api/auth/\[...all\]/route.ts](src/app/api/auth/[...all]/route.ts) —
  `toNextJsHandler(auth.handler)` dari `better-auth/next-js` (subpath diverifikasi ada di
  `better-auth@1.7.7`).
- **Diubah**: [src/auth.ts](src/auth.ts) — `baseURL = process.env.BETTER_AUTH_URL ??
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"` dengan komentar per environment
  (lokal via `.env.local`, deploy mengeset `BETTER_AUTH_URL`). **Tidak ada secret yang
  ditampilkan/tersimpan di repo**; secret dev server dibuat acak per proses dan tidak dicetak.

Cek: `npm run typecheck` exit 0.

## 5. Uji endpoint melalui HTTP

`next dev --port 3000` dijalankan background (env secret dibuat acak, tidak dicetak), probe
`GET /api/auth/ok` → 200. Lalu alur HTTP via curl + cookie jar:

| # | Uji | Hasil |
| --- | --- | --- |
| 1 | `POST /api/auth/sign-up/email` | **200** |
| 2 | `POST /api/auth/sign-in/email` password salah | **401** |
| 3 | `POST /api/auth/sign-in/email` password benar | **200** |
| 4 | `GET /api/auth/get-session` (cookie) | **user + session valid** |
| 5 | `POST /api/auth/sign-out` tanpa header Origin | **403** `MISSING_OR_NULL_ORIGIN` (proteksi CSRF berfungsi) |
| 5b | `POST /api/auth/sign-out` + `Origin` cocok + JSON | **200** |
| 6 | `GET /api/auth/get-session` setelah logout | **200** dengan body `null` (session habis) |
| 7 | `POST /api/auth/sign-up/email` email duplikat | **422** |

Catatan perilaku (bukan bug): POST mutasi Better Auth mensyaratkan header `Origin` non-null
(protfense CSRF); frontend browser mengirim Origin otomatis, hanya curl yang perlu eksplisit.
Selama uji, tak ada secret/token/cookie yang dicetak ke log.

Konflik port: server dev pertama menyeleksi port 54100 secara sendiri (Next otomatis) sehingga
`BETTER_AUTH_URL` tak cocok — ditemukan lewat log "⨯ Another next dev server is already
running", proses lama dimatikan spesifik (taskkill PID listener), lalu diulang dengan
`--port 3000` agar baseURL konsisten. Setelah pengujian, dev server dimatikan (port 3000 bebas).

## 6. Pembersihan data uji

Semua akun uji `http-…@example.test` dari pengujian HTTP dihapus dari
`auth_sessions`, `auth_accounts`, `auth_users` — sisa data uji = **0**.

## 7. Provisioning

**Tetap tidak diimplementasikan** sesuai instruksi — rancangan transaksinya masih berupa
usulan di [laporan-review-auth-rbac.md](laporan-review-auth-rbac.md) (Tahap 4) dan menunggu
review rancangan sebelum implementasi.

## 8. Sisa masalah / catatan lanjutan

1. `next dev` memilih port dinamis bila 3000 ditempati — untuk dev yang stabil, jalankan selalu
   dengan `npm run dev -- --port 3000` dan set `BETTER_AUTH_URL=http://localhost:3000` di `.env.local`.
2. `BETTER_AUTH_SECRET` belum ada di `.env.local` — produksi menolak berjalan tanpa secret kuat;
   diset lewat lingkungan deployment, bukan repo.
3. Pendaftaran HTTP masih berdiri sendiri: provisioning tenant otomatis belum ada, sehingga
   user baru belum punya role tenant — sesuai ekspektasi mengingat provisioning belum
   diimplementasikan.
