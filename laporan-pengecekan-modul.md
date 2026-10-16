# Laporan Pengecekan & Verifikasi Proses — travel-umroh

| Item | Keterangan |
| --- | --- |
| Tanggal | 15 Oktober 2026 |
| Branch | `development` |
| Target database | Neon Development (`NEON_BRANCH=development`) |
| Production disentuh | Tidak |
| Commit / push | Tidak ada (sesuai batasan; seluruh perubahan masih di working tree) |
| Status akhir | **LULUS untuk semua modul** — modul jamaah kini 12/12 tes lulus (pembaruan 16 Okt 2026; lihat bagian X) |
| Menggantikan | Versi sebelumnya dari file ini (`laporan-pengecekan-modul.md`) yang masih menyebut typecheck gagal — klaim itu sudah tidak berlaku |

---

## X. Pembaruan 16 Oktober 2026 — modul jamaah kini LULUS

| Verifikasi | Hasil |
| --- | --- |
| `npx tsc --noEmit` | exit 0 (bersih) |
| `npx eslint .` | exit 0 (0 error, 71 warning — warning `no-console` di `scripts/`, non-blokir) |
| `npx next build` | exit 0 — 6 route, termasuk `/api/tenant/jamaah` dan `/api/tenant/jamaah/[id]` |
| `npx tsx scripts/jamaah-smoke.ts` | exit 0 — **12/12 skenario PASS, 0 blokir** |
| DB: tabel `pilgrims` | Ada di Neon Development (13 kolom) |
| DB: constraint | `pilgrims_tenant_registrant_unique` (UNIQUE tenant_id, registrant_no) + index `pilgrims_tenant_id_status_idx` terpasang |

Temuan lama kini tertutup:

| Temuan | Status |
| --- | --- |
| F-01 tabel `pilgrims` tidak ada | ✅ Tertutup — migrasi `drizzle/0002_add_pilgrims.sql` sudah diterapkan ke Neon Development |
| F-02 handler memakai `userId = ""` | ✅ Tertutup — keempat handler kini memanggil `getTenantAuthContext()` dan memakai `auth.context.userId` |
| F-03 kontrak status (401/400/404/409) | ✅ Tertutup — rute memakai `authProblemToResponse()`; kind baru `"validation" → 400` ditambahkan pada `AuthProblem` |
| F-04 cursor pagination | ⏳ Ditunda — sesuai `TODO(kursor)` di kode, menunggu pemeriksaan frontend |
| F-05 sinkronisasi schema/migrasi | ⏳ Terdokumentasi — enum/text masih perlu penyelarasan saat migrasi berikutnya |
| F-06 artefak sisa | ⏳ Sebagian — `provision-verify.ts.bak` masih ada |
| F-07 `BETTER_AUTH_SECRET` | ⏳ Belum di-set — wajib sebelum rilis |

Perubahan kode sesi ini:

1. [`src/app/api/tenant/jamaah/route.ts`](src/app/api/tenant/jamaah/route.ts) — ditulis ulang bersih; file sebelumnya rusak (fragmen GET/POST terduplikasi → `TS1128`) akibat percobaan edit yang gagal pada sesi sebelumnya.
2. [`src/lib/authz.ts`](src/lib/authz.ts) — kind `"validation"` ditambahkan ke `AuthProblem`, dipetakan ke `400 { error: "validation_failed", message }` di `authProblemToResponse()`; `createJamaah` kini memakai `kind: "validation"` untuk `registrantNo`/`fullName` kosong.

Hasil smoke JA-01 s.d. JA-12: semua PASS. Produksi tidak disentuh; tidak ada commit/push.

---

## A. Ringkasan

Pengecekan dilakukan terhadap seluruh proses yang sudah dibangun sampai sekarang: skema & migrasi, autentikasi Better Auth, provisioning tenant, katalog izin/RBAC, endpoint terlindungi yang sudah ada, dan modul jamaah yang baru ditambahkan (`src/lib/authz.ts` + dua route).

Hasil:

1. **Rantai lama utuh** — typecheck, lint, build, dan lima skrip verifikasi database (seed RBAC, auth smoke, tenant auth, RBAC resource, provision smoke) semuanya lulus dengan exit status 0.
2. **Satu error tipe nyata di modul jamaah diperbaiki** sesi ini (`getJamaahList`), sehingga `tsc --noEmit` kembali bersih.
3. **Modul jamaah belum bisa dipakai.** Dua blokir ditemukan:
   - tabel `pilgrims` **tidak ada** di database (migrasi belum diterapkan);
   - keempat handler jamaah memanggil lapisan otorisasi dengan `userId = ""`, bukan identitas dari sesi, sehingga **semua** permintaan — termasuk yang sah dan bahkan yang tanpa sesi — dijawab `403`.
4. Blokir tersebut **tidak terdeteksi** oleh pemeriksaan sebelumnya karena verifikasi lama hanya menyentuh endpoint `context` dan `installation`.

---

## B. Metode pemeriksaan (perintah dan exit status nyata)

| # | Perintah | Exit | Hasil |
| --- | --- | --- | --- |
| 1 | `npx tsc --noEmit` | 0 | Bersih setelah perbaikan blok `getJamaahList` (sebelumnya 1 error TS2345) |
| 2 | `npx eslint .` | 0 | 0 error, 70 warning (`no-console` / `no-unused-vars`, mayoritas di `scripts/`) |
| 3 | `npx next build` | 0 | Compiled successfully; keenam route terbentuk termasuk `/api/tenant/jamaah` dan `/api/tenant/jamaah/[id]` |
| 4 | `npx tsx scripts/seed-rbac.ts` | 0 | Idempoten: “0 objek baru, sisanya dipertahankan” |
| 5 | `npx tsx scripts/auth-smoke.ts` | 0 | `=== SEMUA TES LULUS ===` |
| 6 | `npx tsx scripts/tenant-auth-test.ts` | 0 | `=== SEMUA TES LULUS ===` |
| 7 | `npx tsx scripts/rbac-resource-test.ts` | 0 | `=== SEMUA TES LULUS ===` |
| 8 | `npx tsx scripts/provision-smoke.ts` | 0 | `=== SEMUA TES LULUS ===` |
| 9 | `npx tsx scripts/jamaah-smoke.ts` | 1 | **3 TES GAGAL, 8 BLOKIR** (probe baru; lihat bagian E) |
| 10 | Query `information_schema.tables` | 0 | 14 tabel ada; `pilgrims` **tidak ada** |

Exit status diambil dari proses asli (tanpa memfilter lewat pipeline yang menyembunyikan kegagalan). Seluruh akses database hanya ke Neon Development; Production tidak disentuh, tidak ada deploy, tidak ada commit/push.

---

## C. Perubahan yang dilakukan sesi ini

| File | Jenis | Alasan |
| --- | --- | --- |
| [`src/lib/authz.ts`](src/lib/authz.ts) | Perbaikan | Menutup error TS2345 di `getJamaahList` |
| [`scripts/jamaah-smoke.ts`](scripts/jamaah-smoke.ts) | File baru | Probe HTTP nyata untuk modul jamaah (menjadi gerbang penerimaan perbaikan) |
| `src/lib/authz-patch-getjamaahlist.js` | Dihapus | Skrip tambalan sekali pakai (artefak sesi sebelumnya) di dalam `src/`; satu-satunya penyebab error lint (`no-require-imports`) dan tidak direferensikan siapa pun |
| `laporan-pengecekan-modul.md` (file ini) | Ditulis ulang | Versi lama memuat klaim yang sudah tidak berlaku |

### C.1 Detail perbaikan `src/lib/authz.ts`

Sebelum (rusak — variabel `conditions` merujuk ke dirinya sendiri, dan `or(...)` yang bisa `undefined` dimasukkan ke array bertipe `SQL`):

```ts
const conditions = [eq(schema.pilgrims.tenantId, tenantId)];
if (search && search.trim()) { /* … conditions.push(or(…)) … */ }
const conditionsList = conditions.length > 1 ? and(...conditions) : conditions[0] as SQL;
```

Sesudah ([`src/lib/authz.ts:195`](src/lib/authz.ts#L195-L208)):

```ts
const conditions: SQL[] = [eq(schema.pilgrims.tenantId, tenantId)];
const term = search?.trim();
if (term) {
  const like = `%${term}%`;
  const searchCondition = or(/* …4 kolom ilike… */);
  if (searchCondition) conditions.push(searchCondition);
}
const where = conditions.length > 1 ? and(...conditions) : conditions[0]!;
```

Filter pencarian kini aman terhadap `undefined` dari `or(...)` dan tidak menyentuh variabel sebelum deklarasinya.

---

## D. Temuan

### F-01 — BLOKIR: tabel `pilgrims` belum ada di database

- `src/db/schema.ts` mendefinisikan `schema.pilgrims`, tetapi `information_schema.tables` untuk schema `public` hanya memuat:
  `accounts, audit_logs, auth_accounts, auth_sessions, auth_users, auth_verifications, installations, permissions, platform_role_assignments, role_permissions, roles, tenant_role_assignments, tenant_users, tenants`
  — tanpa `pilgrims`.
- Bukti runtime: setiap query jamaah gagal dengan `error: relation "pilgrims" does not exist (code 42P01)`.
- Penyebab: `drizzle/0001_curious_boomerang.sql` **memang berisi** `CREATE TABLE "pilgrims"`, tetapi belum pernah diterapkan ke Neon Development. `drizzle/meta/_journal.json` hanya mencatat satu entri (`0000_cute_master_mold`), yaitu migrasi destruktif yang justru berisi `DROP TABLE` seluruh tabel.
- **Dampak:** modul jamaah tidak mungkin berfungsi, apa pun perbaikan kode lain. Ini blokir pertama yang harus ditutup.

### F-02 — BLOKIR: keempat handler jamaah memakai `userId = ""`, bukan identitas sesi

| Lokasi | Kode saat ini |
| --- | --- |
| [`src/app/api/tenant/jamaah/route.ts:42`](src/app/api/tenant/jamaah/route.ts#L42) | `getJamaahList("", tenantId, …)` |
| [`src/app/api/tenant/jamaah/route.ts:86`](src/app/api/tenant/jamaah/route.ts#L86) | `createJamaah("", tenantId, input)` |
| [`src/app/api/tenant/jamaah/[id]/route.ts:44`](src/app/api/tenant/jamaah/[id]/route.ts#L44) | `getJamaahById("", tenantId, id)` |
| [`src/app/api/tenant/jamaah/[id]/route.ts:96`](src/app/api/tenant/jamaah/[id]/route.ts#L96) | `patchJamaah("", tenantId, id, input)` |

Keempat route **tidak pernah membaca sesi** (tidak ada `getTenantAuthContext` / `getSessionFromRequest`, kontras dengan `/api/tenant/context` dan `/api/tenant/installation`). Akibatnya `requireJahadPermissions("", …)` selalu gagal dan seluruh permintaan dijawab `403` — bukan hanya permintaan yang tidak berhak.

Bukti runtime dari probe (semuanya ditolak **sebelum** menyentuh tabel, sehingga tetap valid meski F-01 belum ditutup):

```
FAIL  JA-01: GET list tanpa session                 :: harus 401, dapat 403
FAIL  JA-02: GET list cookie palsu                  :: harus 401, dapat 403
FAIL  JA-04: GET list admin A dgn tenantId Tenant B :: harus 404, dapat 403
PASS  JA-10: GET list oleh anggota aktif tanpa role → 403
```

Pre-kondisi membuktikan katalog izinnya sendiri sehat: admin tenant A **punya** `jamaah.read` di database, tetapi endpoint tetap menolaknya. JA-10 “lulus” hanya karena semua permintaan dijawab 403 — perilaku gagal yang menyerupai perilaku benar.

### F-03 — SEDANG: kontrak status respons tidak dipatuhi

- Dokumentasi di [`src/app/api/tenant/jamaah/[id]/route.ts:21`](src/app/api/tenant/jamaah/[id]/route.ts#L21) menyatakan jamaah milik tenant lain “selalu menjadi **404** (bukan 403)”, tetapi kode mengembalikan `403`.
- `POST` mengembalikan `403` untuk kesalahan validasi (`registrantNo`/`fullName` kosong) — seharusnya `400`.
- Permintaan tanpa sesi seharusnya `401`, bukan `403`.
- `authProblemToResponse()` sudah tersedia di `src/lib/authz.ts` untuk memetakan `no_session → 401`, `no_membership → 404/403`, tetapi tidak dipakai oleh route jamaah.

### F-04 — RINGAN: pagination belum lengkap

`cursor` diterima di `getJamaahList` ([`src/lib/authz.ts:187`](src/lib/authz.ts#L187)) tetapi tidak pernah dipakai untuk menyaring, dan `nextCursor` tidak pernah dikonsumsi ulang oleh route. `no-unused-vars` untuk `cursor` muncul sebagai warning lint. Selain itu, `nextCursor` diisi dengan `id` baris ke-(`limit`+1) — konsisten hanya jika klien memfilter berdasarkan `id > cursor`, yang belum diimplementasikan.

### F-05 — RINGAN: skema dan migrasi tidak sinkron

- `src/db/schema.ts` memodelkan kolom enum (`status`, `pilgrim_status`) sebagai `text`, sementara database Development dibuat dari `drizzle/0000_quiet_dragon_lord.sql` yang memakai `CREATE TYPE … AS ENUM`.
- `drizzle/0001_curious_boomerang.sql` adalah regenerasi **penuh** dari `schema.ts` (`CREATE TABLE` tanpa `IF NOT EXISTS` untuk seluruh 14 tabel yang sudah ada). Menerapkannya apa adanya ke Development akan gagal dengan “relation already exists”, bukan menambahkan `pilgrims` saja.
- **Rekomendasi:** jangan pakai `db:push`/`db:migrate` buta di Development. Tulis migrasi terarah yang hanya membuat `pilgrims` (dan indeks unik `(tenant_id, registrant_no)` untuk menutup balapan pemeriksaan duplikat di `createJamaah`).

### F-06 — RINGAN: artefak sisa

- `scripts/provision-verify.ts.bak` — salinan cadangan di dalam direktori skrip.
- `src/lib/authz-pilgrims.ts` — shim re-export satu baris (tidak diimpor siapa pun).
- `src/lib/authz-patch-getjamaahlist.js` — **sudah dihapus** sesi ini.
- Belasan file `laporan-*.md` untracked; beberapa (mis. `laporan-pengecekan-modul.md` versi lama) sudah usang dan bisa menyesatkan pembaca berikutnya.

### F-07 — RINGAN: peringatan rahasia saat build

`next build` memperingatkan: *“You are using the default secret. Please set `BETTER_AUTH_SECRET` …”*. Untuk pengembangan tidak fatal, tetapi wajib ditutup sebelum rilis.

---

## E. Hasil tes terperinci modul jamaah

`npx tsx scripts/jamaah-smoke.ts` → exit **1**

| Skenario | Harapan | Hasil |
| --- | --- | --- |
| JA-01 GET list tanpa session | 401 | **GAGAL** (403) |
| JA-02 GET list cookie palsu | 401 | **GAGAL** (403) |
| JA-03 GET list admin Tenant A | 200 | BLOKIR (F-01) |
| JA-04 GET list admin A dgn tenantId Tenant B | 404 | **GAGAL** (403) |
| JA-05 POST create admin A | 201 | BLOKIR (F-01) |
| JA-06 POST registrant_no duplikat | 409 | BLOKIR (F-01) |
| JA-07 POST payload tidak valid | 400 | BLOKIR (F-01) |
| JA-08 GET detail jamaah A via tenantId B | 404 | BLOKIR (F-01) |
| JA-09 PATCH jamaah Tenant A | 200 | BLOKIR (F-01) |
| JA-10 GET list anggota tanpa role | 403 | LULUS (tetapi menyesatkan — lihat F-02) |
| JA-11 Isolasi daftar antartenant | tidak ada baris Tenant A | BLOKIR (F-01) |
| JA-12 Library `createJamaah(userId sah)` | sukses | BLOKIR (F-01) |

Skrip ini **sengaja gagal** sampai F-01 dan F-02 ditutup: ia berfungsi sebagai gerbang penerimaan perbaikan, bukan sebagai tes yang diabaikan. Skenario yang bergantung tabel dilaporkan `BLOKIR` (bukan lulus/gagal) agar tidak menyamarkan kegagalan nyata.

Data uji (tiga akun, dua tenant, `PASSWORD_OK` internal) dibersihkan pada blok `finally`; tidak ada data non-uji yang disentuh.

---

## F. Urutan perbaikan yang disarankan

1. **Tutup F-01** — terapkan migrasi yang hanya membuat tabel `pilgrims` + indeks unik `(tenant_id, registrant_no)` di Neon Development, lalu ulangi `scripts/jamaah-smoke.ts`.
2. **Tutup F-02** — di keempat handler jamaah, ganti `""` dengan `userId` hasil `getTenantAuthContext(request, tenantId)`, dan gunakan `authProblemToResponse()` supaya status 401/404 konsisten dengan endpoint tenant yang sudah ada.
3. **Rapikan F-03** — kembalikan `400` untuk validasi, `409` untuk konflik, `404` untuk resource lintas tenant (sesuai komentar yang sudah ditulis).
4. **F-04** — implementasikan filter `cursor` (atau hapus parameternya sampai siap).
5. **F-05** — tambahkan migrasi terarah dan jangan regenerasi seluruh skema ke database yang sudah terisi.
6. **F-06/F-07** — hapus artefak sisa, set `BETTER_AUTH_SECRET` sebelum rilis.

---

## G. Batasan pemeriksaan (yang belum diverifikasi)

- Delapan skenario jamaah yang membutuhkan data tidak dapat dijalankan sampai F-01 ditutup; isolasi antartenant pada **respons daftar jamaah** karena itu masih belum terbukti (baru terbukti pada endpoint `installation`).
- Skenario tulis (create/patch) dengan `PASSWORD_OK` nyata belum pernah dieksekusi berhasil satu kali pun.
- Endpoint bisnis lain (paket, reservasi, pembayaran) belum ada, jadi tidak dapat diperiksa.
- Laporan ini tidak mengklaim modul jamaah siap; statusnya **belum terverifikasi/broken** sampai F-01 dan F-02 ditutup.
- Tidak ada commit, push, deploy, atau perubahan pada Production dalam sesi ini.
