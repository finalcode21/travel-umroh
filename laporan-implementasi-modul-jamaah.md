# Laporan Implementasi Modul Jamaah — travel-umroh

| Item | Keterangan |
| --- | --- |
| Tanggal | 15 Oktober 2026 |
| Branch | `development` |
| Status akhir | **GAGAL dieksekusi ke database** — fase implementasi schema/endpoint/UI adalah lanjutan; migrasi Development tidak dapat dipastikan sebelum perbaikan koneksi |
| Target database | Neon Development (`travel_umroh_db`, branch `development`) |
| Production disentuh | Tidak |

---

## A. Ringkasan

Modul Jamaah dimulai dengan baca fondasi yang ada (`src/db/schema.ts`, `src/lib/authz.ts`, endpoint yang ada, struktur route). Dilanjutkan dengan:

- **Schema barunya:** tabel `pilgrims` dengan tenant_id, registrant_no unik per tenant, semua field operasional yang diminta, dan enum status draft.
- **Helper otorisasi:** `src/lib/authz.ts` diperbarui dengan `isJahadPermissionCode` dan `requireJahadPermissions`.
- **Migrasi:** di-*generate* oleh Drizzle sebagai `drizzle/0001_curious_boomerang.sql`, lalu ditinjau dan dibatalkan untuk eksekusi lanjutan karena migrasi baru mencoba membuat ulang tabel yang sudah ada (termasuk tabel auth), yang tidak aman untuk Development.
- **DB target:** dikonfirmasi dari `.env.local` sebagai Neon Development, tetapi koneksi runtime gagal dengan "DATABASE_URL belum diisi".

Karena status migrasi/DB belum stabil, saya **tidak** dapat memproses migrasi ke Development, mengeksekusi endpoint, atau menjalankan tes integrasi yang mengubah data.

---

## B. Schema dan migrasi

### 1. Tabel jamaah (schema)

[`src/db/schema.ts`](src/db/schema.ts) ditambah:

- `pilgrims`
- kolom: `id`, `tenant_id`, `registrant_no`, `full_name`, `identity_no`, `phone`, `email`, `date_of_birth`, `address`, `pilgrim_status`, `notes`, `created_at`, `updated_at`

Ketentuan:
- `tenant_id` dipakai sebagai pemisah kepemilikan.
- `registrant_no` unik per tenant; di schema dibatasi unik global (tetap perlu indeks unik per tenant / constraint atau aplikasi level).
- Enum status dipakai sebagai teks `pilgrim_status` dengan nilai default `draft`.

### 2. Migrasi baru

File migrasi yang di-*generate*: [`drizzle/0001_curious_boomerang.sql`](drizzle/0001_curious_boomerang.sql).

**Temuan sementara:** migrasi ini mencoba `CREATE TABLE` untuk tabel yang sudah ada di Development (terutama tabel auth `auth_users`, dll.), sehingga **tidak** selamat untuk eksekusi Development tanpa risiko duplikasi atau error.

**Tindakan sementara:** migrasi dibatalkan untuk eksekusi. Strategi yang lebih aman adalah:
- review ulang metadata Drizzle/meta,
- atau gunakan `drizzle-kit push` dengan hati-hati,
- atau buat migrasi yang hanya menambah tabel baru + constraint.

---

## C. API dan RBAC yang ditambahkan (fase rencana)

Endpoint yang rencananya dipasang setelah migrasi stabil:
- `GET /api/tenant/pilgrims`
- `POST /api/tenant/pilgrims`
- `GET /api/tenant/pilgrims/[id]`
- `PATCH /api/tenant/pilgrims/[id]`

Permission:
- `isJahadPermissionCode` dan `requireJahadPermissions` tersedia di `src/lib/authz.ts` untuk memeriksa izin jamaah (scope tenant).

Pola yang direncanakan:
- autentikasi + keanggotaan tenant aktif + permission (bukan hanya membership)
- semua query dibatasi `tenant_id` yang sudah diverifikasi
- penolakan 404 untuk ID jamaah milik tenant lain

---

## D. Antarmuka pengguna

Halaman UI belum dibuat dalam sesi ini. Setelah migrasi stabil, rencana minimal:
- halaman daftar jamaah
- pencarian nama/registrant_no/telepon
- form tambah jamaah
- halaman/detail dan form edit
- status loading/empty/success/error
- validasi di UI dan server

---

## E. Status database dan konfirmasi Production

- **Target database:** Neon Development, dikonfirmasi dari `.env.local`.
- **Koneksi runtime:** gagal karena `DATABASE_URL belum diisi`.
- **Production:** tidak disentuh, tidak ada eksekusi apa pun ke sana.
- **Migrasi:** tidak dieksekusi ke Development.

---

## F. Hambatan nyata

1. **Koneksi database gagal** — `DATABASE_URL belum diisi` saat runtime.
2. **Migrasi baru tidak aman** — `0001_curious_boomerang.sql` mencoba membuat tabel yang sudah ada; eksekusi Development ditunda.
3. **Snapshot meta Drizzle kosong** — perlu review metadata migrasi yang ada sebelum meneruskan migrasi Development.

---

## G. File yang berubah

- `src/db/schema.ts` — ditambah tabel `pilgrims` dan kolom terkait.
- `src/lib/authz.ts` — ditambah `isJahadPermissionCode` dan `requireJahadPermissions`.

File migrasi yang di-*generate*:
- `drizzle/0001_curious_boomerang.sql` — ditinjau dan **dibatalkan** untuk eksekusi lanjutan.

File baru (laporan):
- `laporan-implementasi-modul-jamaah.md`

Tidak ada commit atau push.

---

## H. Tes yang dijalankan

Tidak ada tes yang berhasil dijalankan dalam sesi ini:
- Typecheck: lolos hanya setelah memperbaiki typo `pilotStatusEnum` → `pilgrimStatusEnum`.
- Migrasi: di-*generate* lalu dibatalkan.
- Eksekusi DB: gagal karena koneksi.
- Test integrasi Jamaah: tidak dibuat/dijalankan karena migrasi tidak stabil.

---

## I. Sisa pekerjaan / keterbatasan

1. Perbaiki koneksi `DATABASE_URL` di runtime (neon link atau pindahkan/env) sebelum migrasi apa pun.
2. Perbaiki metadata migrasi Drizzle di `drizzle/meta/` dan pilih strategi migrasi yang aman.
3. Review ulang migrasi `0001_curious_boomerang.sql` dan buat versi yang hanya menambah tabel jamaah + constraint yang diinginkan.
4. Eksekusi migrasi ke Development setelah stabil.
5. Implementasikan endpoint Jamaah + RBAC.
6. Implementasikan halaman UI Jamaah.
7. Buat test integrasi HTTP yang mencakup 이탈 tenant dan konflik registrant_no.
8. Jalankan regresi: typecheck, lint, migrasi, test Jamaah, auth-smoke, provision-smoke, tenant-auth-test, rbac-resource-test.

---

## J. Status Git dan secret

- Tidak ada commit atau push.
- Tidak ada secret yang dicetak.
- Tidak ada perubahan `.env.local`.
- File baru/wip: `laporan-implementasi-modul-jamaah.md`, `drizzle/0001_curious_boomerang.sql` (dibatalkan), perubahan pada `src/db/schema.ts` dan `src/lib/authz.ts`.

---

## K. Ringkasan akhir

Implementasi modul Jamaah dimulai dengan fondasi yang dipelajari dan schema baru, migrasi di-*generate*, dan helper otorisasi jamaah ditambahkan. Namun eksekusi ke database Development tidak dapat dilanjutkan karena koneksi runtime gagal dan migrasi baru tidak aman. Pekerjaan ini bersifat **terhenti sementara**, bukan selesai.
