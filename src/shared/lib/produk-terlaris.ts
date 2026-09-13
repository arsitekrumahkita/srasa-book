// ============================================================
// Rekap Metode Bayar + Produk Best Seller/Slow Moving untuk
// rentang waktu yang SAMA dengan selector Analitik Tren di
// Dashboard (Harian/Mingguan/Bulanan/Custom — lihat tren.ts &
// resolveRentangTanggal di tren-tanggal.ts), atas permintaan
// pemilik cafe.
//
// SENGAJA membaca langsung dari shift/{id}/penjualan (bukan
// dokumen ringkasan summary_harian/summary_bulanan seperti
// tren.ts) karena rincian per-menu & per-metode-bayar TIDAK
// pernah diringkas ke summary_* (itu hanya menyimpan total
// harian/bulanan, bukan pecahan per produk). Untuk cafe kecil
// (beberapa shift/hari) jumlah dokumen yang dibaca masih wajar
// untuk Spark Plan; kalau suatu saat skalanya jauh lebih besar,
// pertimbangkan menambah agregat per-menu ke summary_harian saat
// Tutup Shift, mirip pola summary_harian yang sudah ada.
//
// CATATAN MIGRASI: shift dari SEBELUM fitur pemisahan metode bayar
// per-item ada (lihat src/app/shift/page.tsx, subtotalTunai/
// subtotalNonTunai) tidak punya kedua field itu sama sekali, jadi
// TIDAK ikut masuk ke omsetTunai/omsetNonTunai di sini (beda dengan
// hitungLabaHarian yang punya fallback ke field manual per-shift,
// karena fallback itu hanya berlaku di level TOTAL harian, bukan
// per-item — tidak ada cara membagi total manual lama itu kembali
// ke masing-masing produk). qtyTerjual/omset per produk TETAP
// dihitung dari seluruh shift di rentang itu, jadi Best Seller/Slow
// Moving tetap akurat untuk data lama; hanya rekap metode bayarnya
// yang baru akurat sejak fitur ini dipasang.
// ============================================================

import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { resolveRentangTanggal, type OpsiRentang } from "./tren-tanggal";
import type { PeriodeTren } from "./tren";

export interface ProdukPeriodeEntry {
  menuId: string;
  menuNama: string;
  qtyTerjual: number;
  omset: number;
}

export interface RingkasanPeriode {
  mulai: string;
  selesai: string;
  omsetTunai: number;
  omsetNonTunai: number;
  /** Top 5 produk dengan qty TERJUAL (unit sungguh dibuat: reguler +
   *  Bonus/Gratis + Refund, sama seperti hitungLabaHarian) terbanyak. */
  terlaris: ProdukPeriodeEntry[];
  /** 5 produk dengan qty terjual TERSEDIKIT di rentang ini — termasuk
   *  menu aktif yang qty-nya 0 sama sekali (paling perlu perhatian). */
  kurangLaris: ProdukPeriodeEntry[];
}

export async function ambilRingkasanPeriode(
  outletId: string,
  periode: PeriodeTren,
  opsi: OpsiRentang = {},
): Promise<RingkasanPeriode | null> {
  const rentang = resolveRentangTanggal(periode, opsi);
  if (!rentang) return null;
  const { mulai, selesai } = rentang;

  const shiftSnap = await getDocs(
    query(
      collection(db, "outlets", outletId, "shift"),
      where("tanggal", ">=", mulai),
      where("tanggal", "<=", selesai),
    ),
  );

  let omsetTunai = 0;
  let omsetNonTunai = 0;
  const perMenu = new Map<string, { nama: string; qty: number; omset: number }>();

  for (const shiftDoc of shiftSnap.docs) {
    const penjualanSnap = await getDocs(
      collection(db, "outlets", outletId, "shift", shiftDoc.id, "penjualan"),
    );
    for (const item of penjualanSnap.docs) {
      const d = item.data();
      const menuId = d.menuId as string | undefined;
      omsetTunai += d.subtotalTunai ?? 0;
      omsetNonTunai += d.subtotalNonTunai ?? 0;

      const qtyTotalDibuat = (d.qty ?? 0) + (d.qtyBonus ?? 0) + (d.qtyRefund ?? 0);
      if (!menuId) continue;
      const existing = perMenu.get(menuId);
      perMenu.set(menuId, {
        nama: d.menuNama ?? existing?.nama ?? "",
        qty: (existing?.qty ?? 0) + qtyTotalDibuat,
        omset: (existing?.omset ?? 0) + (d.subtotal ?? 0),
      });
    }
  }

  // Sertakan menu AKTIF yang sama sekali tidak muncul di penjualan
  // manapun pada rentang ini (qty 0) — supaya benar-benar terlihat
  // sebagai "paling tidak laku", bukan cuma yang laku sedikit.
  const menuAktifSnap = await getDocs(
    query(collection(db, "outlets", outletId, "menu_harga"), where("aktif", "==", true)),
  );
  for (const m of menuAktifSnap.docs) {
    if (!perMenu.has(m.id)) {
      perMenu.set(m.id, { nama: m.data().nama ?? "", qty: 0, omset: 0 });
    }
  }

  const daftar: ProdukPeriodeEntry[] = [...perMenu.entries()].map(([menuId, v]) => ({
    menuId,
    menuNama: v.nama,
    qtyTerjual: v.qty,
    omset: v.omset,
  }));

  const terlaris = [...daftar].sort((a, b) => b.qtyTerjual - a.qtyTerjual).slice(0, 5);
  const kurangLaris = [...daftar].sort((a, b) => a.qtyTerjual - b.qtyTerjual).slice(0, 5);

  return { mulai, selesai, omsetTunai, omsetNonTunai, terlaris, kurangLaris };
}
