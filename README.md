# SRASA BOOK

Aplikasi accounting pendamping Majoo POS — omset, kas, dan HPP dalam satu
layar. Lihat PRD lengkap untuk konteks bisnis, rumus, dan roadmap.

Firebase project: `srasa-book` (Spark Plan).

## Layout & Palet Warna

Semua halaman terautentikasi memakai satu kerangka yang sama:
`src/shared/components/app-shell.tsx` (`AppShell`) — sidebar navigasi hijau
emerald di kiri (jadi drawer geser di layar mobile), konten di kanan. Palet
warna (latar bertona mint, gradien kartu hero, warna chart) didefinisikan
sebagai CSS variable di `src/app/globals.css` (`--color-app-bg`,
`--color-brand*`, `--color-chart-*`) — ubah di satu tempat itu untuk
mengubah nuansa di seluruh aplikasi. Dashboard (`src/app/dashboard/`) memakai
[Recharts](https://recharts.org) untuk grafik tren garis & donut.

## Aturan Struktur Proyek (WAJIB dibaca sebelum menambah halaman)

**Satu route = satu folder**, mengikuti konvensi Next.js App Router secara
alami:

```
src/
├── app/
│   ├── <nama-route>/
│   │   ├── page.tsx           # wajib — ini yang membuat route publik
│   │   ├── < komponen-lain>.tsx  # colocated, HANYA dipakai halaman ini
│   │   └── ...
│   ├── layout.tsx              # root layout (ToastProvider dibungkus di sini)
│   └── globals.css
│
├── shared/
│   ├── components/   # HANYA isi yang dipakai ≥2 halaman (Rule of Two)
│   ├── lib/           # logika bisnis murni (kalkulator, format), Firebase client
│   └── types/         # tipe data yang dipakai lintas halaman
```

Aturan intinya: kalau sebuah komponen/fungsi baru dipakai SATU halaman,
biarkan dia hidup di dalam folder halaman itu (`app/<route>/`). Baru
pindahkan ke `src/shared/` begitu halaman KEDUA butuh hal yang sama persis
("Rule of Two"). Jangan bikin folder `hooks/`, `utils/`, `services/` global
di awal kalau isinya masih kosong.

Detail lebih lanjut ada di komentar kepala tiap file — file yang menjadi
besar (misalnya nanti halaman Tutup Shift) tetap boleh satu file besar,
asal diberi penanda `// SECTION: ...` yang konsisten.

## Menjalankan Proyek

```bash
npm install
cp .env.local.example .env.local   # isi kredensial Firebase/Cloudinary nanti
npm run dev
```

Buka http://localhost:3000 — akan diarahkan otomatis ke `/login`, lalu ke
beranda sesuai peran akun (Owner → `/dashboard`, Kasir → `/shift`,
Purchasing → `/belanja-nota`). Staff berikutnya (setelah Owner pertama ada)
dibuat lewat `/kelola-akun` — TIDAK perlu lagi lewat Firebase Console manual.

## Membuat Akun Owner Pertama (WAJIB, manual, sekali saja)

Akun pertama tidak bisa dibuat lewat `/kelola-akun` (halaman itu sendiri
mensyaratkan sudah login sebagai Owner). Jadi khusus akun PERTAMA ini, buat
langsung di Firebase Console:

1. **Authentication → Sign-in method** → aktifkan provider **Email/Password**
   dan **Google** (untuk tombol "Masuk dengan Google" di halaman Login).
2. **Authentication → Users → Add user** → isi Email & Password akun Owner
   → simpan → salin **User UID** yang muncul.
3. **Firestore Database → Data → Start collection** → Collection ID: `users`
   → Document ID: **tempel UID dari langkah 2** → isi field:
   | Field       | Tipe    | Nilai                          |
   | ----------- | ------- | ------------------------------- |
   | `nama`      | string  | nama Owner                      |
   | `email`     | string  | sama seperti langkah 2          |
   | `username`  | string  | username pilihan (huruf kecil, tanpa spasi) |
   | `nomorHp`   | string  | boleh dikosongkan, isi menyusul |
   | `peran`     | string  | `superadmin` (akun Owner pertama — akun Finance dibuat belakangan lewat `/kelola-akun`, bukan lewat langkah manual ini) |
   | `aktif`     | boolean | `true`                          |
4. **Firestore Database → Data → Start collection** (dari root, sejajar
   dengan `users`) → Collection ID: `usernames` → Document ID: **username
   yang sama seperti langkah 3** → isi field:
   | Field   | Tipe   | Nilai                   |
   | ------- | ------ | ------------------------ |
   | `uid`   | string | UID dari langkah 2       |
   | `email` | string | sama seperti langkah 2   |
5. **Firestore Database → Rules** → tempel isi `firestore.rules` dari
   proyek ini → **Publish**.

Setelah ini, akun Owner bisa login lewat Email ATAU Username yang baru
dibuat. Staff (Kasir/Purchasing) berikutnya semuanya dibuat lewat halaman
`/kelola-akun` di aplikasi — tidak perlu ulangi langkah manual ini lagi.

## Skrip yang Tersedia

| Perintah           | Fungsi                                             |
| ------------------ | --------------------------------------------------- |
| `npm run dev`       | Jalankan server pengembangan                        |
| `npm run build`     | Build produksi (dijalankan Vercel saat deploy)       |
| `npm run lint`      | ESLint                                               |
| `npm run test`      | Jalankan seluruh unit test sekali (Vitest)           |
| `npm run test:watch`| Unit test mode watch, dipakai saat coding            |

## Status Implementasi (lihat PRD bagian 13 untuk roadmap lengkap)

Seluruh halaman P0 (dasar) sudah ada dan saling terhubung lewat Login +
peran, memakai Firestore & Cloudinary sungguhan (bukan simulasi lagi):

- [x] Sprint 0 — Fondasi proyek (Next.js, TypeScript, Tailwind, struktur folder)
- [x] Autentikasi (`/login`) & konteks peran (`src/shared/lib/auth-context.tsx`, `RequireAuth`, `AppShell`) — SUPERADMIN (Owner) / Finance / Kasir / Purchasing
  - Pemisahan tugas: halaman input operasional (`/shift`, `/belanja-nota`) hanya bisa dibuka oleh Kasir/Purchasing masing-masing — Owner TIDAK melakukan input harian ini, cukup memantau lewat Dashboard/Riwayat/Notifikasi. `firestore.rules` tetap memberi Owner (superadmin) akses baca/tulis penuh di backend sebagai admin override (audit/koreksi data), hanya UI-nya yang disembunyikan.
  - Peran **Finance** aksesnya SENGAJA dibuat setara penuh dengan Owner (Dashboard, Kalkulator HPP, Kelola Akun, Riwayat, Notifikasi) — lihat komentar `isSuperadmin()` di `firestore.rules` yang menjelaskan alasannya. Dibuat lewat `/kelola-akun` sama seperti staff lain (pilih "Finance" di dropdown Peran).
  - "Tutup Shift" BUKAN menu terpisah di sidebar — itu kartu di bagian bawah halaman `/shift` (setelah Buka Shift + input penjualan), muncul otomatis begitu Kasir sudah membuka shift hari itu.
  - Bisa masuk pakai Email ATAU Username (lihat koleksi `usernames/{username}` di firestore.rules), tombol Masuk dengan Google, dan Lupa Kata Sandi
  - **Wajib diaktifkan manual di Firebase Console** sebelum dipakai: Authentication → Sign-in method → aktifkan **Email/Password** dan **Google**
- [x] Kalkulator HPP + **Resep otomatis** (`/kalkulator-hpp`)
  - HPP Bahan per porsi TIDAK LAGI diinput manual — dihitung otomatis dari
    Resep (bahan + takaran, satuan gram/pcs) × harga bahan terkini di
    `bahan_baku`. Resep tersimpan di `menu/{menuId}/resep/{bahanId}` (lihat
    `src/shared/lib/resep.ts`) dan juga dipakai Kasir untuk mengurangi stok
    gudang otomatis saat mencatat penjualan (lihat poin Shift di bawah).
  - Logika breakdown biaya (susut/utilitas/tenaga kerja/overhead) tetap
    fungsi murni & teruji: `src/shared/lib/hpp-calculator.ts` (14 unit test)
  - **Tersambung Firestore**: menulis `menu_harga/{menuId}` (publik) + `menu/{menuId}` (privat, breakdown biaya) + `menu/{menuId}/resep/{bahanId}` (bahan+takaran, boleh dibaca Kasir) sekaligus, sesuai pemisahan keamanan PRD 6.3
  - Belum ada halaman "edit menu yang sudah ada" — hanya bisa membuat menu
    baru dari form ini (batasan lama, bukan baru di pass ini).
- [x] Dashboard Analitik (`/dashboard`) — kartu Omset & **Laba Bersih OTOMATIS** hari ini + ringkasan bulan berjalan, dibaca dari `summary_harian`/`summary_bulanan`
  - Laba Bersih & HPP Terjual dihitung OTOMATIS setiap Dashboard dibuka
    (bukan manual lagi) — lihat `src/shared/lib/laba-harian.ts`: jumlahkan
    qty terjual per menu dari semua shift hari itu, kalikan HPP per porsi
    TERKINI (dari Resep + harga bahan sekarang), kurangi Total Kas Keluar.
    Kasir/Purchasing SAMA SEKALI tidak terlibat dalam kalkulasi ini —
    hanya sisi Owner/Finance yang boleh baca harga bahan.
  - Untuk hari-hari LAMPAU, gunakan kartu "Hitung Ulang Laba Bersih" di
    halaman Riwayat (backfill manual, dijelaskan di bawah).
- [x] Shift — Input Penjualan, Kas Keluar, Tutup Shift Hari Ini (`/shift`)
  - Modal Kas Awal FLAT Rp500.000 setiap hari, reset otomatis tiap hari (tidak mewarisi sisa kas hari sebelumnya) — TIDAK ADA lagi langkah "Buka Shift" manual, shift hari ini langsung disiapkan otomatis begitu Kasir membuka halaman. Lihat komentar kepala `src/app/shift/page.tsx` untuk detailnya.
  - **Stok gudang berkurang/bertambah otomatis** setiap qty penjualan
    berubah, lewat Resep menu yang bersangkutan (`src/shared/lib/resep.ts`)
    — Kasir tidak pernah melihat harga bahan, hanya takarannya.
  - Selisih Kas BOLEH minus (Kasir tetap bisa Tutup Shift), tapi WAJIB diisi
    keterangan bila ada selisih. Selisih negatif otomatis tercatat sebagai
    **Tanggungan Kasir** (`tanggungan_kasir`) untuk dasar tuntutan ganti
    rugi — Owner/Finance menandai lunas dari halaman Riwayat.
- [x] Belanja & Nota — kas belanja, item, riwayat harga, notifikasi kenaikan harga >10%, upload foto nota ke Cloudinary (`/belanja-nota`)
  - Purchasing input **Total Harga Dibayar** + Jumlah Dibeli (satuan gram/pcs)
    — harga per satuan (mis. Rp/gram) DIHITUNG OTOMATIS (total ÷ jumlah),
    tidak perlu dihitung manual.
  - Setiap belanja otomatis MENAMBAH stok gudang (`bahan_baku.stokSaatIni`)
    — sebelumnya stok tidak pernah bertambah sama sekali (celah yang
    diperbaiki di pass ini).
  - **Stok Rusak/Kedaluwarsa**: keluarkan bahan dari stok TANPA penjualan,
    wajib foto sebagai bukti, TIDAK PERLU persetujuan Owner (langsung
    berlaku begitu foto terunggah) — lihat `bahan_baku/{id}/penyesuaian_stok`.
- [x] Kelola Akun — buat akun staff (aplikasi Firebase kedua agar sesi Owner tidak ikut ter-log-out) & aktif/nonaktifkan akun (`/kelola-akun`)
- [x] Riwayat shift (`/riwayat`) — daftar shift, **Tanggungan Kasir** (selisih kas minus belum lunas + tombol Tandai Lunas), dan **Hitung Ulang Laporan Harian** (menghitung ulang omset/kas keluar/selisih kas/HPP/laba suatu tanggal dari data shift aslinya, lalu menimpanya — sekaligus jadi pemulihan bila ringkasan harian meleset) — & Pusat Notifikasi dasar (`/notifikasi`)

**Perbaikan bug penting (pasca-rilis fitur Resep + Inventaris):**

- **Shift tidak lagi dobel.** Sebelumnya pencarian shift menyaring
  `status == "buka"`, sehingga begitu Kasir menekan Tutup Shift layarnya
  tersangkut di spinner, dan memuat ulang halaman akan MEMBUAT shift kedua
  di hari yang sama (modal Rp500.000 dobel + `jumlahShift` terhitung dua
  kali). Sekarang shift hari ini ditemukan apa pun statusnya, dan bila
  sudah ditutup Kasir melihat layar "Shift hari ini sudah ditutup".
  Statusnya juga disimpan sebagai `terkunci` supaya Security Rules ikut
  menolak perubahan dari Kasir, bukan hanya UI-nya.
- **Harga bahan murah tidak lagi jadi Rp0.** Harga per satuan dulu
  dibulatkan (`Math.round`), padahal bahan bervolume besar harganya
  pecahan — air galon isi ulang Rp6.000 ÷ 19.000 ml = Rp0,32/ml
  membulat jadi 0, artinya bahan itu dihitung GRATIS selamanya di HPP.
  Nilai pecahan kini disimpan apa adanya; pembulatan hanya di tampilan
  (`formatRupiahSatuan`, ada unit test-nya di `format.test.ts`).
- **Laba Bersih tidak lagi minus palsu sepanjang hari.** Omset dulu
  diambil dari field `shift.totalOmset` yang baru terisi saat Tutup
  Shift, sementara HPP dihitung dari subkoleksi `penjualan` yang terisi
  sejak pagi — hasilnya Dashboard menampilkan omset 0 dengan HPP penuh.
  Keduanya kini bersumber dari `penjualan` yang sama.
- **Menu & resep sekarang bisa diedit.** Kalkulator HPP dulu selalu
  membuat `menuId` baru setiap Simpan, jadi salah takaran sekali berarti
  salah selamanya (menu kembar, dan resep lama tetap dipakai Kasir untuk
  mengurangi stok). Sekarang ada pilihan "Ubah: <nama menu>" yang memuat
  resep tersimpan; bahan yang dibuang ikut dihapus dokumennya.
- **Stok minus ditampilkan terang-terangan** di Belanja & Nota. Stok
  minus selalu berarti ada yang keliru (takaran resep kebesaran atau
  pembelian belum dicatat), jadi tidak lagi dibiarkan diam.
- **Tombol +/− penjualan nonaktif sampai resep selesai dimuat**, supaya
  penjualan tidak sempat tercatat tanpa stok gudang ikut berkurang.

**Keputusan/penyederhanaan yang sengaja diambil pada fitur Resep +
Inventaris otomatis (baca komentar kepala file terkait untuk detail):**

- Satuan bahan baku dibatasi HANYA `gram` atau `pcs` — TIDAK ADA konversi
  kg/liter + faktor konversi seperti draft awal PRD 8.3. Purchasing input
  langsung dalam satuan pakai.
- Harga bahan = harga pembelian TERAKHIR saja (bukan rata-rata bergerak 3
  pembelian terakhir seperti draft awal PRD 8.3) — penyederhanaan yang
  sudah ada sejak modul Belanja & Nota pertama kali dibuat.
- Profil Cafe (persentase susut/utilitas/tenaga kerja/overhead default)
  masih berupa konstanta di kode (`PROFIL_HPP_DEFAULT_AWAL` di
  `src/shared/lib/hpp-calculator.ts`), BELUM ada halaman Firestore
  tersendiri — Kalkulator HPP dan kalkulasi Laba Bersih otomatis
  memakai konstanta yang SAMA supaya tetap konsisten satu sama lain.
- Laba Bersih di Dashboard dihitung ULANG setiap halaman dibuka (bukan
  terus-menerus real-time) — buka ulang halaman untuk angka terbaru
  sepanjang hari.
- Modal Kas Awal flat Rp500.000 berlaku PER KASIR PER HARI. Bila dalam
  satu hari ada lebih dari satu akun Kasir yang bertugas, masing-masing
  mendapat shift sendiri dengan modal Rp500.000 sendiri.
- Laba Bersih = Total Omset − HPP Terjual − Total Kas Keluar. Total
  Belanja (`kas_belanja`) SENGAJA tidak dikurangkan lagi di rumus ini —
  itu sudah "menjadi" HPP Terjual begitu bahannya terpakai lewat Resep,
  jadi mengurangkannya lagi akan menghitung dua kali.

**Batasan lain yang masih P1/P2 (lihat PRD bagian 13 untuk roadmap lengkap):**

- Dashboard belum punya toggle periode grafik Mingguan/Bulanan/Tahunan
  (PRD 9.1) — baru tren Harian 7 hari.
- Riwayat belum ada filter tanggal, laporan bulanan/tahunan, atau Export
  Excel/PDF (PRD 9.6).
- Notifikasi belum ada badge jumlah belum-dibaca di ikon lonceng Nav.
- Belanja & Nota belum ada deteksi nota duplikat.
- Alur "Ajukan Koreksi" (tiket approval, PRD 7.5) untuk data yang sudah
  terkunci belum dibangun sebagai UI (skema `tiket_approval` sudah ada di
  firestore.rules, siap dipakai nanti).
- Analisis Produk, Saran Strategi, Catatan Owner, Export Excel/PDF, dan
  Backup JSON (PRD 9.5, 9.8, 9.10) — sepenuhnya belum dikerjakan (P1/P2).

## Sebelum Menyambungkan Firebase (Sprint 1 lanjutan)

1. Buat **dua** proyek Firebase terpisah (dev & produksi) — PRD bagian 17.2.
   Jangan pakai satu proyek untuk keduanya.
2. Aktifkan Firestore dan Authentication (Email/Password) di kedua proyek.
3. Isi `.env.local` dari `.env.local.example` dengan kredensial proyek **dev**.
4. Tambahkan `src/shared/lib/firebase.ts` yang membaca `NEXT_PUBLIC_FIREBASE_*`
   dari environment variables — belum dibuat di scaffold ini supaya tidak ada
   kode yang menganggur menunggu kredensial sungguhan.
5. Firestore Security Rules ditulis dan diuji dengan Firebase Emulator
   SEBELUM ada data sungguhan Owner masuk (PRD bagian 6.3 & 17.3) — jangan
   ditunda sampai Sprint 4 kalau bisa dihindari.
