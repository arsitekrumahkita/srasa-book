// ============================================================
// Laporan Persediaan Keluar & Masuk Bahan Baku — permintaan pemilik
// cafe: rekap per bahan berapa banyak MASUK (dibeli Purchasing) dan
// KELUAR (terjual lewat Resep, atau dikeluarkan manual karena
// rusak/kedaluwarsa) dalam satu rentang tanggal, untuk Owner & Finance.
//
// TIDAK ADA log pergerakan stok tersendiri di database (bukan
// "kartu stok" per transaksi) — bahan_baku.stokSaatIni cuma angka
// berjalan (running total) yang di-increment/decrement langsung di
// titik kejadian (lihat belanja-nota/page.tsx handleTambahItem &
// src/shared/lib/resep.ts terapkanPerubahanStok). Jadi modul ini
// MENGHITUNG ULANG (derive) pergerakan itu dari sumber aslinya,
// pola yang SAMA PERSIS dengan src/shared/lib/laba-harian.ts:
//
// - MASUK: dijumlah dari kas_belanja/{id}/item (setiap baris nota
//   yang dicatat Purchasing) dalam rentang tanggal — field `tanggal`
//   ada di dokumen kas_belanja induk (item sendiri tidak punya
//   tanggal), jadi kas_belanja dibaca dulu (filter tanggal), baru
//   subkoleksi item tiap sesi dibaca.
// - KELUAR (Penjualan): dijumlah dari shift/{id}/penjualan (qty +
//   qtyBonus + qtyRefund per menu, SAMA PERSIS dengan cara
//   laba-harian.ts menghitung HPP — supaya kedua laporan selalu
//   konsisten satu sama lain), lalu dikonversi ke bahan lewat
//   menu/{menuId}/resep (takaran per bahan, termasuk baris `kemasan`
//   yang juga bahan_baku sungguhan).
// - KELUAR (Penyesuaian): dijumlah dari bahan_baku/{id}/penyesuaian_stok
//   (fitur "Stok Rusak/Kedaluwarsa" — satu-satunya log pergerakan
//   stok yang SUNGGUH ada di database, punya timestamp `waktu`).
//
// Refund TIDAK menambah sumber terpisah — qtyRefund sudah termasuk di
// qty yang dihitung dari shift/penjualan di atas (bahannya memang
// tidak dikembalikan ke gudang saat refund, lihat komentar
// laba-harian.ts & shift/page.tsx ubahQtyRefund).
//
// Tidak ada collectionGroup query (konsisten dengan seluruh app ini)
// — tiap sumber dibaca per-Outlet dulu, baru subkoleksinya satu-satu.
// Tidak ada query dengan equality + range digabung (supaya tidak
// butuh index gabungan baru yang belum tentu ada di project Spark
// Plan ini) — semua query di sini HANYA range tanggal/waktu pada satu
// field, filter tambahan (kalau ada) dilakukan di memori.
// ============================================================

import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { db } from "./firebase";

export interface RincianPersediaanBahan {
  bahanId: string;
  nama: string;
  satuan: string;
  masuk: number;
  keluarPenjualan: number;
  keluarPenyesuaian: number;
  totalKeluar: number;
  selisihBersih: number;
}

function tambah(peta: Map<string, number>, id: string, jumlah: number) {
  if (!id || jumlah === 0) return;
  peta.set(id, (peta.get(id) ?? 0) + jumlah);
}

export async function ambilLaporanPersediaan(
  outletId: string,
  dariTanggal: string,
  sampaiTanggal: string,
): Promise<RincianPersediaanBahan[]> {
  const bahanSnap = await getDocs(collection(db, "outlets", outletId, "bahan_baku"));
  const infoBahan = new Map<string, { nama: string; satuan: string }>();
  for (const b of bahanSnap.docs) {
    infoBahan.set(b.id, {
      nama: (b.data().nama as string) ?? "",
      satuan: (b.data().satuan as string) ?? "gram",
    });
  }

  const masuk = new Map<string, number>();
  const keluarPenjualan = new Map<string, number>();
  const keluarPenyesuaian = new Map<string, number>();

  // --- 1. MASUK: kas_belanja dalam rentang -> subkoleksi item ---
  const belanjaSnap = await getDocs(
    query(
      collection(db, "outlets", outletId, "kas_belanja"),
      where("tanggal", ">=", dariTanggal),
      where("tanggal", "<=", sampaiTanggal),
    ),
  );
  await Promise.all(
    belanjaSnap.docs.map(async (belanjaDoc) => {
      const itemSnap = await getDocs(
        collection(db, "outlets", outletId, "kas_belanja", belanjaDoc.id, "item"),
      );
      for (const it of itemSnap.docs) {
        const d = it.data();
        tambah(masuk, (d.bahanId as string) ?? "", (d.qty as number) ?? 0);
      }
    }),
  );

  // --- 2. KELUAR (Penjualan): shift dalam rentang -> penjualan -> resep ---
  const shiftSnap = await getDocs(
    query(
      collection(db, "outlets", outletId, "shift"),
      where("tanggal", ">=", dariTanggal),
      where("tanggal", "<=", sampaiTanggal),
    ),
  );
  const qtyPerMenu = new Map<string, number>();
  await Promise.all(
    shiftSnap.docs.map(async (shiftDoc) => {
      const penjualanSnap = await getDocs(
        collection(db, "outlets", outletId, "shift", shiftDoc.id, "penjualan"),
      );
      for (const item of penjualanSnap.docs) {
        const d = item.data();
        const menuId = d.menuId as string | undefined;
        const qtyTotalDibuat = (d.qty ?? 0) + (d.qtyBonus ?? 0) + (d.qtyRefund ?? 0);
        if (!menuId || qtyTotalDibuat <= 0) continue;
        qtyPerMenu.set(menuId, (qtyPerMenu.get(menuId) ?? 0) + qtyTotalDibuat);
      }
    }),
  );
  await Promise.all(
    [...qtyPerMenu.entries()].map(async ([menuId, qtyTerjual]) => {
      const resepSnap = await getDocs(collection(db, "outlets", outletId, "menu", menuId, "resep"));
      for (const r of resepSnap.docs) {
        const rd = r.data();
        const bahanId: string = (rd.bahanId as string) ?? r.id;
        const takaran: number = (rd.takaran as number) ?? 0;
        if (!bahanId || takaran <= 0) continue;
        tambah(keluarPenjualan, bahanId, takaran * qtyTerjual);
      }
    }),
  );

  // --- 3. KELUAR (Penyesuaian): bahan_baku/{id}/penyesuaian_stok ---
  const awalHari = Timestamp.fromDate(new Date(`${dariTanggal}T00:00:00`));
  const akhirHari = Timestamp.fromDate(new Date(`${sampaiTanggal}T23:59:59.999`));
  await Promise.all(
    bahanSnap.docs.map(async (b) => {
      const penyesuaianSnap = await getDocs(
        query(
          collection(db, "outlets", outletId, "bahan_baku", b.id, "penyesuaian_stok"),
          where("waktu", ">=", awalHari),
          where("waktu", "<=", akhirHari),
        ),
      );
      for (const p of penyesuaianSnap.docs) {
        tambah(keluarPenyesuaian, b.id, (p.data().jumlah as number) ?? 0);
      }
    }),
  );

  // --- Gabungkan ---
  const semuaBahanId = new Set([
    ...infoBahan.keys(),
    ...masuk.keys(),
    ...keluarPenjualan.keys(),
    ...keluarPenyesuaian.keys(),
  ]);

  const hasil: RincianPersediaanBahan[] = [...semuaBahanId]
    .map((bahanId) => {
      const m = masuk.get(bahanId) ?? 0;
      const kp = keluarPenjualan.get(bahanId) ?? 0;
      const ks = keluarPenyesuaian.get(bahanId) ?? 0;
      const info = infoBahan.get(bahanId);
      return {
        bahanId,
        nama: info?.nama ?? "(Bahan sudah dihapus)",
        satuan: info?.satuan ?? "",
        masuk: m,
        keluarPenjualan: kp,
        keluarPenyesuaian: ks,
        totalKeluar: kp + ks,
        selisihBersih: m - (kp + ks),
      };
    })
    // Hanya bahan yang ADA pergerakan pada periode ini — bahan yang
    // sama sekali tidak masuk/keluar tidak perlu memenuhi laporan.
    .filter((r) => r.masuk !== 0 || r.totalKeluar !== 0);

  return hasil.sort((a, b) => a.nama.localeCompare(b.nama));
}
