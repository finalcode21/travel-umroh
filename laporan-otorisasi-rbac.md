# Laporan Verifikasi RBAC & Kepemilikan Resource — travel-umroh

| Item | Keterangan |
| --- | --- |
| Tanggal | 15 Oktober 2026 |
| Branch | `development` |
| Status akhir | **LULUS** (RBAC & isolasi lintas tenant pada endpoint bisnis; operasi tulis tidak diuji — tidak ada endpoint write yang sesuai) |
| Target database | Neon Development (`travel_umroh_db`, `NEON_BRANCH=development`) |
| Production disentuh | Tidak (juga tanpa `db:push` / migrasi baru) |
| Laporan terkait | [`laporan-otorisasi-tenant.md`](laporan-otorisasi-tenant.md) |

---

## A. Ringkasan

Celah AUTH-08 dari laporan sebelumnya kini tertutup: dilindungi endpoint bisnis `GET /api/tenant/installation` yang mewajibkan **session valid + keanggotaan tenant aktif + permission RBAC tenant `installation.own.read`**, dan semua query resource dibatasi oleh tenant yang sudah diverifikasi server. Pengujian integrasi HTTP dengan session nyata (`npx tsx scripts/rbac-resource-test.ts`) lulus penuh: **10/10 skenario PASS + bukti dampak DB**, exit code 0 terverifikasi dari proses.

---

## B. Implementasi

### B.1 Endpoint bisnis baru

File: [`src/app/api/tenant/installation/route.ts`](src/app/api/tenant/installation/route.ts)

- Metode: `GET`; path: `/api/tenant/installation`
- Parameter: `tenantId` (wajib, query); `installationId` (opsional, query)
- Permission diwajibkan: `installation.own.read` (scope tenant) — izin yang benar-benar ada pada katalog dan dipetakan provisioning ke role `tenant.admin`
- Alur pemeriksaan server:
  1. `getTenantAuthContext(request, tenantId)` — session via `auth.api.getSession`, keanggotaan aktif via `tenant_users` (status `active`), tanpa mempercayai `tenantId` client sebagai kebenaran.
  2. `hasPermission(userId, "installation.own.read", "tenant", tenantId)` — penolakan `403 {error:"forbidden"}` tanpa membocorkan detail.
  3. Query `installations` **selalu** dengan `WHERE tenant_id = tenant terverifikasi`; `installationId` hanya menyaring dalam rentang tenant tersebut — client tidak pernah menjadi sumber kepemilikan.
- Kebijakan status: `400` parameter kosong · `401` tanpa session · `404` tenant tak dikenal / bukan anggota / `installationId` bukan milik tenant terverifikasi (keberadaan disembunyikan) · `403` anggota aktif tanpa izin · `200` konteks instalasi milik tenant terverifikasi.
- Tidak ada operasi tulis; response hanya `installation {id, name, status}` + `tenantId`.

### B.2 Kenapa model ini benar-benar tersedia

- Tabel `installations` adalah tabel bisnis aktual ([`src/db/schema.ts`](src/db/schema.ts), unik per `tenant_id`), bukan tabel yang dikarang.
- Kode permission `installation.own.read` (scope tenant) ada di katalog `permissions` dan dipetakan ke role `tenant.admin` oleh `ADMIN_CODES` di [`src/lib/provisioning.ts`](src/lib/provisioning.ts); `STAFF_CODES` tidak memuatnya — perbedaan ini dipakai untuk menguji penolakan permission secara nyata.
- Tidak ada skema baru, migrasi, maupun perubahan `src/lib/provisioning.ts`.

---

## C. Daftar file yang berubah

| File | Perubahan | Alasan |
| --- | --- | --- |
| `src/app/api/tenant/installation/route.ts` | File baru. | Endpoint bisnis terlindungi RBAC untuk menutup celah AUTH-08 dan kepemilikan resource lintas tenant. |
| `scripts/rbac-resource-test.ts` | File baru. | Pengujian integrasi HTTP dengan session sungguhan, termasuk pre-kondisi permission di DB, verifikasi isi respons terhadap DB, dan bukti data tidak berubah. |

File dari tahap sebelumnya (`src/lib/authz.ts`, `src/app/api/tenant/context/route.ts`, `scripts/tenant-auth-test.ts`, `laporan-otorisasi-tenant.md`) tidak diubah.

---

## D. Matriks pengujian HTTP

Hasil aktual `npx tsx scripts/rbac-resource-test.ts` (`REAL_EXIT=0`, `=== SEMUA TES LULUS ===`):

| ID | Skenario | Hasil HTTP aktual | Status |
| --- | --- | --- | --- |
| RBAC-01 | Request tanpa session | 401 | LULUS |
| RBAC-02 | Cookie session palsu | 401 | LULUS |
| RBAC-03 | Admin A membaca instalasi Tenant A | 200; `installation.{id,name,status}` = baris DB; `tenantId` = tenant terverifikasi | LULUS |
| RBAC-04 | `installationId` milik Tenant B + `tenantId` Tenant A | 404 (resource lintas tenant disembunyikan) | LULUS |
| RBAC-05 | Admin A meminta tenant Tenant B | 404 | LULUS |
| RBAC-06 | `tenantId` tidak dikenal (manipulasi) | 404 | LULUS |
| RBAC-07 | Staf Tenant B (anggota aktif, tanpa izin baca instalasi) | 403 `{"error":"forbidden"}` | LULUS |
| RBAC-08 | Anggota Tenant A tanpa role (nol izin) | 403 | LULUS |
| RBAC-09 | Staf B memanipulasi `tenantId` ke Tenant A | 404 | LULUS |
| RBAC-10 | Request sah (`installationId` + `tenantId` milik A) setelah rangkaian penolakan | 200, isi = DB | LULUS |

**Bukti dampak database (`DB-IMPAK`):** baris instalasi Tenant A dibaca dari DB sebelum dan sesudah seluruh rangkaian tes — `id`, `name`, `status` identik. Membuktikan semua request yang ditolak (401/403/404) tidak mengubah data; endpoint ini read-only, dan identitas pre-kondisi diverifikasi langsung lewat `hasPermission` di setup (admin punya izin, staf tidak) — kegagalan pre-kondisi menghentikan tes sejak awal.

---

## E. Hasil regresi (exit code asli dari proses)

1. `npm run typecheck` → exit 0
2. `npm run lint` → 0 error, 51 warning (no-console/no-unused, hanya pada script `scripts/`)
3. `npx tsx scripts/rbac-resource-test.ts` → exit 0, SEMUA TES LULUS (10 skenario + DB-IMPAK)
4. `npx tsx scripts/auth-smoke.ts` → exit 0, SEMUA TES LULUS
5. `npx tsx scripts/provision-smoke.ts` → exit 0, SEMUA TES LULUS (termasuk "RBAC & isolasi antartenant")

Perbaikan bug selama pengujian (semuanya di script tes, bukan pelemahan assertion): `moveUserToTenant` sempat memakai `auth_users.platform_account_id` sebagai tenantId — kolom itu ternyata menyimpan `accounts.id`, sehingga insert `tenant_users` kena duplicate PK (`tenant_users_pkey`); diperbaiki dengan menerima `ownTenantId` hasil provisioning secara eksplisit. Satu assertion RBAC-03 dikoreksi ke bentuk respons yang benar (`tenantId` di top-level), tetap ketat.

---

## F. Keamanan dan batasan

- Target terverifikasi Neon Development; tidak ada koneksi Production, `db:push`, atau migrasi; tidak ada commit/push; tidak ada secret/cookie/token yang tercetak.
- Router memakai helper terpusat; tidak ada duplikasi logika auth.
- **Belum terverifikasi:** operasi tulis (write-path) dengan permission tenant — katalog izin tenant tidak memiliki izin update instalasi dan tidak ada tabel bisnis write yang cocok saat ini; sesuai batasan tugas, tidak dibuat skema/migrasi baru semata untuk tes. Diuji menyeluruh di sisi read + isolasi + penolakan.
- Verifikasi izin `installation.own.read` untuk role `tenant.admin` bergantung pada mapping `ADMIN_CODES` provisioning yang juga dipakai smoke provisioning — perubahan mapping di masa depan harus diikuti pengujian ini.

---

## G. Git dan secret

- Working tree (tidak di-commit, sesuai batasan): file baru `src/app/api/tenant/installation/route.ts`, `scripts/rbac-resource-test.ts`, `laporan-otorisasi-rbac.md`, berdampingan dengan perubahan tahap sebelumnya.
- `git status` memuat **tidak** ada `.env.local`, file secret, atau nilai koneksi; `git diff` hanya berisi kode laporan/tes/endpoint di atas.
- Tidak ada push, deployment, atau perubahan konfigurasi hosting.

---

## H. Tindak lanjut yang benar-benar diperlukan

1. Saat fitur write dibutuhkan (mis. paket/reservasi), tambahkan izin tenant yang tepat ke katalog + endpoint, lalu perluas test ini untuk write-path (termasuk verifikasi data tidak berubah saat ditolak).
2. Tambahkan endpoint daftar resource milik tenant (mis. daftar paket) menggunakan pola yang sama bila kebutuhan bisnis muncul.
3. Tidak ada pekerjaan otorisasi lain yang memblokir; jangan menyatakan siap produksi sampai write-path dan smoke lintas-browser diuji di lingkungan staging.
