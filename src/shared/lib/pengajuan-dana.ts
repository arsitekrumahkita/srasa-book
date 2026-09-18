// ============================================================
// Pengajuan Dana — alur yang diminta pemilik cafe:
// "Purchasing Pengajuan Dana, Finance Approval, maka dana masuk
// Saldo Finance, saldo bertambah."
//
// Jadi Saldo Finance sekarang punya DUA pintu masuk:
//  1. Tambah Dana manual oleh Finance (Transaksi Finance) — untuk
//     setoran modal dari Owner.
//  2. Pengajuan Dana dari Purchasing yang DISETUJUI Finance — modul
//     ini. Purchasing tidak pernah bisa menambah saldo sendiri;
//     firestore.rules hanya mengizinkan Purchasing MEMBUAT pengajuan
//     berstatus 'menunggu', dan hanya Finance yang boleh mengubah
//     statusnya (lihat bagian pengajuan_dana di firestore.rules).
//
// Dipakai dua halaman -> shared (Rule of Two):
//  - src/app/belanja-nota/page.tsx (Purchasing: ajukan & pantau)
//  - src/app/transaksi-finance/page.tsx (Finance: setujui/tolak)
//
// Saat disetujui, penambahan saldo & baris mutasi ditulis dalam SATU
// batch bersama perubahan status — lihat setujuiPengajuanDana().
// ============================================================

import {
  collection,
  doc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { catatMutasiFinance } from "./mutasi-finance";

/** Dokumen tunggal Saldo Deposito Finance — sama dengan
 *  ID_SALDO_FINANCE di halaman Transaksi Finance & Belanja. */
const ID_SALDO_FINANCE = "utama";

export type StatusPengajuan = "menunggu" | "disetujui" | "ditolak";

export interface PengajuanDana {
  id: string;
  tanggal: string;
  waktu: Date | null;
  purchasingUid: string;
  purchasingNama: string;
  /** Nominal yang DIMINTA Purchasing. */
  nominal: number;
  /** Nominal yang AKHIRNYA disetujui Finance — bisa lebih kecil dari
   *  yang diminta (persetujuan sebagian). 0 selama masih menunggu. */
  nominalDisetujui: number;
  keperluan: string;
  status: StatusPengajuan;
  ditinjauOlehNama: string;
  catatanFinance: string;
}

function bacaPengajuan(id: string, data: Record<string, unknown>): PengajuanDana {
  return {
    id,
    tanggal: (data.tanggal as string) ?? "",
    waktu: (data.waktu as { toDate?: () => Date } | undefined)?.toDate?.() ?? null,
    purchasingUid: (data.purchasingUid as string) ?? "",
    purchasingNama: (data.purchasingNama as string) ?? "",
    nominal: (data.nominal as number) ?? 0,
    nominalDisetujui: (data.nominalDisetujui as number) ?? 0,
    keperluan: (data.keperluan as string) ?? "",
    status: (data.status as StatusPengajuan) ?? "menunggu",
    ditinjauOlehNama: (data.ditinjauOlehNama as string) ?? "",
    catatanFinance: (data.catatanFinance as string) ?? "",
  };
}

/** Semua pengajuan yang masih menunggu keputusan Finance.
 *  Query equality tunggal + orderBy field yang sama TIDAK dipakai di
 *  sini (butuh index gabungan) — cukup filter status saja lalu urutkan
 *  di memori, jumlah pengajuan menunggu pasti sedikit. */
export async function ambilPengajuanMenunggu(outletId: string): Promise<PengajuanDana[]> {
  const snap = await getDocs(
    query(collection(db, "outlets", outletId, "pengajuan_dana"), where("status", "==", "menunggu")),
  );
  return snap.docs
    .map((d) => bacaPengajuan(d.id, d.data()))
    .sort((a, b) => (a.waktu?.getTime() ?? 0) - (b.waktu?.getTime() ?? 0));
}

/** Riwayat pengajuan milik SATU Purchasing (dipakai di halaman
 *  Belanja & Nota supaya Purchasing bisa memantau pengajuannya). */
export async function ambilPengajuanSaya(
  outletId: string,
  purchasingUid: string,
): Promise<PengajuanDana[]> {
  const snap = await getDocs(
    query(
      collection(db, "outlets", outletId, "pengajuan_dana"),
      where("purchasingUid", "==", purchasingUid),
    ),
  );
  return snap.docs
    .map((d) => bacaPengajuan(d.id, d.data()))
    .sort((a, b) => (b.waktu?.getTime() ?? 0) - (a.waktu?.getTime() ?? 0));
}

/** Riwayat pengajuan pada rentang tanggal (Owner/Finance). */
export async function ambilPengajuanRentang(
  outletId: string,
  dariTanggal: string,
  sampaiTanggal: string,
): Promise<PengajuanDana[]> {
  const snap = await getDocs(
    query(
      collection(db, "outlets", outletId, "pengajuan_dana"),
      where("tanggal", ">=", dariTanggal),
      where("tanggal", "<=", sampaiTanggal),
      orderBy("tanggal", "desc"),
    ),
  );
  return snap.docs.map((d) => bacaPengajuan(d.id, d.data()));
}

/** Purchasing mengajukan dana. Status SELALU 'menunggu' — tidak ada
 *  jalan bagi Purchasing menaikkan saldo tanpa Finance. */
export async function ajukanDana(
  outletId: string,
  data: { purchasingUid: string; purchasingNama: string; nominal: number; keperluan: string; tanggal: string },
): Promise<void> {
  const batch = writeBatch(db);
  const ref = doc(collection(db, "outlets", outletId, "pengajuan_dana"));
  batch.set(ref, {
    tanggal: data.tanggal,
    waktu: serverTimestamp(),
    purchasingUid: data.purchasingUid,
    purchasingNama: data.purchasingNama,
    nominal: data.nominal,
    nominalDisetujui: 0,
    keperluan: data.keperluan,
    status: "menunggu" as StatusPengajuan,
    ditinjauOlehUid: "",
    ditinjauOlehNama: "",
    catatanFinance: "",
  });
  await batch.commit();
}

/** Finance menyetujui — SATU batch atomik: status berubah, saldo
 *  bertambah, dan baris mutasi tercatat. Kalau salah satu ditolak
 *  rules, tidak ada yang berubah sama sekali (jadi mustahil ada
 *  pengajuan "disetujui" tanpa saldo ikut naik, atau sebaliknya). */
export async function setujuiPengajuanDana(
  outletId: string,
  pengajuan: PengajuanDana,
  nominalDisetujui: number,
  peninjau: { uid: string; nama: string },
  catatan: string,
  tanggal: string,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, "outlets", outletId, "pengajuan_dana", pengajuan.id), {
    status: "disetujui" as StatusPengajuan,
    nominalDisetujui,
    ditinjauOlehUid: peninjau.uid,
    ditinjauOlehNama: peninjau.nama,
    catatanFinance: catatan,
    waktuTinjau: serverTimestamp(),
  });
  batch.set(
    doc(db, "outlets", outletId, "saldo_finance", ID_SALDO_FINANCE),
    { saldo: increment(nominalDisetujui) },
    { merge: true },
  );
  catatMutasiFinance(batch, outletId, {
    arah: "masuk",
    nominal: nominalDisetujui,
    sumber: "pengajuan_dana",
    keterangan: `Pengajuan Dana disetujui — ${pengajuan.keperluan || "tanpa keterangan"} (${pengajuan.purchasingNama})`,
    refId: pengajuan.id,
    olehUid: peninjau.uid,
    olehNama: peninjau.nama,
    tanggal,
  });
  await batch.commit();
}

/** Finance menolak — tidak menyentuh saldo sama sekali, jadi tidak
 *  perlu baris mutasi (tidak ada uang yang bergerak). */
export async function tolakPengajuanDana(
  outletId: string,
  pengajuanId: string,
  peninjau: { uid: string; nama: string },
  catatan: string,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, "outlets", outletId, "pengajuan_dana", pengajuanId), {
    status: "ditolak" as StatusPengajuan,
    ditinjauOlehUid: peninjau.uid,
    ditinjauOlehNama: peninjau.nama,
    catatanFinance: catatan,
    waktuTinjau: serverTimestamp(),
  });
  await batch.commit();
}
