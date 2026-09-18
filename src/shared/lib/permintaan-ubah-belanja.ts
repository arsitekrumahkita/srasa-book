// ============================================================
// Permintaan Ubah/Hapus Item Belanja — permintaan pemilik cafe:
// "Begitu sudah disimpan maka jika ingin edit maka membutuhkan
// Approval Akun Finance demi keamanan menghindari kecurangan."
//
// KENAPA PERLU: sejak item belanja langsung memotong Saldo Finance
// saat disimpan (lihat handleTambahItem di belanja-nota/page.tsx),
// mengizinkan Purchasing mengedit/menghapus item sendiri berarti
// mengizinkan Purchasing mengubah saldo perusahaan tanpa pengawasan.
// Jadi item jadi TERKUNCI setelah disimpan; koreksi harus lewat
// permintaan yang disetujui Finance.
//
// PENEGAKAN BERLAPIS:
//  1. firestore.rules — Purchasing hanya boleh CREATE item, TIDAK
//     boleh update/delete (hanya Owner/Finance). Jadi walau UI-nya
//     diakali, database tetap menolak.
//  2. Modul ini — perubahan hanya diterapkan lewat
//     setujuiPermintaanUbah() yang dijalankan akun Finance.
//
// SAAT DISETUJUI, semua efek ditulis dalam SATU batch atomik:
// item, totalBelanja sesi, stok bahan_baku + cerminnya (stok_kasir),
// saldo_finance (kalau sumber dananya Saldo Finance), dan baris
// mutasi. Tidak mungkin sebagian berhasil sebagian gagal.
//
// Dipakai dua halaman -> shared (Rule of Two):
//  - src/app/belanja-nota/page.tsx (Purchasing: mengajukan)
//  - src/app/transaksi-finance/page.tsx (Finance: meninjau)
// ============================================================

import {
  collection,
  deleteDoc,
  doc,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { catatMutasiFinance } from "./mutasi-finance";

const ID_SALDO_FINANCE = "utama";

export type JenisPermintaan = "ubah" | "hapus";
export type StatusPermintaan = "menunggu" | "disetujui" | "ditolak";

export interface PermintaanUbahBelanja {
  id: string;
  belanjaId: string;
  itemId: string;
  jenis: JenisPermintaan;
  bahanId: string | null;
  bahanNama: string;
  satuan: string;
  sumberDana: "kas_resto" | "saldo_finance";
  qtyLama: number;
  hargaSatuanLama: number;
  subtotalLama: number;
  /** Untuk jenis "hapus" ketiganya 0. */
  qtyBaru: number;
  hargaSatuanBaru: number;
  subtotalBaru: number;
  alasan: string;
  status: StatusPermintaan;
  purchasingUid: string;
  purchasingNama: string;
  ditinjauOlehNama: string;
  catatanFinance: string;
  tanggal: string;
  waktu: Date | null;
}

export function bacaPermintaan(id: string, data: Record<string, unknown>): PermintaanUbahBelanja {
  return {
    id,
    belanjaId: (data.belanjaId as string) ?? "",
    itemId: (data.itemId as string) ?? "",
    jenis: (data.jenis as JenisPermintaan) ?? "ubah",
    bahanId: (data.bahanId as string | null) ?? null,
    bahanNama: (data.bahanNama as string) ?? "",
    satuan: (data.satuan as string) ?? "",
    sumberDana: (data.sumberDana as "kas_resto" | "saldo_finance") ?? "kas_resto",
    qtyLama: (data.qtyLama as number) ?? 0,
    hargaSatuanLama: (data.hargaSatuanLama as number) ?? 0,
    subtotalLama: (data.subtotalLama as number) ?? 0,
    qtyBaru: (data.qtyBaru as number) ?? 0,
    hargaSatuanBaru: (data.hargaSatuanBaru as number) ?? 0,
    subtotalBaru: (data.subtotalBaru as number) ?? 0,
    alasan: (data.alasan as string) ?? "",
    status: (data.status as StatusPermintaan) ?? "menunggu",
    purchasingUid: (data.purchasingUid as string) ?? "",
    purchasingNama: (data.purchasingNama as string) ?? "",
    ditinjauOlehNama: (data.ditinjauOlehNama as string) ?? "",
    catatanFinance: (data.catatanFinance as string) ?? "",
    tanggal: (data.tanggal as string) ?? "",
    waktu: (data.waktu as { toDate?: () => Date } | undefined)?.toDate?.() ?? null,
  };
}

export function kueriPermintaanMenunggu(outletId: string) {
  return query(
    collection(db, "outlets", outletId, "permintaan_ubah_belanja"),
    where("status", "==", "menunggu"),
  );
}

export function kueriPermintaanSaya(outletId: string, purchasingUid: string) {
  return query(
    collection(db, "outlets", outletId, "permintaan_ubah_belanja"),
    where("purchasingUid", "==", purchasingUid),
  );
}

/** Purchasing mengajukan koreksi. Status SELALU 'menunggu' —
 *  tidak ada efek apa pun ke stok/saldo sampai Finance menyetujui. */
export async function ajukanPermintaanUbah(
  outletId: string,
  data: Omit<PermintaanUbahBelanja, "id" | "status" | "ditinjauOlehNama" | "catatanFinance" | "waktu">,
): Promise<void> {
  const ref = doc(collection(db, "outlets", outletId, "permintaan_ubah_belanja"));
  const batch = writeBatch(db);
  batch.set(ref, {
    ...data,
    status: "menunggu" as StatusPermintaan,
    ditinjauOlehUid: "",
    ditinjauOlehNama: "",
    catatanFinance: "",
    waktu: serverTimestamp(),
  });
  await batch.commit();
}

/** Finance MENYETUJUI — di sinilah perubahan sungguhan diterapkan.
 *
 *  Semua selisih dihitung sebagai DELTA (increment), bukan angka
 *  absolut hasil baca layar, supaya tidak pernah meleset gara-gara
 *  state basi — pola "tulis tanpa baca" yang sama dipakai di seluruh
 *  app ini (lihat src/shared/lib/resep.ts). */
export async function setujuiPermintaanUbah(
  outletId: string,
  permintaan: PermintaanUbahBelanja,
  peninjau: { uid: string; nama: string },
  catatan: string,
  tanggal: string,
): Promise<void> {
  const batch = writeBatch(db);
  const hapus = permintaan.jenis === "hapus";

  // Delta uang & stok. Untuk "hapus", nilai baru dianggap 0.
  const subtotalBaru = hapus ? 0 : permintaan.subtotalBaru;
  const qtyBaru = hapus ? 0 : permintaan.qtyBaru;
  const deltaSubtotal = subtotalBaru - permintaan.subtotalLama;
  const deltaQty = qtyBaru - permintaan.qtyLama;

  const itemRef = doc(db, "outlets", outletId, "kas_belanja", permintaan.belanjaId, "item", permintaan.itemId);
  if (hapus) {
    batch.delete(itemRef);
  } else {
    batch.update(itemRef, {
      qty: permintaan.qtyBaru,
      hargaSatuan: permintaan.hargaSatuanBaru,
      subtotal: permintaan.subtotalBaru,
      dikoreksiOlehUid: peninjau.uid,
      dikoreksiOlehNama: peninjau.nama,
      waktuKoreksi: serverTimestamp(),
    });
  }

  // Total belanja sesi ikut bergeser.
  batch.update(doc(db, "outlets", outletId, "kas_belanja", permintaan.belanjaId), {
    totalBelanja: increment(deltaSubtotal),
  });

  // Stok gudang + cermin stok_kasir. Cermin ditulis langsung lewat
  // batch (bukan setMirrorStokKasir yang async sendiri) supaya tetap
  // satu operasi atomik dengan sisanya.
  if (permintaan.bahanId && deltaQty !== 0) {
    batch.update(doc(db, "outlets", outletId, "bahan_baku", permintaan.bahanId), {
      stokSaatIni: increment(deltaQty),
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(db, "outlets", outletId, "stok_kasir", permintaan.bahanId),
      { stokSaatIni: increment(deltaQty) },
      { merge: true },
    );
  }

  // Saldo Finance hanya tersentuh bila sesi belanjanya memang memakai
  // Saldo Finance (sumber Kas Resto tidak pernah menyentuh saldo).
  if (permintaan.sumberDana === "saldo_finance" && deltaSubtotal !== 0) {
    // Belanja berkurang -> uang kembali ke saldo (masuk), dan
    // sebaliknya. deltaSubtotal negatif berarti saldo bertambah.
    batch.set(
      doc(db, "outlets", outletId, "saldo_finance", ID_SALDO_FINANCE),
      { saldo: increment(-deltaSubtotal) },
      { merge: true },
    );
    catatMutasiFinance(batch, outletId, {
      arah: deltaSubtotal < 0 ? "masuk" : "keluar",
      nominal: Math.abs(deltaSubtotal),
      sumber: "koreksi_belanja",
      keterangan: hapus
        ? `Koreksi disetujui: hapus "${permintaan.bahanNama}" dari belanja ${permintaan.purchasingNama}`
        : `Koreksi disetujui: "${permintaan.bahanNama}" ${permintaan.qtyLama} -> ${permintaan.qtyBaru} ${permintaan.satuan}`,
      refId: permintaan.itemId,
      olehUid: peninjau.uid,
      olehNama: peninjau.nama,
      tanggal,
    });
  }

  batch.update(doc(db, "outlets", outletId, "permintaan_ubah_belanja", permintaan.id), {
    status: "disetujui" as StatusPermintaan,
    ditinjauOlehUid: peninjau.uid,
    ditinjauOlehNama: peninjau.nama,
    catatanFinance: catatan,
    waktuTinjau: serverTimestamp(),
  });

  await batch.commit();
}

/** Finance MENOLAK — tidak ada yang berubah selain status. */
export async function tolakPermintaanUbah(
  outletId: string,
  permintaanId: string,
  peninjau: { uid: string; nama: string },
  catatan: string,
): Promise<void> {
  await updateDoc(doc(db, "outlets", outletId, "permintaan_ubah_belanja", permintaanId), {
    status: "ditolak" as StatusPermintaan,
    ditinjauOlehUid: peninjau.uid,
    ditinjauOlehNama: peninjau.nama,
    catatanFinance: catatan,
    waktuTinjau: serverTimestamp(),
  });
}

/** Purchasing membatalkan permintaannya sendiri selagi masih
 *  'menunggu' — tidak menyentuh uang sama sekali, jadi aman. */
export async function batalkanPermintaanUbah(outletId: string, permintaanId: string): Promise<void> {
  await deleteDoc(doc(db, "outlets", outletId, "permintaan_ubah_belanja", permintaanId));
}
