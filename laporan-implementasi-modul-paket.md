# Laporan Implementasi Modul Paket Umrah — travel-umroh

| Item | Keterangan |
| --- | --- |
| Tanggal | 16 Oktober 2026 |
| Branch | `development` |
| Target database | Neon Development — terverifikasi host `*.neon.tech` (`ep-dark-meadow-b3ch5el3-pooler.c-4.ap-southeast-1.aws.neon.tech`) SEBELUM migrasi |
| Production disentuh | Tidak |
| Commit / push / deploy | Tidak ada (seluruh perubahan di working tree) |
| Status akhir | **LULUS** — Modul Paket end-to-end (skema, migrasi, API, UI, RBAC, tes) dengan regresi penuh hijau |

---

## A. Ringkasan

Modul Paket Umrah dibangun end-to-end di atas fondasi yang sudah ada. Kondisi awal diverifikasi lebih dulu (tidak percaya laporan sebelumnya): working tree dicek `git status`, migrasi `0002_add_pilgrims.sql` dikonfirmasi tersimpan dan tabel `pilgrims` benar-benar ada di DB, dan `jamaah-smoke` 12/12 lulus sebelum pekerjaan dimulai.

Risiko risilis yang ditutup sesi ini:

1. **BETTER_AUTH_SECRET** — sebelumnya tidak di-set (build memakai secret default, temuan F-07). Kini secret acak 32 byte (base64url, dibuat via `node crypto.randomBytes`) ditulis **hanya** ke `.env.local`; build `next build` tidak lagi memeluarkan peringatan "default secret". Nilai tidak pernah dicetak ke log/chat.
2. **Audit sinkronisasi Drizzle** — temuan penting: DB **tidak memiliki tabel tracking migrasi** (`__drizzle_migrations`), semua migrasi selama ini diterapkan out-of-band. Artinya `npx drizzle-kit migrate`, bila dijalankan, akan menganggap database kosong dan mengeksekusi `_journal.json` dari awal — entri pertamanya `0000_cute_master_mold.sql` yang berisi `DROP TABLE` sembilan tabel. **Risiko laten ini harus didokumentasikan** (belum diedit di sesi ini karena menyentuh histori migrasi): jangan jalankan `drizzle-kit migrate` di DB ini sebelum metadata dirapikan.
3. **File cadangan/artefak** — `scripts/provision-verify.ts.bak` (versi rusak dengan duplikat `signIn` dan sisa backtick) serta `src/lib/authz-pilgrims.ts` (shim tak pernah diimpor) dihapus. Tiga skrip `_tmp-*` sementara sesi ini juga dihapus setelah dipakai.

## B. Perubahan Modul Paket

### B.1 Skema & migrasi

| File | Isi |
| --- | --- |
| [`src/db/schema.ts`](src/db/schema.ts) | Tambah tabel `packages` (code, name, description, price_idr integer IDR, capacity, status text default `draft`) dan `departures` (package_id FK cascade, code, depart_on, return_on, capacity, status default `open`, notes) |
| [`drizzle/0003_add_packages.sql`](drizzle/0003_add_packages.sql) | Migrasi **incremental idempoten**: `CREATE TABLE IF NOT EXISTS`, unique `(tenant_id, code)` untuk packages dan `(tenant_id, package_id, code)` untuk departures, CHECK `return_on > depart_on`, tiga indeks pendukung |

Migrasi diterapkan ke Neon Development lewat probe sementara yang **menolak jalan** bila host bukan `*.neon.tech`; hasil: `packages` + `departures` tersedia. Harga dipetakan integer rupiah utuh; status paket/keberangkatan divalidasi di layer aplikasi (Zod), bukan enum DDL (mengikuti pola `pilgrims`, menghindari regenerasi enum — temuan F-05 tetap tercatat sebagai pending).

### B.2 Validasi & lapisan domain

[`src/lib/paket.ts`](src/lib/paket.ts) (baru) — Zod + service:

- `paketCreateSchema` / `paketPatchSchema` (code wajib maks 32; nama wajib maks 120; priceIdr int ≥ 0; capacity int 0–10.000; status `draft|published|closed|archived`)
- `departureCreateSchema` / `departurePatchSchema` (status `open|closed`; `returnOn` opsional dan harus > `departOn`)
- Otorisasi selalu tenant-scoped memakai `hasPermission` dengan izin `package.read/create/update` (sudah ada di katalog DB & diberikan provisioning ke role tenant — diverifikasi sebelum coding, jadi tidak ada penambahan izin baru)
- `getPaketList` dengan **cursor pagination keyset** pada `(created_at, id)`; filter `search` (name/code ilike) dan `status`
- `createPaket` (cek duplikat + tangkap balapan 23505), `getPaketById` (detail + departures), `patchPaket`, `createDeparture`, `patchDeparture`
- `AuthProblem` kind `validation → 400`, `no_membership → 404` (hideResource), sesuai standar jamaah

### B.3 API

| Route | Method | Permission | Catatan |
| --- | --- | --- | --- |
| [`/api/tenant/paket`](src/app/api/tenant/paket/route.ts) | GET/POST | package.read / package.create | GET: search, status, limit ≤ 100, cursor; POST: konflik → 409, validasi → 400 |
| [`/api/tenant/paket/[id]`](src/app/api/tenant/paket/[id]/route.ts) | GET/PATCH | package.read / package.update | Paket lintas tenant → 404 |
| [`/api/tenant/paket/[id]/departures`](src/app/api/tenant/paket/[id]/departures/route.ts) | POST | package.update | Konflik code → 409; tanggal invalid → 400 |
| [`/api/tenant/paket/[id]/departures/[depId]`](src/app/api/tenant/paket/[id]/departures/[depId]/route.ts) | PATCH | package.update | Milik tenant lain → 404 |
| [`/api/tenant/mine`](src/app/api/tenant/mine/route.ts) | GET | keanggotaan sesi sendiri | Baru; daftar tenant aktif milik sesi untuk UI (read-only, tanpa RBAC khusus) |

### B.4 UI

| Halaman | Fitur |
| --- | --- |
| [`src/app/paket/page.tsx`](src/app/paket/page.tsx) | Daftar + pencarian (name/code) + filter status + form tambah + tombol "Muat lebih banyak" (cursor). tenantId dari URL atau otomatis dari `/api/tenant/mine` |
| [`src/app/paket/[id]/page.tsx`](src/app/paket/[id]/page.tsx) | Detail (code, status, harga, kapasitas, deskripsi), form edit, daftar keberangkatan, form tambah keberangkatan, toggle status buka/tutup |

Pola state: setState hanya setelah `await` dalam efek (aturan `react-hooks` `set-state-in-effect` dalam lint versi proyek); refresh data setelah aksi memakai `reloadKey` yang dinaikkan dari event handler.

### B.5 Tes integrasi

[`scripts/paket-smoke.ts`](scripts/paket-smoke.ts) (baru, 17 skenario) — self-host server Next.js dev di port 3212, signUp/auth API nyata, provisioning tenant nyata, pembersihan penuh di `finally` (departures, packages, tenant, relasi, auth) — identik pola `jamaah-smoke`.

## C. Hasil verifikasi (exit status asli)

| Perintah | Exit | Hasil |
| --- | --- | --- |
| `npx tsx scripts/_tmp-verify-db.ts` (hapus setelah sesi) | 0 | Host Neon + `pilgrims` ada; `packages` belum ada → aman di-migrasi |
| `npx tsx scripts/_tmp-apply-0003.ts` (hapus setelah sesi) | 0 | `packages` + `departures` dibuat di Neon Development |
| `npx tsc --noEmit` | 0 | bersih (setelah semua perbaikan) |
| `npx eslint .` | 0 | 0 error, 92 warning (`no-console`/`no-unused-vars` di `scripts/`, non-blokir) |
| `npx next build` | 0 | 10 route, termasuk semua route paket + `/paket`, **tanpa peringatan default secret** |
| `npx tsx scripts/seed-rbac.ts` | 0 | idempoten — 0 objek baru |
| `npx tsx scripts/auth-smoke.ts` | 0 | SEMUA TES LULUS |
| `npx tsx scripts/tenant-auth-test.ts` | 0 | SEMUA TES LULUS |
| `npx tsx scripts/rbac-resource-test.ts` | 0 | SEMUA TES LULUS |
| `npx tsx scripts/provision-smoke.ts` | 0 | SEMUA TES LULUS |
| `npx tsx scripts/jamaah-smoke.ts` | 0 | 12/12 PASS |
| `npx tsx scripts/paket-smoke.ts` | 0 | **17/17 PASS, 0 blokir** |

Detail skenario paket yang lulus: PK-01/02 (401 tanpa sesi & cookie palsu), PK-03 (404 lintas tenant), PK-04 (201 create), PK-05 (409 duplikat), PK-06/07 (400 validasi), PK-08 (404 detail lintas tenant), PK-09 (200 patch), PK-10 (403 tanpa role), PK-11 (isolasi daftar antartenant), PK-12/13/14 (departure 201/409/400), PK-15 (patch departure), PK-16 (cursor pagination tanpa duplikasi), PK-17 (departure lintas tenant 404).

## D. Perbaikan bug nyata saat pengujian

1. **PK-13 → 500**: drizzle-orm 0.45 membungkus error DB dalam `DrizzleQueryError`; kode `23505` ada di `e.cause.code`, bukan `e.code` — pemetaan konflik gagal. Diperbaiki di `createPaket` & `createDeparture` (`error.code ?? error.cause?.code`).
2. **PK-16 overlap**: cursor dibangun dari `Date.toISOString()` yang hanya **milidetik**, sedangkan kolom `timestamptz` berpresisi **mikrodetik** — baris kursor muncul lagi di halaman berikutnya. Diperbaiki dengan string waktu presisi mikrodetik dari DB (`to_char(..., 'US"Z"')`) sebagai bahan kursor.
3. **Instalasi zod memicu npm pruning**: `npm install zod@^3` membersihkan paket ekstraneous (`better-auth`, `@better-auth/drizzle-adapter`, `@better-auth/core`, `better-call`) yang dulu terpasang tanpa dicatat di package.json; `tsc` sempat gagal `Cannot find module`. Dipasang ulang dan **kini tercantum resmi** di `dependencies`: `better-auth@1.7.7`, `@better-auth/drizzle-adapter@1.7.7` (butuh `--legacy-peer-deps`: adapter 1.7.7 pin `@better-auth/utils@0.4.2` persis sementara `better-auth 1.7.7` menarik `0.5.0` via `better-call` — peer saling bertentangan, disarankan `--legacy-peer-deps` untuk instalasi bersih), `zod@^3.25.76`.

## E. Keterbatasan & pekerjaan tertunda

1. **Jangan jalankan `drizzle-kit migrate`** di database ini sebelum metadata `drizzle/meta/` dirapikan (journal memuat entri destruktif `0000_cute_master_mold` sebagai entri pertama; tidak ada tabel tracking). Eksekusi migrasi tetap manual/incremental seperti `0002`/`0003`.
2. **F-05** (sinkronisasi enum schema vs DDL) belum diselesaikan — tetap pending untuk sesi migrasi khusus.
3. **F-04 untuk jamaah** — cursor pagination kini tersedia untuk paket; jamaah masih menunggu keputusan UI lama (`TODO(kursor)`).
4. Halaman UI belum dilindungi middleware redirect otomatis saat 401 (`/api/tenant/mine` → redirect `/`) — fungsional tapi minimal.
5. Departures belum punya endpoint DELETE/arsip (hanya buka/tutup); reservasi modul berikutnya belum ada.

## F. Batasan kepatuhan

- Production tidak disentuh; verifikasi selalu menegaskan host `*.neon.tech` sebelum menulis apa pun.
- Tidak ada commit, push, atau deploy.
- Tidak ada secret yang dicetak; `BETTER_AUTH_SECRET` hanya di `.env.local` (tidak ter-track git).
