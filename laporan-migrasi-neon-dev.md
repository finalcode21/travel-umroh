# Laporan Migrasi Pertama ke Neon Development

Tanggal: 2026-10-14 · Branch Git: `development` · Status: **Migrasi berhasil diterapkan**

## 1. Target yang diverifikasi (bukan tebakan `NEON_BRANCH`)

- Project Neon: `rough-brook-30059963` (travel-umroh)
- Endpoint di `DIRECT_URL` dan `DATABASE_URL`: `ep-dark-meadow-b3ch5el3`
- Mapping endpoint → branch ditarik langsung dari Neon API:
  - `ep-dark-meadow-b3ch5el3` → **`br-shy-tree-b35ibs8d`** = branch **`development`** ✔
  - (endpoint lain di project, `ep-steep-salad-b3i1t6i8`, milik branch production `br-super-hat-b35hg28w` — tidak tersentuh)
- `current_database()` saat eksekusi = **`travel_umroh_db`** ✔
- Database ditemukan **kosong** sebelum migrasi: 0 enum, 0 tabel public, tidak ada tabel bookkeeping drizzle → memang belum pernah dimigrasi.

## 2. Perintah yang dijalankan

1. `npm run db:migrate` (percobaan 1–4) → **exit 1**, database tetap kosong (tidak ada state parsial; seluruh ranjau roll back bersih).
2. Reproduksi dengan migrator `drizzle-orm/neon-serverless` untuk memunculkan error asli.
3. `npm run db:migrate` (percobaan 5) → **exit 0**, sukses.
4. `npx drizzle-kit check` → OK ("Everything's fine").

Catatan: dengan output di-redirect (non-TTY), drizzle-kit menelan pesan errornya — hanya spinner `applying migrations...` lalu exit 1. Error asli hanya terlihat lewat migrator runtime.

## 3. Penyebab kegagalan awal & perbaikan minimal

Error asli:

```
ALTER TABLE "platform_role_assignments" ADD CONSTRAINT
"platform_role_assignments_role_scope_fkey" FOREIGN KEY ("role_id","scope")
REFERENCES "public"."roles"("id","scope") ...;
→ error: there is no unique constraint matching given keys for referenced table "roles"
```

SQL migration yang sudah disetujui membuat FK komposit **sebelum** unique index yang menjadi targetnya. Empat FK terkena dampaknya: `platform_role_assignments(role_id,scope)`, `role_permissions(role_id,scope)`, `role_permissions(permission_id,scope)`, `tenant_role_assignments(role_id,tenant_id)`, dan `tenant_role_assignments(user_id,tenant_id)` terhadap `tenant_users(user_id,tenant_id)`.

Perbaikan (bukan regenerasi — [drizzle/0000_quiet_dragon_lord.sql](drizzle/0000_quiet_dragon_lord.sql)): **4 statement `CREATE UNIQUE INDEX` dipindah ke sebelum blok `ALTER TABLE ... FOREIGN KEY`**:

- `roles_id_scope_unique (id, scope)`
- `roles_id_tenant_unique (id, tenant_id)`
- `permissions_id_scope_unique (id, scope)`
- `tenant_users_user_tenant_unique (user_id, tenant_id)`

Isi statement tidak diubah sama sekali, hanya urutan. Snapshot/Journal dan `drizzle-kit check` tetap konsisten.

## 4. Verifikasi struktur hasil di Neon Development

Dikunjuk langsung melalui `DIRECT_URL` ke endpoint development:

- Enum: **6** — `account_status`, `audit_actor_type`, `installation_status`, `role_scope`, `tenant_status`, `user_status`
- Tabel public: **14** — `accounts`, `audit_logs`, `auth_accounts`, `auth_sessions`, `auth_users`, `auth_verifications`, `installations`, `permissions`, `platform_role_assignments`, `role_permissions`, `roles`, `tenant_role_assignments`, `tenant_users`, `tenants`
- FK: **14**
- CHECK: **2** — `roles_scope_tenant_check`, `platform_role_assignments_scope_check`
- Index: **52** total (33 UNIQUE, termasuk partial unique index `roles_platform_code_unique` & `roles_tenant_code_unique` dan unique komposit yang dipindahkan)
- Record buku besar migrasi: **1** baris di `drizzle.__drizzle_migrations`, hash `eed180f8...e90d65443`, sesuai tag journal `0000_quiet_dragon_lord`

## 5. Keamanan & batasan laporan

- Secret dan connection string tidak pernah ditampilkan; env hanya dibaca programatik.
- Production (`br-super-hat-b35hg28w`) tidak diakses untuk tulis maupun baca isi database.
- Tidak ada commit/push. Lint/typecheck/build tidak diulang karena tidak ada perubahan kode TS.

## 6. Catatan tersisa

- `drizzle-kit migrate` menelan pesan errornya saat stdout non-TTY — untuk percobaan berikutnya, jalankan di terminal interaktif agar error terlihat.
- Klaim laporan sebelumnya bahwa migrasi "berhasil dijalankan" ke development ternyata tidak akurat: bookkeeping migrasi tidak ada di database development sebelum percobaan ini. Tidak ada bukti migrasi 0000 berdampak ke branch lain yang bisa diperiksa tanpa menyentuh production.
