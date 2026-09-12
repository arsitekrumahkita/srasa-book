// ============================================================
// Resep (bahan + takaran per menu) dan penerapan pengurangan stok
// gudang otomatis darinya. Dipakai LINTAS HALAMAN: Kalkulator HPP
// (Owner/Finance, tulis resep + hitung HPP Bahan otomatis dari
// harga bahan) DAN Shift (Kasir, baca takaran SAJA untuk mengurangi
// stok gudang saat penjualan tercatat) -> shared (Rule of Two).
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

import { collection, doc, getDocs, increment, setDoc, writeBatch } from "firebase/firestore";
import { db } from "./firebase";
import type { ResepItem, SatuanBahan } from "@/shared/types/inventaris";

export async function ambilResepMenu(menuId: string): Promise<ResepItem[]> {
  const snap = await getDocs(collection(db, "menu", menuId, "resep"));
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
 * berarti stok KEMBALI. Ditulis sebagai batch increment tanpa pernah
 * membaca dokumen bahan_baku — lihat catatan keamanan di atas.
 */
export async function terapkanPerubahanStok(
  resep: ResepItem[],
  deltaQty: number,
): Promise<void> {
  if (deltaQty === 0 || resep.length === 0) return;
  const batch = writeBatch(db);
  let adaPerubahan = false;
  for (const item of resep) {
    if (!item.bahanId || item.takaran <= 0) continue;
    const perubahan = -(item.takaran * deltaQty);
    batch.update(doc(db, "bahan_baku", item.bahanId), {
      stokSaatIni: increment(perubahan),
    });
    // Cermin ke stok_kasir — pakai set({merge:true}) BUKAN update(),
    // supaya batch ini tidak gagal seandainya dokumen cerminnya belum
    // pernah dibuat (data lama dari sebelum fitur ini ada). Kasir hanya
    // diberi izin menulis field stokSaatIni di sini (lihat
    // firestore.rules), sama seperti batasannya di bahan_baku.
    batch.set(
      doc(db, "stok_kasir", item.bahanId),
      { stokSaatIni: increment(perubahan) },
      { merge: true },
    );
    adaPerubahan = true;
  }
  if (adaPerubahan) await batch.commit();
}

/**
 * Salin ulang field NON-HARGA satu bahan_baku ke cerminnya di
 * stok_kasir — dipanggil setiap kali Purchasing/Owner/Finance membuat
 * atau mengubah bahan_baku DI LUAR alur penjualan (tambah bahan baru,
 * belanja menambah stok, penyesuaian stok rusak/kedaluwarsa, atau
 * mengubah Batas Minimal Stok). TIDAK menyertakan hargaSatuanTerakhir
 * — itulah inti kerahasiaannya dari Kasir.
 */
export async function setMirrorStokKasir(
  bahanId: string,
  data: {
    nama: string;
    kategori: string;
    satuan: SatuanBahan;
    stokSaatIni: number;
    batasMinimalStok?: number;
    aktif: boolean;
  },
): Promise<void> {
  await setDoc(doc(db, "stok_kasir", bahanId), data, { merge: true });
}
