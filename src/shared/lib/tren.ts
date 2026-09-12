// ============================================================
// Analitik Tren dengan rentang waktu custom (Owner/Finance).
//
// Sebelumnya Dashboard hanya menampilkan "7 Hari Terakhir" secara
// tetap. Fitur ini menambah pilihan periode: Harian (14 hari
// terakhir), Mingguan (8 minggu terakhir, dikelompokkan per 7
// hari), Bulanan (6 bulan terakhir, dari summary_bulanan), Custom
// Tanggal (rentang tanggal bebas), dan Custom Bulan (rentang bulan
// bebas) — sesuai permintaan pemilik cafe.
//
// Sumber data TETAP dokumen ringkasan teragregasi (summary_harian
// & summary_bulanan), BUKAN hitung ulang dari transaksi mentah —
// demi kuota Firestore Spark Plan, sama seperti sebelumnya. Semua
// query dibatasi dengan range documentId() (ID dokumennya memang
// string tanggal "YYYY-MM-DD"/"YYYY-MM" yang urut secara leksikal),
// jadi tidak perlu index komposit tambahan.
//
// HANYA dipanggil sisi Owner/Finance — firestore.rules menolak baca
// summary_harian/summary_bulanan untuk peran lain.
// ============================================================

import { collection, documentId, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { daftarBulanAntara, daftarTanggalAntara, formatBulanId, tanggalKe } from "./tren-tanggal";

export type PeriodeTren = "harian" | "mingguan" | "bulanan" | "custom-tanggal" | "custom-bulan";

export interface TitikTren {
  label: string;
  omset: number;
  laba: number;
}

export interface OpsiTren {
  /** Wajib untuk periode "custom-tanggal", format "YYYY-MM-DD". */
  tanggalMulai?: string;
  tanggalSelesai?: string;
  /** Wajib untuk periode "custom-bulan", format "YYYY-MM". */
  bulanMulai?: string;
  bulanSelesai?: string;
}

const NAMA_BULAN = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Ags", "Sep", "Okt", "Nov", "Des",
];

interface RingkasanMentah {
  totalOmset?: number;
  labaBersih?: number;
}

export { formatBulanId, formatTanggalId, daftarBulanAntara, daftarTanggalAntara } from "./tren-tanggal";

async function ambilRangeSummary(
  koleksi: "summary_harian" | "summary_bulanan",
  idMulai: string,
  idSelesai: string,
): Promise<Map<string, RingkasanMentah>> {
  const snap = await getDocs(
    query(
      collection(db, koleksi),
      where(documentId(), ">=", idMulai),
      where(documentId(), "<=", idSelesai),
      orderBy(documentId(), "asc"),
    ),
  );
  const map = new Map<string, RingkasanMentah>();
  snap.docs.forEach((d) => map.set(d.id, d.data() as RingkasanMentah));
  return map;
}

/** Harian: N hari terakhir, satu titik per hari (default 14 hari). */
export async function ambilTrenHarian(jumlahHari = 14): Promise<TitikTren[]> {
  const selesai = tanggalKe(0);
  const mulai = tanggalKe(jumlahHari - 1);
  const map = await ambilRangeSummary("summary_harian", mulai, selesai);
  const hasil: TitikTren[] = [];
  for (let i = jumlahHari - 1; i >= 0; i--) {
    const id = tanggalKe(i);
    const v = map.get(id);
    hasil.push({ label: id.slice(5), omset: v?.totalOmset ?? 0, laba: v?.labaBersih ?? 0 });
  }
  return hasil;
}

/** Mingguan: N minggu terakhir, dijumlahkan per 7 hari (default 8 minggu). */
export async function ambilTrenMingguan(jumlahMinggu = 8): Promise<TitikTren[]> {
  const selesai = tanggalKe(0);
  const mulai = tanggalKe(jumlahMinggu * 7 - 1);
  const map = await ambilRangeSummary("summary_harian", mulai, selesai);
  const hasil: TitikTren[] = [];
  for (let w = jumlahMinggu - 1; w >= 0; w--) {
    let omset = 0;
    let laba = 0;
    for (let hari = 0; hari < 7; hari++) {
      const v = map.get(tanggalKe(w * 7 + hari));
      omset += v?.totalOmset ?? 0;
      laba += v?.labaBersih ?? 0;
    }
    const labelAwal = tanggalKe(w * 7 + 6).slice(5);
    const labelAkhir = tanggalKe(w * 7).slice(5);
    hasil.push({ label: `${labelAwal}–${labelAkhir}`, omset, laba });
  }
  return hasil;
}

/** Bulanan: N bulan terakhir dari summary_bulanan (default 6 bulan). */
export async function ambilTrenBulanan(jumlahBulan = 6): Promise<TitikTren[]> {
  const sekarang = new Date();
  const bulanMulaiDate = new Date(sekarang.getFullYear(), sekarang.getMonth() - (jumlahBulan - 1), 1);
  const mulai = formatBulanId(bulanMulaiDate);
  const selesai = formatBulanId(sekarang);
  const map = await ambilRangeSummary("summary_bulanan", mulai, selesai);
  const hasil: TitikTren[] = [];
  for (let i = jumlahBulan - 1; i >= 0; i--) {
    const d = new Date(sekarang.getFullYear(), sekarang.getMonth() - i, 1);
    const id = formatBulanId(d);
    const v = map.get(id);
    hasil.push({
      label: `${NAMA_BULAN[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`,
      omset: v?.totalOmset ?? 0,
      laba: v?.labaBersih ?? 0,
    });
  }
  return hasil;
}

/** Custom rentang tanggal bebas. Rentang > 35 hari dikelompokkan per minggu
 *  supaya grafik tetap terbaca (bukan dipadatkan puluhan/ratusan titik). */
export async function ambilTrenCustomTanggal(
  tanggalMulaiInput: string,
  tanggalSelesaiInput: string,
): Promise<TitikTren[]> {
  const mulai = tanggalMulaiInput <= tanggalSelesaiInput ? tanggalMulaiInput : tanggalSelesaiInput;
  const selesai = tanggalMulaiInput <= tanggalSelesaiInput ? tanggalSelesaiInput : tanggalMulaiInput;
  const semuaTanggal = daftarTanggalAntara(mulai, selesai);
  if (semuaTanggal.length === 0) return [];
  const map = await ambilRangeSummary("summary_harian", mulai, selesai);

  if (semuaTanggal.length > 35) {
    const hasil: TitikTren[] = [];
    for (let i = 0; i < semuaTanggal.length; i += 7) {
      const bucket = semuaTanggal.slice(i, i + 7);
      let omset = 0;
      let laba = 0;
      for (const id of bucket) {
        const v = map.get(id);
        omset += v?.totalOmset ?? 0;
        laba += v?.labaBersih ?? 0;
      }
      hasil.push({
        label: `${bucket[0].slice(5)}–${bucket[bucket.length - 1].slice(5)}`,
        omset,
        laba,
      });
    }
    return hasil;
  }

  return semuaTanggal.map((id) => {
    const v = map.get(id);
    return { label: id.slice(5), omset: v?.totalOmset ?? 0, laba: v?.labaBersih ?? 0 };
  });
}

/** Custom rentang bulan bebas ("YYYY-MM" ke "YYYY-MM"). */
export async function ambilTrenCustomBulan(
  bulanMulaiInput: string,
  bulanSelesaiInput: string,
): Promise<TitikTren[]> {
  const mulai = bulanMulaiInput <= bulanSelesaiInput ? bulanMulaiInput : bulanSelesaiInput;
  const selesai = bulanMulaiInput <= bulanSelesaiInput ? bulanSelesaiInput : bulanMulaiInput;
  const semuaBulan = daftarBulanAntara(mulai, selesai);
  if (semuaBulan.length === 0) return [];
  const map = await ambilRangeSummary("summary_bulanan", mulai, selesai);
  return semuaBulan.map((id) => {
    const v = map.get(id);
    const [y, m] = id.split("-").map(Number);
    return {
      label: `${NAMA_BULAN[m - 1]} '${String(y).slice(2)}`,
      omset: v?.totalOmset ?? 0,
      laba: v?.labaBersih ?? 0,
    };
  });
}

/** Titik masuk tunggal dipakai Dashboard — memilihkan fungsi yang sesuai
 *  berdasarkan periode yang aktif. */
export async function ambilTren(periode: PeriodeTren, opsi: OpsiTren = {}): Promise<TitikTren[]> {
  switch (periode) {
    case "harian":
      return ambilTrenHarian();
    case "mingguan":
      return ambilTrenMingguan();
    case "bulanan":
      return ambilTrenBulanan();
    case "custom-tanggal":
      if (!opsi.tanggalMulai || !opsi.tanggalSelesai) return [];
      return ambilTrenCustomTanggal(opsi.tanggalMulai, opsi.tanggalSelesai);
    case "custom-bulan":
      if (!opsi.bulanMulai || !opsi.bulanSelesai) return [];
      return ambilTrenCustomBulan(opsi.bulanMulai, opsi.bulanSelesai);
    default:
      return [];
  }
}

export const LABEL_PERIODE_TREN: Record<PeriodeTren, string> = {
  harian: "Harian (14 hari)",
  mingguan: "Mingguan (8 minggu)",
  bulanan: "Bulanan (6 bulan)",
  "custom-tanggal": "Custom Tanggal",
  "custom-bulan": "Custom Bulan",
};
