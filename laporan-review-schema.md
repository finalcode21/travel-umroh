# Laporan Hasil Proses Review & Perbaikan Desain Schema Core `travel-umroh`

| Item | Keterangan |
| --- | --- |
| Tanggal | 13 Oktober 2026 |
| Branch | `development` |
| File yang diubah | [`src/db/schema.ts`](src/db/schema.ts) (satu-satunya file berubah, **belum di-commit**) |
| Status | Review final menunggu persetujuan — tidak ada migrasi yang dijalankan |
| Verifikasi | `lint` exit 0 · `typecheck` exit 0 · `build` exit 0 |

---

## 1. Ringkasan eksekutif

Schema Core ditulis ulang dari 546 → 816 baris (14 tabel, 6 PostgreSQL enum) berdasarkan sembilan persyaratan review. Tiga temuan paling penting:

1. **Package `better-auth` tidak terpasang sama sekali** di proyek (tidak ada di `package.json`, `package-lock.json`, maupun `node_modules`), dan tidak ada kode autentikasi di `src/`. Klaim desain sebelumnya bahwa tabel mengikuti "skema inti Better Auth 1.7" adalah **asumsi yang tidak bisa diverifikasi** — dokumen ini menggantinya dengan verifikasi terhadap dokumentasi resmi Better Auth 1.7.7 dan konfigurasi `modelName` yang harus dipasang saat package benar-benar diinstal.
2. **RBAC lama tidak aman**: `roles.tenant_id` nullable tanpa pembatas, satu-satunya index unique `(tenant_id, code)` tidak melindungi baris `tenant_id NULL` (PostgreSQL menganggap `NULL != NULL`), dan `user_role_assignments` mengizinkan role apa pun kepada identitas mana pun tanpa pemeriksaan keanggotaan tenant. Desain baru memberi **dua scope eksplisit** dengan CHECK + foreign key komposit yang menutup celah tersebut di level database.
3. **Audit log bergantung pada foreign key** (`audit_logs.tenant_id` → `ON DELETE SET NULL`) sehingga jejak bisa kehilangan tautan tenant. Desain baru menjadikan `audit_logs` tabel append-only tanpa FK, dengan snapshot `actor_label`.

---

## 2. Ruang lingkup & batasan yang dipatuhi

| Batasan | Kepatuhan |
| --- | --- |
| Tidak menjalankan `db:push`, generate migrasi, atau migrasi database | ✅ Tidak ada perintah drizzle-kit yang dijalankan (`drizzle/meta/_journal.json` tetap kosong) |
| Tidak menyentuh database Production | ✅ Tidak ada satu pun koneksi database |
| Tidak mengubah atau mencetak secret | ✅ `.env.local` tidak dibaca/diubah |
| Tidak commit schema sebelum review final disetujui | ✅ Perubahan tetap working-tree, branch `development` |
| Mempertahankan perubahan di branch `development` | ✅ `git status`: `M src/db/schema.ts` di `development` |

---

## 3. Verifikasi pemetaan Better Auth (persyaratan 2)

### 3.1 Hasil pemeriksaan package

- `better-auth`: **tidak ditemukan** di `package.json`, `package-lock.json`, dan `node_modules`.
- `@neondatabase/auth` (Neon Auth wrapper): juga tidak ditemukan.
- Tidak ada file `auth.ts` / pemakaian `drizzleAdapter` di `src/`.

**Kesimpulan:** tidak ada "versi package terpasang" yang bisa dijadikan acuan. Pemetaan model diverifikasi terhadap **dokumentasi resmi Better Auth 1.7.7** (versi terbaru saat review) dan hasilnya ditulis sebagai konfigurasi intent di header `src/db/schema.ts`, yang **wajib diverifikasi ulang** setelah package dipasang.

### 3.2 Pemetaan model → tabel (hasil verifikasi dokumentasi)

| Model Better Auth | Nama tabel default | Nama tabel di skema ini | Syarat agar berlaku |
| --- | --- | --- | --- |
| `user` | `user` | `auth_users` | `user: { modelName: "auth_users" }` |
| `session` | `session` | `auth_sessions` | `session: { modelName: "auth_sessions" }` |
| `account` | `account` | `auth_accounts` | `account: { modelName: "auth_accounts" }` |
| `verification` | `verification` | `auth_verifications` | `verification: { modelName: "auth_verifications" }` |

Temuan pada desain sebelumnya: nama tidak konsisten — tabel fisik `auth_user_session` / `auth_user_account` / `auth_user_verification` sedangkan komentar menyebut `auth_account` / `auth_verification`. Semuanya dinormalisasi menjadi bentuk jamak yang seragam.

Konfigurasi lengkap yang didokumentasikan di header skema:

```ts
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: authUsers, session: authSessions,
      account: authAccounts, verification: authVerifications,
    },
  }),
  user: {
    modelName: "auth_users",
    additionalFields: {
      phone:              { type: "string", required: false, input: true,  returned: true },
      platformAccountId:  { type: "string", required: false, input: false, returned: true },
    },
  },
  session:      { modelName: "auth_sessions" },
  account:      { modelName: "auth_accounts" },
  verification: { modelName: "auth_verifications" },
});
```

### 3.3 Kontrak kolom & unique key (core schema 1.7.x)

- `user(id, name, email, emailVerified, image, createdAt, updatedAt)` — kolom tambahan domain (`phone`, `platformAccountId`) hanya lewat `user.additionalFields`.
- `session(id, token, userId, expiresAt, ipAddress, userAgent, …)` — **UNIQUE(token)**.
- `account(id, accountId, providerId, userId, password, …)` — **UNIQUE(provider_id, account_id)**; pasangan inilah kunci identitas provider (dokumen 1.7.x menegaskan `issuer` di 1.7.0–1.7.2 hanya sementara dan tidak lagi berlaku).
- `verification(id, identifier, value, expiresAt, …)` — `identifier` di-**index biasa, bukan unique** (dokumen tidak mewajibkan unique).
- Adapter drizzle **tidak membuat tabel** — DDL sepenuhnya lewat drizzle-kit.

---

## 4. Temuan pada desain sebelumnya

1. Komentar header berisi teks rusak (mojibake, mis. "S较高的 satu account", "satbuat 1 pragui") yang merusak dokumentasi invariant.
2. Header menyebut tabel `users` ("parser ERP, profil okupasi per tenant") yang **tidak pernah didefinisikan** di skema.
3. `permissions` adalah satu-satunya tabel tanpa `updated_at`.
4. `roles` (tenant_id nullable) + `user_role_assignments.tenant_id` nullable = peta NULL yang tidak terdefinisi: `tenant_id NULL` bisa ditafsirkan sebagai superadmin tanpa pengecekan role.
5. Unique `(tenant_id, code)` tidak melindungi role dengan `tenant_id NULL`.
6. `user_role_assignments` hanya unique `(user_id, role_id)` — tidak ada yang menjamin role milik tenant yang sama dengan tenant assignment, maupun bahwa user benar-benar anggota tenant tersebut.
7. `audit_logs.tenant_id` FK `ON DELETE SET NULL` — penghapusan tenant menghapus tautan jejak.

---

## 5. Desain final — tabel & constraint (persyaratan 1, 3, 6)

### 5.1 Daftar tabel (14)

| # | Tabel | Peran | Constraint kunci |
| --- | --- | --- | --- |
| 1 | `accounts` | Akun bisnis platform (bukan identitas login) | `UNIQUE(email)`; index `status` |
| 2 | `tenants` | Tenant pelanggan | `UNIQUE(account_id)` → **1 akun ≤ 1 tenant**; `UNIQUE(slug)`; FK `restrict` ke `accounts` |
| 3 | `installations` | Instalasi ERP per tenant | `UNIQUE(tenant_id)` → **1 tenant ≤ 1 instalasi**; FK `cascade` ke `tenants` |
| 4 | `auth_users` | Identitas login (model `user`) | `UNIQUE(email)`; `UNIQUE(platform_account_id)` (satu identitas pemilik per akun, FK `set null`); core columns 1.7.x |
| 5 | `auth_sessions` | Sesi login | `UNIQUE(token)`; index `user_id`; FK `cascade` |
| 6 | `auth_accounts` | Credential per provider | `UNIQUE(provider_id, account_id)`; index `user_id`; FK `cascade` |
| 7 | `auth_verifications` | Token verifikasi | Index `identifier` (bukan unique); tanpa FK |
| 8 | `tenant_users` **(baru)** | Profil okupasi + keanggotaan staf | `PK(user_id)` → **1 identitas = 1 tenant**; `UNIQUE(user_id, tenant_id)` (jangkar FK); FK `cascade` dua arah; enum `user_status` |
| 9 | `roles` | Role dua scope | CHECK scope↔tenant_id; unique code **per scope** (index parsial); jangkar `(id, scope)` & `(id, tenant_id)` |
| 10 | `permissions` | Katalog izin | `UNIQUE(code)` global; `UNIQUE(scope, resource, action)`; jangkar `(id, scope)`; **`updated_at` ditambahkan** |
| 11 | `role_permissions` | Peran ↔ izin | 2 FK komposit `scope`; `UNIQUE(role_id, permission_id)` |
| 12 | `platform_role_assignments` **(baru)** | Jalur tunggal pemberian role platform | CHECK `scope='platform'` + FK komposit → `roles(id, scope)`; `UNIQUE(user_id, role_id)` |
| 13 | `tenant_role_assignments` **(baru, diganti dari `user_role_assignments`)** | Pemberian role tenant | `tenant_id NOT NULL` + 2 FK komposit; `UNIQUE(user_id, role_id)` |
| 14 | `audit_logs` | Jejak append-only | **Tanpa FK**; index `(tenant, created_at)`, `action`, `(actor_type, actor_id)`, **`(entity_type, entity_id)` baru** |

### 5.2 Enum PostgreSQL (6)

- Dipertahankan: `account_status`, `tenant_status`, `installation_status`, `audit_actor_type`.
- **Baru**: `role_scope ('platform','tenant')`, `user_status ('active','suspended','deactivated')`.
- Nama enum lama tidak diubah (kompatibel bila sebelumnya pernah `db:push`).

### 5.3 Invariant 1:1 (persyaratan 3)

```
accounts ──UNIQUE(account_id)──▶ tenants ──UNIQUE(tenant_id)──▶ installations
   1            ≤ 1                1             ≤ 1                1
```

- DB menjamin **"tidak lebih dari satu"** (unique index); **"tepat satu"** dijamin oleh alur registrasi — constraint database tidak bisa memaksa keberadaan baris.
- `tenants.account_id` FK `ON DELETE RESTRICT`: akun tidak bisa dihapus selama tenant masih ada — relasi akun→tenant→jejak audit terlindungi.

### 5.4 Delete behavior, index, timestamp

- **Cascade** (pembersihan turunan wajar): `installations → tenants`, `tenant_users → tenants/auth_users`, `roles → tenants`, `role_permissions → roles`, kedua assignment → parent-nya.
- **Restrict** (mencegah kehilangan diam-diam): `tenants.account_id → accounts`; `role_permissions.permission_id` — menghapus izin dari katalog diblokir selama masih terpasang pada role.
- **Set null**: `auth_users.platform_account_id → accounts` (identitas bertahan walau akun dihapus).
- Semua `timestamp` memakai `timestamptz` (`withTimezone: true`).
- Index parsial per scope pada `roles` karena index unique biasa tidak melindungi baris NULL.

---

## 6. RBAC dua scope (persyaratan 4)

Prinsip: **tidak ada lagi makna tersembunyi di balik NULL** — `roles.scope` wajib terisi dan diikat ke `tenant_id` oleh CHECK.

```
(scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL)
```

| Persyaratan | Implementasi |
| --- | --- |
| Role platform & tenant dibedakan eksplisit | Kolom `roles.scope` (enum `role_scope`) + CHECK di atas; unique code dipisah lewat index parsial per scope |
| Role platform hanya via assignment yang berwenang | Tabel terpisah `platform_role_assignments`: CHECK `scope='platform'` + FK komposit `(role_id, scope) → roles(id, scope)` — role tenant **ditolak DB**. Otoritas pemberi diverifikasi aplikasi saat insert; `assigned_by` menyimpan jejak pemberi (tanpa FK agar bertahan bila pemberi dihapus) |
| Assignment tenant konsisten dengan tenant role & identitas pengguna | Dua FK komposit pada `tenant_id`: `(user_id, tenant_id) → tenant_users` (user wajib anggota tenant yang sama) dan `(role_id, tenant_id) → roles` (role wajib tenant & milik tenant sama). `tenant_id NOT NULL` |
| `tenant_id NULL` ≠ superadmin | Tidak ada jalur NULL: role platform selalu `scope='platform'` (dengan `tenant_id NULL` yang diikat CHECK), otoritas platform hanya dari `platform_role_assignments` + pengecekan role-nya |
| Izin tidak bocor lintas scope | `role_permissions.scope` + dua FK komposit → role tenant mustahil menerima izin platform dan sebaliknya |

Skenario yang otomatis **ditolak** oleh database:

1. Memberi role tenant lewat `platform_role_assignments` (CHECK scope).
2. Memberi role platform lewat `tenant_role_assignments` (FK ke `roles(id, tenant_id)` — role platform punya `tenant_id NULL`).
3. Assignment dengan tenant ≠ tenant user (FK ke `tenant_users`).
4. Assignment untuk identitas yang tidak punya `tenant_users` row (identitas lingkup platform).
5. Role tenant diberi izin scope platform (FK komposit di `role_permissions`).

---

## 7. Keputusan desain: pengguna internal ERP (persyaratan 5)

**Keputusan: pengguna internal ERP terikat TEPAT SATU tenant.**

- `tenant_users` memiliki `PK(user_id)` ⇒ satu identitas maksimal satu baris profil ⇒ maksimal satu tenant; keanggotaan ganda mustahil di level DB, konsisten dengan model "satu registrasi akun = satu tenant".
- Satu baris `tenant_users` **sekaligus adalah keanggotaan** — tidak perlu tabel membership tambahan; `tenant_role_assignments` wajib merujuk baris ini (FK komposit).
- Identitas **tanpa** baris `tenant_users` = identitas lingkup platform; akses lintas-tenant hanya melalui `platform_role_assignments` + pengecekan role — bukan lewat keanggotaan ganda.
- `tenant_users.status` (`active/suspended/deactivated`) memungkinkan penonaktifan staf tanpa menghapus identitas login.

Alternatif yang dipertimbangkan dan ditolak: keanggotaan multi-tenant via tabel `memberships` — dinilai menambah state konteks tenant per-request dan tidak dibutuhkan Requirement; kebutuhan akses lintas-tenant sudah tercakup oleh scope platform.

---

## 8. Retensi jejak audit (persyaratan 7)

`audit_logs` sengaja **tanpa foreign key**:

- `actor_id` (id identitas) + **`actor_label` baru** (snapshot email/nama saat peristiwa) tetap utuh walau `auth_users`/`accounts` dihapus — jejak tetap terbaca tanpa join.
- `tenant_id` disimpan sebagai nilai: penghapusan tenant tidak mengubah/menghapus baris log, dan keberadaan log tidak memblokir penghapusan tenant.
- Penonaktifan (`status`) tidak menghapus apa pun — jejak selalu utuh.
- `metadata` (jsonb) menyimpan detail hard-snapshot lanjutan.
- Relasi Drizzle `audit_logs → tenants` dipertahankan hanya sebagai query-level (left join menghasilkan `null` bila tenant sudah dihapus).

---

## 9. Relasi antar tabel (persyaratan 9)

```
accounts ──1:1──▶ tenants ──1:1──▶ installations
   │                │
   │ (set null)     ├──1:n──▶ roles ──n:n──▶ permissions   (via role_permissions)
   ▼                │              │
auth_users ──1:1──▶ tenant_users   ├──1:n──▶ tenant_role_assignments ◀──n:1 auth_users
   │  │                 │          └──1:n──▶ platform_role_assignments ◀──n:1 auth_users
   │  ├──1:n──▶ auth_sessions
   │  └──1:n──▶ auth_accounts        audit_logs ──(tanpa FK, query-only)──▶ tenants
   └──1:n──▶ tenant_role_assignments / platform_role_assignments
```

| Relasi | Arah (Drizzle) | Catatan |
| --- | --- | --- |
| `accounts ↔ tenants` | `one—one` | lewat `tenants.account_id UNIQUE` |
| `tenants ↔ installations` | `one—one` | lewat `installations.tenant_id UNIQUE` |
| `auth_users ↔ tenant_users` | `one—one` (opsional) | profil keanggotaan tunggal |
| `auth_users → auth_sessions/auth_accounts` | `one—many` | cascade saat identitas dihapus |
| `auth_users.platformAccount → accounts` | `many—one` | UNIQUE ⇒ tepat satu identitas pemilik per akun |
| `roles ↔ permissions` | `many—many` via `role_permissions` | dibatasi scope lewat 2 FK komposit |
| `tenant_role_assignments →` `tenant_users`, `roles`, `tenants`, `auth_users` | `many—one` ×4 | 2 di antaranya FK komposit |
| `platform_role_assignments →` `auth_users`, `roles` | `many—one` | FK komposit `(role_id, scope)` |
| `audit_logs → tenants` | query-level saja | tanpa FK disengaja |

---

## 10. Hasil verifikasi (persyaratan 8)

| Check | Perintah | Exit status | Keterangan |
| --- | --- | --- | --- |
| Lint | `npm run lint` | **0** | eslint, tanpa warning/error |
| Typecheck | `npm run typecheck` | **0** | `tsc --noEmit` — satu error awal `TS2353` (konfigurasi `many()` drizzle) diperbaiki, lalu lolos |
| Build | `npm run build` | **0** | Next.js 16.4.0 Turbopack, TypeScript selesai, 3 halaman statis |
| Pemeriksaan akhir file | grep nama lama | 0 match | `auth_user_session`/`userRoleAssignments`/dsb. sudah tidak ada |

Checks dijalankan **setelah edit terakhir** pada `src/db/schema.ts`; file tidak berubah lagi setelahnya.

---

## 11. Keterbatasan & risiko tersisa

1. **DDL belum dieksekusi di PostgreSQL.** CHECK, FK komposit, dan index parsial baru tervalidasi di tingkat TypeScript/Drizzle. Validasi SQL nyata sengaja tidak dilakukan (migrasi dilarang). Risiko: typo semantik hanya akan terbaca saat `db:push`/`db:generate` berikutnya.
2. **Pemetaan Better Auth belum terverifikasi terhadap package terpasang** — package memang belum ada. Konfigurasi `modelName` di header skema adalah dokumen intent; wajib diverifikasi ulang setelah `better-auth` diinstal.
3. **Tabel lama mungkin masih ada di database** bila pernah ada `db:push` sebelumnya (`auth_user_session`, `auth_user_account`, `auth_user_verification`) — tidak diperiksa karena database tidak boleh disentuh; pembersihan manual perlu dilakukan saat migrasi pertama.
4. **Penonaktifan per-identitas** (mis. banned global) belum tersedia di `auth_users` — memerlukan Better Auth admin plugin; penonaktifan staf saat ini lewat `tenant_users.status`.
5. **Otoritas pemberi role platform** diverifikasi aplikasi (bukan DB) — `assigned_by` hanya mencatat jejak; saat ada kode aplikasi, guard session pemberi harus ditulis.

---

## 12. Langkah selanjutnya (belum dikerjakan — menunggu persetujuan)

1. Pasang `better-auth` + drizzle adapter; buat `auth.ts` sesuai konfigurasi §3.2; **verifikasi ulang** pemetaan model terhadap package terpasang.
2. Seed `roles`/`permissions` per scope (mis. `platform.superadmin`, `tenant.admin`, `tenant.staff`).
3. Setelah review final disetujui: `db:generate` → inspeksi SQL → push/migrasi (di luar scope laporan ini).
4. Bersihkan tabel `auth_user_*` lama bila ternyata ada di database.

---

## 13. Referensi

- Better Auth — Database core schema: <https://better-auth.com/docs/concepts/database#core-schema>
- Better Auth — Drizzle adapter, modifying table names: <https://better-auth.com/docs/adapters/drizzle#modifying-table-names>
- Better Auth — Extending core schema (`additionalFields`): <https://better-auth.com/docs/concepts/database#extending-core-schema>
- Better Auth — 1.7 upgrade guide (identitas account `(providerId, accountId)`): <https://better-auth.com/docs/guides/1-7-upgrade-guide>
- Better Auth changelog (versi 1.7.7): <https://better-auth.com/changelog>
