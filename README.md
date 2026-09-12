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
   | `peran`     | string  | `superadmin`                    |
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
- [x] Autentikasi (`/login`) & konteks peran (`src/shared/lib/auth-context.tsx`, `RequireAuth`, `AppShell`) — SUPERADMIN/Kasir/Purchasing
  - Pemisahan tugas: halaman input operasional (`/shift`, `/belanja-nota`) hanya bisa dibuka oleh Kasir/Purchasing masing-masing — Owner TIDAK melakukan input harian ini, cukup memantau lewat Dashboard/Riwayat/Notifikasi. `firestore.rules` tetap memberi Owner (superadmin) akses baca/tulis penuh di backend sebagai admin override (audit/koreksi data), hanya UI-nya yang disembunyikan.
  - Bisa masuk pakai Email ATAU Username (lihat koleksi `usernames/{username}` di firestore.rules), tombol Masuk dengan Google, dan Lupa Kata Sandi
  - **Wajib diaktifkan manual di Firebase Console** sebelum dipakai: Authentication → Sign-in method → aktifkan **Email/Password** dan **Google**
- [x] Kalkulator HPP versi manual + komponen persentase (`/kalkulator-hpp`)
  - Logika murni & teruji: `src/shared/lib/hpp-calculator.ts` (14 unit test)
  - **Tersambung Firestore**: menulis `menu_harga/{menuId}` (publik) + `menu/{menuId}` (privat) sekaligus, sesuai pemisahan keamanan PRD 6.3
- [x] Dashboard Analitik dasar (`/dashboard`) — kartu Omset & Laba Bersih hari ini + ringkasan bulan berjalan, dibaca dari `summary_harian`/`summary_bulanan`
- [x] Shift — Buka/Tutup Shift, Input Penjualan, Kas Keluar (`/shift`)
- [x] Belanja & Nota — kas belanja, item, riwayat harga, notifikasi kenaikan harga >10%, upload foto nota ke Cloudinary (`/belanja-nota`)
- [x] Kelola Akun — buat akun staff (aplikasi Firebase kedua agar sesi Owner tidak ikut ter-log-out) & aktif/nonaktifkan akun (`/kelola-akun`)
- [x] Riwayat shift dasar (`/riwayat`) & Pusat Notifikasi dasar (`/notifikasi`)

**Batasan yang disengaja pada versi P0 ini (lihat komentar kepala tiap
file terkait untuk detail teknisnya), menyusul sebagai P1:**

- **HPP terjual & Laba Bersih belum otomatis terhitung di Shift/Dashboard.**
  Ini bukan bug yang terlewat — Kasir memang TIDAK BOLEH bisa membaca HPP
  (koleksi `menu` privat khusus Owner, PRD 6.3), sehingga Kasir juga tidak
  bisa menuliskan `hppSnapshot` yang bisa dipercaya saat mencatat
  penjualan. Rekonsiliasi laba (mencocokkan penjualan dengan HPP terkini)
  perlu dikerjakan dari sisi Owner — belum dibangun di pass ini.
- Dashboard belum punya grafik tren, perbandingan periode kontekstual,
  atau pita peringatan otomatis (PRD 9.1) — baru kartu angka hari ini/bulan ini.
- Riwayat belum ada filter tanggal, laporan bulanan/tahunan, atau Export
  Excel/PDF (PRD 9.6).
- Notifikasi belum ada badge jumlah belum-dibaca di ikon lonceng Nav.
- Belanja & Nota belum ada deteksi nota duplikat, dan bahan baru dibuat
  langsung dari form ini (belum ada halaman kelola inventaris tersendiri).
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
