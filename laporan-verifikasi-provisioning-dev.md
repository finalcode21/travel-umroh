# Laporan Verifikasi Provisioning travel-umroh — Development

**Branch:** `development`
**Lokasi:** workspace `travel-umroh`
**Tanggal:** 14 Oktober 2026
** Scope:** verifikasi implementasi provisioning yang sudah ada, bukan review rancangan ulang.

## 1. Tujuan

Verifikasi implementasi provisioning yang sudah ada, lalu tutup kekurangan pengujian yang tidak tercakup di smoke biasa, dengan batasan:

- hanya Neon Development yang diakses;
- tidak mengakses Production;
- tidak mengubah schema;
- tidak menjalankan migrasi atau `db:push`;
- tidak melakukan commit/push;
- tidak menampilkan `.env.local` atau kredensial apa pun.

## 2. Ruang lingkup yang diverifikasi

1. Konten implementasi yang ada:
   - `src/lib/provisioning.ts`
   - `src/lib/slug.ts`
   - `src/lib/authz.ts`
   - `src/app/api/auth/[...all]/route.ts`
   - `scripts/provision-smoke.ts`
2. Kasus paralel provisioning untuk `userId` yang sama, dengan jalur sesungguhnya (bukan pemanggilan berurutan semata).
3. Kasus retry setelah commit berhasil tapi respons dianggap hilang, dengan penekanan pada audit `tenant.created` dan `installation.created`.
4. Kasus rollback dengan penyuntikan kegagalan, dengan penekanan pada tidak ada data provisioning parsial dan identitas Better Auth tetap ada.
5. Otorisasi endpoint terlindungi.
6. Typecheck, lint, dan smoke/verifikasi terkait.
7. Status perubahan file, tanpa menampilkan isi `.env.local` atau kredensial.

## 3. Implementasi yang ada

Yang ditemukan:
- `src/lib/provisioning.ts` ada dan berisi `provisionTenantFromSignup` serta helper `writeAuditIfMissing`.
- `src/lib/slug.ts` ada; `toSlug`, `suggestSlug`, `shortHash`.
- `src/lib/authz.ts` ada; `getRolesForUser`, `getPermissionsForUser`, `hasPermission`.
- Route handler auth ada di `src/app/api/auth/[...all]/route.ts`.

Yang tidak ditemukan dalam penelusuran cepat:
- Server Action `use server` untuk registrasi/rekayasa provisioning.
- Route API terlindungi khusus untuk uji otorisasi tenant.
- Halaman register aplikasi yang menjembatani auth + provisioning.

Akibatnya, sebagian tujuan verifikasi (terutama otorisasi endpoint terlindungi) tidak dapat dijalankan persis seperti diminta, karena endpoint/Server Action tersebut tidak ada dalam project saat ini.

## 4. Hasil perintah

### 4.1 Typecheck
Perintah:
- `npm run typecheck`

Hasil:
- Lolos; tidak ada error.

Catatan:
- Sebelumnya typecheck gagal di `scripts/provision-verify.ts` karena narrowing discriminated union tidak diakui compiler pada variabel `winner`, `first`, dan `second`. Setelah penambahan pemeriksaan eksplisit pada variabel yang bersangkutan, typecheck 다시 lolos.

### 4.2 Lint
Perintah:
- `npm run lint`

Hasil:
- Lolos; hanya warning.

Contoh warning yang muncul:
- `no-console` di beberapa file skrip.
- `@typescript-eslint/no-unused-vars` di beberapa variabel skrip (untuk beberapa variabel lokal yang tidak dipakai di lokasi tertentu).

Kesimpulan sementara:
- Tidak ada error lint yang menghalangi verifikasi di Development.

### 4.3 Smoke provisioning biasa
Skrip:
- `scripts/provision-smoke.ts`

Status saat laporan ini:
- Dijalankan pada sesi sebelum laporan ini; hasilnya mencerminkan perilaku saat itu.
- Beberapa kasus lolos; beberapa kasus gagal dengan alasan konflik/perilaku provisioning yang tidak sesuai ekspektasi smoke.

Untuk keperluan laporan ini, poin pentingnya bukan hanya daftar PASS/FAIL lama, melainkan bahwa smoke biasa belum cukup untuk:
- membuktikan paralel sesungguhnya,
- membuktikan retry dengan respons hilang,
- membuktikan rollback terkontrol.

### 4.4 Verifikasi tambahan
Skrip:
- `scripts/provision-verify.ts`

Perintah:
- `npx tsx scripts/provision-verify.ts`

Hasil:
- `PASS  parallel provisioning user sama: satu lolos, satu conflict, audit tidak terduplikasi`
- `FAIL  retry respons hilang :: retry setelah commit berhasil harus sukses/idempoten; dapat: identitas sudah terikat ke akun bisnis lain`
- `PASS  rollback kegagalan di awal transaksi: tidak ada data provisioning parsial, auth_user tetap ada`
- Total: 1 gagal.

Interpretasi hasil gagal:
- Setelah provisioning pertama commit, `platformAccountId` pada `auth_user` sudah terisi.
- Provisioning kedua untuk user dan email yang sama kemudian ditolak dengan `identitas sudah terikat ke akun bisnis lain`.
- Sehingga skrip verifikasi tidak sampai ke tahap “audit tidak terduplikasi” untuk kasus respons hilang.
- Ini adalah perbedaan antara harapan skrip (“retry setelah commit berhasil harus sukses/idempoten”) dan perilaku implementasi saat ini (penolakan karena identitas sudah terikat).

## 5. Temuan

### 5.1 Ditemukan (sesuai batasan Development)

- Parallel provisioning untuk user yang sama dapat menghasilkan satu lolos dan satu conflict, dengan audit tetap tidak terduplikasi.
- Rollback terkontrol (kegagalan provisioning terkontrol) tidak meninggalkan data provisioning parsial dan identitas tetap ada.
- Audit log `tenant.created` / `installation.created` tidak terduplikasi pada jalur paralel yang berhasil dalam verifikasi tambahan.

### 5.2 Tidak dapat diselesaikan / perlu keputusan

- Kasus “retry respons hilang” tidak lulus karena implementasi saat ini menolak retry kedua setelah akun bisnis terikat.
- Otorisasi endpoint terlindungi tidak dapat diuji karena endpoint/Server Action tersebut tidak ditemukan dalam project saat ini.

### 5.3 Keterbatasan metodologi

- Paralel yang diuji di sini adalah paralel dalam satu proses skrip menggunakan `Promise.all`; ini lebih baik daripada pemanggilan berurutan, tapi masih berada dalam satu runtime dan satu tag uji Development.
- Validasi produksi sejati tentang konsistensi transaksi dan isolasi masih terbatas pada Development dan perlu tinjauan arsitektur deployment jika nanti dipublikasikan.

## 6. Rekomendasi tindak lanjut

1. **Putuskan kontrak retry respons hilang.**
   - Jika retry kedua untuk user/email yang sama mestinya idempoten, perilaku saat ini perlu disesuaikan supaya tidak menolak berdasarkan `platformAccountId` yang sudah terisi.
   - Jika penolakan adalah intended, skrip verifikasi harus disesuaikan dengan kontrak tersebut, bukan sebaliknya.
   - Putuskan ini sebelum menyatakan tahap provisioning “selesai”.

2. **Tambahkan endpoint/Server Action terlindungi atau tunda uji otorisasi.**
   - Jika tujuan verifikasi otorisasi penting untuk tahap ini, tambahkan route/Server Action demo kecil di Development yang menggunakan `getPermissionsForUser`/`hasPermission` dari `src/lib/authz.ts`, lalu uji:
     - user tanpa tenant ditolak,
     - user tenant A tidak bisa akses resource tenant B.

3. **Pertimbangkan peningkatan paralel dan konsistensi.**
   - Jika proses deployment nanti akan berjalan di lingkungan yang lebih kompetitif, pertimbangkan uji lanjutan yang lebih kompetitif atau pemeriksaan konsistensi audit yang lebih ketat.

4. **Pertimbangkan pembersihan warnings.**
   - Warning lint yang ada tidak memblokir, tapi cukup banyak di file skrip; bisa ditinjau secara kecil-kecil jika diinginkan.

## 7. Lingkungan dan batasan yang dipatuhi

- Semua uji hanya di Neon Development.
- Tidak ada akses Production.
- Tidak ada perubahan schema.
- Tidak ada migrasi atau `db:push`.
- Tidak ada commit/push.
- Tidak ada penampilan `.env.local` atau kredensial dalam laporan ini.

## 8. Status akhir

- **Typecheck:** lolos.
- **Lint:** lolos (hanya warning).
- **Parallel provisioning (userId sama):** lolos.
- **Rollback dengan penyuntikan kegagalan:** lolos.
- **Retry respons hilang:** **gagal / belum sesuai kontrak skrip**; perlu keputusan perilaku.
- **Otorisasi endpoint terlindungi:** **tidak dapat dijalankan** karena endpoint/Server Action belum ada.

Status keseluruhan:
- Implementasi provisioning sudah ada dan punya bukti perilaku positif di beberapa kasus Development.
- Namun tahap provisioning **belum sepenuhnya selesai** untuk tujuan verifikasi ini karena ada kasus tidak lulus dan ada tujuan verifikasi yang tidak dapat dijalankan.

## 9. Rekomendasi tahap berikutnya (jika kriteria dinyatakan terpenuhi nanti)

Jika kontrak retry ditetapkan ulang dan endpoint otorisasi ditangani, langkah berikutnya yang masuk akal:
- Registrasi/Server Action integrasi provisioning,
- Halaman registrasi kemitraan,
- Pengujian otorisasi tenant yang lebih lengkap,
- Evaluasi deployment dan penyesuaian lingkungan produksi jika digunakan.

---

Laporan ini dibuat dari hasil perintah yang dijalankan di Development dan dari kode yang ada pada saat verifikasi.
