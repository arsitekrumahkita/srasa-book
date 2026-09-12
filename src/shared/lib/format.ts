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

export function formatPersen(nilai: number, desimal = 1): string {
  const angka = Number.isFinite(nilai) ? nilai : 0;
  return `${angka.toFixed(desimal)}%`;
}
