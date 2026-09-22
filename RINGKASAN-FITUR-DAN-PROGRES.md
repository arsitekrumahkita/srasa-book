# Archimax — Ringkasan Fitur & Laporan Progres Pengembangan

**Untuk:** Atasan / Pemilik Cafe
**Disusun oleh:** fery (Accounting)
**Tanggal:** 22 September 2026

---

## 1. Apa Itu Archimax

Archimax adalah aplikasi akuntansi & operasional cafe berbasis web, dibuat untuk mencatat Omset, Kas, HPP (Harga Pokok Penjualan), Laba Bersih, dan posisi keuangan cafe secara harian — bisa dipakai di HP maupun komputer, dan mendukung **multi-outlet** (lebih dari satu cabang dalam satu aplikasi).

Aplikasi ini punya 4 peran pengguna dengan akses berbeda:

| Peran | Akses |
|---|---|
| **Owner** | Akses penuh semua outlet, harga, HPP, dan seluruh laporan |
| **Finance** | Setara Owner untuk laporan/HPP, khusus mencatat Uang Masuk-Keluar Deposito |
| **Kasir** | Input penjualan, buka/tutup shift — TIDAK bisa lihat harga beli bahan/HPP |
| **Purchasing** | Belanja bahan baku, kelola stok gudang — TIDAK bisa lihat harga jual/HPP menu |

Prinsip kerahasiaan dijaga ketat: Kasir tidak pernah tahu berapa modal/HPP produk, Purchasing tidak pernah tahu harga jual atau margin keuntungan.

---

## 2. Daftar Fitur yang Sudah Ada

### A. Operasional Harian (Kasir)
- Buka & Tutup Shift dengan Modal Kas Awal otomatis.
- Input penjualan per produk, dipisah Metode Bayar (Tunai/Non-Tunai/QRIS).
- Rekap penjualan & Produk Terlaris real-time selama shift berjalan.
- Bonus/Gratis dan Refund cepat langsung dari layar Kasir.
- Perhitungan otomatis kas seharusnya vs kas fisik saat tutup shift, dengan kolom keterangan wajib bila ada selisih.
- Slip Cash Opname bisa dicetak/diekspor otomatis maupun manual, termasuk cetak ulang (reprint) untuk Kasir.

### B. Pembelian & Gudang (Purchasing)
- Sesi "Belanja & Nota" — mulai sesi belanja dengan modal dari Kas Resto atau Saldo Deposito Finance.
- Input item belanja otomatis menghitung harga satuan & memperbarui stok gudang.
- Deteksi otomatis kenaikan harga bahan baku, riwayat harga tersimpan.
- Upload foto Nota sebagai bukti, dengan pilihan metode bayar **Tunai** atau **Utang ke Supplier**.
- **Hutang Supplier** — pencatatan resmi kalau supplier titip barang dulu dan dibayar belakangan; bisa ditandai Lunas oleh Purchasing maupun Finance.
- Form Banding Purchasing — pengajuan revisi/insiden untuk ditinjau Owner/Finance.
- Ekspor laporan pembelian per periode (harian/mingguan/bulanan/tahunan).

### C. Keuangan (Finance)
- Saldo Deposito Finance dengan riwayat Tambah Dana & Catat Transaksi Keluar (termasuk kategori Biaya Operasional).
- Kartu Hutang Supplier juga tampil di sisi Finance — bisa ikut menandai Lunas.
- Ekspor Laporan Keuangan per periode.

### D. Laporan & Analisa (Owner/Finance)
- **Dashboard** — ringkasan Omset, Laba, stok menipis, Analitik Tren dengan rentang waktu custom.
- **Neraca (Posisi Keuangan)** — ringkasan Aset, Kewajiban, dan Ekuitas usaha secara real-time, khusus tampil untuk peran Finance.
- **Cash Opname Akhir Hari** — rekonsiliasi kas satu hari penuh, membandingkan kas yang seharusnya disetor dengan kas fisik, mendeteksi selisih secara otomatis.
- **Riwayat** — daftar seluruh shift, dengan fitur "Hitung Ulang Laporan Harian" dan "Tutup Paksa Shift" untuk shift yang lupa ditutup Kasir.
- Kalkulator HPP — hitung harga pokok produk otomatis dari Resep (bahan+takaran) dan Packaging Cost.

### E. Manajemen & Admin
- Kelola Akun (staff), Kelola Outlet (cabang), Kelola Jadwal Shift.
- Notifikasi sistem (mis. kenaikan harga bahan).
- Backup Data — ekspor seluruh data outlet.
- Profil Akun, ekspor laporan dengan letterhead perusahaan (siap cetak A4).
- Login dengan username, Google Sign-In, dan lupa password; auto-logout untuk keamanan.

---

## 3. Laporan Progres Pengembangan (Ringkas)

**Status saat ini: Aplikasi sudah berjalan lengkap (fitur inti P0 selesai), dalam tahap penyempurnaan & pengetatan akurasi laporan keuangan.**

Sepanjang pengembangan, sudah dilakukan lebih dari 30 iterasi perbaikan/fitur, mencakup: seluruh alur operasional harian (Kasir, Purchasing, Finance), arsitektur multi-outlet, serta berbagai perbaikan bug data (race condition, selisih stok, refund berlebih).

**Perkembangan terbaru (minggu ini):**

1. **Fitur baru — Hutang Supplier**: sekarang aplikasi bisa mencatat kalau supplier titip barang dulu dan dibayar belakangan (utang usaha), otomatis masuk sebagai Kewajiban di Neraca.
2. **Fitur baru — Neraca (Posisi Keuangan)**: laporan Aset, Kewajiban, dan Ekuitas usaha kini tersedia real-time di Dashboard Finance.
3. **Audit menyeluruh atas seluruh fitur Finance & Accounting**: dilakukan pengecekan detail terhadap akurasi semua laporan keuangan yang ada. Ditemukan dan langsung diperbaiki 1 bug penting (belanja yang dibayar belakangan sempat berisiko terhitung dua kali di laporan kas), plus penguatan sistem supaya data tidak rusak jika koneksi internet terputus saat menyimpan, dan penguatan keamanan akses data.
4. Seluruh perbaikan sudah melalui pengujian otomatis (58 test) dan verifikasi build sebelum dipakai.

**Yang masih dalam daftar rencana (belum dikerjakan, menunggu arahan prioritas):**
- Laporan Laba Rugi resmi bulanan & Laporan Arus Kas.
- Fitur ekspor Neraca & riwayat Neraca per periode (saat ini hanya tampilan hari berjalan).
- Pengingat jatuh tempo pembayaran Hutang Supplier.
- Laporan gabungan lintas-outlet untuk Owner.
- Notifikasi otomatis stok hampir habis.

**Catatan teknis untuk tim internal:** aplikasi berjalan di atas Firebase paket gratis (tanpa server backend khusus), sehingga seluruh keamanan data bergantung pada aturan akses (security rules) yang harus di-deploy manual setiap kali ada perubahan — proses ini sudah dilakukan secara konsisten di setiap update.

---

*Laporan ini dibuat untuk memberi gambaran ringkas kepada atasan/pemilik cafe mengenai fitur yang tersedia dan progres pengembangan Archimax hingga saat ini.*
