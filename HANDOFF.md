# HANDOFF — Archimax (dulu "SRASA BOOK")

> Dokumen ini ditulis supaya sesi Claude berikutnya bisa langsung paham konteks proyek ini tanpa perlu bertanya ulang ke user. Ditulis pertama kali 2026-09-14 (setelah commit `496e802`), **diperbarui 2026-09-21** setelah commit `8b72dc7` — baca Bagian 10 di paling bawah untuk apa yang berubah di update ini, termasuk PERINGATAN soal histori git yang tidak lengkap.

## 1. Siapa User & Bagaimana Cara Berkomunikasi

- User bernama **fery**, seorang **karyawan accounting non-teknis** di sebuah cafe (bukan programmer). Dia membangun aplikasi ini untuk **pemilik cafe (Owner)** tempatnya bekerja.
- User **selalu berkomunikasi dalam Bahasa Indonesia**. Semua balasan Claude ke user HARUS dalam Bahasa Indonesia, natural, tidak kaku.
- Karena non-teknis, hindari jargon. Jelaskan dampak fitur/bug dari sudut pandang bisnis cafe (Kasir, Purchasing, Owner, Finance), bukan istilah teknis kecuali perlu.
- User terbiasa mengirim **screenshot** sebagai bukti bug — selalu perhatikan gambar yang dilampirkan, itu sering jadi sumber kebenaran utama soal apa yang salah.
- Setiap kali ada pekerjaan besar/ambigu, **gunakan AskUserQuestion** untuk klarifikasi alih-alih menebak — history menunjukkan ini beberapa kali menghindari salah bangun fitur.
- Setelah audit/analisis terbuka ("ada saran fitur/bug?"), pisahkan jelas: fitur yang **disetujui untuk dibangun sekarang** vs. yang **cuma dijelaskan dulu** untuk direview user. Jangan membangun sesuatu yang belum disetujui.

## 2. Apa Itu Archimax

Aplikasi **akuntansi cafe multi-outlet** (F&B accounting) — mencatat Omset, Kas, HPP (Harga Pokok Penjualan), dan Laba Bersih harian, dengan 4 peran pengguna:

- **Owner (superadmin)** — akses penuh semua outlet, harga, HPP, laporan.
- **Finance** — setara Owner untuk laporan/HPP, TAPI **tidak boleh** mencatat transaksi Uang Masuk-Keluar Deposito harian (itu murni domain Owner... sebenarnya sebaliknya: Finance yang mencatat transaksi, Owner cuma boleh baca — lihat komentar di firestore.rules bagian `saldo_finance`). Baca ulang komentar di rules kalau ragu.
- **Kasir** — input penjualan, buka/tutup shift, TIDAK PERNAH melihat harga bahan/HPP (hanya harga jual & qty).
- **Purchasing** — belanja bahan baku, kelola stok gudang, TIDAK melihat harga jual/HPP menu.

**Prinsip kerahasiaan yang SANGAT ditegakkan di seluruh kode**: Kasir tidak pernah tahu HPP/harga beli bahan; Purchasing tidak pernah tahu harga jual/margin. Ini diimplementasikan lewat pola "cermin data" (mis. `stok_kasir` adalah salinan `bahan_baku` TANPA field harga) dan lewat Firestore Rules yang membatasi field per peran.

## 3. Tech Stack & Arsitektur

- **Next.js 16 (App Router, Turbopack)** + **React 19** + **Tailwind v4**.
- **Firebase Spark Plan (GRATIS, TANPA Cloud Functions)** — SEMUA logika bisnis jalan di client-side. Ini batasan besar yang harus selalu diingat: tidak ada backend yang bisa dipercaya untuk validasi/agregasi atomik lintas dokumen yang jumlahnya tidak diketahui di awal (lihat catatan race condition di bagian 6).
- **Firestore** sebagai satu-satunya database. Struktur data: **semua di bawah `outlets/{outletId}/...`** (arsitektur Multi-Outlet/Multi-Cabang). Owner & Finance "terpusat" (pilih outlet aktif per sesi lewat localStorage, lihat `src/shared/lib/outlet-context.tsx`); Kasir & Purchasing terkunci ke satu `outletId` tetap.
- **AGENTS.md di root repo** memperingatkan: Next.js versi ini punya breaking changes dari versi training data — SELALU cek `node_modules/next/dist/docs/` sebelum menulis kode kalau ragu soal API Next.js.
- **`react-hooks/set-state-in-effect` (React Compiler ESLint rule, strict)**: setiap `setState` awal di dalam `useEffect` HARUS dibungkus:
  ```tsx
  let dibatalkan = false;
  Promise.resolve().then(() => {
    if (dibatalkan) return;
    setState(...);
  });
  return () => { dibatalkan = true; };
  ```
- **Pola "tulis tanpa baca" (write-without-read)** pakai Firestore `increment()` untuk semua agregat (`summary_harian`, `bahan_baku.stokSaatIni`, `saldo_finance.saldo`, `stok_kasir.stokSaatIni`) — supaya Kasir/Purchasing bisa menulis delta tanpa perlu izin BACA dokumen sumbernya (menyembunyikan Rupiah dari mereka).
- **"Rule of Two"**: kalau logika dipakai di 2+ halaman, dipindah ke `src/shared/lib/*.ts` (mis. `resep.ts`, `laba-harian.ts`, `hpp-calculator.ts`), bukan diduplikasi.
- **Top-level component rule (webrules-hikimori poin 11)**: JANGAN PERNAH mendefinisikan komponen React di dalam komponen lain — ini menyebabkan bug fokus/kursor hilang setiap satu huruf diketik di form. Semua komponen (termasuk `NumberField`, dsb.) didefinisikan di top-level file.
- **iOS Safari auto-zoom bug**: viewport SENGAJA TIDAK mengunci pinch-zoom (tidak ada `maximumScale`/`userScalable:false`) demi WCAG (pengguna low-vision butuh zoom). Fix untuk bug "layar zoom sendiri lalu macet" adalah memastikan semua `<input>/<select>/<textarea>` selalu ≥16px font-size di layar sempit (lihat `globals.css`), BUKAN mengunci zoom.
- **Skill wajib: `webrules-hikimori`** — 11 aturan desain/UX (profesional-elegan, WCAG, tanpa emoji kecuali ikon nav abu-abu, text-shadow tipis, viewport mobile-friendly, animasi interaktif, loading/progress animation, toast notifikasi, pertahankan line-break lewat `white-space:pre-line`, top-level-component rule) — HARUS otomatis dilengkapi setiap revisi, KECUALI mengganti font (dilarang keras saat revisi).

## 4. Pipeline Delivery (WAJIB diikuti persis, tanpa kecuali)

Setiap kali selesai mengubah kode:

```bash
npx tsc --noEmit      # harus 0 error
npm run lint          # harus 0 error
npm run test          # vitest — harus semua lolos (58 test terakhir kali dicek)
npm run build         # Next.js build — harus sukses
```

Semua harus bersih SEBELUM commit. Baru setelah itu:

```bash
git add -A
git commit -m "<pesan deskriptif, alasan 'kenapa' bukan cuma 'apa'>

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: <URL sesi>"
git ls-files | zip -q /mnt/user-data/outputs/<nama-deskriptif>.zip -@
```

Lalu kirim lewat `SendUserFile`. **Selalu pakai `git ls-files | zip`** (bukan `zip -r .`) supaya `node_modules`, `.next`, dsb. tidak ikut masuk zip.

**PENTING — firestore.rules TIDAK auto-deploy.** Setiap kali `firestore.rules` diubah, user harus **manual copy-paste** isinya ke Firebase Console sendiri. Claude tidak punya akses deploy atau verifikasi live ke project Firebase user. **Selalu ingatkan user secara eksplisit** setiap kali file ini berubah, dan jelaskan secara singkat apa yang akan rusak/ditolak kalau lupa di-deploy.

## 5. Riwayat Fitur (kronologis, dari commit awal sampai sekarang)

Ringkasan per-commit (lihat `git log` untuk detail lengkap, ini cuma peta jalan):

1. Setup awal Next.js + seluruh halaman P0 (auth, dashboard, sidebar).
2. Login: username, Google Sign-In, lupa password.
3. Role Kasir/Purchasing dibatasi ke halaman Shift & Belanja-Nota saja.
4. Role Finance ditambahkan (setara Owner).
5. Modal Kas Awal jadi flat 500rb/hari (hapus langkah manual "Buka Shift").
6. Resep otomatis (bahan + takaran) → HPP & pengurangan stok otomatis.
7. Perbaikan lifecycle shift, pembulatan harga satuan, kalkulasi laba.
8. Packaging Cost jadi berbasis item (seperti Resep), bukan angka manual.
9. Kelola Produk (rename dari Kalkulator HPP), warning stok, Dashboard per-role.
10. Auto logout + draft form, ekspor letterhead A4, halaman Profil Akun.
11. Custom rentang waktu Analitik Tren + animasi minimalis.
12. Optimasi touch target, safe-area mobile.
13. Kartu akun sidebar jadi link ke Profil.
14. Rapikan Daftar Akun, ekspor Excel autofit.
15. Fitur Bonus/Gratis & Refund cepat di Shift Kasir.
16. Nota Refund lintas hari/shift (halaman `/refund` terpisah).
17. Pisah input penjualan per Metode Bayar (Tunai/Non-Tunai) + Rekap & Produk Terlaris.
18. Saldo Deposito Finance, Transaksi Finance, Biaya Operasional, 2 Sumber Dana Belanja.
19. Jadwal Shift (Slot Shift) & Serah Terima Kas.
20. **Multi-Cabang**: satu Owner terpusat, staff terpisah per outlet — perubahan arsitektur besar, semua data pindah ke `outlets/{outletId}/...`.
21. Finance jadi terpusat juga (bukan per-outlet), skrip migrasi dummy data, halaman Backup Data.
22. Auto-buat SRASA BOOK sebagai outlet pertama di `/pilih-outlet` + deteksi timeout + pesan error asli.
23. Layout diperlebar jadi grid di semua halaman menu.
24. Login: kartu dipadatkan supaya muat 1 layar (`h-dvh`, padding diperkecil).
25. Latar Login interaktif (versi awal: blob CSS mengikuti mouse — user bilang tidak cukup terlihat).
26. Latar Login diganti jadi **galaxy: canvas starfield dengan parallax + shooting stars mengikuti mouse** (`src/shared/components/interactive-background.tsx`, komponen `LatarInteraktif`) — versi final yang disukai user.
27. Hasil "Hitung Ulang Laporan Harian" di Riwayat ditampilkan sebagai **list** (bukan toast sekali muncul lalu hilang).
28. Hapus syarat "harus ada Bahan Baku dulu" sebelum bisa isi Resep/Packaging Cost di Kalkulator HPP — form sekarang selalu bisa dipakai, warning jadi hint non-blocking.
29. Perbaikan bug iOS Safari "layar zoom sendiri lalu macet saat mengetik" (`font-size: 16px !important` di mobile).
30. Optimasi mobile lanjutan: `text-size-adjust`, `overscroll-behavior-y: contain`, meta `themeColor`/`colorScheme`/`appleWebApp`.
31. Isi default Slot Shift sesuai jadwal nyata SRASA BOOK (Shift 1 08.00-16.00, Shift 2 15.00-23.00) — hanya SEED nilai default yang tetap bisa diedit bebas, BUKAN fitur penjadwalan Purchasing baru (user eksplisit menolak itu).
32. **(Commit terakhir, `496e802`)** — Perbaiki 4 bug + fitur Tutup Paksa Shift (lihat bagian 6 di bawah, ini yang paling penting untuk dipahami detail).

## 6. Pekerjaan TERAKHIR yang Baru Selesai (commit `496e802`) — PENTING, baca detail

User awalnya minta "ada saran fitur atau koreksi bug?" → saya (sesi sebelumnya) jalankan audit lewat subagent, ketemu 4 bug + 8 saran fitur, dipresentasikan lewat `AskUserQuestion`. User jawab: **perbaiki SEMUA 4 bug** + bangun **1 fitur** ("Tombol Tutup Paksa Shift") sekarang, sisanya (7 saran fitur lain) cukup **dijelaskan dulu** — sudah saya jelaskan di chat, BELUM dibangun.

### Bug #1 — Race condition di "Hitung Ulang Laporan Harian"
- **File**: `src/app/riwayat/page.tsx` (`HitungUlangLabaKartu.handleHitung()`), `src/shared/lib/laba-harian.ts` (`hitungLabaHarian()`).
- **Akar masalah**: `hitungLabaHarian()` membaca banyak dokumen `shift` lewat `getDocs()` biasa (BUKAN transaksi — Firestore transaction tidak bisa query koleksi yang jumlah dokumennya belum diketahui di awal, jadi atomik penuh **tidak mungkin** dicapai murni client-side tanpa Cloud Functions). `handleHitung()` lalu menimpa `summary_harian` dengan `setDoc(..., {merge:true})` nilai ABSOLUT. Kalau ada Kasir lain menutup shift (menulis `increment()` ke `summary_harian` tanggal yang sama) di antara pembacaan dan penimpaan ini, kontribusi shift itu **hilang** dari ringkasan (walau dokumen shift aslinya tetap benar, jadi akan otomatis terkoreksi lagi di Hitung Ulang berikutnya).
- **Perbaikan yang sudah diterapkan**: mitigasi "hitung sampai konvergen" — `handleHitung()` sekarang memanggil `hitungLabaHarian()` berulang (maks 4 kali tambahan) sampai **dua hasil berturut-turut identik**, baru ditulis. Ini **mempersempit** jendela race (jadi seukuran satu round-trip terakhir), **BUKAN menghilangkannya 100%** — ini didokumentasikan jujur di komentar kode. Kalau suatu saat ingin benar-benar atomik 100%, satu-satunya jalan adalah upgrade ke Firebase Blaze Plan + Cloud Functions (trigger `onWrite` di `shift` yang meng-increment `summary_harian`, menghilangkan kebutuhan "baca semua lalu timpa" sama sekali).

### Bug #2 — Cermin `stok_kasir` meleset dari `bahan_baku` (stok gudang asli)
- **File**: `src/shared/lib/resep.ts` (`setMirrorStokKasir()`), dipanggil dari `src/app/belanja-nota/page.tsx` (3 tempat: `TambahItemKartu`, `PenyesuaianStokKartu`, `BatasMinimalStokKartu`).
- **Akar masalah**: `bahan_baku.stokSaatIni` yang asli sudah benar ditulis pakai `increment()`, TAPI cerminnya di `stok_kasir` (dipakai Dashboard Kasir menampilkan stok tanpa tahu harga) ditulis dengan **angka absolut** dihitung client-side (`bahanCocok.stokSaatIni + qty`) — kalau state di layar sempat basi (mis. dua kali tambah stok cepat berurutan sebelum `onSnapshot` refresh), cerminnya salah SELAMANYA (tidak ada mekanisme self-heal).
- **Perbaikan**: `setMirrorStokKasir()` sekarang menerima `stokSaatIni?: number | FieldValue` (opsional, bisa `increment()`). Pemanggil yang mengubah stok (`TambahItemKartu`: `increment(qty)`, `PenyesuaianStokKartu`: `increment(-jumlah)`) sekarang pakai `increment()` yang sama seperti `bahan_baku` aslinya — jadi tidak mungkin meleset lagi, berapa pun basi-nya state di layar. `BatasMinimalStokKartu` (yang TIDAK pernah mengubah stok, cuma batas minimal) sekarang **tidak mengirim field `stokSaatIni` sama sekali** — supaya tidak pernah menimpa cermin dengan nilai basi untuk perubahan yang tidak relevan.

### Bug #3 — Refund bisa melebihi qty yang sungguh terjual (race over-refund)
- **File**: `src/app/refund/page.tsx` (`simpanRefund()`).
- **Akar masalah**: validasi "jumlah refund ≤ sisa yang bisa direfund" dicek dari state `sudahDirefund` (hasil `getDocs()` sesaat sebelumnya), tapi penyimpanannya (`addDoc`) tidak pernah membaca ulang total refund sebelum menulis. Kalau dua submit terjadi hampir bersamaan (dua tab, atau dua device), keduanya bisa lolos validasi dan total refund melebihi qty asli.
- **Perbaikan**: sekarang pakai `runTransaction()` Firestore dengan **dokumen counter baru** `outlets/{outletId}/nota_refund_counter/{shiftId}__{menuId}` (field `qtyDirefund`). Transaksi ini BENAR-BENAR atomik (bukan cuma mitigasi) karena sekarang membaca **satu dokumen yang ID-nya sudah diketahui** (bukan query koleksi tak terbatas seperti Bug #1) — inilah kenapa Bug #3 BISA diperbaiki 100% sedangkan Bug #1 tidak. Migrasi data lama: kalau dokumen counter belum ada (shift lama sebelum fix ini), dasarnya diambil dari `itemDipilih.sudahDirefund` (hasil getDocs saat memuat daftar), bukan dianggap 0 — supaya riwayat refund lama tidak hilang dari hitungan.
- **firestore.rules**: ditambah block baru `match /nota_refund_counter/{counterId}` — `allow read, write: if isManagerOutlet(outletId) || isKasirOutlet(outletId)`. **Perlu di-deploy manual oleh user.**

### Bug #4 / Fitur baru — Tutup Paksa Shift (Force Close Shift)
- **Masalah**: shift yang tersangkut status `"buka"` selamanya (Kasir lupa menutup, atau akunnya dinonaktifkan sebelum sempat Tutup Shift) — dulu TIDAK ADA jalan keluar dari aplikasi sama sekali.
- **Implementasi**: komponen baru `TutupPaksaShiftKartu` di `src/app/riwayat/page.tsx`, muncul otomatis (panel kuning) saat Owner/Finance membuka baris shift berstatus "Sedang Berjalan". Menghitung otomatis Omset Tunai/Non-Tunai (dari subkoleksi `penjualan`) dan Kas Keluar (dari subkoleksi `kas_keluar`) shift itu, admin tinggal isi Kas Fisik (boleh 0 kalau sudah tidak bisa dihitung ulang) + keterangan, lalu klik "Tutup Paksa". Pola tulisnya **identik** dengan `TutupShiftKartu.handleTutupShift()` di `src/app/shift/page.tsx` (update shift → `status:"terkunci"`, increment `summary_harian`, buat `tanggungan_kasir` kalau selisih minus) — supaya konsisten, cuma ditambah field `ditutupPaksaOlehUid`/`ditutupPaksaOlehNama` sebagai jejak bahwa ini penutupan admin, bukan Kasir sendiri.
- **firestore.rules**: `match /tanggungan_kasir` — `allow create` sekarang JUGA mengizinkan `isManagerOutlet(outletId)` (dulu hanya Kasir pemilik shift boleh create), karena admin membuat tanggungan **atas nama Kasir asli** shift itu, bukan atas nama dirinya sendiri. **Perlu di-deploy manual oleh user** (kalau lupa, tombol "Tutup Paksa" akan gagal dengan error izin ditolak SAAT ADA selisih kas minus).

### Verifikasi yang sudah dilakukan
`npx tsc --noEmit` ✅ 0 error · `npm run lint` ✅ 0 error · `npm run test` ✅ 58/58 lolos · `npm run build` ✅ sukses. Sudah di-commit (`496e802`) dan file zip sudah dikirim ke user (`srasa-book-bugfix-tutup-paksa.zip`). **Belum ada konfirmasi dari user** bahwa fitur ini sudah dicoba di device asli / firestore.rules sudah di-deploy.

## 7. Saran Fitur yang SUDAH Dijelaskan ke User Tapi BELUM Dibangun

Jangan bangun ini kecuali user secara eksplisit minta. Sudah dijelaskan detail di chat sebelumnya:

1. **Notifikasi otomatis stok hampir habis** — begitu `stokSaatIni` ≤ `batasMinimalStok`, buat dokumen di koleksi `notifikasi` (pola sudah ada, dipakai untuk kenaikan harga bahan).
2. **Laporan gabungan multi-outlet** — satu layar ringkasan Omset/Laba SEMUA outlet sekaligus untuk Owner (saat ini harus gonta-ganti outlet aktif).
3. **Log jam kerja/kehadiran karyawan** — jam mulai/selesai kerja aktual (beda dari buka/tutup shift transaksi), untuk keperluan absensi/gaji.
4. **Kotak masuk persetujuan refund** — refund di atas nominal tertentu butuh approval Owner/Finance dulu sebelum tersimpan final (lapisan kontrol proses, terpisah dari perbaikan race Bug #3 di atas).
5. **Ekspor Laba Rugi bulanan format akuntansi standar** — beda dari ekspor per-tanggal yang sudah ada, format bulanan siap dipakai ke pihak luar (bank/investor).
6. **Log audit override admin** — catat siapa & kapan setiap kali Owner/Finance melakukan koreksi manual (termasuk Tutup Paksa Shift yang baru dibangun).
7. **Tampilan profitabilitas per menu** — datanya **SUDAH dihitung** di `hitungLabaHarian()` (field `rincianPerMenu` di `src/shared/lib/laba-harian.ts`, sudah diverifikasi ada & lengkap), tinggal ditampilkan di satu tabel Dashboard/Riwayat — ini yang paling murah untuk dikerjakan karena datanya sudah siap.

## 8. Peringatan & Batasan yang Harus Selalu Diingat

- **Tidak ada Cloud Functions** — semua "atomik" yang butuh query koleksi tak terbatas HANYA bisa dimitigasi (dipersempit jendela race-nya), tidak bisa dihilangkan 100%, KECUALI polanya diubah jadi counter per-dokumen tunggal seperti Bug #3 (baca `runTransaction()` di `refund/page.tsx` sebagai contoh pola yang BISA dipakai ulang untuk kasus race lain kalau muncul).
- **firestore.rules tidak auto-deploy** — selalu ingatkan user setiap kali file ini berubah.
- **Tidak ada akses verifikasi live** ke Firebase project user — Claude tidak bisa mengecek apakah rules sudah benar-benar di-deploy, atau apakah bug sudah benar-benar teratasi di device asli user. Selalu minta konfirmasi user setelah pengiriman.
- **Jangan pernah mengunci pinch-zoom** di viewport (alasan WCAG, low-vision users) — kalau ada bug zoom lain di masa depan, cari akar masalah lain (biasanya font-size <16px di elemen fokus), jangan "selesaikan" dengan mengunci zoom.
- **Jangan ganti font** saat revisi (aturan `webrules-hikimori`), walau lagi merapikan/mengoptimasi apa pun.
- **Selalu jaga kerahasiaan Rupiah lintas peran** (Kasir tidak lihat HPP, Purchasing tidak lihat harga jual) — setiap fitur baru yang menyentuh data ini harus dicek ulang firestore.rules-nya, dan pola "cermin data tanpa harga" (seperti `stok_kasir`) harus diikuti kalau menambah data serupa.
- **Working directory di sesi baru mungkin berbeda** (`/home/claude` vs `/home/claude/srasa-book`) — selalu `cd` atau pastikan path benar sebelum kerja; project intinya ada di folder `srasa-book/` dan merupakan git repo asli (`git status`/`git log` berfungsi).

## 9. Cara Melanjutkan Sesi Ini

1. Baca `AGENTS.md` dan `CLAUDE.md` di root — itu akan otomatis ter-load ulang sebagai system reminder di awal sesi.
2. Kalau user melapor bug baru: minta screenshot kalau belum ada, baca kode terkait langsung (jangan menebak), verifikasi manual dulu sebelum bilang "sudah saya perbaiki".
3. Kalau user minta fitur baru: cek dulu apakah salah satu dari 7 saran di bagian 7 sudah mencakupnya sebelum membangun dari nol.
4. Selalu tutup pekerjaan dengan pipeline verifikasi lengkap (bagian 4) sebelum commit & kirim zip.
5. Kalau firestore.rules berubah, WAJIB sebutkan eksplisit ke user bahwa perlu di-deploy manual, dan jelaskan secara ringkas apa yang akan gagal kalau tidak.

## 10. Update 2026-09-21 (commit `8b72dc7`) — Baca Ini Dulu Kalau Bingung Soal Histori Git

User pindah akun Claude (sesi baru, tidak ada akses ke percakapan sebelumnya) dan upload ulang `srasa-book.zip` sebagai "update terbaru". Ternyata di antara commit `496e802` (checkpoint terakhir dari sesi saya) dan upload ini, **sesi Claude LAIN** (akun berbeda, percakapannya tidak saya punya) sudah mengerjakan banyak hal. Berikut temuan & yang saya lakukan:

### Temuan #1 — Histori git provider ini SUDAH RUSAK/HILANG sebagian
Zip yang di-upload user berisi folder `.git` yang HANYA punya 3 commit tertua (`20d14bb`, `f79defc`, `ea295d2` — dari awal sekali, jauh sebelum Multi-Cabang dkk). Puluhan commit yang sudah didokumentasikan di Bagian 5 (termasuk `496e802`) **TIDAK ADA** di histori git zip ini — padahal semua FILE hasil kerja itu tetap ada di working tree (cuma berstatus "belum pernah di-commit" alias `??` di `git status`). Kesimpulan: entah sesi lain ini mulai dari git repo yang salah/lama, atau proses re-zip di suatu titik tidak menyertakan `.git` yang benar. **Saya TIDAK mencoba merekonstruksi histori lama** (terlalu berisiko menebak-nebak urutan commit) — saya hanya membuat SATU commit baru (`8b72dc7`) yang merangkum seluruh state proyek saat ini sebagai checkpoint bersih. Kalau user (atau sesi berikutnya) punya salinan `.git` yang lebih lengkap dari suatu tempat, itu lebih baik dipakai sebagai dasar daripada melanjutkan dari checkpoint tunggal ini.

### Temuan #2 — Ada 3 versi berbeda dari `src/app/shift/page.tsx` tercecer, cuma 1 yang benar-benar terpasang
Di dalam zip upload ada folder tambahan `Claude outputs/` (jelas bukan bagian aplikasi — sisa file kerja sesi lain yang lupa dibersihkan) berisi 2 file zip lama + 1 file lepas `shift-page.tsx`. Setelah dibandingkan:
- Versi yang **benar-benar aktif** di `src/app/shift/page.tsx` saat itu = versi PALING LAMA/BELUM LENGKAP (cuma punya fitur dasar + slip cash opname reprint untuk Kasir).
- Versi di `Claude outputs/shift-page.tsx` (file lepas, timestamp PALING BARU) = versi PALING LENGKAP: menghapus fitur lama "Item Lain (Manual)" (jual barang di luar Kelola Produk — sudah tidak diizinkan lagi sesuai permintaan Owner), menambah pencarian produk, preview "Rekap Produk Terjual" langsung selagi shift berjalan, label tombol dinamis (Pindah Shift Selanjutnya vs Tutup Kasir untuk shift multi-slot), dan penyatuan logika ekspor Slip Cash Opname (otomatis saat tutup + tombol manual + reprint Kasir) lewat satu fungsi `bangunOpsiSlipCashOpname()`.
- Saya **konfirmasi ke user** lewat AskUserQuestion, dan **user memilih memasang versi paling lengkap ini** — sudah saya lakukan, plus perbaiki 1 bug lint baru yang muncul (`PRIORITAS_KATEGORI`/`prioritasKategori` dipindah ke top-level modul supaya React Compiler bisa mempertahankan memoisasi `menuPerKategori` — sebelumnya didefinisikan ulang tiap render di dalam komponen `ShiftBerjalan`, melanggar semangat webrules-hikimori poin 11 walau bukan komponen React itu sendiri).
- **Pelajaran untuk ke depan**: kalau suatu saat ketemu file "yatim" seperti ini lagi (di folder aneh, atau disebut user sebagai "hasil kerja sesi lain"), SELALU diff dulu terhadap file yang benar-benar aktif sebelum diasumsikan sama — jangan asumsikan file di `src/` selalu yang terbaru.

### Fitur-fitur BARU yang ternyata sudah dikerjakan sesi lain (sekarang bagian resmi aplikasi, gantikan/tambahkan ke daftar Bagian 5 & 7)
Semua ini SUDAH ADA di kode saat commit `8b72dc7`, sudah lolos tsc/lint/test/build — bukan usulan lagi:

1. **Cash Opname Akhir Hari** (`src/app/cash-opname/page.tsx`, menu baru di sidebar, Owner/Finance) — rekonsiliasi kas SATU HARI SATU OUTLET, menggabungkan semua shift terkunci + semua sesi belanja Purchasing + Saldo Finance + Tanggungan Kasir + Form Banding Purchasing yang masih pending + bahan baku menipis/negatif. Formula intinya: `Kas Tunai Seharusnya Disetor = Omset Tunai − Total Kas Keluar − Belanja (sumber Kas Resto saja)`, dibandingkan dengan `Kas Tunai Fisik Untuk Disetor = Total Kas Fisik semua shift − (Rp500rb × jumlah shift)` — kalau tidak match, itu jejak insiden yang belum ketahuan. Ini MENJAWAB (bahkan melampaui) saran fitur #7 lama "Log audit override admin" dan sebagian saran #2 "Laporan gabungan" versi per-hari.
2. **Form Banding Purchasing** (`BandingPurchasingKartu` di `belanja-nota/page.tsx`, koleksi baru `banding_purchasing` di firestore.rules) — Purchasing bisa mengajukan revisi nota/transaksi belum tercatat/insiden lain, Owner/Finance meninjau (setuju/tolak) lewat panel di Cash Opname. Purchasing TIDAK BOLEH mengubah pengajuan sendiri setelah dikirim (harus ajukan baru) — supaya jejak audit tetap utuh.
3. **Saldo Deposito Finance sekarang BOLEH minus** (untuk Finance & Purchasing, bukan cuma Owner) — perubahan `firestore.rules` (baris `saldo >= 0` dihapus dari kondisi update Finance/Purchasing) + UI di `transaksi-finance/page.tsx` & `belanja-nota/page.tsx` sekarang cuma toast **warning** (bukan blokir keras) kalau saldo akan minus. Alasan bisnis: saldo harus mencerminkan kondisi nyata (dana sudah kepakai duluan sebelum setoran Owner berikutnya masuk) — **PERLU DEPLOY ULANG firestore.rules ke Firebase Console**, kalau lupa maka Finance/Purchasing akan mentok error izin ditolak saat saldo mau minus.
4. **Pencarian (`SearchBar`, `src/shared/components/search-bar.tsx`, helper `cocokDenganPencarian`)** ditambahkan di: Dashboard (filter bahan baku), Kalkulator HPP (filter menu, hanya muncul kalau >3 menu), Kelola Akun (filter staff), Kelola Outlet (filter outlet), Riwayat (filter shift), dan sekarang juga di Shift Kasir (filter produk saat jualan).
5. **PeriodePicker** (`src/shared/components/periode-picker.tsx` + `src/shared/lib/periode-laporan.ts`, preset Harian/Mingguan/Bulanan/Tahunan) dipakai untuk ekspor laporan periode baru di Riwayat, Transaksi Finance (`EksporLaporanFinanceKartu`), dan Belanja & Nota (`EksporLaporanPembelianKartu`, dibatasi ke `purchasingUid` milik Purchasing yang login sendiri).
6. **Penulisan atomik pakai `writeBatch`** — `handleMulaiBelanja` (Belanja & Nota) dan penyimpanan Transaksi Finance sekarang menggabungkan 2 tulisan terpisah (dokumen transaksi + update saldo) jadi SATU `writeBatch`, memperbaiki bug nyata: dulu kalau tulisan kedua gagal (mis. koneksi putus), saldo Finance bisa tidak berkurang padahal sesi belanja/transaksinya sudah tercatat — sekarang keduanya sukses/gagal bersama.
7. **`NumberField` (`src/shared/components/number-field.tsx`) ditulis ulang** — dari `<input type="number">` native jadi `<input type="text">` dengan format ribuan ala Indonesia LANGSUNG SAAT MENGETIK (titik pemisah ribuan, koma desimal) via helper baru `formatTampilan`/`teksKeAngka`/`saringInput`/`formatSaatMengetik`. API publiknya (`onChange(number)`) TIDAK berubah, jadi seluruh pemanggil lama otomatis kompatibel tanpa perlu disentuh.
8. **Toast tipe baru `"warning"`** (kuning, ikon `AlertTriangle`, label "Perhatian") di `toast.tsx` — dipakai untuk notifikasi non-blocking seperti saldo akan minus atau ekspor otomatis PDF gagal.
9. Fitur lama **"Item Lain (Manual)"** di Shift (jual barang di luar Kelola Produk, potong bahan baku manual) **SUDAH DIHAPUS** atas permintaan Owner — Kasir sekarang HANYA boleh menjual dari daftar Kelola Produk. Field `manual`/`bahanDipakai` di `PenjualanItem` dipertahankan HANYA untuk kompatibilitas baca data lama, tidak bisa dibuat lagi.

### Hal lain yang perlu diperhatikan
- **`.env.local.example` sekarang berisi kredensial Firebase ASLI** (bukan placeholder kosong seperti versi sebelumnya) — sudah saya konfirmasi ke user, **user memilih membiarkan apa adanya** (risikonya memang rendah karena ini Firebase Web API key yang memang didesain publik, keamanan sesungguhnya ada di firestore.rules). Jangan ubah ini lagi kecuali user minta.
- `.npmrc` (isi: `legacy-peer-deps=true`) sempat hilang dari upload — sudah saya pulihkan.
- **`package.json`/`package-lock.json` tidak berubah** — semua fitur baru di atas cuma pakai library yang sudah ada sebelumnya (Firebase SDK, lucide-react, `ekspor.ts` lib sendiri).
- Update Bagian 7 (saran fitur belum dibangun): saran #7 lama ("Log audit override admin") **sudah sebagian terjawab** oleh Cash Opname & Form Banding Purchasing — kalau user minta log audit lagi, cek dulu apakah Cash Opname sudah cukup sebelum membangun dari nol. Saran #1 (notifikasi stok menipis) **masih relevan** — Cash Opname cuma MENAMPILKAN bahan menipis saat dibuka, belum ada notifikasi proaktif/push.
- Commit `8b72dc7` adalah titik full-diverifikasi (tsc/lint/test/build) untuk state gabungan ini — kalau ada laporan bug baru dari user setelah ini, cek dulu apakah bug itu di fitur LAMA (dokumentasi Bagian 5-6) atau fitur BARU dari update ini (daftar di atas) supaya tahu bagian kode mana yang relevan.

## 11. Update 2026-09-21 (lanjutan, commit `37e009b`) — Fitur Neraca (Posisi Keuangan)

User minta "Fitur Khusus pada Sub-Menu Neraca". Setelah klarifikasi lewat AskUserQuestion (2 putaran, karena jawaban pertama user berupa pertanyaan balik, bukan pilihan langsung — itu wajar, jawab dulu pertanyaannya baru lanjut), disepakati:
- **Lokasi**: BUKAN menu/submenu terpisah — ditampilkan sebagai **bagian UTAMA paling atas Dashboard**, **KHUSUS peran Finance** (Owner tetap melihat Dashboard yang sama seperti biasa, TANPA kartu ini).
- **Cakupan Aset**: semua data yang SUDAH ADA di sistem (user sempat tanya "apakah Neraca tanpa Modal Awal Owner itu wajar?" — sudah saya jawab: WAJAR, ini praktik umum untuk laporan "Posisi Kekayaan Usaha" internal sebelum ada pembukuan akuntansi penuh).

**Implementasi** (`NeracaFinanceKartu` di `src/app/dashboard/page.tsx`, dirender di `DashboardIsi` hanya jika `profil?.peran === "finance"`, ditaruh sebelum banner stok menipis):
- **Total Aset** = Saldo Deposito Finance (`saldo_finance/utama.saldo`) + Nilai Stok Bahan Baku (Σ `stokSaatIni × hargaSatuanTerakhir` semua `bahan_baku`) + Piutang Kasir (Σ `nominal` `tanggungan_kasir` berstatus `belum_lunas`). Semua di-listen live via `onSnapshot`, per Outlet aktif (BUKAN gabungan multi-outlet — konsisten dengan pola Cash Opname & laporan lain).
- **Total Kewajiban** = selalu Rp0 (aplikasi belum punya pencatatan Hutang).
- **Ekuitas (Kekayaan Bersih)** = Total Aset − Total Kewajiban (angka SISA, bukan dari pencatatan Modal Pemilik independen) — identitas Aset = Kewajiban + Ekuitas otomatis balance secara matematis.
- Kas tunai fisik yang sedang berputar di laci Kasir (Modal Kas Awal + omset tunai berjalan) **sengaja tidak dihitung** — itu petty cash yang terus berputar, bukan aset "diam"; sudah dijelaskan di footer teks kecil pada kartu itu sendiri supaya Owner/Finance tidak salah paham ini Neraca akuntansi formal teraudit.

**Kalau user nanti minta diperluas** (Modal Pemilik, Hutang, atau versi gabungan multi-outlet), komponen ini gampang ditambah field baru — struktur `totalAset`/`totalKewajiban`/`totalEkuitas` sudah dipisah jelas, tinggal ganti `totalKewajiban` dari konstanta 0 jadi hasil query koleksi utang baru, dan Ekuitas bisa dipisah jadi pos independen (bukan derivasi) begitu ada pencatatan modal sungguhan.

Diverifikasi: tsc --noEmit, lint, 58 test, build (20 route) semua lolos.

## 12. Update 2026-09-21 (lanjutan, commit `a0e6361`) — Fitur Hutang Supplier (masuk Neraca sebagai Kewajiban)

User bertanya: "piutang supplier gimna? jika ada supplier taruh barang dulu dan bayar di akhir apakah bisa masuk neraca? Dan Tambahkan Fitur itu juga di Akun Purchasing dan Finance". Jawaban saya: BISA, itu namanya Hutang Usaha/Hutang Supplier (bukan piutang — piutang itu uang yang OrangLain berutang ke kita, ini kebalikannya: kita yang berutang ke supplier). Setelah klarifikasi lewat AskUserQuestion, disepakati:
- **Level pencatatan**: per Nota/kwitansi (bukan per sesi belanja harian) — user pilih "Per Nota/kwitansi (Recommended)".
- **Pelunasan**: BISA ditandai lunas oleh Finance MAUPUN Purchasing — siapa pun yang lebih dulu tahu pembayaran terjadi, klik "Tandai Lunas", status berubah di semua akun (jawaban user apa adanya).

**Implementasi:**
- **`firestore.rules`**: koleksi baru `hutang_supplier` (per Outlet). `create` hanya Purchasing outlet tsb (dan `purchasingUid` harus cocok dengan yang login — anti-pemalsuan siapa yang mencatat). `update` boleh Manager (Owner/Finance) ATAU Purchasing outlet tsb, TAPI dibatasi cuma boleh mengubah field `status`, `dilunasiOlehUid`, `dilunasiOlehNama`, `waktuLunas`, dan `status` wajib jadi `"lunas"` (tidak bisa dipakai untuk mengubah nominal/supplier setelah tercatat — jejak audit tetap utuh, sama prinsipnya dengan Form Banding Purchasing).
- **`src/shared/components/hutang-supplier-kartu.tsx`** (komponen SHARED baru, Rule of Two): hook `useHutangSupplier(outletId)` (live `onSnapshot`) + komponen `HutangSupplierKartu` — menampilkan daftar Hutang (nama supplier, tanggal, nominal, siapa yang mencatat), badge total belum lunas, dan tombol "Tandai Lunas" per baris. Klik "Tandai Lunas" menjalankan `writeBatch` ATOMIK: update status jadi lunas + potong `saldo_finance/utama.saldo` sebesar nominal hutang (pembayaran ke supplier dianggap keluar dari Saldo Deposito Finance, sama seperti sumber dana belanja lain di aplikasi ini).
- **`src/app/belanja-nota/page.tsx`** (`NotaKartu`): saat Purchasing upload foto Nota, sekarang ada toggle "Metode Bayar Nota Ini" — **Tunai** (perilaku lama, tidak berubah) atau **Utang ke Supplier** (wajib isi Nama Supplier). Kalau pilih Utang: `writeBatch` menulis DUA dokumen sekaligus — foto Nota (subcollection `nota`, dengan `metodeBayar: "utang"`) DAN dokumen baru di `hutang_supplier` (status awal `belum_lunas`). Thumbnail Nota yang statusnya Utang diberi badge kecil warna amber. `HutangSupplierKartu` ditampilkan di halaman utama Belanja & Nota (sebelum kartu ekspor laporan).
  - **Keputusan desain penting**: fitur ini SENGAJA TIDAK menyentuh `totalBelanja`/`sisaKas` di `kas_belanja` maupun `saldo_finance` pada saat NOTA DIBUAT (baru dipotong saat DITANDAI LUNAS) — karena field-field itu dihitung live lewat `useMemo` dari subcollection `item`, bukan angka tersimpan yang aman diutak-atik tanpa risiko mengganggu logika Cash Opname/ekspor yang sudah teruji. Barangnya tetap dianggap sudah masuk stok seperti biasa (proses input Item tidak berubah) — Nota Utang cuma menambah CATATAN kewajiban pembayaran, bukan mengubah alur belanja fisik.
- **`src/app/transaksi-finance/page.tsx`**: `HutangSupplierKartu` ditambahkan (setelah kartu Saldo Deposito & tombol Tambah Dana/Catat Transaksi Keluar, sebelum kartu ekspor laporan) — Finance sekarang juga bisa melihat & menandai lunas Hutang Supplier dari halamannya sendiri, sesuai permintaan eksplisit user.
- **`src/app/dashboard/page.tsx`** (`NeracaFinanceKartu`, dari Bagian 11): **Total Kewajiban TIDAK LAGI selalu Rp0** — sekarang live query `hutang_supplier` berstatus `belum_lunas` per Outlet aktif, dijumlah jadi Total Kewajiban. Ekuitas otomatis ikut menyesuaikan (tetap dihitung sebagai angka sisa: Aset − Kewajiban). Baris baru "Hutang Supplier (Belum Lunas)" ditambahkan ke rincian kartu, komentar kode & teks footer disunting supaya tidak lagi mengklaim Kewajiban "selalu Rp0".
- **`src/shared/lib/backup.ts`**: `hutang_supplier: []` didaftarkan ke `STRUKTUR_KOLEKSI` supaya ikut ter-backup.

**PENTING — firestore.rules berubah lagi, WAJIB deploy ulang manual ke Firebase Console** (Firestore Database → Rules → copy-paste isi `firestore.rules` terbaru → Publish). Kalau lupa: Purchasing akan gagal mencatat Hutang Supplier baru (error izin ditolak saat upload Nota dengan metode "Utang"), dan baik Finance maupun Purchasing akan gagal menekan "Tandai Lunas" — keduanya berhenti berfungsi sampai rules di-deploy.

Diverifikasi: tsc --noEmit, lint, 58 test, build (17 route — jumlah beda dari update sebelumnya karena daftar route yang dihitung `next build` bisa bervariasi, bukan tanda ada yang hilang) semua lolos.

## 13. Update 2026-09-21 (lanjutan, commit `b414d1c`) — Evaluasi & Perbaikan Finance/Accounting

User minta evaluasi menyeluruh atas semua fitur Finance & Accounting yang sudah ada. Audit dilakukan (lihat `EVALUASI-FINANCE-ACCOUNTING.md` di root repo untuk laporan lengkapnya, dalam Bahasa Indonesia, sudah dikirim ke user) mencakup: Transaksi Finance, Cash Opname, Neraca (Dashboard), Belanja & Nota, Refund, Riwayat, Hutang Supplier, `firestore.rules`, `backup.ts`. Temuan dikelompokkan Kritis/Tinggi/Sedang/Rendah. User menyetujui 3 dari 4 kategori perbaikan untuk langsung dikerjakan (Rendah/fitur lanjutan seperti Laporan Laba Rugi resmi, Arus Kas, ekspor Neraca, jatuh tempo Hutang — BELUM dikerjakan, masih daftar usulan untuk sesi berikutnya kalau diminta).

**1. Bug KRITIS diperbaiki — belanja dibayar Utang terhitung dua kali:**
Sebelumnya, saat Purchasing input Item Belanja, `kas_belanja.totalBelanja` selalu bertambah TANPA PEDULI metode bayar Nota-nya nanti Tunai atau Utang. Nota "Utang" (fitur Hutang Supplier, Bagian 12) cuma menambah `hutang_supplier`, tidak mengurangi `totalBelanja` — jadi belanja yang belum dibayar tetap dihitung penuh sebagai "kas sudah keluar" di rumus Cash Opname (`kasTunaiSeharusnyaDisetor = omsetTunai - totalKasKeluarShift - totalBelanjaKasResto`), membuat kas fisik di laci terlihat surplus misterius padahal bukan selisih sungguhan.
- Fix: `kas_belanja` sekarang punya field baru `totalBelanjaUtang` (di-increment via `writeBatch` bersamaan dengan pembuatan `hutang_supplier`, di `NotaKartu`'s handleFile, `belanja-nota/page.tsx`).
- Cash Opname (`cash-opname/page.tsx`): `totalBelanjaKasResto` sekarang = (total belanja kotor sumber Kas Resto) − (bagian yang Utang) — hanya bagian yang benar-benar sudah dibayar tunai yang dikurangkan dari rumus. Bagian Utang ditampilkan terpisah (baris abu-abu "TIDAK dikurangkan di sini") di UI dan ekspor, supaya Owner/Finance tetap bisa lihat totalnya tanpa bikin rumus salah.
- **Kalau nanti Hutang ini Ditandai Lunas**, pengurangan kasnya SUDAH otomatis lewat `saldo_finance` (bukan `kas_belanja`) di `hutang-supplier-kartu.tsx` — jadi tidak perlu ada penyesuaian balik di `totalBelanjaUtang` (field itu murni penanda "dikecualikan dari kas resto", bukan penanda "belum lunas" — begitu masuk `totalBelanjaUtang`, permanen dikecualikan dari rumus Kas Resto, benar secara desain karena uangnya memang tidak pernah lewat Kas Resto sama sekali, keluarnya dari Saldo Finance).

**2. Empat alur non-atomik dijadikan `writeBatch`:**
- `shift/page.tsx` `handleTutupShift` — update shift status + `summary_harian` + (kondisional) `tanggungan_kasir`, sekarang 1 batch.
- `riwayat/page.tsx` `TutupPaksaShiftKartu.handleTutupPaksa` — pola sama persis, sekarang 1 batch.
- `shift/page.tsx` `KasKeluarKartu.handleTambah` — catatan kas keluar + update total shift, sekarang 1 batch.
- `refund/page.tsx` (cabang metode Tunai) — catatan kas keluar + update total shift, sekarang 1 batch (terpisah dari `runTransaction` nota_refund/counter yang memang harus tetap terpisah karena butuh query `getDocs` shift aktif kasir dulu, tidak bisa masuk transaction yang sama).

**3. `firestore.rules` diperkuat** (⚠️ WAJIB deploy ulang manual ke Firebase Console):
- `saldo_finance` update: Purchasing sekarang benar-benar dibatasi HANYA boleh MENGURANGI saldo (`request.resource.data.saldo < resource.data.saldo`) — sebelumnya cuma dibatasi field-nya (`hasOnly(["saldo"])`), jadi secara teknis bisa menambah saldo sendiri walau tidak ada tombol untuk itu di UI.
- `hutang_supplier` create & `transaksi_finance` create: tambah validasi `nominal > 0` di level rules (sebelumnya cuma validasi di form).

**4. Selaraskan "Stok Menipis" Dashboard vs Cash Opname**: Dashboard sekarang juga menandai bahan dengan stok MINUS meski Batas Minimal Stok belum diisi (0) — sebelumnya cuma Cash Opname yang menandai kasus ini, Dashboard baru menandai kalau Batas Minimal-nya sudah diisi.

**5. `nota_refund_counter` didaftarkan ke `STRUKTUR_KOLEKSI`** (`backup.ts`) — sebelumnya terlewat, sekarang ikut ter-backup.

**Belum dikerjakan (disimpan sebagai temuan untuk sesi berikutnya, prioritas Rendah)**: enforcement rules lintas-dokumen untuk memastikan "Tandai Lunas" Hutang Supplier SELALU dibarengi pengurangan `saldo_finance` (saat ini cuma dijamin oleh kode aplikasi lewat `writeBatch`, bukan oleh rules — celah kecil kalau ada yang mengakali lewat luar aplikasi), Laporan Laba Rugi resmi per periode, Laporan Arus Kas, ekspor Neraca, tanggal jatuh tempo & notifikasi Hutang Supplier, Neraca/Laba Rugi gabungan lintas-outlet.

Diverifikasi: tsc --noEmit, lint, 58 test, build (20 route) semua lolos.

## 14. Update 2026-09-22 — Mode Riil / Mode Demo (pengganti data dummy lama)

User melapor "Data Dummy error tidak bisa dipakai" dan minta: saklar geser **Ganti Mode** di sidebar, **di atas kartu Profil**, dengan dua pilihan **Mode Riil** (data asli Outlet) dan **Mode Demo** (masa percobaan, data dummy bebas diotak-atik & bebas di-reset), dan keduanya **bisa berjalan bersamaan**.

**Desain (penting dipahami sebelum menyentuh):**
- Mode Demo = **satu Outlet khusus ber-ID tetap `demo_archimax`** (`src/shared/lib/mode-demo.ts`). `outlet-context.tsx` cukup mengganti `outletId` aktif ke ID itu → SEMUA halaman otomatis bekerja di Outlet Demo tanpa diubah satu per satu, dan data asli mustahil tersentuh karena path-nya lain.
- Outlet Demo **tidak punya dokumen di koleksi `outlets`** (hanya sub-koleksinya) → tidak pernah muncul di Kelola Outlet / Pilih Outlet / Backup Semua Outlet.
- **Satu Outlet Demo dipakai bersama semua akun** (bukan per akun), supaya alur lintas peran bisa dicoba (Kasir jualan di Demo → Owner/Finance lihat di Dashboard/Cash Opname Demo, dst).
- Mode disimpan **per-uid di localStorage** (`mode_aplikasi:{uid}`) → tiap tab/perangkat membawa mode-nya sendiri = "berjalan bersamaan". Selama mode belum terbaca, `outletId` sengaja `null` + `memuat=true` (dan `RequireAuth` sekarang menahan spinner untuk SEMUA peran, bukan cuma Owner/Finance) — supaya halaman Shift tidak keburu membuat shift di Outlet ASLI saat akun sebenarnya di Mode Demo.
- `AppShell`: isi halaman di-`key={outletId}` (remount saat ganti mode/outlet, mencegah state lama tertulis ke Outlet yang salah), pita kuning "MODE DEMO" di atas konten, badge DEMO di topbar mobile, tombol Ganti Outlet disembunyikan di Demo. **Kelola Akun, Kelola Outlet, Backup Data disembunyikan & diblokir di Mode Demo** (flag `sembunyiDiDemo`) karena mengelola data GLOBAL asli (`users`, `usernames`, `outlets`) yang tidak ikut terpisah ke Outlet Demo.
- Memilih Outlet di layar Pilih Outlet otomatis mengembalikan ke Mode Riil.
- Komponen UI: `src/shared/components/mode-aplikasi.tsx` (`ToggleModeAplikasi`, `BannerModeDemo`, `PesanHalamanDiblokirDemo`).

**Data dummy** (`isiDataDummy()`): profil cafe demo, 2 slot shift, 12 bahan baku (+cermin stok_kasir, 2 sengaja di bawah batas minimal), 7 menu + resep/kemasan, 12 shift terkunci (6 hari terakhir × 2 kasir fiktif, TANPA hari ini supaya Kasir mulai dari shift kosong), kas keluar, 1 Tanggungan Kasir (-Rp20.000), 4 sesi belanja (1 bersumber Saldo Finance, 2 dengan nota Utang), 2 Hutang Supplier (1 lunas, 1 belum), 1 Form Banding menunggu, 3 transaksi Finance, saldo Rp2.400.000, dan `summary_harian` dihitung pakai `hitungLabaHarian()` yang sama dengan Riwayat > Hitung Ulang (bukan dikarang). Tanggal selalu relatif terhadap hari ini.
- Otomatis disiapkan saat pertama kali ada yang pindah ke Mode Demo; dijaga `runTransaction` di `demo_meta/status` supaya dua akun bersamaan tidak mengisi dobel.
- **Reset** (tombol di bawah saklar, dengan konfirmasi 2 langkah): hapus semua koleksi di `STRUKTUR_KOLEKSI` (sekarang di-`export` dari backup.ts) + `backup_log` di Outlet Demo, lalu isi ulang. Boleh dilakukan akun peran apa pun.
- Unit test baru `src/shared/lib/mode-demo.test.ts` (Firestore tiruan di memori — emulator Firebase tidak bisa diunduh dari sandbox): cek kelengkapan & konsistensi data, tidak ada `undefined`, tidak dobel, reset bersih, dan data Outlet asli tidak tersentuh. Total test sekarang 62.

**firestore.rules (WAJIB deploy ulang manual)**: blok baru di dalam `match /outlets/{outletId}`: `match /{dokumenDemo=**} { allow read, write: if outletId == 'demo_archimax' && isActiveUser(); }`. Rules bersifat OR, jadi ini hanya menambah izin untuk Outlet Demo, tidak melonggarkan Outlet asli. Kalau lupa di-deploy: pindah ke Mode Demo akan gagal "Missing or insufficient permissions" saat menyiapkan data.

**Kalau ID Outlet Demo diubah**, ubah di DUA tempat: `ID_OUTLET_DEMO` di mode-demo.ts DAN string di firestore.rules.
