// ============================================================
// Petty Cash Kas Outlet — SATU sumber kebenaran untuk nominal modal
// kas yang selalu tinggal di laci tiap shift.
//
// Sebelumnya angka ini disalin di TIGA tempat (src/app/shift/page.tsx,
// src/app/cash-opname/page.tsx, src/shared/lib/data-dummy.ts) — kalau
// Owner suatu saat mengubah kebijakan nominalnya, satu saja yang lupa
// diubah berarti laporan Cash Opname langsung meleset tanpa ada yang
// sadar. Dipusatkan di sini (Rule of Two).
//
// ARTI BISNISNYA (dikonfirmasi pemilik cafe): Kas Outlet SEHARUSNYA
// berisi PERSIS sejumlah ini sebelum penjualan dimulai, dan kembali
// ke jumlah ini lagi setelah setoran ke Finance saat outlet tutup.
// Selisih di luar itu = jejak insiden yang harus ditelusuri (lihat
// "Selisih Setoran" di src/app/cash-opname/page.tsx).
//
// Kas Outlet SENGAJA tidak punya dokumen saldo berjalan seperti
// saldo_finance — nilainya direkonsiliasi per hari lewat Cash Opname,
// dengan angka di bawah ini sebagai titik nolnya.
// ============================================================

/** Modal Kas Awal FLAT per shift — tidak diinput manual oleh Kasir
 *  dan tidak mewarisi sisa kas shift/hari sebelumnya. */
export const MODAL_KAS_AWAL_HARIAN = 500_000;

/** Label siap pakai untuk ditempel di UI mana pun yang menyebut Kas
 *  Outlet/Kas Resto, supaya karyawan tidak menebak-nebak berapa
 *  isinya "seharusnya". */
export const LABEL_PETTY_CASH = "Petty Cash Rp500.000 / shift";
