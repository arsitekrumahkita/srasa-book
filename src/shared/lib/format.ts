// ============================================================
// Util format angka yang dipakai lintas halaman. Sengaja dibuat
// "shared" sejak awal meski baru dipakai satu halaman (Kalkulator
// HPP) — pengecualian sadar terhadap Rule of Two, karena format
// Rupiah adalah utilitas satu baris yang pasti dipakai ulang oleh
// hampir semua halaman uang (dashboard, shift, laporan), dan
// biaya salah menaruhnya di awal nyaris nol.
// ============================================================

const formatterRupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatRupiah(nilai: number): string {
  return formatterRupiah.format(Number.isFinite(nilai) ? nilai : 0);
}

/**
 * Rupiah untuk HARGA PER SATUAN KECIL (per gram / per pcs), yang sering
 * bernilai pecahan di bawah Rp1 — misalnya air galon isi ulang Rp6.000
 * untuk 19.000 ml = Rp0,32 per ml. formatRupiah() akan membulatkannya
 * jadi "Rp0" dan membuat bahan itu terlihat gratis, jadi di tempat-tempat
 * yang menampilkan harga satuan kecil kita pakai fungsi ini: menampilkan
 * sampai 2 angka di belakang koma HANYA bila nilainya memang di bawah
 * Rp100 (di atas itu desimalnya tidak bermakna bagi pengguna).
 */
const formatterRupiahPresisi = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatRupiahSatuan(nilai: number): string {
  const angka = Number.isFinite(nilai) ? nilai : 0;
  if (angka !== 0 && Math.abs(angka) < 100) return formatterRupiahPresisi.format(angka);
  return formatterRupiah.format(angka);
}

export function formatPersen(nilai: number, desimal = 1): string {
  const angka = Number.isFinite(nilai) ? nilai : 0;
  return `${angka.toFixed(desimal)}%`;
}
