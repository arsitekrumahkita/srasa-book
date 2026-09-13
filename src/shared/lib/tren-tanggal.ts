// ============================================================
// Bagian MURNI (tanpa Firebase) dari analitik tren rentang waktu —
// dipisah dari tren.ts KHUSUS supaya bisa diuji dengan Vitest tanpa
// memicu inisialisasi Firebase Auth/Firestore (lihat komentar di
// vitest.config.mts: hanya fungsi murni di src/shared/lib yang
// diuji, tanpa environment/setup Firebase). tren.ts meng-impor
// ulang semuanya dari sini.
// ============================================================

export function formatTanggalId(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatBulanId(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function tanggalKe(offsetHari: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetHari);
  return formatTanggalId(d);
}

export function daftarTanggalAntara(mulai: string, selesai: string): string[] {
  const hasil: string[] = [];
  const d = new Date(`${mulai}T00:00:00`);
  const akhir = new Date(`${selesai}T00:00:00`);
  // Batas pengaman: jangan pernah membangun daftar tanggal tak
  // terbatas kalau input rusak/kebalik.
  let pengaman = 0;
  while (d <= akhir && pengaman < 3660) {
    hasil.push(formatTanggalId(d));
    d.setDate(d.getDate() + 1);
    pengaman++;
  }
  return hasil;
}

/** Opsi rentang custom (subset dari OpsiTren di tren.ts — didefinisikan
 *  ulang di sini, bukan diimpor, supaya file ini tetap 100% bebas
 *  Firebase dan bisa diuji Vitest tanpa memicu inisialisasi apa pun). */
export interface OpsiRentang {
  tanggalMulai?: string;
  tanggalSelesai?: string;
  bulanMulai?: string;
  bulanSelesai?: string;
}

/** Menerjemahkan periode & opsi Analitik Tren (lihat tren.ts) menjadi
 *  rentang TANGGAL HARIAN "YYYY-MM-DD" konkret — dipakai fitur yang
 *  butuh baris tanggal asli (shift.tanggal), bukan dokumen ringkasan
 *  summary_harian/summary_bulanan yang sudah dibungkus per hari/bulan.
 *  Dipisah di sini (bukan di produk-terlaris.ts yang butuh Firebase)
 *  supaya bisa diuji Vitest sebagai fungsi murni. */
export function resolveRentangTanggal(
  periode: "harian" | "mingguan" | "bulanan" | "custom-tanggal" | "custom-bulan",
  opsi: OpsiRentang = {},
): { mulai: string; selesai: string } | null {
  switch (periode) {
    case "harian":
      return { mulai: tanggalKe(13), selesai: tanggalKe(0) };
    case "mingguan":
      return { mulai: tanggalKe(8 * 7 - 1), selesai: tanggalKe(0) };
    case "bulanan": {
      const sekarang = new Date();
      const awal = new Date(sekarang.getFullYear(), sekarang.getMonth() - 5, 1);
      return { mulai: formatTanggalId(awal), selesai: formatTanggalId(sekarang) };
    }
    case "custom-tanggal": {
      if (!opsi.tanggalMulai || !opsi.tanggalSelesai) return null;
      const [mulai, selesai] =
        opsi.tanggalMulai <= opsi.tanggalSelesai
          ? [opsi.tanggalMulai, opsi.tanggalSelesai]
          : [opsi.tanggalSelesai, opsi.tanggalMulai];
      return { mulai, selesai };
    }
    case "custom-bulan": {
      if (!opsi.bulanMulai || !opsi.bulanSelesai) return null;
      const [bulanMulai, bulanSelesai] =
        opsi.bulanMulai <= opsi.bulanSelesai
          ? [opsi.bulanMulai, opsi.bulanSelesai]
          : [opsi.bulanSelesai, opsi.bulanMulai];
      const [ySelesai, mSelesai] = bulanSelesai.split("-").map(Number);
      // Tanggal 0 dari bulan BERIKUTNYA = hari terakhir bulan ini
      // (trik standar Date JS untuk "akhir bulan" tanpa tabel 28/30/31).
      const akhirBulan = new Date(ySelesai, mSelesai, 0);
      return { mulai: `${bulanMulai}-01`, selesai: formatTanggalId(akhirBulan) };
    }
    default:
      return null;
  }
}

export function daftarBulanAntara(mulai: string, selesai: string): string[] {
  const hasil: string[] = [];
  const [yMulai, mMulaiRaw] = mulai.split("-").map(Number);
  const [ySelesai, mSelesaiRaw] = selesai.split("-").map(Number);
  let y = yMulai;
  let m = mMulaiRaw;
  let pengaman = 0;
  while ((y < ySelesai || (y === ySelesai && m <= mSelesaiRaw)) && pengaman < 600) {
    hasil.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    pengaman++;
  }
  return hasil;
}
