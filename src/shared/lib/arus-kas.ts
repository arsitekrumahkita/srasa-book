// ============================================================
// Tracking Arus Kas Outlet & Arus Saldo Finance — permintaan pemilik
// cafe: dua "dompet" yang SENGAJA terpisah (lihat komentar kepala
// src/app/transaksi-finance/page.tsx) perlu terlihat pergerakan
// masuk/keluarnya per HARI, bukan cuma saldo akhir sekarang.
//
// Granularitas HARIAN (bukan per-transaksi/jam) sengaja dipilih
// karena kas_belanja (Purchasing) TIDAK punya field jam/waktu presisi,
// hanya `tanggal` string (lihat komentar di belanja-nota/page.tsx) —
// jadi urutan intra-hari tidak bisa direkonstruksi akurat. Agregasi
// harian tetap sangat berguna untuk melihat tren tanpa data yang
// tidak ada.
//
// Sumber data (masing-masing SUDAH ada, modul ini hanya membaca &
// menggabungkan, tidak menulis apa pun):
// - Arus Kas Outlet: shift/{id} (field omsetTunai & totalKasKeluar
//   yang ditulis saat Tutup Kasir, lihat src/app/shift/page.tsx) +
//   kas_belanja (modalDiberikan saat sumberDana === "kas_resto" —
//   uang kas outlet yang dibawa Purchasing belanja).
// - Arus Saldo Finance: transaksi_finance (masuk/keluar manual
//   Finance) + kas_belanja (modalDiberikan saat sumberDana ===
//   "saldo_finance").
//
// SENGAJA tidak menghitung ulang saldo historis mundur hari-per-hari
// (butuh titik awal yang tidak tercatat) — saldo Saldo Finance yang
// akurat & real-time sudah ada di saldo_finance/utama (dibaca
// langsung, sama seperti transaksi-finance/page.tsx). Fitur ini hanya
// menambahkan RINCIAN pergerakan per tanggal di atas saldo itu.
//
// Tidak ada collectionGroup query, pola sama dengan modul lain di app
// ini (baca 1 koleksi per sumber dengan filter rentang tanggal).
// ============================================================

import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "./firebase";

export interface TitikArusKasOutlet {
  tanggal: string;
  kasMasuk: number;
  kasKeluarOperasional: number;
  kasKeluarBelanja: number;
  netArusKas: number;
}

/** Modal kas_belanja per tanggal — HANYA shift PERTAMA (nomorShift
 *  terkecil) tiap tanggal yang dihitung sebagai uang keluar nyata dari
 *  outlet, karena shift lanjutan cuma membawa sisa kas yang sama
 *  (bukan suntikan dana baru) — pola yang sama dengan perbaikan bug
 *  "Total Modal Diberikan" di EksporLaporanPembelianKartu. */
function modalAsliPerTanggal(
  baris: { tanggal: string; modalDiberikan: number; nomorShift: number }[],
): Map<string, number> {
  const perTanggal = new Map<string, { modalDiberikan: number; nomorShift: number }[]>();
  for (const b of baris) {
    const grup = perTanggal.get(b.tanggal) ?? [];
    grup.push(b);
    perTanggal.set(b.tanggal, grup);
  }
  const hasil = new Map<string, number>();
  for (const [tanggal, grup] of perTanggal.entries()) {
    const pertama = [...grup].sort((a, b) => a.nomorShift - b.nomorShift)[0];
    hasil.set(tanggal, pertama.modalDiberikan);
  }
  return hasil;
}

/** Ambil SEMUA sesi kas_belanja dalam rentang tanggal (tanpa filter
 *  sumberDana di query Firestore) lalu saring per sumberDana di
 *  memori — SENGAJA begitu supaya query di sini cuma butuh index
 *  rentang tanggal biasa (sama dengan query shift/transaksi_finance
 *  di bawah), bukan index gabungan (equality + range) baru yang belum
 *  tentu sudah ada di project ini (Spark Plan, tidak ada
 *  firestore.indexes.json / deploy otomatis — index gabungan baru
 *  harus dibuat manual lewat link error Firebase Console). */
async function ambilKasBelanjaRange(
  outletId: string,
  dariTanggal: string,
  sampaiTanggal: string,
): Promise<{ tanggal: string; sumberDana: string; modalDiberikan: number; nomorShift: number }[]> {
  const snap = await getDocs(
    query(
      collection(db, "outlets", outletId, "kas_belanja"),
      where("tanggal", ">=", dariTanggal),
      where("tanggal", "<=", sampaiTanggal),
      orderBy("tanggal"),
    ),
  );
  return snap.docs.map((d) => ({
    tanggal: d.data().tanggal ?? "",
    sumberDana: d.data().sumberDana ?? "kas_resto",
    modalDiberikan: d.data().modalDiberikan ?? 0,
    nomorShift: d.data().nomorShift ?? 1,
  }));
}

export async function ambilArusKasOutlet(
  outletId: string,
  dariTanggal: string,
  sampaiTanggal: string,
): Promise<TitikArusKasOutlet[]> {
  const [shiftSnap, semuaBelanja] = await Promise.all([
    getDocs(
      query(
        collection(db, "outlets", outletId, "shift"),
        where("tanggal", ">=", dariTanggal),
        where("tanggal", "<=", sampaiTanggal),
        orderBy("tanggal"),
      ),
    ),
    ambilKasBelanjaRange(outletId, dariTanggal, sampaiTanggal),
  ]);

  const perTanggal = new Map<string, { kasMasuk: number; kasKeluarOperasional: number }>();
  for (const s of shiftSnap.docs) {
    const d = s.data();
    const tanggal: string = d.tanggal ?? "";
    if (!tanggal) continue;
    const existing = perTanggal.get(tanggal) ?? { kasMasuk: 0, kasKeluarOperasional: 0 };
    existing.kasMasuk += d.omsetTunai ?? 0;
    existing.kasKeluarOperasional += d.totalKasKeluar ?? 0;
    perTanggal.set(tanggal, existing);
  }

  const belanjaKasResto = modalAsliPerTanggal(
    semuaBelanja.filter((b) => b.sumberDana === "kas_resto"),
  );

  const semuaTanggal = new Set([...perTanggal.keys(), ...belanjaKasResto.keys()]);
  const hasil: TitikArusKasOutlet[] = [...semuaTanggal].map((tanggal) => {
    const dariShift = perTanggal.get(tanggal) ?? { kasMasuk: 0, kasKeluarOperasional: 0 };
    const kasKeluarBelanja = belanjaKasResto.get(tanggal) ?? 0;
    return {
      tanggal,
      kasMasuk: dariShift.kasMasuk,
      kasKeluarOperasional: dariShift.kasKeluarOperasional,
      kasKeluarBelanja,
      netArusKas: dariShift.kasMasuk - dariShift.kasKeluarOperasional - kasKeluarBelanja,
    };
  });
  return hasil.sort((a, b) => (a.tanggal < b.tanggal ? -1 : 1));
}

export interface TitikArusSaldoFinance {
  tanggal: string;
  masuk: number;
  keluarManual: number;
  keluarBelanja: number;
  netHarian: number;
}

export async function ambilArusSaldoFinance(
  outletId: string,
  dariTanggal: string,
  sampaiTanggal: string,
): Promise<TitikArusSaldoFinance[]> {
  const [transaksiSnap, semuaBelanja] = await Promise.all([
    getDocs(
      query(
        collection(db, "outlets", outletId, "transaksi_finance"),
        where("tanggal", ">=", dariTanggal),
        where("tanggal", "<=", sampaiTanggal),
        orderBy("tanggal"),
      ),
    ),
    ambilKasBelanjaRange(outletId, dariTanggal, sampaiTanggal),
  ]);

  const perTanggal = new Map<string, { masuk: number; keluarManual: number }>();
  for (const t of transaksiSnap.docs) {
    const d = t.data();
    const tanggal: string = d.tanggal ?? "";
    if (!tanggal) continue;
    const existing = perTanggal.get(tanggal) ?? { masuk: 0, keluarManual: 0 };
    if (d.arah === "masuk") existing.masuk += d.nominal ?? 0;
    else existing.keluarManual += d.nominal ?? 0;
    perTanggal.set(tanggal, existing);
  }

  const belanjaSaldoFinance = modalAsliPerTanggal(
    semuaBelanja.filter((b) => b.sumberDana === "saldo_finance"),
  );

  const semuaTanggal = new Set([...perTanggal.keys(), ...belanjaSaldoFinance.keys()]);
  const hasil: TitikArusSaldoFinance[] = [...semuaTanggal].map((tanggal) => {
    const dariTransaksi = perTanggal.get(tanggal) ?? { masuk: 0, keluarManual: 0 };
    const keluarBelanja = belanjaSaldoFinance.get(tanggal) ?? 0;
    return {
      tanggal,
      masuk: dariTransaksi.masuk,
      keluarManual: dariTransaksi.keluarManual,
      keluarBelanja,
      netHarian: dariTransaksi.masuk - dariTransaksi.keluarManual - keluarBelanja,
    };
  });
  return hasil.sort((a, b) => (a.tanggal < b.tanggal ? -1 : 1));
}
