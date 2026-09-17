// ============================================================
// Preset rentang tanggal Harian/Mingguan/Bulanan/Tahunan untuk
// halaman Laporan (Riwayat, Transaksi Finance, Belanja & Pembelian) —
// atas permintaan pemilik cafe: "Semua Format Laporan bisa di Filter
// Harian, Mingguan, Bulanan, Tahunan".
//
// SENGAJA terpisah dari resolveRentangTanggal() di tren-tanggal.ts:
// itu untuk grafik Analitik Tren (rentang MULTI-periode untuk
// membandingkan beberapa hari/bulan sekaligus di satu grafik), ini
// untuk filter laporan/ekspor (SATU rentang tunggal: "hari ini",
// "minggu ini", dst.) — semantiknya beda meski sama-sama soal
// tanggal, jadi dipisah supaya masing-masing tetap sederhana dibaca.
// Fungsi dasar (formatTanggalId, tanggalKe) TETAP diimpor ulang dari
// tren-tanggal.ts (Rule of Two), tidak diduplikasi.
// ============================================================

import { formatTanggalId, tanggalKe } from "./tren-tanggal";

export type PeriodeLaporan = "harian" | "mingguan" | "bulanan" | "tahunan";

export const LABEL_PERIODE_LAPORAN: Record<PeriodeLaporan, string> = {
  harian: "Harian",
  mingguan: "Mingguan",
  bulanan: "Bulanan",
  tahunan: "Tahunan",
};

/** Rentang tanggal "YYYY-MM-DD" untuk satu preset periode, SELALU
 *  berakhir hari ini:
 *  - harian: hari ini saja
 *  - mingguan: 7 hari terakhir (termasuk hari ini)
 *  - bulanan: dari tanggal 1 bulan ini sampai hari ini
 *  - tahunan: dari 1 Januari tahun ini sampai hari ini
 */
export function rentangPeriodeLaporan(periode: PeriodeLaporan): { mulai: string; selesai: string } {
  const selesai = tanggalKe(0);
  switch (periode) {
    case "harian":
      return { mulai: selesai, selesai };
    case "mingguan":
      return { mulai: tanggalKe(6), selesai };
    case "bulanan": {
      const sekarang = new Date();
      return { mulai: formatTanggalId(new Date(sekarang.getFullYear(), sekarang.getMonth(), 1)), selesai };
    }
    case "tahunan": {
      const sekarang = new Date();
      return { mulai: formatTanggalId(new Date(sekarang.getFullYear(), 0, 1)), selesai };
    }
  }
}

export function formatTanggalPanjangId(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
