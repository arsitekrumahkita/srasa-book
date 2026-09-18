// ============================================================
// Mutasi Saldo Finance — BUKU BESAR (ledger) semua pergerakan Saldo
// Deposito Finance, dibuat atas permintaan pemilik cafe: "Sediakan
// Menu Mutasi layaknya Mutasi Rekening Bank".
//
// MASALAH YANG DIPECAHKAN: sebelum ini saldo_finance/utama cuma
// menyimpan SATU angka (saldo berjalan) yang di-increment dari
// beberapa tempat berbeda (Transaksi Finance, Belanja Purchasing),
// TANPA satu pun catatan terpusat "kapan, berapa, karena apa". Jadi
// mustahil menampilkan mutasi seperti rekening bank, dan mustahil
// mengaudit kalau angkanya terasa aneh.
//
// ATURAN WAJIB (jangan dilanggar di kode baru mana pun):
// Setiap kali saldo_finance/utama di-increment, baris mutasi HARUS
// ikut ditulis DALAM BATCH YANG SAMA lewat catatMutasiFinance().
// Kalau tidak, saldo dan mutasi akan berbeda dan halaman Mutasi
// menampilkan saldo berjalan yang meleset. Batch yang sama =
// keduanya berhasil atau keduanya gagal (pola yang sama dipakai di
// handleMulaiBelanja & CatatTransaksiKeluarKartu).
//
// APPEND-ONLY: firestore.rules SENGAJA menolak update & delete untuk
// koleksi ini, bahkan untuk Owner — ini jejak audit anti-kecurangan,
// koreksi dilakukan dengan MENAMBAH baris lawan (bukan menghapus
// baris lama), persis seperti bank.
//
// Saldo berjalan TIDAK disimpan per baris (itu butuh baca-lalu-tulis
// yang rawan balapan/race). Sebagai gantinya dihitung MUNDUR di sisi
// klien dari saldo_finance/utama yang otoritatif — lihat
// hitungSaldoBerjalan() di bawah.
// ============================================================

import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "./firebase";

/** Dari mana pergerakan saldo ini berasal — dipakai untuk ikon/warna
 *  di halaman Mutasi dan untuk menelusuri balik ke dokumen aslinya
 *  lewat refId. */
export type SumberMutasi =
  /** Uang Masuk/Keluar yang dicatat manual oleh Finance. */
  | "transaksi_finance"
  /** Pengajuan Dana Purchasing yang disetujui Finance. */
  | "pengajuan_dana"
  /** Item belanja Purchasing (memotong saldo saat item disimpan). */
  | "belanja"
  /** Koreksi item belanja yang sudah disetujui Finance. */
  | "koreksi_belanja";

export interface BarisMutasiFinance {
  id: string;
  /** Null hanya sesaat untuk tulisan yang belum sampai server
   *  (serverTimestamp masih pending di cache lokal). */
  waktu: Date | null;
  tanggal: string;
  arah: "masuk" | "keluar";
  nominal: number;
  sumber: SumberMutasi;
  keterangan: string;
  refId: string;
  olehNama: string;
}

export interface DataMutasiFinance {
  arah: "masuk" | "keluar";
  /** SELALU positif — arah yang menentukan tambah/kurang. */
  nominal: number;
  sumber: SumberMutasi;
  keterangan: string;
  /** ID dokumen sumber (transaksi_finance / pengajuan_dana /
   *  item belanja) supaya bisa ditelusuri balik. */
  refId: string;
  olehUid: string;
  olehNama: string;
  /** "YYYY-MM-DD" — disimpan juga (selain `waktu`) supaya bisa
   *  difilter/dicocokkan dengan laporan lain yang memakai tanggal
   *  string, sama seperti koleksi lain di app ini. */
  tanggal: string;
}

/** Catat SATU pergerakan Saldo Finance. WAJIB dipanggil di batch yang
 *  SAMA dengan increment saldo_finance-nya (lihat catatan di kepala
 *  file). Tidak mengembalikan apa pun — batch di-commit pemanggil. */
export function catatMutasiFinance(
  batch: WriteBatch,
  outletId: string,
  data: DataMutasiFinance,
): void {
  const ref = doc(collection(db, "outlets", outletId, "mutasi_finance"));
  batch.set(ref, {
    arah: data.arah,
    nominal: Math.abs(data.nominal),
    sumber: data.sumber,
    keterangan: data.keterangan,
    refId: data.refId,
    olehUid: data.olehUid,
    olehNama: data.olehNama,
    tanggal: data.tanggal,
    waktu: serverTimestamp(),
  });
}

/** Ambil mutasi SEJAK `dariTanggal` sampai SEKARANG (sengaja tanpa
 *  batas atas, lihat hitungSaldoBerjalan untuk alasannya).
 *
 *  Query-nya range + orderBy pada FIELD YANG SAMA (`waktu`) supaya
 *  cukup dengan index satu-field bawaan Firestore — tidak butuh index
 *  gabungan baru yang harus dibuat manual di Console (project ini
 *  Spark Plan, tanpa firestore.indexes.json). */
export async function ambilMutasiFinanceSejak(
  outletId: string,
  dariTanggal: string,
): Promise<BarisMutasiFinance[]> {
  const awal = Timestamp.fromDate(new Date(`${dariTanggal}T00:00:00`));
  const snap = await getDocs(
    query(
      collection(db, "outlets", outletId, "mutasi_finance"),
      where("waktu", ">=", awal),
      orderBy("waktu"),
    ),
  );
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      waktu: data.waktu?.toDate?.() ?? null,
      tanggal: (data.tanggal as string) ?? "",
      arah: (data.arah ?? "keluar") as "masuk" | "keluar",
      nominal: (data.nominal as number) ?? 0,
      sumber: (data.sumber ?? "transaksi_finance") as SumberMutasi,
      keterangan: (data.keterangan as string) ?? "",
      refId: (data.refId as string) ?? "",
      olehNama: (data.olehNama as string) ?? "",
    };
  });
}

export interface BarisMutasiDenganSaldo extends BarisMutasiFinance {
  /** Saldo SESUDAH baris ini terjadi — kolom paling kanan di mutasi
   *  rekening bank. */
  saldoSesudah: number;
}

/** Hitung saldo berjalan tiap baris, MUNDUR dari saldo terkini.
 *
 *  Kenapa mundur: saldo_finance/utama adalah satu-satunya angka yang
 *  otoritatif (semua increment bermuara ke situ). Kalau saldo dihitung
 *  MAJU dari nol, hasilnya cuma benar bila ledger lengkap sejak hari
 *  pertama — padahal ledger ini baru ada mulai sekarang, sementara
 *  saldo sudah punya riwayat dari sebelumnya. Menghitung mundur dari
 *  saldo terkini membuat baris paling bawah SELALU cocok dengan saldo
 *  asli, berapa pun umur ledger-nya.
 *
 *  Karena itu `daftar` HARUS berisi semua mutasi sampai SEKARANG
 *  (bukan dipotong di akhir periode) — penyaringan periode dilakukan
 *  SETELAH saldo dihitung, lihat pemakaian di halaman Mutasi. */
export function hitungSaldoBerjalan(
  daftar: BarisMutasiFinance[],
  saldoSaatIni: number,
): BarisMutasiDenganSaldo[] {
  const hasil: BarisMutasiDenganSaldo[] = new Array(daftar.length);
  let saldoSesudah = saldoSaatIni;
  for (let i = daftar.length - 1; i >= 0; i--) {
    const baris = daftar[i];
    hasil[i] = { ...baris, saldoSesudah };
    const delta = baris.arah === "masuk" ? baris.nominal : -baris.nominal;
    // Saldo SEBELUM baris ini = saldo sesudahnya dikurangi dampaknya,
    // dan itu jadi "saldoSesudah" untuk baris di atasnya.
    saldoSesudah = saldoSesudah - delta;
  }
  return hasil;
}

export const LABEL_SUMBER_MUTASI: Record<SumberMutasi, string> = {
  transaksi_finance: "Transaksi Finance",
  pengajuan_dana: "Pengajuan Dana",
  belanja: "Belanja Purchasing",
  koreksi_belanja: "Koreksi Belanja",
};
