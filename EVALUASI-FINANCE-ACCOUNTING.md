# Evaluasi & Strategi Optimasi — Fitur Finance & Accounting Archimax

Tanggal audit: 21 September 2026
Cakupan: Transaksi Finance, Cash Opname, Neraca (Dashboard), Belanja & Nota (Purchasing), Refund, Riwayat/Laporan, Hutang Supplier, `firestore.rules`, `backup.ts`.

Metode: membaca ulang seluruh alur penulisan/pembacaan uang (bukan cuma UI) di setiap halaman terkait, menelusuri setiap koleksi Firestore yang menyimpan nominal, dan mengecek konsistensi rumus antar laporan.

Temuan dikelompokkan berdasarkan tingkat urgensi: **Kritis** (bisa membuat laporan keuangan salah tanpa ketahuan), **Tinggi** (celah keamanan/izin), **Sedang** (inkonsistensi laporan), **Rendah** (fitur yang wajar ditambahkan untuk pembukuan yang lebih lengkap).

---

## 1. KRITIS — Bug nyata yang bisa membuat angka salah

### 1.1 Belanja via "Utang" ikut terhitung DUA KALI (sebagai kas keluar DAN sebagai hutang)

Ini temuan paling serius, dan berkaitan langsung dengan fitur Hutang Supplier yang baru saja dibangun.

**Yang terjadi sekarang:**
- Saat Purchasing input **Item Belanja** (barang yang dibeli), total belanja sesi (`kas_belanja.totalBelanja`) SELALU bertambah — tidak peduli nanti nota-nya mau dibayar Tunai atau Utang.
- Saat Purchasing upload **Nota** dengan metode "Utang ke Supplier", sistem HANYA membuat catatan Hutang baru (`hutang_supplier`). Tidak ada pengurangan apa pun di `totalBelanja`.
- Akibatnya: satu pembelian yang sebenarnya belum dibayar (utang) tetap dihitung penuh sebagai "kas yang sudah keluar" dari sesi belanja itu — padahal uangnya belum keluar sama sekali, baru jadi kewajiban.

**Dampak konkret:**
- Di halaman **Cash Opname**, rumus `Kas Tunai Seharusnya Disetor = Omset Tunai − Kas Keluar Shift − Belanja (sumber Kas Resto)` akan **mengurangi kas seharusnya lebih besar dari yang semestinya**, karena belanja yang dibayar utang ikut mengurangi padahal uangnya tidak benar-benar keluar dari Kas Resto. Hasilnya: kas fisik yang dihitung di laci akan terlihat **lebih besar dari perhitungan sistem** (surplus misterius) — dan Owner/Finance akan disuruh mengecek Tanggungan Kasir atau Form Banding Purchasing, padahal penyebab aslinya tidak ada di sana sama sekali. Ini bisa membuat tim curiga ada kebocoran/selisih padahal sebenarnya cuma masalah pencatatan.
- Nilai yang sama (nominal barang) muncul sebagai "sudah dibelanjakan" di satu laporan dan "belum dibayar" (Hutang) di laporan lain — dua-duanya benar secara literal, tapi tidak boleh dijumlah begitu saja saat menghitung total pengeluaran riil bulan ini.

**Rekomendasi perbaikan** (butuh keputusan desain, bukan sekadar 1 baris kode):
- Opsi A (paling aman secara akuntansi): saat status Nota "Utang" dibuat, JANGAN tambahkan nominal itu ke `totalBelanja`/`sisaKas` sama sekali (barang tetap masuk stok seperti sekarang, hanya "kas keluar"-nya ditunda). Baru saat Hutang itu **Ditandai Lunas**, itulah saat nominalnya masuk sebagai pengeluaran kas riil.
- Opsi B (lebih sederhana, tapi butuh pemisahan tampilan): biarkan `totalBelanja` tetap menghitung semua (Tunai + Utang) sebagai "Total Nilai Barang Dibeli", tapi tambahkan field baru `totalBelanjaUtang` yang dikecualikan secara eksplisit dari rumus Cash Opname (`totalBelanjaKasResto` harus dikurangi `totalBelanjaUtang` sebelum dipakai di rumus).
- Saya rekomendasikan **Opsi B** — perubahannya lebih kecil (tidak menyentuh logika `item`/stok yang sudah teruji), dan tetap transparan menunjukkan "total nilai barang dibeli" vs "yang sudah benar-benar keluar kasnya".

### 1.2 Beberapa alur penulisan 2 dokumen TIDAK atomik (berisiko data "pincang" kalau koneksi putus)

Konvensi yang sudah dipakai di banyak tempat di aplikasi ini adalah `writeBatch` — dua dokumen terkait ditulis sekaligus, sukses/gagal bersama. Tapi ada beberapa alur lama yang masih menulis terpisah:

- **Tutup Shift** (`shift/page.tsx`) dan **Tutup Paksa Shift** (`riwayat/page.tsx`): update status shift → update `summary_harian` → (kadang) buat `tanggungan_kasir`, dilakukan 3 langkah terpisah. Kalau koneksi putus di tengah, shift bisa terkunci permanen tapi `summary_harian` tidak ter-update (Dashboard/Riwayat jadi salah hitung), atau kasir yang kurang kas tidak tercatat sebagai Piutang.
- **Kas Keluar di Shift** (`shift/page.tsx`): catat kas keluar → update total kas keluar shift, 2 langkah terpisah. Kalau putus di tengah, catatan kas keluar ada tapi total shift tidak berubah — Cash Opname & Laba Harian membaca dari total shift, bukan menjumlah ulang, jadi selisih ini tidak ketahuan.
- **Refund (Tunai)** (`refund/page.tsx`): setelah transaksi refund tercatat, catat kas keluar → update total kas keluar shift, juga 2 langkah terpisah dengan risiko sama.

**Dampak:** ini bukan bug yang selalu muncul — cuma muncul kalau koneksi HP/internet Kasir/Purchasing putus tepat di tengah proses simpan (realistis terjadi di warung/cafe dengan wifi tidak stabil). Tapi kalau terjadi, hasilnya adalah selisih kas yang sulit dilacak sumbernya, karena dokumen pertama sudah tersimpan (kelihatan "berhasil") padahal dokumen kedua gagal.

**Rekomendasi:** ubah 4 alur di atas jadi `writeBatch`, mengikuti pola yang sudah dipakai di Transaksi Finance & Belanja. Ini pekerjaan yang jelas, tidak perlu keputusan desain baru — tinggal eksekusi.

---

## 2. TINGGI — Celah di Firestore Security Rules

Karena Spark Plan tidak punya Cloud Functions, **security rules adalah satu-satunya penjaga** — semua validasi di luar itu cuma di sisi aplikasi (HP orang bisa dimodifikasi/dilewati kalau tahu caranya).

- **`saldo_finance`**: rule saat ini cuma membatasi field mana yang boleh diubah (`saldo`), TAPI **tidak membatasi arah perubahannya**. Komentar kode sendiri bilang Purchasing seharusnya cuma boleh MENGURANGI saldo — tapi rule-nya tidak benar-benar memaksa itu. Secara teknis, akun Purchasing bisa menambah saldo sendiri lewat rule ini, padahal seharusnya cuma Finance yang boleh "Tambah Dana".
- **`hutang_supplier`**: tidak ada validasi nominal harus lebih dari 0 di level rules — cuma dicek di form (UI). Kalau ada yang mengakali (misalnya lewat developer tools), bisa membuat catatan Hutang dengan nominal 0 atau negatif.
- **Pelunasan Hutang tidak terhubung secara aman ke pengurangan saldo**: aplikasi memang menjalankan keduanya (update status Lunas + potong saldo) dalam satu `writeBatch` — tapi rule Firestore mengecek tiap dokumen SENDIRI-SENDIRI, tidak tahu itu berasal dari 1 batch. Artinya secara teknis, ada celah untuk menandai Hutang "Lunas" TANPA benar-benar memotong Saldo Finance (kalau bukan lewat tombol resmi di aplikasi) — Neraca bisa menampilkan Kewajiban lebih kecil dari yang sebenarnya tanpa ada yang tahu.
- **`transaksi_finance`** dan beberapa koleksi lain (nota/item belanja) juga tidak punya validasi nominal > 0 di level rules.
- `nota_refund_counter` (koleksi kecil, cuma angka kuota refund) tidak terdaftar di `backup.ts` — kalau suatu saat restore dari backup, data ini akan hilang (dampaknya kecil, tapi sebaiknya tetap dilengkapi supaya backup benar-benar lengkap).

**Rekomendasi:** ini bukan hal yang mendesak-darurat (butuh niat jahat/akses teknis untuk dieksploitasi, bukan bug yang muncul sendiri), tapi sebaiknya diperbaiki bertahap karena ini fondasi keamanan data keuangan. Saya bisa perkuat rules ini di iterasi berikutnya.

---

## 3. SEDANG — Inkonsistensi Antar Laporan

- **Definisi "Stok Menipis" beda antara Dashboard dan Cash Opname.** Dashboard hanya menandai bahan menipis kalau "Batas Minimal Stok"-nya sudah diisi (>0). Cash Opname juga menandai bahan yang stoknya sudah MINUS meskipun Batas Minimal-nya belum diisi. Hasilnya: bahan baku yang stoknya sudah minus tapi belum diisi batas minimalnya akan muncul sebagai peringatan di Cash Opname tapi TIDAK muncul di Dashboard — bisa membingungkan kalau Owner membandingkan dua halaman ini.
- **Kategori "Biaya Operasional" (misal: Wifi, Listrik, PDAM) muncul identik di 2 tempat berbeda** — satu di Shift (Kasir, potong kas shift harian) dan satu di Transaksi Finance (Finance, potong Saldo Deposito). Karena namanya sama persis, orang yang melihat laporan bisa salah kira itu pos yang sama, padahal itu dua "dompet" yang berbeda. Sebaiknya salah satu diberi label yang lebih jelas membedakan (misal "Wifi (Kas Harian Shift)" vs "Wifi (Deposito Finance)").
- **Laporan Ekspor Belanja (Purchasing) dan Cash Opname menghitung "Total Belanja" dengan cakupan berbeda** — Purchasing menjumlah SEMUA sumber dana, Cash Opname memisah per sumber dana (Kas Resto vs Saldo Finance). Bukan salah, tapi kalau Owner membandingkan angka "Total Belanja bulan ini" dari 2 laporan berbeda, bisa dapat angka yang beda dan bingung kenapa tidak sama.

**Rekomendasi:** perbaikan kecil (nama label, penyesuaian filter) — bisa dikerjakan cepat, dampaknya ke kejelasan laporan buat Owner yang bukan orang teknis.

---

## 4. RENDAH — Pengembangan Lanjutan yang Wajar untuk Pembukuan Lebih Lengkap

Ini bukan bug, tapi kalau tujuannya laporan keuangan yang makin matang, ini yang biasanya jadi langkah berikutnya:

1. **Laporan Laba Rugi (P&L) resmi yang bisa diekspor per periode** — saat ini Laba Harian cuma tampil inline di Dashboard/Riwayat, belum ada laporan bulanan yang bisa di-download seperti laporan Finance/Purchasing lainnya.
2. **Laporan Arus Kas (Cash Flow)** — belum ada sama sekali.
3. **Neraca belum bisa diekspor, dan cuma bisa dilihat "hari ini" (live)** — tidak ada cara melihat "Neraca akhir bulan lalu" untuk dibandingkan dari waktu ke waktu.
4. **Hutang Supplier belum punya tanggal jatuh tempo & notifikasi** — kalau supplier kasih termin (misalnya 14 hari), sistem belum bisa mengingatkan sebelum telat bayar.
5. **Belum ada Neraca/Laba Rugi gabungan lintas-outlet** — kalau nanti ada lebih dari 1 cafe, Owner harus buka satu-satu per outlet, belum ada rekap semua outlet jadi satu.
6. **Modal Pemilik belum tercatat sebagai pos formal** — ini sudah didiskusikan sebelumnya dan disepakati wajar untuk skala saat ini, jadi masuk daftar "kalau suatu saat dibutuhkan", bukan prioritas.

---

## Strategi Optimasi — Urutan Prioritas yang Disarankan

| Prioritas | Item | Alasan |
|---|---|---|
| 1 | **1.1** — Perbaiki double-count Belanja Utang vs Cash Opname | Ini yang paling berpotensi bikin laporan kas terlihat "selisih" padahal bukan salah siapa-siapa — bisa bikin panik/curiga tanpa alasan jelas |
| 2 | **1.2** — Jadikan 4 alur penulisan itu atomik (writeBatch) | Mencegah data "pincang" kalau koneksi tidak stabil — realistis terjadi di lapangan |
| 3 | **2** — Perkuat firestore.rules (validasi nominal, batasi arah saldo) | Fondasi keamanan data keuangan, sebaiknya dibereskan sebelum aplikasi dipakai skala lebih besar |
| 4 | **3** — Perbaiki label & selaraskan filter "Stok Menipis" | Cepat dikerjakan, langsung mengurangi kebingungan Owner |
| 5 | **4** — Fitur lanjutan (P&L, Arus Kas, ekspor Neraca, jatuh tempo Hutang, dst) | Pengembangan jangka menengah, dikerjakan sesuai kebutuhan bisnis berikutnya |

Saya sarankan mulai dari **Prioritas 1 dan 2** dulu — dua-duanya murni perbaikan (bukan fitur baru), risikonya rendah untuk dikerjakan, dan langsung menyelesaikan potensi salah laporan yang paling serius. Saya bisa langsung kerjakan kalau Anda setuju.
