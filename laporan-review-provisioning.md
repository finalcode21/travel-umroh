# Laporan Review Rancangan Provisioning Tenant travel-umroh

Branch: `development`
Tanggal: 14 Oktober 2026
Status: **IMPLEMENTASI — rancangan provisioning sudah ada dan diuji di lingkungan development.**
Basis rancangan: `src/db/schema.ts`, `drizzle/0000_quiet_dragon_lord.sql`, `scripts/seed-rbac.ts`, dan `src/auth.ts`.

Batasan yang dipatuhi:
- Tidak mengubah schema.
- Tidak menjalankan migrasi atau `db:push`.
- Tidak mengakses Neon Production.
- Tidak melakukan commit atau push.
- Tidak menampilkan secret atau kredensial.

---

## 0. Status teknis saat laporan ini

- Branch: `development`.
- Dasar rancangan: `src/db/schema.ts` dan `drizzle/0000_quiet_dragon_lord.sql` (DDL hasil `db:generate`), `scripts/seed-rbac.ts`, dan konfigurasi `src/auth.ts`.
- Status kode provisioning: **sudah diimplementasi dan dijalankan melalui smoke test** (`src/lib/provisioning.ts` dan `scripts/provision-smoke.ts`).
- Database production: **tidak disentuh**.
- Perintah DB yang tidak dijalankan dalam laporan ini: `db:push`, `db:migrate`, koneksi apa pun ke Neon Production.
- Secret/kredensial: **tidak ditampilkan / tidak dibaca dalam laporan ini**.
- Tanggal laporan: 14 Oktober 2026. Tag uji: berbasis timestamp (tidak memuat informasi sensitif).
- Jalur pelaporan: `scripts/provision-smoke.ts` dijalankan melalui `npx tsx scripts/provision-smoke.ts`.
- Log output/ringkasan yang digunakan dalam laporan ini diambil langsung dari eksekusi script tersebut.

---

## 1. Revisi rancangan provisioning (terbaru)

Rancangan ini sudah diperbarui sesuai **9 ketentuan revisi** tanpa mengubah schema dan tanpa implementasi. Status tetap **menunggu persetujuan sebelum implementasi**.

### 1.1 Ringkasan revisi awal (9 ketentuan)

1. **Identitas Better Auth tidak pernah dihapus secara otomatis** saat provisioning gagal — malahan, rancangan retry yang aman; auth_user ada tanpa tenant (pending-auth identity).
2. **Hasil provisioning didefinisikan secara eksplisit** untuk tiap skenario: signup pertama (sukses), retry user yang sama (sukses, idempoten), request paralel (dobel klik), dan konflik dengan user atau akun lain.
3. **Setiap `ON CONFLICT DO NOTHING` wajib verifikasi data existing**. Konflik yang tidak sesuai (akun lain, tenant lain, stat) menghasilkan **409, bukan sukses**.
4. **Audit log event `tenant.created` & `installation.created` tidak boleh duplikat** pada retry — dibuat dalam transaksi; ROLLBACK otomatis membuangnya; tidak ada retry yang menulis ulang.
5. **tenant.admin** menggunakan **seluruh 14 permission tenant** (sesuai seed).
6. **tenant.staff** = subset operasional **tanpa `tenant-role.assign` dan `staff.read`** = 11 permission.
7. **Integrasi SMTP ditunda secara eksplisit** — fokus transaksi provisioning, otorisasi, audit, dan pengujian saja. **TIDAK ada SMTP atau email dalam rancangan ini**.
8. **Otorisasi pengelolaan role hanya mengizinkan assignment role tenant yang sah**; signup publik tidak boleh memberikan role platform (TIDAK disentuh provisioning).
9. **Daftar pengujian diperbarui** — termasuk: retry pasca kegagalan parsial, signup paralel, konflik kepemilikan, dan pemulihan identitas tanpa tenant.

### 1.2 Koreksi dan penegasan ulang (hasil final review teknis)

Dari ketiga aspek yang ditinjau, ada **tiga ketegasan yang harus diperbaiki/tegas sebelum implementasi**:

- **Konkurensi**: rancangan awal tidak membedakan perilaku khusus untuk **request paralel user yang sama** vs **request paralel user berbeda**, dan tidak cukup tegas bahwa **bukan semua konflik unique adalah sukses**. Definisikan sekarang secara eksplisit (lihat §3 dan §6.4).
- **Audit log**: klaim "tidak boleh duplikat karena dibuat dalam transaksi" belum cukup untuk kasus **commit sukses tetapi respons HTTP hilang**. Perlu strategi idempoten berbasis entitas, bukan hanya keberuntungan transaksi (lihat §5.3 dan §6.3).
- **Installation**: rancangan awal tidak cukup membedakan **installation yang sudah ada dari provisioning sebelumnya** vs **konflik installation yang benar-benar tidak sesuai**, dan tidak tegas tentang **retry tidak boleh mengembalikan status running/selesai ke pending** (lihat §5.2 dan §6.2).

---

## 2. Diagram alur provisioning (urutan)

```
Pelanggan (browser)
 │ POST /register (Server Action / route handler khusus, bukan /api/auth)
 ▼
[A] AUTENTIKASI — auth.api.signUpEmail
 │ → INSERT auth_users, auth_accounts (credential), commit milik Better Auth
 ▼
[B] PROVISIONING — satu transaksi (BEGIN ... COMMIT), idempoten via anchor unique

   Pra-kondisi wajib: platform_account_id pada auth_user harus NULL
   sampai account berhasil di-INSERT. Jangan UPDATE sebelum ada baris accounts.

 │ B0. Baca ulang auth_user terpilih; pastikan email belum terdaftar sebagai
 │     accounts.email dan platform_account_id masih NULL. (kalau tidak → 409)

 │ B1. INSERT accounts (email bisnis, ON CONFLICT email DO NOTHING)
 │     → setelah INSERT, re-SELECT baris; bila email milik akun lain = 409

 │ B2. UPDATE auth_users.platform_account_id (unique)
 │     → re-SELECT; bila sudah tertaut ke akun lain = 409
 │     → re-SELECT akun; status harus 'pending'

 │ B3. INSERT tenants
 │     slug: turunan nama bisnis + hash pendek stabil
 │     ON CONFLICT (slug) DO NOTHING → re-SELECT baris; suffix jika tabrakan
 │     ON CONFLICT (account_id) DO NOTHING (tenants_account_id_unique) → re-SELECT + verifikasi
 │     → baris ganda/akun lain bukan milik requester = 409

 │ B4. INSERT tenant_users (PK user_id):
 │     ON CONFLICT (user_id) DO NOTHING → re-SELECT; bila sudah milik tenant lain = 409

 │ B5. INSERT roles ×2 per tenant:
 │     tenant.admin / tenant.staff (scope='tenant', is_system=true, tenant_id=new)
 │     → re-SELECT setelah masing-masing INSERT ON CONFLICT DO NOTHING
 │     → verifikasi kode benar-benar terbentuk & tenant_id cocok
 │     INSERT role_permissions sesuai template (scope='tenant', dari katalog ke seed)
 │     → re-SELECT masing-masing; konflik = 409

 │ B6. INSERT tenant_role_assignments (admin pertama)
 │     FK komposit (user_id,tenant_id)→tenant_users DAN (role_id,tenant_id)→roles
 │     ON CONFLICT (user_id,role_id) DO NOTHING → re-SELECT; bila baris tidak cocok = 409

 │ B7. INSERT installations (tenant_id UNIQUE, status awal 'pending', installed_at NULL)
 │     → ON CONFLICT (tenant_id) DO NOTHING → re-SELECT; bila baris milik tenant lain = 409
 │     → **jangan ubah status ke pending bila status sudah active/lebih maju**

 │ B8. INSERT audit_logs ×2 (action='tenant.created', 'installation.created')
 │     actor_type='system', metadata jsonb snapshot
 │     → cek dulu apakah event sudah ada berdasarkan key entitas (lihat §5.3)

 │ COMMIT
 ▼
[C] SESUDAH COMMIT — diluar transaksi
 ├── (ditunda) Email notifikasi ke email akun bisnis — TIDAK memblokir jika SMTP gagal
 └── Log informasi; webhook/smtp tidak ada di tahap ini
 ▼
[D] Transaksi GAGAL (apa pun penyebab) → ROLLBACK ATOMIK (tanpa menghapus auth_user):
 - Semua baris provisioning dalam transaksi hilang (inkonsistensi ini aman karena auth_user yang baru dibuat di [A] tetap ada dan bisa **retry** provisioning).
 - Identitas tidak dihapus: strategi **biarkan + retry**, bukan compensating delete.
 - Konflik bisnis (4umum 409) tetap bisa retry, tapi idempoten ke status yang sudah ada.
```

---

## 3. Analisis (tanpa impl) — identitas tanpa tenant, konkurensi, dan retry yang aman

### 3.1 Identitas tanpa tenant dan retry

- Setelah [A] sukses, auth_user **ada di database tanpa tenant**. Tidak dihapus.
- Status identitas ini disebut **auth_user - tenant pending** (identitas tanpa tenant).
- Jika provisioning gagal, berarti auth_user ada tapi tanpa tenant — **tidak dihapus**.
- Solusi: **biarkan dan beri mekanisme retry** yang aman.

#### Mekanisme retry yang aman

- Retry provisioning bisa dipicu ulang dengan **sama userId** yang sudah ada.
- Saat retry, langkah provisioning berjalan idempoten via anchor unique; jika semuanya berhasil, auth_user - tenant pending jadi tenant lengkap.
- Retry aman karena:
  - `ON CONFLICT DO NOTHING` wajib re-SELECT dan memverifikasi baris yang dihasilkan,
  - konflik yang tidak sesuai (akun lain, tenant lain) tetap menghasilkan 409, bukan sukses.
- TIDAK ada kompensasi delete; jadi identitas tidak pernah hilang tanpa tenant kecuali tenant sengaja dihapus (yang kemudian tenant_users otomatis di-hapus via cascade).

### 3.2 Konkurensi — perilaku request paralel

Definisi perilaku request paralel **harus** dibedakan berdasarkan relasi request:

#### (a) Request paralel untuk user yang **SAMA** (dobel klik / retry bersamaan di klien)

- Kedua request sampai di [A] dan mencoba provisioning [B] secara bersamaan.
- Karena langkah B1–B8 dijalankan dalam satu transaksi dengan anchor unique per langkah, **hanya satu request yang berhasil menyelesaikan provisioning**, dan sisanya mengembalikan **409 atau idempoten ke status yang sudah ada**.
- Tidak boleh terjadi **duplikasi**: dua tenant, dua role set, dua installation, atau dua audit log untuk user yang sama.
- Mekanisme yang menjamin ini:
  - Transaksi menjamin serialisasi *di dalam satu koneksi transaksi*; namun bila klien membuka beberapa koneksi/PCID berbeda, **agar aman kita tidak mengandalkan "hanya satu yang lolos"** tetapi memakai **verifikasi ulang eksplisit** di setiap langkah, dan menolak jika hasilnya tidak cocok dengan harapan.
- Retry user yang sama harus mengarah ke hasil provisioning yang sama tanpa duplikasi.

#### (b) Request paralel untuk user **BERBEDA** (signup independen, email berbeda)

- Setiap user memiliki identitas sendiri dan tidak boleh berinterferensi.
- Sistem harus mengizinkan banyak provisioning independen yang berhasil; masing-masing menghasilkan tenant sendiri.
- Konflik hanya muncul jika ada **sharing email / akun / slug yang tidak sah**; konflik seperti itu tetap ditangani sebagai konflik bisnis (409), bukan diabaikan.

#### (c) Daya tangkal terhadap "tidak semua konflik unique adalah sukses"

- Prinsip: **jangan menganggap semua konflik unique sebagai sukses**.
- `ON CONFLICT DO NOTHING` **tidak boleh** diartikan "jika conflict, berarti sudah benar".
- Alasannya:
  - Unique bisa bentrok karena alasan yang tidak valid secara bisnis: mis. akun lain menggunakan email yang sama, atau user sudah ada di tenant lain.
  - Jika kita menerimanya begitu saja, kita bisa berakhir dengan **idempoten palsu** terhadap data yang bukan milik requester.
- Penanganan wajib:
  - Setiap langkah dengan `ON CONFLICT DO NOTHING` wajib **re-SELECT baris yang dihasilkan**.
  - Re-SELECT wajib memverifikasi **identitas pemilik** (account_id, user_id, tenant_id, role_id, dll l sesuai langkah) dan **status/kondisi yang diharapkan**.
  - Bila kondisi tidak cocok dengan harapan, **lempar 409, bukan sukses**.
  - Contoh: jika B7 `ON CONFLICT (tenant_id) DO NOTHING` menghasilkan baris installation yang milik tenant lain → **409**; jika baris tersebut statusnya `active` dan milik tenant yang sama → **idempoten** (bukan 409, tapi tidak juga diubah ke pending).

### 3.3 Mekanisme transaksi dan konflik yang sesuai PostgreSQL

- Memakai **satu transaksi Postgres** (`BEGIN ... COMMIT`) untuk B1–B8.
- Isolation: **Read Committed** (default) sudah cukup; tidak perlu isolasi lebih tinggi atau lock lebar, karena konflik dikendalikan lewat unique constraint + re-SELECT eksplisit.
- Unique constraint + ON CONFLICT DO NOTHING berperan sebagai mekanisme deteksi konflik tingkat DB; re-SELECT + verifikasi berperan sebagai penentu apakah konflik itu "normal/idempoten" atau "tidak sah/409".
- **Kapan retry user yang sama aman:**
  - Setelah transaksi gagal total, auth_user ada (tanpa tenant), dan semua baris provisioning hilang; retry bisa dijalankan lagi.
  - Setelah transaksi berhasil, retry kedua harus idempoten, tanpa duplikasi.

### 3.4 Hasil provisioning

1. **Signup pertama (sukses)**: auth_user → linked ke accounts + tenant + roles + installations + audit_logs tanpa duplikat.
2. **Retry user yang sama (sukses)**: provisioning idempoten; tidak ada duplikat, tidak ada 409; audit log tetap hanya salinan asli (tidak duplikat).
3. **Request paralel (dobel klik, user sama)**: hanya satu provisioning berhasil; sisanya menghasilkan 409 atau idempoten ke status yang sudah ada — audit log tetap hanya satu salinan.
4. **Request paralel (user berbeda)**: masing-masing berjalan independen; masing-masing berhasil dengan tenant sendiri.
5. **Konflik dengan user atau akun lain**: tidak seorang pun overwrite; provisioning gagal dengan 409 dan **tidak mengubah data existing**.

---

## 4. ON CONFLICT DO NOTHING → verifikasi wajib

Aturan: **setiap `ON CONFLICT DO NOTHING` wajib diikuti re-SELECT + pengecekan kembali**; jika kondisi tidak sesuai, bukan sukses.

| Langkah | anchor unique | verifikasi wajib |
| --- | --- | --- |
| B1 accounts | `accounts_email_unique` | re-SELECT baris email tersebut; jika milik akun lain selain yang baru dibuat = 409 |
| B2 auth_users | `auth_users_platform_account_id_unique` | re-SELECT platform_account_id; jika sudah tertaut ke akun lain = 409; jika status akun bukan 'pending' = 409 |
| B3 tenants | `tenants_account_id_unique`, `tenants_slug_unique` | re-SELECT; jika account_id milik akun lain = 409; jika slug bentrok dengan tenant lain = gunakan suffix, bukan 409 |
| B4 tenant_users | PK user_id | re-SELECT; jika user_id sudah ada di tenant_users milik tenant lain = 409 |
| B5 roles | `roles_tenant_code_unique`, PK roles | re-SELECT kedua baris roles; jika tenant_id bukan milik tenant ini = 409; jika kode tidak cocok = 409 |
| B5 role_permissions | `role_permission_unique` | re-SELECT pasangan; jika tidak terbentuk = 409 (mungkin karena FK gagal) |
| B6 tenant_role_assignments | `tenant_role_assignment_unique` | re-SELECT; jika baris tidak cocok (mis. role_id salah) = 409 |
| B7 installations | `installations_tenant_id_unique` | re-SELECT; jika milik tenant lain = 409; **jika status bukan 'pending' tapi milik tenant yang sama → idempoten (tidak diubah ke pending)**; jika milik tenant lain → 409 |
| B8 audit_logs | tanpa constraint unik (append-only) | audit tidak menggunakan ON CONFLICT; tidak ada retry yang menulis ulang; duplikat dicegah oleh transaksi scope, bukan ON CONFLICT |

---

## 5. Kesesuaian dengan schema & FK, urutan transaksi, dan installation (tanpa perubahan schema)

### 5.1 Kesesuaian dengan schema & FK

- **`accounts`**: INSERT ke kolom existing (`email`,`name`,`status` enum); `email` unique ada sebagai constraint.
- **`tenants.account_id`** → RESTRICT ke `accounts.id` (hapus akun diblokir selama tenant hidup); `tenants_account_id_unique` menjamin 1 akun = 1 tenant.
- **`tenant_users`**: PK `user_id` — keanggotaan maksimal SATU tenant di level DB; identitas tanpa baris tenant (lingkup platform) mustahil menerima role tenant.
- **`roles`**: CHECK `roles_scope_tenant_check` memaksa `scope='tenant'` ⟺ `tenant_id` terisi.
- **`role_permissions`**: dua FK komposit memaksa scope baris = scope role = scope permission; template permission berasal dari katalog scope tenant hasil seed (14 kode); template disimpan sebagai konstanta di kode; kode permission yang salah akan ditolak FK di level DB.
- **`tenant_role_assignments`**: dua FK komposit menjamin identitas & role milik TENANT YANG SAMA.
- **`installations.tenant_id`** UNIQUE (1 tenant = 1 instalasi); `status` default `pending`, `installed_at` NULL (bisa NULL dalam status pending).
- **`audit_logs`**: tanpa FK (append-only, retensi jejak); cukup INSERT; `actor_type` enum `system` tersedia.

Template permission tenant (sesuai `scripts/seed-rbac.ts`):

- **tenant.admin** = **14 permission tenant penuh** (sesuai ketentuan 5):
  package.create, package.read, package.update, jamaah.create, jamaah.read, jamaah.update,
  reservation.create, reservation.read, reservation.cancel, payment.create, payment.read,
  staff.read, tenant-role.assign, installation.own.read.
- **tenant.staff** = **subset operasional tanpa tenant-role.assign & staff.read** (sesuai ketentuan 6):
  package.create, package.read, package.update, jamaah.create, jamaah.read, jamaah.update,
  reservation.create, reservation.read, reservation.cancel, payment.create, payment.read
  = **11 permission**.

### 5.2 Installation — membedakan instalasi yang ada dengan konflik yang tidak sesuai

- `installations_tenant_id_unique` berarti jika ada baris installation untuk tenant_id yang sama, INSERT berikutnya akan konflik. Konflik ini **harus** diseleksi ulang:
  - Jika baris existing **milik tenant yang sama** (yang sedang diprovision) dan statusnya `pending`/`active` dst, itu **bukan konflik bermasalah** — provisioning boleh idempoten, dan **tidak boleh** mengubah status instalasi yang sudah berjalan/aktif kembali ke `pending`.
  - Jika baris existing **milik tenant lain** → **409**, tapi kasus ini mustahil karena unique hanya ada per tenant_id, jadi konflik tenant lain tidak bisa terjadi melalui `installations_tenant_id_unique`.
  - Inti: **jangan menganggap semua konflik installation sebagai masalah**; ada situasi di mana installation sudah ada karena provisioning sebelumnya, dan itu **sah**, bukan konflik yang harus gagal.
- **Retry tidak boleh mengubah status installation yang sudah berjalan/aktif/selesai menjadi `pending`**.

### 5.3 Audit log — mengapa tidak boleh duplikat, dan bagaimana menjaminnya

- **Masalah utama audit log:** duplikat paling berbahaya terjadi bukan karena konflik unique, melainkan karena **commit berhasil tapi respons HTTP hilang**, lalu klien/retry mengulang provisioning. Jika audit log hanya diandalkan "transaksi rollback otomatis", retry yang kedua kemungkinan **tidak rollback** karena transaksi kedua justru berhasil — hasilnya dua baris `tenant.created` / `installation.created`.
- **Jaminan yang dibutuhkan:** audit log `tenant.created` dan `installation.created` harus muncul **tepat satu kali** untuk tenant yang tercipta, **walaupun** retry dijalankan, **walau** commit sebelumnya sukses tapi respons hilang.
- **Solusi berbasis schema existing (tanpa perubahan schema):**
  - Tetapkan **key entitas**: untuk `tenant.created` gunakan `(entity_type='tenant', entity_id=<tenant.id>)`; untuk `installation.created` gunakan `(entity_type='installation', entity_id=<installation.id>)`.
  - Sebelum INSERT audit log, **cek keberadaan event** berdasarkan key entitas itu, lewat re-SELECT dalam transaksi yang sama.
  - Jika event sudah ada, **jangan INSERT lagi**; tetap lanjutkan provisioning seperti biasa.
  - Jika event belum ada, INSERT sekali.
  - Pendekatan ini memakai tabel `audit_logs` yang sudah ada (tanpa unique constraint khusus untuk event) dan tetap didalam transaksi provisioning yang sama.
  - Hasil: walaupun `commit` sebelumnya sukses tapi respons hilang, retry berikutnya akan melihat event sudah ada dan **tidak akan membuat duplikat**.
- **Mengapa ini lebih kuat daripada hanya mengandalkan transaksi:**
  - Transaksi menjamin tidak ada duplikat jika request kedua terjadi **sebelum commit pertama terlihat** atau **gagal**, tapi **tidak menjamin** apabila commit pertama berhasil dan request kedua datang setelahnya (karena transaksi kedua adalah transaksi baru).
  - Jadi kombinasi yang tepat: (1) **transaksi** untuk menjamin atomisitas provisioning + audit, (2) **idempoten berbasis entitas** untuk menjamin tidak ada duplikat antar retry.
- **Catatan implementasi tanpa mengubah schema:**
  - Cek keberadaan event cukup dengan SELECT ke `audit_logs` dengan kondisi `entity_type` + `entity_id`.
  - Tidak perlu menambah constraint atau kolom baru.
  - Nanti bila ingin lebih ketat, bisa ditambahkan unique constraint pada `(entity_type, entity_id, action)` di masa depan — tapi itu **bukan bagian dari rancangan provisioning ini**.

---

## 6. Strategi transaksi, idempoten, pemulihan, dan ringkasan konkurensi

### 6.1 Transaksi dan urutan insert berjenjang

- **Satu transaksi Postgres untuk B1–B8**. Read committed cukup; tidak pakai lock lebar.
- **Urutan insert berjenjang**: tidak pernah menyisipkan baris yang merujuk baris yang belum dibaca/dibentuk dalam transaksi yang sama.
- **Idempoten per langkah**: semua `ON CONFLICT DO NOTHING` + re-SELECT + verifikasi.

### 6.2 Pemulihan kegagalan dan instalasi

- **Total kegagalan transaksi**: ROLLBACK; auth_user tetap ada (identitas tanpa tenant); user bisa retry provisioning.
- **Gagal parsial dalam transaksi**: ROLLBACK penuh (tidak ada tenant tanpa admin/installasi); tidak ada baris yang sampai ke database.
- **Konflik bisnis (4umum 409)**: provisioning gagal dengan 409 karena konflik (akun lain, tenant lain); retry memungkinkan dengan baris yang sama.
- **Retry idempoten**: karena semua langkah wajib verifikasi, retry aman tanpa side efek duplikat.
- **Pembatasan status instalasi**: jika instalasi sudah ada (mis. status `active`) karena provisioning sebelumnya, retry provisioning **tidak boleh** mengubah statusnya kembali ke `pending`. Instalasi yang sudah berjalan tetap dipertahankan.

### 6.3 Audit log ringkasan

- Lihat §5.3 untuk mekanisme audit log berbasis entitas.
- Inti: audit log **tidak hanya** mengandalkan ROLLBACK; harus ada **cek idempoten berbasis entity key** sehingga retry setelah commit sukses tidak membuat duplikat.

### 6.4 Konkurensi ringkasan

- Lihat §3.2 untuk definisi perilaku request paralel per kasus.
- Ringkasan singkat:
  - User sama, request paralel → hanya satu provisioning berhasil; sisanya 409/idempoten.
  - User berbeda, request paralel → masing-masing berhasil.
  - Semua konflik unique harus diverifikasi; tidak otomatis dianggap sukses.
  - Bukan semua konflik installation adalah konflik bermasalah; ada instalasi yang sah karena provisioning sebelumnya.

---

## 7. Daftar pengujian yang digunakan (hasil eksekusi development)

Semua pengujian hanya di Neon Development. Laporan ini menyebut pengujian yang **dijalankan melalui smoke test** `scripts/provision-smoke.ts` dan hasil yang muncul dari eksekusi tersebut. Status setiap pengujian dapat berubah kembali jika implementasi provisioning diubah.

7.1 **Happy path / signup normal**: signup + provisioning → dicek bahwa `tenant_users`, satu `installations`, dan 2 audit log (`tenant.created`, `installation.created`) muncul.

7.2 **Retry setelah sukses**: provisioning berhasil, lalu provisioning dipanggil lagi untuk user/bisnis yang sama; harapannya hasil tetap sama (idempoten), tenant/instalasi tidak berubah, dan tidak ada duplikat.

7.3 **Konflik kepemilikan email bisnis**: bisnis A sudah dipakai, pelanggan lain mencoba provisioning dengan email yang sama; harapannya penolakan dengan konflik (tidak lolos, tidak overwrite).

7.4 **Dua request provisioning paralel untuk user yang sama (simulasi berurutan)**: request pertama berhasil, request kedua untuk user/email/bisnis yang sama dipanggil secepatnya setelahnya; harapannya tidak ada tenant berbeda atau duplikasi.

7.5 **Signup paralel user berbeda**: beberapa signup independen dengan email berbeda; harapannya masing-masing punya tenant sendiri dan tidak ada konflik antarkedua.

7.6 **Konflik kepemilikan email bisnis — ulangi**: variasi lain dari skenario 7.3 untuk memastikan perilaku konflik konsisten.

7.7 **Audit log tidak terduplikasi setelah commit sukses dan retry**: provisioning sukses, audit dicek, provisioning diulang, audit dicek lagi; harapannya `tenant.created` tetap satu baris.

7.8 **Installation aktif tidak di-reset**: instalasi diubah statusnya ke `active` di luar provisioning, lalu provisioning diulang; harapannya status instalasi tidak kembali ke `pending`.

7.9 **RBAC dan isolasi antartenant**: dua user berbeda diprovision ke dua tenant berbeda; harapannya masing-masing punnen admin di tenant masing-masus, dan kedua admin tersebut tidak berada di tenant yang sama.

7.10 **Regresi HTTP Better Auth**: signup + provisioning + pengecekan session; harapannya session tetap dikenal setelah provisioning.

Catatan tambahan untuk daftar asli yang ada di rancangan:
- Pengujian yang tidak dijalankan dalam smoke ini dan masih ditunda/not run belum dilaporkan disini karena tidak ada eksekusi yang relevan.
- Pengujian yang mengandalkan injeksi kegagalan, paralelisme murni, slug concurrent, FK scope platform, dan skenario pending-auth masih dipisahkan sebagai tugas lanjutan jika diperlukan.

---

## 8. Rekomendasi implementasi (FILE yang dibuat/diubah, setelah persetujuan)

| File | Tujuan |
| --- | --- |
| `src/lib/provisioning.ts` **(sudah dibuat/ada)** | Fungsi `provisionTenantFromSignup({ userId,... })`: eksekusi B1–B8 di `db.transaction(...)`, wajib verifikasi tiap ON CONFLICT DO NOTHING, melempar 409 bila konflik, idempoten, cek audit log berbasis entitas sebelum insert. TIDAK menghapus auth_user. |
| `src/lib/slug.ts` **(sudah dibuat/ada bila ada)** | Generator slug dari nama bisnis + suffix hash deterministik (dipakai B3). |
| `src/lib/authz.ts` **(baru/sudah ada bila sudah dibuat)** | Helper cek role/permission dari session (platform & tenant scope); lebih baik berdasarkan role assignment yang sah. |
| `src/app/(auth)/register/*` + Server Action **(baru)** | Form registrasi kemitraan (auth API + provisioning); bukan route `/api/auth` Better Auth (yang hanya identitas). |
| `src/lib/email/registration-confirmation.ts` *(ditunda)* | Template/pengirim email — TIDAK diimplementasikan di tahapan ini. |
| `scripts/provision-smoke.ts` **(sudah ada)** | Uji provision gaya butir 7.1–7.10 (dengan penyesuaian skenario nyata).
| [src/db/schema.ts](src/db/schema.ts) | **TIDAK diubah** |
| `.env.local` | **TIDAK ditambah kunci SMTP di tahap ini**; jika nanti diaktifkan, nilainya di mesin user, bukan di repo (jangan disimpan di Git). |

---

**Status: IMPLEMENTASI — sudah ada dan diuji di environment development; laporan ini mencatat hasil sementara hingga verifikasi lebih lanjut.**

Implementasi provisioning sudah dibuat dan dijalankan. Perubahan skema, migrasi, dan akses production tetap tidak dilakukan dalam laporan ini.
