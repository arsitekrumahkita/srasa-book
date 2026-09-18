# HANDOFF — Jurnal F A T A (dulu "ARCHIMAX", sebelumnya "SRASA BOOK")

> Dokumen ini ditulis supaya sesi Claude berikutnya bisa langsung paham konteks proyek ini tanpa perlu bertanya ulang ke user. Ditulis pada 2026-09-14, setelah commit `496e802`.

## 1. Siapa User & Bagaimana Cara Berkomunikasi

- User bernama **fery**, seorang **karyawan accounting non-teknis** di sebuah cafe (bukan programmer). Dia membangun aplikasi ini untuk **pemilik cafe (Owner)** tempatnya bekerja.
- User **selalu berkomunikasi dalam Bahasa Indonesia**. Semua balasan Claude ke user HARUS dalam Bahasa Indonesia, natural, tidak kaku.
- Karena non-teknis, hindari jargon. Jelaskan dampak fitur/bug dari sudut pandang bisnis cafe (Kasir, Purchasing, Owner, Finance), bukan istilah teknis kecuali perlu.
- User terbiasa mengirim **screenshot** sebagai bukti bug — selalu perhatikan gambar yang dilampirkan, itu sering jadi sumber kebenaran utama soal apa yang salah.
- Setiap kali ada pekerjaan besar/ambigu, **gunakan AskUserQuestion** untuk klarifikasi alih-alih menebak — history menunjukkan ini beberapa kali menghindari salah bangun fitur.
- Setelah audit/analisis terbuka ("ada saran fitur/bug?"), pisahkan jelas: fitur yang **disetujui untuk dibangun sekarang** vs. yang **cuma dijelaskan dulu** untuk direview user. Jangan membangun sesuatu yang belum disetujui.

## 2. Apa Itu Jurnal F A T A

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
