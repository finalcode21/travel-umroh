# Laporan Otorisasi Tenant — travel-umroh

| Item | Keterangan |
| --- | --- |
| Tanggal | 15 Oktober 2026 |
| Branch | `development` |
| Status akhir | LULUS SEBAGIAN (AUTH-08 belum terverifikasi) |
| Target database | Neon Development (`travel_umroh_db`, branch `development`) |
| Production disentuh | Tidak |

---

## A. Ringkasan

Helper otorisasi terpusat di `src/lib/authz.ts` dipakai oleh endpoint `GET /api/tenant/context`. Pengujian integrasi HTTP (`npx tsx scripts/tenant-auth-test.ts`) dijalankan sampai selesai pada 15 Oktober 2026: **9 dari 10 skenario LULUS** (AUTH-01 s.d. AUTH-07, AUTH-09, AUTH-10), meliputi bukti bahwa pengguna Tenant A tidak dapat mengakses konteks Tenant B (404) dan request sah tetap berfungsi setelah penolakan.

Skenario AUTH-08 (permission lebih tinggi) tetap **BELUM DIVERIFIKASI** karena endpoint yang diuji hanya memeriksa keanggotaan, bukan permission RBAC; tidak dibuat operasi tulis semata untuk tes.

Smoke test yang sudah ada tetap lolos:
- `npx tsx scripts/auth-smoke.ts` → semua tes lulus
- `npx tsx scripts/provision-smoke.ts` → semua tes lulus

Typecheck dan lint lolos (lint: 0 error, 36 warning no-console/no-unused pada script tes).

---

## B. Implementasi

### B.1 Helper otorisasi

File: [`src/lib/authz.ts`](src/lib/authz.ts)

Yang ada atau disiapkan:
- `getSessionFromRequest(request)` — ambil session Better Auth lewat `auth.api.getSession`, ekstrak `session` dan `userId`.
- `checkTenantMembership(session, tenantId)` — cek baris `tenant_users` dengan `userId` + `tenantId` yang cocok, hanya terima status `active`.
- `getTenantAuthContext(request, requireTenantId?)` — gabungkan autentikasi + keanggotaan; mengembalikan konteks terverifikasi atau `problem`.
- `requirePermission(userId, code, scope, tenantId?)` — cek izin RBAC.
- `authProblemToResponse(problem, hideResource?)` — terjemahkan ke status HTTP 401/403/404.
- Tipe `TenantAuthContext`, `TenantMembershipResult`, `AuthProblem`, `GetSessionResult`.

Kebijakan:
- Tidak mempercayai `tenantId` dari client sebagai bukti akses.
- Keanggotaan harus ada di `tenant_users` dan statusnya `active`.
- Status HTTP: 401 untuk tidak ada session, 403 untuk tidak ada keanggotaan/izin, 404 opsional untuk menyembunyikan keberadaan tenant.

### B.2 Endpoint yang dilindungi

File: [`src/app/api/tenant/context/route.ts`](src/app/api/tenant/context/route.ts)

- Metode: `GET`
- Path: `/api/tenant/context`
- Wajib: query `tenantId`
- Periksa: session valid + keanggotaan aktif di `tenant_users`
- Return minimal: `userId`, `tenantId`, `tenantStatus`
- Tidak mengekspos secret, cookie, atau data jamaah
- Tidak ada operasi tulis

### B.3 Cara session, keanggotaan, permission diperiksa

1. Ambil session via `auth.api.getSession`.
2. Jika tidak ada session → 401.
3. Jika ada `tenantId` yang diminta, cek `tenant_users` → jika tidak ada atau tidak aktif → 404 (dengan `hideResource=true`).
4. Return konteks yang sudah diverifikasi.

---

## C. Daftar file yang berubah

| File | Perubahan | Alasan |
| --- | --- | --- |
| `src/lib/authz.ts` | Perbaikan helper: ekstraksi `userId` dari hasil `getSession`, alur `getTenantAuthContext` yang selalu mengembalikan tenant terverifikasi bila `requireTenantId` diberikan, hapus `requireNonNull` yang tak terpakai. | Helper otorisasi yang benar untuk dipakai route handler. |
| `src/app/api/tenant/context/route.ts` | File baru. | Endpoint terlindungi untuk verifikasi isolasi tenant. |
| `scripts/tenant-auth-test.ts` | Script tes integrasi HTTP: health-check server diperbaiki (polling `/`, bukan endpoint tak dikenal `/api/ok` yang selalu 404), log server di-pipe agar kegagalan startup terlihat, setup memindahkan user staf ke Tenant B (FK komposit `tenant_role_assignments_user_tenant_fkey` menuntut baris `tenant_users` di tenant yang sama), cleanup menambah penghapusan assignment/membership per `userId`, dan lifecycle proses diperbaiki: server dimatikan lewat `taskkill /T` (kill() hanya membunuh wrapper cmd di Windows) serta pool Neon ditutup, sehingga skrip berakhir dengan exit code yang benar (sebelumnya menggantung, exit 124). | Membuat pengujian reusable dan berjalan sampai selesai; perbaikan bug pada script tes, bukan pelemahan assertion — semua assertion status HTTP tetap ketat. |

---

## D. Matriks pengujian HTTP

Hasil aktual dari `npx tsx scripts/tenant-auth-test.ts` (15 Oktober 2026, bukti log PASS + status HTTP di log server Next.js):

| ID | Skenario | Hasil HTTP aktual | Status |
| --- | --- | --- | --- |
| AUTH-01 | Request tanpa session | 401 (`{"error":"unauthorized"}`) | LULUS |
| AUTH-02 | Cookie palsu (`badcookie=badvalue`) | 401 | LULUS |
| AUTH-03 | User A → konteks Tenant A | 200 + `userId` & `tenantId` cocok | LULUS |
| AUTH-04 | User A → konteks Tenant B | 404 (keberadaan tenant disembunyikan) | LULUS |
| AUTH-05 | User B → konteks Tenant B | 200 + `userId` & `tenantId` cocok | LULUS |
| AUTH-06 | Manipulasi `tenantId` (UUID tak dikenal) | 404 | LULUS |
| AUTH-07 | Session valid, bukan anggota tenant | 404 | LULUS |
| AUTH-08 | Operasi yang butuh permission lebih tinggi | Endpoint tidak memeriksa permission RBAC | BELUM DIVERIFIKASI |
| AUTH-09 | Cookie dimanipulasi (token session diganti) | 401 | LULUS |
| AUTH-10 | Request sah setelah penolakan lintas tenant | Tetap 200 + konteks benar | LULUS |

Bukti relevan: setiap baris PASS pada output script berpasangan dengan baris log akses server, mis. `GET /api/tenant/context?tenantId=<tenantB> 404` untuk AUTH-04 dan `GET /api/tenant/context?tenantId=<tenantA> 200` untuk AUTH-10 setelah penolakan. Skenario AUTH-03/AUTH-05 juga memverifikasi isi respons (`userId`, `tenantId`), bukan hanya status.

---

## E. Hasil regresi

Perintah yang dijalankan (exit code diverifikasi):

1. `npm run typecheck` → exit 0
2. `npm run lint` → 0 error, 35 warning (no-console/no-unused pada script tes saja)
3. `npx tsx scripts/tenant-auth-test.ts` → `=== SEMUA TES LULUS ===`; 9/10 skenario PASS, exit code 0 terverifikasi langsung dari proses (REAL_EXIT=0; run sebelumnya menggantung dengan exit 124 karena pool Neon dan child server tidak ditutup — diperbaiki)
4. `npx tsx scripts/auth-smoke.ts` → semua tes lulus
5. `npx tsx scripts/provision-smoke.ts` → semua tes lulus (termasuk "RBAC & isolasi antartenant")

Pemeriksaan konsistensi Drizzle tidak dijalankan karena tidak ada perubahan skema.

---

## F. Keamanan dan batasan

- Target yang diverifikasi: Neon Development (`travel_umroh_db`, branch `development`), dari `.env.local` (`NEON_BRANCH=development`).
- Production tidak disentuh; tidak ada `db:push`, `db:generate`, maupun migrasi baru.
- Tidak ada commit/push; tidak ada secret yang tercetak.
- AUTH-08 belum teruji: endpoint `/api/tenant/context` hanya memerlukan keanggotaan aktif, bukan permission RBAC tertentu.
- Data uji dibersihkan lewat cleanup per-user/per-tenant yang dibuat test; pengujian tidak menghapus data lain.

---

## G. Git dan secret

- `git status`: perubahan working tree pada `src/lib/authz.ts` dan `src/app/api/tenant/context/route.ts`, ditambah file script tes.
- `git diff`: berisi perubahan kode otorisasi dan route baru; tidak ada `.env.local`, tidak ada secret, tidak ada cookie/result test yang masuk ke diff.
- Tidak ada commit atau push.

---

## H. Tindak lanjut

1. Tambahkan endpoint bisnis yang memerlukan permission RBAC (mis. operasi tulis paket/reservasi) untuk menguji AUTH-08 secara nyata; helper `requirePermission` sudah tersedia di `src/lib/authz.ts`.
2. Saat endpoint bisnis ditambahkan, selipkan data resource di antara Tenant A dan B untuk uji verifikasi kepemilikan resource lintas tenant.
3. Jangan menyatakan siap produksi sampai AUTH-08 (permission RBAC) dan verifikasi resource-ownership teruji.
