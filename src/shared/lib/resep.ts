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
// ============================================================

import { collection, doc, getDocs, increment, writeBatch } from "firebase/firestore";
import { db } from "./firebase";
import type { ResepItem } from "@/shared/types/inventaris";

export async function ambilResepMenu(menuId: string): Promise<ResepItem[]> {
  const snap = await getDocs(collection(db, "menu", menuId, "resep"));
  return snap.docs.map((d) => ({
    id: d.id,
    bahanId: d.data().bahanId ?? d.id,
    bahanNama: d.data().bahanNama ?? "",
    takaran: d.data().takaran ?? 0,
    satuan: d.data().satuan === "pcs" ? "pcs" : "gram",
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
    batch.update(doc(db, "bahan_baku", item.bahanId), {
      stokSaatIni: increment(-(item.takaran * deltaQty)),
    });
    adaPerubahan = true;
  }
  if (adaPerubahan) await batch.commit();
}
