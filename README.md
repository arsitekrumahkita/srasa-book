# Jurnal F A T A — Food n Beverages Lifestyle Accounting

Aplikasi accounting pendamping Majoo POS — omset, kas, dan HPP dalam satu
layar. **Jurnal F A T A** adalah nama aplikasi/brand globalnya (sebelumnya
"ARCHIMAX", dan sebelum itu "SRASA BOOK"); **SRASA BOOK**
adalah nama Outlet PERTAMA di dalamnya (lihat bagian Multi-Cabang di
bawah — aplikasi ini sekarang mendukung banyak Outlet/cabang dalam satu
akun Owner terpusat). Lihat PRD lengkap untuk konteks bisnis, rumus, dan
roadmap.

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

Efek animasi SENGAJA dibuat sederhana & minimalis (bukan mencolok) —
utility class `.animasi-masuk` (fade + geser naik tipis) dan
`.kartu-interaktif` (kartu sedikit terangkat saat disorot) didefinisikan
di `src/app/globals.css`, dipakai di kartu-kartu Dashboard dan transisi
daftar↔form di Kelola Produk. Tetap tunduk pada blok
`prefers-reduced-motion` yang sudah ada di file yang sama, jadi otomatis
nonaktif untuk pengguna yang mematikan animasi di OS/browser-nya.

**Optimasi gesture touchscreen & ragam ukuran layar mobile:**

- Semua tombol/kontrol yang sering disentuh berulang (qty +/- Penjualan
  di `/shift`, hapus baris Resep/Packaging di Kelola Produk, tombol
  hamburger & tutup drawer navigasi, tombol tutup toast) dibesarkan ke
  target sentuh minimal **44×44px** (standar WCAG), bukan sekadar
  ukuran ikonnya — lihat `h-11 w-11` di `app-shell.tsx`, `shift/page.tsx`,
  `kalkulator-hpp/page.tsx`, dan `toast.tsx`.
- `button, a, [role="button"], input, select, textarea` diberi
  `touch-action: manipulation` + `-webkit-tap-highlight-color: transparent`
  (`globals.css`) — menghapus jeda tap ~300ms & kotak highlight biru
  bawaan browser mobile, diganti feedback `:active` (scale) yang sudah
  dipakai konsisten di seluruh tombol.
- `viewport.viewportFit: "cover"` (`layout.tsx`) + class utilitas
  `.aman-notch-atas/bawah/kiri/kanan` (`globals.css`, pakai
  `env(safe-area-inset-*)`) dipasang di topbar mobile, drawer navigasi,
  dan viewport toast — supaya tidak ketiban notch/pill kamera atau
  home-indicator di HP layar penuh (iPhone dsb). Zoom TIDAK dikunci
  (tidak ada `maximumScale`/`userScalable:false`) — mengunci pinch-zoom
  melanggar WCAG untuk pengguna low-vision.
- Layout sudah mobile-first sejak awal (flex/grid + breakpoint Tailwind,
  tanpa tabel HTML atau lebar piksel tetap) — diverifikasi ulang di sini:
  tidak ada `<table>`, tidak ada `grid-cols-3` ke atas tanpa breakpoint,
  tidak ada `w-[...px]`/`min-w-[...px]` yang bisa memaksa scroll
  horizontal di layar sempit (~320–375px).

**Loading & notifikasi di setiap proses CRUD** (submit, simpan, hapus,
ubah status, ekspor) sudah standar di seluruh halaman sejak sesi-sesi
sebelumnya — pola `sedang<Aksi>` (state boolean/ID) yang men-disable
tombol + menampilkan `<Loader2 className="animate-spin" />` selama
proses berjalan (mencegah submit ganda), dipasangkan dengan
`useToast()` (`src/shared/components/toast.tsx`) yang menampilkan pesan
sukses/gagal SPESIFIK (bukan generik) setelah proses selesai. Diverifikasi
ulang lengkap di sesi ini: `/shift`, `/belanja-nota`, `/kalkulator-hpp`
(Kelola Produk), `/kelola-akun`, `/riwayat`, `/profil`, `/notifikasi`,
`/login` semuanya sudah memenuhi pola ini untuk setiap operasi
create/update/delete miliknya.

**Revisi tampilan lanjutan (permintaan pemilik cafe):**

- Semua shape/kartu di seluruh aplikasi memakai token `--shadow-sm`
  (Tailwind v4 `@theme inline`, `globals.css`) — ditimpa jadi shadow
  ganda yang lebih tegas ("timbul") di SATU tempat, otomatis berlaku ke
  66 pemakaian `shadow-sm` di seluruh kode tanpa menyentuh satu-satu.
- Daftar Akun (`/kelola-akun`) sekarang menandai tiap field dengan
  label eksplisit (Email/Username/Peran/Status), bukan digabung dengan
  "·". Kata sandi SENGAJA tidak pernah ditampilkan — Firebase Auth
  menyimpannya terenkripsi satu arah, tidak bisa dibaca ulang oleh
  siapa pun termasuk Owner; ada catatan penjelasan di halaman.
- Nama Perusahaan (Profil Akun → Detail Perusahaan) sekarang textarea
  multi-baris (2-3 baris, mis. nama + anak kalimat) — setiap Enter
  dihormati sampai ke kop surat Excel/PDF (`src/shared/lib/ekspor.ts`
  mencetak tiap baris nama sebagai barisnya sendiri, bukan digabung).
- Ekspor Excel: lebar kolom sekarang **autofit sungguhan** — dihitung
  dari isi terpanjang tiap kolom (termasuk format ribuan untuk kolom
  angka), bukan tebakan tetap. `kolom.lebar` di pemanggil sekarang jadi
  batas minimum saja, bukan menimpa hasil autofit.

## Multi-Cabang (Multi-Outlet) — Owner & Finance terpusat, Kasir/Purchasing per Outlet

Permintaan pemilik cafe: bisnis akan berkembang jadi beberapa Outlet/cabang.
Owner DAN Finance **keduanya terpusat** — satu akun masing-masing bisa
melihat/mengelola SEMUA Outlet (revisi: "Finance juga terpusat login pilih
outlet") — sementara Kasir/Purchasing masing-masing bekerja HANYA untuk
satu Outlet tempat mereka ditugaskan.

**Alur Login sekarang** (perubahan dari sebelumnya yang langsung ke
Dashboard):

```
Login → (Owner ATAU Finance) Pilih Outlet → Dashboard
Login → (Kasir/Purchasing) langsung → Dashboard
```

Kasir/Purchasing SENGAJA tidak melihat layar "Pilih Outlet" sama sekali —
akun mereka terkunci permanen ke satu Outlet sejak dibuat (field
`outletId` di `users/{uid}`), jadi tidak ada apa pun untuk dipilih. Owner
DAN Finance TIDAK punya `outletId` tetap — keduanya memilih Outlet mana
yang sedang "aktif" di sesi browsernya lewat halaman `/pilih-outlet`,
tersimpan di `localStorage` (per-uid, jadi dua akun/perangkat berbeda tidak
bertabrakan) supaya tidak perlu memilih ulang setiap kali refresh. Tombol
"Ganti Outlet" ada di sidebar (`AppShell`, untuk Owner maupun Finance)
untuk berpindah Outlet kapan saja tanpa logout.

**Arsitektur data — isolasi per path, bukan per field** (`firestore.rules`
& `src/shared/lib/outlet-context.tsx`):

Semua data operasional (bahan_baku, menu, shift, kas_belanja, summary
harian/bulanan, notifikasi, dst — daftar lengkap ada di komentar kepala
`scripts/hapus-data-lama.mjs`) sekarang hidup di bawah
`outlets/{outletId}/{koleksi}/...`, BUKAN lagi koleksi top-level datar.
Ini dipilih dibanding menambah field `outletId` ke setiap dokumen karena
isolasi ditegakkan oleh LOKASI dokumen (path Firestore), bukan sebuah
field yang secara teori bisa salah/dipalsukan — jauh lebih aman & mudah
diverifikasi di `firestore.rules`.

Yang TETAP global (top-level, tidak dipindah per Outlet):

- `users/{uid}` — profil semua akun, lintas Outlet (perlu tetap global
  supaya akun Owner/Finance bisa dicek aksesnya dari Outlet manapun).
  HANYA Kasir/Purchasing yang punya field `outletId` (wajib, tetap);
  Owner & Finance tidak punya field ini sama sekali.
- `usernames/{username}` — lookup publik username→email dipakai halaman
  Login SEBELUM ada sesi/Outlet yang diketahui.
- `outlets/{outletId}` — daftar Outlet itu sendiri (`nama`, `alamat`,
  `aktif`), dikelola dari halaman **Kelola Outlet** di bawah.

**Halaman baru:**

- **`/pilih-outlet`** (Owner & Finance) — daftar Outlet aktif, tekan satu
  untuk masuk ke Dashboard Outlet itu. Kalau daftarnya masih KOSONG SAMA
  SEKALI (instalasi baru), halaman ini otomatis membuatkan Outlet
  pertama (`outlets/srasa-book`, nama "SRASA BOOK") saat dibuka oleh
  Owner — tidak perlu langkah manual lewat Kelola Outlet lagi untuk
  Outlet pertama ini (Finance tidak bisa memicu ini, `firestore.rules`
  membatasi tulis `outlets` hanya untuk Owner murni).
- **`/kelola-outlet`** (Owner MURNI saja, `hanyaOwnerMurni`) — tambah
  Outlet baru dan aktifkan/nonaktifkan Outlet yang sudah ada. Ini
  keputusan struktural lintas-Outlet, bukan wewenang Finance walau
  Finance kini setara Owner di hampir semua data operasional. SENGAJA
  tidak ada tombol hapus permanen (hanya nonaktifkan) supaya data lama di
  `outlets/{id}/...` milik Outlet itu tidak pernah menjadi yatim/hilang
  rujukan.

**`firestore.rules` — helper baru** menggantikan pola lama `isSuperadmin()`:

- `isOwner()` — Owner global sungguhan (`peran == "superadmin"`), berlaku
  di SEMUA Outlet.
- `isFinance()` — SEJAK revisi ini, Finance JUGA global/terpusat seperti
  Owner (tidak punya `outletId` tetap, berlaku di SEMUA Outlet).
- `myOutletId()` — HANYA berarti untuk Kasir/Purchasing (Outlet tempat
  akunnya terkunci).
- `isKasirOutlet(outletId)` / `isPurchasingOutlet(outletId)` — true hanya
  kalau perannya cocok DAN `outletId` yang diminta sama dengan Outlet akun
  itu sendiri. `isFinanceOutlet(outletId)` dipertahankan sebagai alias
  (kini identik dengan `isFinance()`, parameter `outletId`-nya diabaikan)
  supaya seluruh pemanggilnya di `firestore.rules` tidak perlu diganti
  satu-satu.
- `isManagerOutlet(outletId)` — pengganti `isSuperadmin()` lama:
  `isOwner() || isFinance()`. Dipakai di hampir semua koleksi per-Outlet,
  lolos untuk Owner MAUPUN Finance di Outlet manapun.
- **Pengecualian yang tetap dipertahankan** (satu-satunya beda perilaku
  Owner vs Finance yang tersisa): Saldo Deposito Finance
  (`saldo_finance`/`transaksi_finance`) TETAP memakai `isFinance()` murni
  (BUKAN `isManagerOutlet()`) untuk mencatat transaksi — Owner tetap hanya
  boleh memantau, tidak mengeksekusi uang masuk/keluar sehari-hari, sama
  seperti sebelum fitur Multi-Cabang ada.

**Kelola Akun (`/kelola-akun`) sekarang outlet-aware:**

- Owner DAN Finance (keduanya terpusat) melihat & bisa membuat akun untuk
  **Outlet manapun** tanpa batasan — daftar akun menampilkan SEMUA akun
  lintas Outlet untuk keduanya.
- Dropdown pilihan Outlet di form "Buat Akun Staff" HANYA muncul saat
  Peran yang dipilih **Kasir atau Purchasing** — begitu Peran diganti ke
  Finance, dropdown itu hilang (Finance sengaja TIDAK diberi `outletId`
  sama sekali, siapa pun yang membuatnya).

**Data lama (dummy/trial) — dihapus, bukan dimigrasikan:**

Data yang sempat tersimpan di koleksi top-level lama (sebelum fitur
Multi-Cabang) sudah dikonfirmasi hanya data uji coba, bukan data produksi
— jadi TIDAK dipindahkan, cukup dibersihkan lewat skrip Node.js terpisah:
`scripts/hapus-data-lama.mjs`. Skrip ini menghapus SEMUA koleksi
top-level lama beserta seluruh sub-koleksinya (ditemukan otomatis lewat
`listCollections()`), dan SAMA SEKALI TIDAK menyentuh `users`,
`usernames`, atau `outlets` (akun login & daftar Outlet tetap ada). Lihat
komentar lengkap di kepala berkas skrip untuk cara pakai step-by-step
(butuh Service Account Key dari Firebase Console + `npm install
firebase-admin`, dijalankan manual di komputer — TIDAK bisa dijalankan
dari sandbox pengembangan ini karena kredensial admin tidak boleh
tersimpan di kode aplikasi). Setelah dijalankan, buat Outlet pertama
("SRASA BOOK") lewat halaman **Kelola Outlet** dan mulai input data dari
nol di struktur baru.

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
6. Kalau ada data dummy/trial dari sebelum fitur Multi-Cabang ada,
   jalankan `scripts/hapus-data-lama.mjs` dulu untuk membersihkannya
   (lihat bagian Multi-Cabang di atas) — SEBELUM lanjut ke langkah 7.
7. Login ke aplikasi sebagai Owner (akun dari langkah 1-2) → akan
   diarahkan ke `/pilih-outlet`. Kalau daftar Outlet masih kosong sama
   sekali, halaman ini OTOMATIS membuatkan Outlet pertama
   (`outlets/srasa-book`, nama **"SRASA BOOK"**) — tidak perlu lagi buka
   Kelola Outlet manual untuk langkah pertama ini (lihat
   `src/app/pilih-outlet/page.tsx`). Tunggu beberapa detik sampai
   muncul, lalu tekan untuk masuk Dashboard.

Setelah ini, akun Owner bisa login lewat Email ATAU Username yang baru
dibuat. Staff berikutnya semuanya dibuat lewat halaman `/kelola-akun` di
aplikasi — tidak perlu ulangi langkah manual ini lagi:

- **Finance** dibuat sama seperti Owner: TIDAK terikat satu Outlet,
  login → `/pilih-outlet` → Dashboard, bisa berpindah Outlet kapan saja.
- **Kasir/Purchasing** dibuat dengan Outlet tujuan dipilih dari dropdown
  (Owner ATAU Finance yang membuatnya bisa memilih Outlet manapun) —
  akun ini langsung ke Dashboard tanpa layar pilih Outlet.

Outlet baru (cabang kedua dst) dibuat lewat halaman `/kelola-outlet`,
bukan lewat Firebase Console.

## Skrip yang Tersedia

| Perintah           | Fungsi                                             |
| ------------------ | --------------------------------------------------- |
| `npm run dev`       | Jalankan server pengembangan                        |
| `npm run build`     | Build produksi (dijalankan Vercel saat deploy)       |
| `npm run lint`      | ESLint                                               |
| `npm run test`      | Jalankan seluruh unit test sekali (Vitest)           |
| `npm run test:watch`| Unit test mode watch, dipakai saat coding            |

## Status Implementasi (lihat PRD bagian 13 untuk roadmap lengkap)

> Catatan penting soal riwayat di bawah: banyak entri lama menyebut
> `isSuperadmin()` di `firestore.rules` — nama itu sudah DIGANTI jadi
> `isOwner()`/`isManagerOutlet()`/`isFinance()` dkk sejak fitur
> Multi-Cabang (lihat bagian "Multi-Cabang" di atas untuk arsitektur
> terkini). Perilaku yang dideskripsikan (Finance setara Owner kecuali
> Saldo Deposito Finance) TIDAK berubah — Finance malah SEKARANG makin
> setara Owner (sama-sama terpusat, akses semua Outlet), hanya
> Kasir/Purchasing yang masih terkunci per-Outlet.

Seluruh halaman P0 (dasar) sudah ada dan saling terhubung lewat Login +
peran, memakai Firestore & Cloudinary sungguhan (bukan simulasi lagi):

- [x] **Multi-Cabang (Multi-Outlet)** — Owner & Finance terpusat, bisa
  mengakses semua Outlet (`/pilih-outlet`, `/kelola-outlet` khusus
  Owner); Kasir/Purchasing masing-masing terkunci ke satu Outlet. Lihat
  bagian "Multi-Cabang" di atas untuk detail arsitektur, alur login
  baru, dan skrip pembersihan data lama.

- [x] Sprint 0 — Fondasi proyek (Next.js, TypeScript, Tailwind, struktur folder)
- [x] Autentikasi (`/login`) & konteks peran (`src/shared/lib/auth-context.tsx`, `RequireAuth`, `AppShell`) — SUPERADMIN (Owner) / Finance / Kasir / Purchasing
  - Pemisahan tugas: halaman input operasional (`/shift`, `/belanja-nota`) hanya bisa dibuka oleh Kasir/Purchasing masing-masing — Owner TIDAK melakukan input harian ini, cukup memantau lewat Dashboard/Riwayat/Notifikasi. `firestore.rules` tetap memberi Owner (superadmin) akses baca/tulis penuh di backend sebagai admin override (audit/koreksi data), hanya UI-nya yang disembunyikan.
  - Peran **Finance** aksesnya SENGAJA dibuat setara penuh dengan Owner (Dashboard, Kalkulator HPP, Kelola Akun, Riwayat, Notifikasi) — lihat komentar `isSuperadmin()` di `firestore.rules` yang menjelaskan alasannya. Dibuat lewat `/kelola-akun` sama seperti staff lain (pilih "Finance" di dropdown Peran).
  - "Tutup Shift" BUKAN menu terpisah di sidebar — itu kartu di bagian bawah halaman `/shift` (setelah Buka Shift + input penjualan), muncul otomatis begitu Kasir sudah membuka shift hari itu.
  - Bisa masuk pakai Email ATAU Username (lihat koleksi `usernames/{username}` di firestore.rules), tombol Masuk dengan Google, dan Lupa Kata Sandi
  - **Wajib diaktifkan manual di Firebase Console** sebelum dipakai: Authentication → Sign-in method → aktifkan **Email/Password** dan **Google**
- [x] **Kelola Produk** (dulu "Kalkulator HPP", `/kalkulator-hpp`) + **Resep otomatis**
  - Nama menu di sidebar diganti jadi "Kelola Produk". Tampilan AWAL kini
    katalog produk dikelompokkan per kategori (bukan langsung form) — tekan
    sebuah produk untuk mengubah resep/harganya, atau tombol "+ Tambah Menu
    Baru" di kanan atas untuk menu kosong.
  - **Tambah Bahan/Item Baru tanpa menunggu stok ada**: di kartu Resep ada
    tombol "+ Bahan/Item Baru" — Owner bisa membuat bahan_baku (stok &
    harga = 0) langsung dari sini dan menyusun resep duluan, TANPA perlu
    menunggu Purchasing membelinya lebih dulu. Tetap tersambung penuh ke
    inventaris yang sama: begitu Purchasing membelinya (dicocokkan dari
    nama), harga & stok terisi normal seperti bahan lain.
  - **Batas Minimal Stok** (kriteria "hampir habis", DITENTUKAN MANUAL per
    bahan, mis. Ayam = 1 kg) diatur dari Belanja & Nota (kartu "Batas
    Minimal Stok") — begitu `stokSaatIni` turun sampai/di bawah angka ini,
    banner peringatan otomatis muncul di Dashboard.
  - HPP Bahan per porsi TIDAK LAGI diinput manual — dihitung otomatis dari
    Resep (bahan + takaran, satuan gram/pcs) × harga bahan terkini di
    `bahan_baku`. Resep tersimpan di `menu/{menuId}/resep/{bahanId}` (lihat
    `src/shared/lib/resep.ts`) dan juga dipakai Kasir untuk mengurangi stok
    gudang otomatis saat mencatat penjualan (lihat poin Shift di bawah).
  - Logika breakdown biaya (susut/utilitas/tenaga kerja/overhead) tetap
    fungsi murni & teruji: `src/shared/lib/hpp-calculator.ts` (14 unit test)
  - **Tersambung Firestore**: menulis `menu_harga/{menuId}` (publik) + `menu/{menuId}` (privat, breakdown biaya) + `menu/{menuId}/resep/{bahanId}` (bahan+takaran, boleh dibaca Kasir) sekaligus, sesuai pemisahan keamanan PRD 6.3
  - Dropdown "Buat Baru atau Ubah Menu yang Ada" — resep & Packaging Cost
    menu yang sudah ada bisa dimuat lalu ditimpa (bukan hanya bisa buat
    menu baru terus-menerus).
  - **Packaging Cost** (cup, sedotan, sumpit sekali pakai, dll., dulu
    disebut "Biaya Kemasan") kini ITEM-BASED seperti Resep, bukan angka
    Rupiah manual: pilih item dari Bahan Baku (satuan pcs — beli satu
    pack/ball, harga per pcs dihitung otomatis di Belanja & Nota), atur
    jumlah per porsi, tombol "+ Tambah" untuk menambah baris (menu yang
    cuma pakai gelas tanpa sedotan cukup tidak menambahkan baris
    sedotannya). Disimpan di subkoleksi `resep` YANG SAMA dengan Bahan
    Baku (dibedakan lewat field `jenis: "bahan" | "kemasan"`), sehingga
    stok packaging JUGA ikut berkurang otomatis dari inventaris saat menu
    ini terjual — persis seperti bahan baku, lewat mekanisme yang sama
    (`src/shared/lib/resep.ts`), tanpa kode terpisah.
- [x] Dashboard (`/dashboard`) — SEKARANG DIBAGI PER PERAN, bukan cuma satu tampilan:
  - **Owner/Finance**: Dashboard Analitik lama tetap utuh — kartu Omset &
    **Laba Bersih OTOMATIS** hari ini + ringkasan bulan berjalan + Analitik
    Tren, PLUS banner baru "Stok bahan menipis" (dari Batas Minimal Stok).
    Ini "zona privasi otoritas tinggi" atas permintaan pemilik cafe — data
    finansial & Analitik Tren TIDAK PERNAH dirender untuk peran lain,
    percabangannya di komponen paling luar (`DashboardRouter`), bukan
    sekadar disembunyikan lewat CSS.
  - **Analitik Tren — rentang waktu custom** (`src/shared/lib/tren.ts`):
    grafik Tren sekarang punya 5 pilihan periode lewat tombol segmen di
    pojok kanan atas kartunya — **Harian** (14 hari terakhir), **Mingguan**
    (8 minggu terakhir, dijumlahkan per 7 hari), **Bulanan** (6 bulan
    terakhir dari `summary_bulanan`), **Custom Tanggal** (pilih tanggal
    mulai & selesai bebas — kalau rentangnya lebih dari 35 hari otomatis
    dikelompokkan per minggu supaya grafik tidak penuh sesak), dan
    **Custom Bulan** (pilih bulan mulai & selesai bebas). Semua tetap
    membaca dokumen ringkasan teragregasi (`summary_harian`/
    `summary_bulanan`) pakai query range `documentId()` — bukan hitung
    ulang transaksi mentah — jadi tidak menambah beban kuota Firestore.
    Bagian pembangun daftar tanggal/bulannya murni (tanpa Firebase) dan
    diuji di `src/shared/lib/tren-tanggal.ts` /
    `src/shared/lib/tren.test.ts`.
  - **Kasir & Purchasing**: Dashboard yang SAMA SEKALI BERBEDA — rincian
    stok bahan baku per kategori + banner stok menipis, TANPA Omset/Laba/
    Tren apa pun. Purchasing membaca `bahan_baku` langsung (sudah py akses
    penuh); Kasir membaca `stok_kasir`, salinan `bahan_baku` TANPA field
    harga sama sekali (Kasir tidak pernah diberi izin baca `bahan_baku` —
    lihat firestore.rules), ditulis ulang otomatis setiap kali stok/nama/
    kategori/Batas Minimal Stok berubah (lihat `setMirrorStokKasir` di
    `src/shared/lib/resep.ts`).
  - Laba Bersih & HPP Terjual dihitung OTOMATIS setiap Dashboard Owner/
    Finance dibuka — lihat `src/shared/lib/laba-harian.ts`: jumlahkan
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
- [x] **Ekspor Laporan Excel & PDF A4 berkop surat** (kartu di `/riwayat`)
  — pilih rentang tanggal, lalu unduh `.xlsx` atau PDF ukuran A4 yang
  dicetak dengan KOP SURAT berisi Detail Perusahaan (nama, bidang usaha,
  alamat, telepon/email/website, NPWP), judul laporan, periode, tabel
  shift, ringkasan total, dan kaki halaman bernomor. Lihat
  `src/shared/lib/ekspor.ts` — exceljs & jspdf sengaja di-`import()`
  dinamis agar tidak membebani halaman yang tidak mengekspor apa pun.
- [x] **Profil Akun** (`/profil`, semua peran) — biodata diri (nama bisa
  diperbaiki sendiri), **Ganti Kata Sandi** (wajib kata sandi lama →
  reautentikasi Firebase), dan **KHUSUS Owner/Finance**: **Detail
  Perusahaan** di bagian bawah, yang menjadi sumber KOP SURAT semua
  ekspor di atas.
- [x] **Auto Logout** — sesi berakhir saat (1) tidak ada aktivitas 60
  menit, (2) tab browser ditutup, (3) aplikasi browser ditutup, (4)
  perangkat dimatikan. Poin 2–4 ditangani oleh `browserSessionPersistence`
  di `src/shared/lib/firebase.ts` (sesi hidup di sessionStorage, yang
  umurnya terikat tab) — bukan lewat event `beforeunload`, yang tidak
  pernah bisa diandalkan saat perangkat mati paksa. Poin 1 ditangani
  `src/shared/components/auto-logout.tsx`, lengkap dengan peringatan
  hitung mundur 2 menit + tombol "Saya masih di sini".
- [x] **Auto Draft** — form panjang menulis isinya ke localStorage terus-
  menerus (`src/shared/lib/draf.ts`, 18 unit test), jadi pekerjaan yang
  belum sempat disimpan TIDAK hilang saat auto logout/tab tertutup.
  Terpasang di: Kelola Produk (menu + seluruh baris resep & packaging,
  dengan banner "Lanjutkan Draf / Buang Draf"), Tutup Shift (hasil
  hitungan kas fisik), dan Tambah Item Belanja. Draf dikunci per-uid
  sehingga dua kasir yang memakai satu tablet tidak pernah tertukar, dan
  otomatis kedaluwarsa setelah 48 jam.
- [x] **Backup Data (`/backup-data`, PRD 9.10)** — Owner & Finance
  (keduanya terpusat) bisa mengunduh backup JSON dengan CAKUPAN pilihan:
  **Semua Outlet sekaligus** (satu file, dikelompokkan per Outlet,
  termasuk Outlet yang sedang dinonaktifkan) atau **satu Outlet saja**
  (dropdown pilihan). Backup MANUAL (Spark Plan, tidak ada Cloud
  Functions untuk backup terjadwal otomatis) — tombol memicu unduhan
  file `.json` langsung dari browser lewat Blob, tanpa server perantara.
  Timestamp Firestore dikonversi ke string ISO 8601 supaya hasilnya JSON
  murni yang valid. Lihat `src/shared/lib/backup.ts` (struktur koleksi +
  sub-koleksi yang dicadangkan didaftar manual di sana — SDK client
  Firestore tidak punya `listCollections()` seperti Admin SDK, beda
  dengan `scripts/hapus-data-lama.mjs`).

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

**Fitur Bonus/Gratis & Refund di halaman Shift Kasir (permintaan pemilik cafe):**

Setiap baris menu di halaman Kasir (`/shift`) sekarang punya tombol panah
(chevron) di sebelah stepper qty reguler yang membuka panel tambahan berisi
dua kontrol baru, di luar qty reguler yang sudah ada:

- **Bonus / Gratis** — dipakai saat produk diberikan gratis ke customer
  sebagai bonus pembelian (misal promo "beli 2 gratis 1"). Menambah
  `qtyBonus`, bahan baku di gudang tetap berkurang lewat Resep seperti
  biasa, TAPI `subtotal`-nya SELALU 0 — sama sekali tidak menyumbang Omset.
- **Refund** — dipakai saat customer mengembalikan produk yang sudah
  dibayar. Memindahkan 1 unit dari `qty` reguler ke `qtyRefund` (mengurangi
  Omset sesuai harga jual saat itu), TAPI bahan baku yang sudah terpakai
  TIDAK dikembalikan ke stok gudang (produk yang sudah jadi tidak bisa
  "un-dimasak"). Tombol "+" Refund otomatis nonaktif kalau qty reguler
  menu tsb sudah 0 (tidak ada yang bisa direfund).

Kasir HANYA melihat angka qty di ketiga kontrol ini — tidak pernah melihat
HPP/margin Rupiah sama sekali (itu memang privat, lihat firestore.rules),
jadi tidak ada risiko Kasir bingung melihat angka minus.

Kalkulasi otomatis di sisi Owner/Finance (`src/shared/lib/laba-harian.ts`)
sudah menghormati logika ini tanpa perlu input manual apa pun:

- **Omset** tetap murni dari `subtotal`, yang sudah otomatis hanya
  mencerminkan qty reguler (Bonus selalu 0, Refund sudah dikurangkan) —
  jadi Bonus/Refund TIDAK PERNAH membuat Omset salah atau bikin bingung.
- **HPP Terjual** (dan karenanya Laba Bersih) dihitung dari jumlah SEMUA
  unit yang sungguh dibuat (`qty` + `qtyBonus` + `qtyRefund`), karena
  bahan bakunya sama-sama benar-benar terpakai untuk ketiganya. Dengan
  begitu biaya bahan untuk produk gratis/refund tetap otomatis mengurangi
  Laba Bersih di Dashboard — sesuai permintaan "tetap otomatisasi
  kalkulasi keuangannya" — tanpa pernah menyingkap angka itu ke Kasir.

Tidak ada perubahan `firestore.rules` untuk fitur ini — rule subkoleksi
`shift/{id}/penjualan` untuk Kasir memang sudah tidak membatasi field
tertentu (beda dengan `bahan_baku`/`stok_kasir`), jadi field baru
`qtyBonus`/`qtyRefund` otomatis sudah bisa ditulis Kasir.

**Nota Refund lintas hari/shift (halaman `/refund`, khusus Kasir):**

Stepper Refund cepat di halaman Shift (di atas) HANYA berlaku selagi shift
hari itu masih berjalan/belum dikunci — begitu shift ditutup, Firestore
Rules melarang Kasir menulis lagi ke subkoleksi penjualan shift itu. Untuk
customer yang baru komplain SETELAH shift ditutup (bahkan hari lain),
dibuat halaman terpisah `/refund` yang alurnya meniru "cari nota" ala
Majoo, disesuaikan dengan skema app ini yang mencatat qty per menu per
shift (bukan per struk customer):

1. Kasir pilih tanggal transaksi asal.
2. Pilih shift (hanya shift MILIK KASIR ITU SENDIRI yang muncul, sesuai
   firestore.rules — refund lintas Kasir ditangani manual oleh Owner lewat
   Riwayat).
3. Pilih menu yang mau direfund dari shift itu (sisa yang bisa direfund
   otomatis dihitung dari qty asli dikurangi refund-refund sebelumnya).
4. Isi jumlah, alasan (dropdown + opsi "Lainnya" isi manual), dan metode
   pengembalian dana (Tunai/Non-tunai).

Hasilnya tersimpan di koleksi baru `nota_refund` — TIDAK menulis ulang ke
shift lama yang sudah terkunci, murni catatan finansial + jejak audit yang
merujuk ke shift/menu asal. Bahan baku sama sekali tidak disentuh (sudah
terpakai di hari transaksi asli, tidak dikembalikan ke stok).

Efeknya ke Laba Bersih dibedakan menurut metode, supaya tidak dobel hitung:

- **Tunai** — otomatis tercatat sebagai Kas Keluar (kategori "Refund
  Tunai") di shift Kasir HARI INI. Ini membuat Kas Seharusnya hari ini
  otomatis cocok dengan uang fisik di laci (karena uangnya memang keluar
  hari ini), dan Laba Bersih ikut berkurang lewat totalKasKeluar yang
  sudah ada — tidak ada logika baru yang perlu dipercaya untuk kasus ini.
- **Non-tunai** — tidak ada uang fisik yang keluar dari laci, jadi dicatat
  sebagai pengurang Omset pada TANGGAL REFUND terjadi (`hitungLabaHarian`
  di `src/shared/lib/laba-harian.ts` menjumlahkan `nota_refund` dengan
  `metode == "non_tunai"` pada tanggal itu) — bukan mengedit ulang laporan
  hari transaksi asli yang sudah final.

Owner/Finance bisa melihat seluruh riwayat Nota Refund (50 terbaru,
termasuk alasannya) di halaman Riwayat — berguna untuk memantau pola
masalah (misal sering "Salah pesan dari kasir" di jam sibuk tertentu).
Kasir SENGAJA tidak perlu approval Owner untuk membuat Nota Refund (atas
permintaan pemilik cafe, supaya operasional tetap cepat) — jejak
transparansi untuk Owner ada di riwayat ini, bukan di alur approval
sebelum refund terjadi.

**Pemisahan Metode Bayar per item (Tunai/Non-Tunai) + Rekap & Produk
Terlaris di Dashboard (permintaan pemilik cafe):**

Sebelumnya Kasir input qty per menu dengan SATU stepper (mis. Kopi 48
pcs), lalu total Omset Non-Tunai diisi TEBAKAN manual satu angka di akhir
shift saat Tutup Shift. Sekarang setiap menu di halaman Shift punya DUA
stepper berdampingan — Tunai dan Non-Tunai (QRIS/kartu/transfer) — jadi
kalau Kopi hari ini laku 16pcs (10 dibayar QRIS, 6 tunai), Kasir input
"Kopi 10" di stepper Non-Tunai dan "Kopi 6" di stepper Tunai secara
terpisah, sejak awal, bukan direkap manual belakangan.

- Setiap dokumen `shift/{id}/penjualan/{menuId}` sekarang punya
  `qtyTunai`/`qtyNonTunai` (dan `subtotalTunai`/`subtotalNonTunai`) di
  samping `qty`/`subtotal` totalnya — Bonus/Refund/HPP TIDAK diubah sama
  sekali (tetap beroperasi di atas `qty` total seperti sebelumnya), jadi
  Rekap Omset dan seluruh kalkulasi keuangan lain tetap GLOBAL/tidak
  berubah, sesuai permintaan pemilik cafe — hanya rinciannya yang
  bertambah detail.
- Refund cepat di halaman Shift (untuk shift yang masih berjalan) TIDAK
  meminta Kasir memilih metode bayar lagi (refund biasanya mendadak) —
  bucket sumbernya dipilih otomatis (Non-Tunai diutamakan lebih dulu),
  didokumentasikan sebagai penyederhanaan yang disengaja di
  `ubahQtyRefund` (`src/app/shift/page.tsx`). Rekap Omset TOTAL tetap
  100% akurat apa pun urutan pemilihannya — hanya rincian Tunai/Non-Tunai
  yang memakai penyederhanaan ini.
- **Tutup Shift disederhanakan**: field manual "Omset Non-Tunai" DIHAPUS
  dari form — sekarang dihitung OTOMATIS dari total `subtotalTunai`/
  `subtotalNonTunai` seluruh item yang sudah diinput Kasir sepanjang
  shift. Ini juga membuat "Kas Seharusnya" (dasar rekonsiliasi kas fisik)
  lebih akurat karena tidak lagi bergantung pada tebakan manual di akhir
  shift.
- `hitungLabaHarian` (`src/shared/lib/laba-harian.ts`) memakai rincian
  per-item ini untuk Omset Tunai/Non-Tunai kalau tersedia, dengan
  FALLBACK ke field manual `omsetNonTunai` lama KHUSUS untuk shift dari
  SEBELUM fitur ini ada — supaya laporan hari-hari lama tidak tiba-tiba
  menunjukkan Rp0.
- **Dashboard** (Owner/Finance) — kartu baru "Rekap Metode Bayar",
  "Produk Terlaris", dan "Produk Kurang Laris" (termasuk menu yang sama
  sekali tidak laku sama sekali di rentang itu), semuanya mengikuti
  rentang periode yang SAMA dengan toggle Harian/Mingguan/Bulanan/Custom
  Tanggal/Custom Bulan di grafik Analitik Tren — atas permintaan pemilik
  cafe ("diatur di grafik analitik tren"). Sumber datanya fungsi baru
  `ambilRingkasanPeriode` di `src/shared/lib/produk-terlaris.ts`, yang
  membaca langsung dari `shift/{id}/penjualan` (bukan dokumen ringkasan
  `summary_harian`/`summary_bulanan`, karena rincian per-produk & per-
  metode-bayar memang tidak pernah diringkas ke sana) — wajar untuk skala
  cafe kecil di Spark Plan, tapi perlu dipikirkan ulang kalau skalanya
  jauh lebih besar nanti.

**Saldo Deposito Finance, Transaksi Finance, Biaya Operasional, & 2
Sumber Dana Belanja (permintaan pemilik cafe):**

Sebelumnya semua uang di aplikasi ini bersumber dari Omset penjualan
(kas shift Kasir). Sekarang ada SUMBER DANA KEDUA yang sengaja terpisah
total: **Saldo Deposito Finance** — dana yang diberikan Owner DI LUAR
Omset (misalnya modal tambahan, dana operasional bulanan), dikelola
lewat menu baru **Transaksi Finance** (`/transaksi-finance`).

- **Akses khusus** (satu-satunya tempat di aplikasi ini yang berbeda dari
  pola biasa): peran Finance normalnya setara penuh dengan Owner
  (superadmin) di semua fitur lain — tapi khusus Saldo Deposito Finance
  ini, Owner **hanya boleh memantau** (lihat saldo & riwayat transaksi),
  **tidak bisa mengeksekusi** Tambah Dana atau mencatat transaksi apa
  pun — itu wewenang eksklusif akun berperan Finance. Ditegakkan di dua
  lapis: UI menyembunyikan form aksi untuk Owner, dan firestore.rules
  (`saldo_finance`/`transaksi_finance`) menolak create/update/delete dari
  `isSuperadmin()` biasa, hanya `isFinance()` murni.
- **Tambah Dana (Uang Masuk)** — Finance mencatat dana masuk dari Owner
  di luar Omset, menambah Saldo Deposito.
- **Catat Transaksi (Uang Keluar)** — tiga kategori: **Gaji Karyawan**
  (nama karyawan diisi bebas per transaksi, tanpa perlu data master
  karyawan dulu — sesuai permintaan), **Biaya Operasional** (Wifi/
  Listrik/PDAM (Air)/Lainnya), dan **Lainnya**. Saldo tidak bisa
  ditarik melebihi yang tersedia — dicegah di klien DAN di
  firestore.rules (`saldo_finance.saldo >= 0` diperiksa di level
  database, bukan cuma UI).
- **Biaya Operasional juga bisa diinput Kasir** lewat Kas Keluar di
  halaman Shift (kategori Wifi/Listrik/PDAM (Air) kini eksplisit di
  `KATEGORI_KAS_KELUAR`, `src/app/shift/page.tsx`) — bedanya, versi
  Kasir ini memotong KAS SHIFT (uang hasil Omset hari itu), BUKAN Saldo
  Deposito Finance. Sumber dananya mengikuti siapa yang input: Kasir ->
  kas shift, Finance -> Saldo Deposito.
- **Belanja Purchasing kini pilih 2 Sumber Dana** saat "Mulai Belanja"
  (`src/app/belanja-nota/page.tsx`): **Kas Resto/Outlet** (seperti
  sebelumnya, tidak dilacak sebagai saldo tersendiri di aplikasi) atau
  **Saldo Finance** (memotong Saldo Deposito Finance sejumlah modal yang
  diterima, dengan pengecekan saldo cukup sebelum belanja dimulai).
  Purchasing diberi akses BACA ke `saldo_finance` (bukan Kasir) khusus
  untuk melihat sisa saldo sebelum memilih sumber dana ini.
- **Batasan yang disengaja**: pengeluaran dari Saldo Deposito Finance
  (Gaji Karyawan, Biaya Operasional versi Finance, belanja bersumber
  Saldo Finance) TIDAK ikut mengurangi Laba Bersih di `hitungLabaHarian`
  (`src/shared/lib/laba-harian.ts`) — rumus Laba Bersih itu murni
  berbasis Omset penjualan, sedangkan Saldo Deposito adalah pool dana
  terpisah yang sumbernya dari luar Omset. Riwayat lengkap pengeluaran
  Finance tetap tercatat & bisa dipantau Owner di halaman Transaksi
  Finance, hanya belum digabung ke satu angka Laba Bersih.

**Jadwal Shift (Slot Shift) & Serah Terima Kas (permintaan pemilik
cafe: "Finance juga yang atur pembagian shift", termasuk strategi
transisi pergantian shift yang jam-nya beririsan):**

- **Menu baru "Jadwal Shift"** (`/kelola-jadwal-shift`, peran
  superadmin & finance — akses SAMA RATA seperti pola biasa di app ini,
  BUKAN domain uang masuk/keluar seperti Saldo Deposito Finance)
  mengelola daftar **Slot Shift**: nama + jam mulai/selesai (mis.
  "Shift 1: 08.00–17.00", "Shift 2: 15.00–24.00"), bisa
  diaktifkan/nonaktifkan atau dihapus.
- **Bentuk yang dipilih (jawaban eksplisit pemilik cafe)**: daftar Slot
  Shift saja — BUKAN roster penugasan per tanggal/per Kasir. Kasir
  sendiri yang memilih slot mana secara self-service saat shift belum
  ada untuk hari itu (`src/app/shift/page.tsx`). Kalau slot aktif cuma
  0 atau 1, Kasir tidak perlu memilih apa-apa sama sekali — perilaku
  identik dengan sebelum fitur ini ada (auto-provisioning diam-diam).
  Layar pilih slot hanya muncul kalau ada >= 2 slot aktif.
- **Transisi pergantian shift**: skema `shift` (dokumen per
  kasirUid+tanggal) SUDAH otomatis mendukung Shift 2 membuka shift
  sendiri meski Shift 1 belum menutup shift-nya — dua Kasir berbeda =
  dua dokumen independen, tanpa perubahan apa pun. Yang ditambahkan
  supaya masa transisi (jam-jam yang beririsan, mis. 2 jam semua shift
  bertemu) tetap rapi adalah:
  - **Serah Terima Kas** (koleksi `serah_terima_kas`, kartu baru di
    halaman Shift) — jejak audit untuk laci kas fisik yang **dipakai
    bersama** saat transisi (jawaban eksplisit pemilik cafe: "Laci
    sama, perlu serah terima kas"). Kasir yang sedang menyerahkan laci
    mencatat nominal & keterangan singkat kapan saja selama shift
    berjalan (tidak harus menunggu Tutup Shift, karena serah terima
    biasanya terjadi DI TENGAH shift, saat jam transisi).
  - **Sengaja TIDAK ditargetkan ke satu Kasir penerima tertentu** (uid
    tujuan) — Kasir tidak punya akses `list` ke koleksi `users` untuk
    memilih nama rekan dari daftar (lihat firestore.rules). Cukup
    dicatat "dari siapa, jam berapa, berapa", dan SEMUA Kasir aktif
    boleh membaca daftar hari ini (bukan cuma pembuatnya).
  - **Murni catatan audit/informasional** — TIDAK memengaruhi Modal Kas
    Awal maupun perhitungan Kas Seharusnya/Selisih Kas di manapun.
- **Modal Kas Awal tetap FLAT Rp500.000 untuk SEMUA slot** (jawaban
  eksplisit pemilik cafe) — `MODAL_KAS_AWAL_HARIAN` di
  `src/app/shift/page.tsx` tidak berubah sama sekali oleh fitur ini;
  field `slotNama`/`slotJamMulai`/`slotJamSelesai` di dokumen shift
  murni untuk tampilan (mis. label "Shift 1 (08.00–17.00)" di header
  halaman Shift), bukan input keuangan.
- **Batasan yang disengaja**: tidak ada penugasan/roster per tanggal
  ("siapa masuk shift apa hari ini" ditentukan Kasir sendiri saat
  membuka aplikasi, bukan dijadwalkan Finance di muka), dan tidak ada
  validasi otomatis bahwa Kasir hanya boleh pilih slot yang jamnya
  memang sedang berlangsung — keduanya sesuai jawaban pemilik cafe yang
  memilih opsi paling ringan (P2 kalau nanti ternyata dibutuhkan).

**Batasan lain yang masih P1/P2 (lihat PRD bagian 13 untuk roadmap lengkap):**

- Riwayat belum ada filter tanggal, laporan bulanan/tahunan.
- Notifikasi belum ada badge jumlah belum-dibaca di ikon lonceng Nav.
- Belanja & Nota belum ada deteksi nota duplikat.
- Alur "Ajukan Koreksi" (tiket approval, PRD 7.5) untuk data yang sudah
  terkunci belum dibangun sebagai UI (skema `tiket_approval` sudah ada di
  firestore.rules, siap dipakai nanti).
- Analisis Produk, Saran Strategi, dan Catatan Owner (PRD 9.5, 9.8) —
  sepenuhnya belum dikerjakan (P1/P2). Export Excel/PDF SUDAH ADA (lihat
  bagian Status Implementasi di atas).

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
