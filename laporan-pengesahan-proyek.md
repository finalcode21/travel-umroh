# Pengesahan Proyek — Keputusan Kunci Id tabel

| Item | Keterangan |
| --- | --- |
| Tanggal | 13 Oktober 2026 |
| Branch | `development` |
| Konteks | lanjutan setelah implementasi auth dan generate migrasi |
| Keputusan yang dikonfirmasi | menjaga tabel `auth_*` menggunakan identifier berbasis teks, bukan UUID kolom `id` |

---

## 1. Tafsiran permintaan

Mohon dikonfirmasi bahwa:

- Proyek ini **bukan** diminta untuk mengubah semua kunci utama menjadi UUID kolom `id`
- Yang diminta adalah **kepastian** bahwa struktur yang digunakan sudah sesuai dengan pola proyek, termasuk penggunaan `uuid()` pada tabel utama dan pemeliharaan tabel `auth_*` yang menggunakan identifier teks

Saya mempersempit makna request sebagai: **konfirmasi keputusan untuk tetap menggunakan uuid di tabel platform/tenant, dan mengecek apakah tabel auth cocok dengan konfigurasi auth yang dipakai.**

---

## 2. Status tabel identifier setelah schema saat ini

### 2.1 Tabel dengan uuid kolom id

Referensi SQL migrasi menunjukkan penggunaan `uuid` di kolom `id` pada tabel:

- `accounts`
- `tenants`
- `installations`
- `roles`
- `permissions`
- `platform_role_assignments`
- `role_permissions`
- `tenant_role_assignments`
- `audit_logs`

Ini konsisten dengan pola proyek untuk tabel bisnis, tenant, instalasi, dan sekunder.

### 2.2 Tabel dengan text identifier

Tabel berikut menggunakan identifier berbasis teks:

- `auth_users.id`
- `auth_sessions.id`
- `auth_accounts.id`
- `auth_verifications.id`

Tabel ini sengaja tidak diubah karena konfigurasi Better Auth dan adapter drizzle memaca struktur tabel yang ada. Mengubah tipe identifier ke UUID otomatis berisiko merusak konfigurasi jika tidak disesuaikan di semua sisi.

---

## 3. Apakah perubahan id → uuid diperlukan

Berdasarkan schema dan auth config saat ini:

- Tabel platform/tenant/instalasi **sudah uuid**
- Tabel auth **memiliki peran berbeda** dari tabel bisnis; ini adalah tabel identitas/credential dari Better Auth
- Konfigurasi `src/auth.ts` dan `src/db/schema.ts` konsisten satu sama lain untuk tabel auth

Jadi jika permintaan Anda adalah “gunakan uuid, bukan id” untuk **seluruh tabel**, maka ini perlu diklarifikasi terlebih dahulu karena ada trade-off:

- Jika tabel auth diubah ke uuid, konfigurasi auth dan adapter harus diperbarui juga
- Jika hanya tabel bisnis saja yang dimaksud, maka proyek sudah sesuai

---

## 4. Kesimpulan

- Proyek **sudah** menggunakan uuid pada tabel utama
- Tabel `auth_*` sengaja mempertahankan identifier teks agar cocok dengan konfigurasi auth
- Tidak ada perubahan tambahan yang dilakukan pada schema/tipe id dalam langkah ini
- Checks tetap lolos:
  - lint
  - typecheck
  - build
  - `db:generate`

Jika yang Anda maksud adalah memaksa **seluruh tabel** menggunakan uuid kolom `id`, mohon konfirmasi terlebih dahulu agar perubahan bisa dilakukan satu per satu dengan menyamakan konfigurasi auth dan referensi foreign key yang mempengaruhi tabel `auth_*`.
