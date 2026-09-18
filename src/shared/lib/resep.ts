// ============================================================
// Resep (bahan + takaran per menu) dan penerapan pengurangan stok
// gudang otomatis darinya. Dipakai LINTAS HALAMAN: Kalkulator HPP
// (Owner/Finance, tulis resep + hitung HPP Bahan otomatis dari
// harga bahan) DAN Shift (Kasir, baca takaran SAJA untuk mengurangi
// stok gudang saat penjualan tercatat) -> shared (Rule of Two).
//
// Semua path sekarang di bawah outlets/{outletId}/... (Multi-Cabang,
// permintaan pemilik cafe) — setiap fungsi WAJIB diberi outletId
// eksplisit oleh pemanggil.
//
// KEAMANAN (penting): menu/{menuId}/resep/{bahanId} HANYA berisi
// bahanId, bahanNama, takaran, satuan — TIDAK ADA Rupiah apa pun.
// Kasir diberi izin BACA subkoleksi ini di firestore.rules justru
// karena isinya aman dibaca (bukan biaya) — dokumen induk menu/{id}
// (HPP, breakdown biaya) dan koleksi bahan_baku (harga per satuan)
// TETAP tidak bisa dibaca Kasir sama sekali. Pengurangan stok
// dilakukan lewat updateDoc(increment()) ke bahan_baku TANPA PERNAH
// membaca isi dokumennya (pola "tulis tanpa baca", sama seperti
// summary_harian) — jadi Kasir bisa mengurangi stok tanpa pernah
// tahu harganya.
//
// CERMIN stok_kasir (atas permintaan pemilik cafe: Dashboard Kasir
// juga perlu menampilkan rincian stok gudang): setiap kali stok
// bahan_baku berkurang di sini, dokumen stok_kasir/{bahanId} yang
// SAMA ID-nya ikut ditulis dengan medan yang SAMA (TANPA harga) —
// pola persis seperti menu_harga vs menu. Kasir diberi izin baca
// stok_kasir tapi TIDAK PERNAH bahan_baku, jadi Kasir bisa melihat
// "Ayam tersisa 400gr" tanpa pernah tahu itu senilai berapa Rupiah.
// Field non-stok (nama/kategori/satuan/batasMinimalStok/aktif)
// dicerminkan lewat setMirrorStokKasir() di bawah, dipanggil dari
// Belanja & Nota dan Kelola Produk setiap kali bahan_baku dibuat/
// diubah di luar alur penjualan.
// ============================================================

import { collection, doc, getDocs, increment, runTransaction, setDoc, type FieldValue } from "firebase/firestore";
import { db } from "./firebase";
import type { ResepItem, SatuanBahan } from "@/shared/types/inventaris";

export interface KekuranganBahan {
  bahanNama: string;
  /** Jumlah yang dibutuhkan resep untuk penambahan qty ini. */
  dibutuhkan: number;
  /** Jumlah yang benar-benar ada di gudang saat transaksi dicoba. */
  tersedia: number;
  satuan: SatuanBahan;
}

/** Dilempar saat penjualan/bonus akan membuat stok bahan baku minus.
 *
 *  ATURAN BISNIS (permintaan pemilik cafe): uang boleh minus (kas &
 *  Saldo Finance memang harus mencerminkan kondisi nyata walau
 *  negatif), TAPI BAHAN BAKU TIDAK PERNAH BOLEH MINUS — stok fisik
 *  tidak bisa kurang dari nol di dunia nyata, dan acuan boleh-tidaknya
 *  sebuah produk dijual memang ketersediaan bahannya. Kalau bahannya
 *  habis, transaksi harus ditolak, bukan dicatat lalu menyisakan stok
 *  minus yang membuat seluruh laporan HPP & persediaan ikut salah. */
export class StokTidakCukupError extends Error {
  readonly kekurangan: KekuranganBahan[];

  constructor(kekurangan: KekuranganBahan[]) {
    super("Bahan baku tidak cukup");
    this.name = "StokTidakCukupError";
    this.kekurangan = kekurangan;
  }
}

/** Pengenal aman untuk StokTidakCukupError.
 *
 *  Sengaja TIDAK hanya mengandalkan `instanceof`: kalau suatu saat
 *  modul ini termuat dua kali oleh bundler (mis. karena split chunk),
 *  `instanceof` bisa meleset dan pesan "bahan tidak cukup" berubah jadi
 *  pesan error generik yang membingungkan Kasir. Pemeriksaan `name`
 *  sebagai cadangan membuatnya tetap dikenali. */
export function adalahStokTidakCukup(error: unknown): error is StokTidakCukupError {
  if (error instanceof StokTidakCukupError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "StokTidakCukupError" &&
    Array.isArray((error as { kekurangan?: unknown }).kekurangan)
  );
}

/** Ringkas daftar kekurangan jadi satu kalimat siap tampil ke Kasir. */
export function pesanStokTidakCukup(kekurangan: KekuranganBahan[]): string {
  const rincian = kekurangan
    .map((k) => `${k.bahanNama} (butuh ${k.dibutuhkan} ${k.satuan}, tersisa ${k.tersedia} ${k.satuan})`)
    .join("; ");
  return `Bahan Baku tidak cukup — transaksi tidak dapat dilanjutkan. ${rincian}.`;
}

export async function ambilResepMenu(outletId: string, menuId: string): Promise<ResepItem[]> {
  const snap = await getDocs(collection(db, "outlets", outletId, "menu", menuId, "resep"));
  return snap.docs.map((d) => ({
    id: d.id,
    bahanId: d.data().bahanId ?? d.id,
    bahanNama: d.data().bahanNama ?? "",
    takaran: d.data().takaran ?? 0,
    satuan: d.data().satuan === "pcs" ? "pcs" : "gram",
    jenis: d.data().jenis === "kemasan" ? "kemasan" : "bahan",
  }));
}

/**
 * Terapkan perubahan stok gudang untuk SATU perubahan qty penjualan
 * satu menu. `deltaQty` positif (Kasir menambah qty terjual) berarti
 * stok bahan BERKURANG; negatif (Kasir mengurangi/membatalkan qty)
 * berarti stok KEMBALI.
 *
 * DIJALANKAN SEBAGAI TRANSAKSI, bukan batch buta seperti sebelumnya.
 * Dulu fungsi ini langsung menembakkan increment() tanpa memeriksa apa
 * pun, sehingga menjual produk yang bahannya habis tetap "berhasil" dan
 * menyisakan stok MINUS — persis bug yang dilaporkan pemilik: "kalau
 * bahan bakunya 0, mau jualan apa?". Sekarang:
 *
 *   1. Stok tiap bahan dibaca dulu dari cermin stok_kasir (satu-satunya
 *      sumber stok yang BOLEH dibaca Kasir — bahan_baku menyimpan harga
 *      dan tetap rahasia, lihat catatan keamanan di kepala file).
 *   2. Kalau ada yang kurang, seluruh transaksi dibatalkan dengan
 *      StokTidakCukupError — TIDAK ADA satu pun tulisan yang terjadi.
 *   3. Baru stok dipotong.
 *
 * Karena semuanya dalam satu transaksi Firestore, dua Kasir yang
 * menjual bersamaan tidak bisa "menyelinap" melewati pemeriksaan:
 * transaksi yang kalah cepat otomatis diulang dengan stok terbaru, dan
 * akan ditolak kalau ternyata sudah tidak cukup.
 *
 * Pengembalian stok (deltaQty negatif, mis. Kasir membatalkan qty)
 * TIDAK diperiksa — menambah stok kembali memang selalu aman.
 *
 * Bahan yang belum punya dokumen cermin dianggap stoknya 0, jadi
 * penjualannya ditolak. Ini disengaja: semua jalur pembuatan bahan_baku
 * di app ini selalu membuat cerminnya juga (Kalkulator HPP, Belanja &
 * Nota, Data Dummy), jadi cermin yang hilang berarti datanya memang
 * bermasalah — lebih baik ditolak daripada diam-diam bikin stok minus.
 */
export async function terapkanPerubahanStok(
  outletId: string,
  resep: ResepItem[],
  deltaQty: number,
): Promise<void> {
  if (deltaQty === 0) return;
  const dipakai = resep.filter((item) => item.bahanId && item.takaran > 0);
  if (dipakai.length === 0) return;

  await runTransaction(db, async (trx) => {
    // Firestore mewajibkan SEMUA baca selesai sebelum tulisan pertama.
    const cermin = await Promise.all(
      dipakai.map((item) => trx.get(doc(db, "outlets", outletId, "stok_kasir", item.bahanId))),
    );

    if (deltaQty > 0) {
      const kekurangan: KekuranganBahan[] = [];
      dipakai.forEach((item, i) => {
        const snap = cermin[i];
        const tersedia = snap.exists() ? ((snap.data().stokSaatIni as number) ?? 0) : 0;
        const dibutuhkan = item.takaran * deltaQty;
        if (tersedia < dibutuhkan) {
          kekurangan.push({
            bahanNama: item.bahanNama || ((snap.data()?.nama as string) ?? "Bahan"),
            dibutuhkan,
            tersedia,
            satuan: item.satuan,
          });
        }
      });
      if (kekurangan.length > 0) throw new StokTidakCukupError(kekurangan);
    }

    for (const item of dipakai) {
      const perubahan = -(item.takaran * deltaQty);
      trx.update(doc(db, "outlets", outletId, "bahan_baku", item.bahanId), {
        stokSaatIni: increment(perubahan),
      });
      // Cermin ke stok_kasir — pakai set({merge:true}) BUKAN update(),
      // supaya transaksi ini tidak gagal seandainya dokumen cerminnya
      // belum pernah dibuat. Kasir hanya diberi izin menulis field
      // stokSaatIni di sini (lihat firestore.rules), sama seperti
      // batasannya di bahan_baku.
      trx.set(
        doc(db, "outlets", outletId, "stok_kasir", item.bahanId),
        { stokSaatIni: increment(perubahan) },
        { merge: true },
      );
    }
  });
}

/** Berapa porsi menu ini yang MASIH BISA dibuat dari stok sekarang.
 *
 *  Dipakai layar Kasir untuk menandai/mengunci produk yang bahannya
 *  habis sebelum Kasir sempat mencoba menjualnya — "acuan penjualan
 *  produk adalah ketersediaan bahan baku" (permintaan pemilik cafe).
 *
 *  Menu tanpa resep mengembalikan Infinity: stoknya memang tidak bisa
 *  dihitung, jadi jangan dikunci (perilakunya sama dengan sebelum
 *  fitur ini ada — penjualan tetap berjalan normal).
 *
 *  `stokPerBahan` diisi dari koleksi stok_kasir oleh pemanggil. */
export function porsiMaksimalDariStok(
  resep: ResepItem[],
  stokPerBahan: Map<string, number>,
): number {
  const dipakai = resep.filter((item) => item.bahanId && item.takaran > 0);
  if (dipakai.length === 0) return Number.POSITIVE_INFINITY;
  let porsi = Number.POSITIVE_INFINITY;
  for (const item of dipakai) {
    const tersedia = stokPerBahan.get(item.bahanId) ?? 0;
    porsi = Math.min(porsi, Math.floor(tersedia / item.takaran));
  }
  return Math.max(porsi, 0);
}

/**
 * Salin ulang field NON-HARGA satu bahan_baku ke cerminnya di
 * stok_kasir — dipanggil setiap kali Purchasing/Owner/Finance membuat
 * atau mengubah bahan_baku DI LUAR alur penjualan (tambah bahan baru,
 * belanja menambah stok, penyesuaian stok rusak/kedaluwarsa, atau
 * mengubah Batas Minimal Stok). TIDAK menyertakan hargaSatuanTerakhir
 * — itulah inti kerahasiaannya dari Kasir.
 *
 * PENTING (perbaikan bug drift cermin stok): `stokSaatIni` menerima
 * NILAI ABSOLUT (number) HANYA untuk kasus yang memang tidak mengubah
 * stok (mis. sekadar mengubah Batas Minimal Stok) atau membuat dokumen
 * baru. Untuk pemanggil yang menambah/mengurangi stok akibat sebuah
 * transaksi (Belanja menambah stok, Penyesuaian Stok mengurangi), WAJIB
 * kirim hasil increment()/FieldValue di sini juga — SAMA seperti
 * bahan_baku.stokSaatIni ditulis di baris sebelumnya — supaya cerminnya
 * ikut "tulis tanpa baca" dan tidak pernah meleset akibat state lokal
 * yang basi (mis. dua kali tambah stok cepat berurutan sebelum
 * onSnapshot sempat menyegarkan data di layar).
 */
export async function setMirrorStokKasir(
  outletId: string,
  bahanId: string,
  data: {
    nama: string;
    kategori: string;
    satuan: SatuanBahan;
    // Opsional: pemanggil yang TIDAK mengubah stok (mis. hanya mengedit
    // Batas Minimal Stok) sebaiknya tidak menyertakan field ini sama
    // sekali, supaya setDoc({merge:true}) di bawah tidak pernah menimpa
    // nilai stokSaatIni di cermin dengan angka basi — lihat pemanggil
    // BatasMinimalStokKartu di src/app/belanja-nota/page.tsx.
    stokSaatIni?: number | FieldValue;
    batasMinimalStok?: number;
    aktif: boolean;
  },
): Promise<void> {
  await setDoc(doc(db, "outlets", outletId, "stok_kasir", bahanId), data, { merge: true });
}
