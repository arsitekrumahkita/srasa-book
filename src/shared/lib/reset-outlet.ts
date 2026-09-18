// ============================================================
// Reset Data Outlet — mengosongkan isi SATU Outlet, atas permintaan
// pemilik cafe ("tombol merah kecil di menu Backup, bisa pilih target
// Outlet tertentu yang akan di-reset datanya ke default").
//
// YANG TIDAK PERNAH IKUT TERHAPUS:
//  - Dokumen outlets/{outletId} itu sendiri — Outlet-nya tetap ada,
//    hanya isinya yang dikosongkan. (Untuk menghapus Outlet beserta
//    dokumennya, itu ranah Kelola Outlet / Data Dummy.)
//  - Koleksi `users` & `usernames` yang berada di ROOT, bukan di dalam
//    Outlet — akun staf tidak boleh hilang gara-gara reset data.
//
// DUA CAKUPAN:
//  - "transaksi": hapus semua jejak transaksi (shift, penjualan,
//    belanja, keuangan, laporan), TAPI pertahankan data induk yang
//    susah payah disusun: Menu, Resep, daftar Bahan Baku, Jadwal
//    Shift, Detail Perusahaan. Stok tiap bahan dinolkan karena seluruh
//    riwayat pembelian & pemakaiannya ikut terhapus — kalau stoknya
//    dibiarkan, angkanya jadi tidak punya dasar sama sekali.
//  - "total": kosong seperti Outlet yang baru saja dibuat.
//
// DIGERAKKAN OLEH STRUKTUR_KOLEKSI MILIK BACKUP (src/shared/lib/
// backup.ts) — sengaja satu daftar untuk dua fitur, supaya koleksi
// yang suatu saat ditambahkan tidak bisa ikut ter-backup tapi luput
// dari reset (atau sebaliknya) tanpa ketahuan.
//
// CATATAN PENTING SOAL ATOMISITAS: Firestore Spark Plan tidak punya
// recursive delete sisi server, jadi penghapusan dilakukan
// dokumen-per-dokumen dari klien dan di-commit bertahap per ~400
// operasi. Artinya, kalau koneksi putus di tengah jalan, Outlet bisa
// berada dalam kondisi SEBAGIAN ter-reset. Itu tidak merusak: operasi
// ini aman diulang — menjalankannya lagi akan meneruskan sisanya.
// UI wajib menyampaikan ini dan menyarankan unduh backup lebih dulu.
// ============================================================

import { collection, doc, getDocs, writeBatch, type DocumentReference } from "firebase/firestore";
import { db } from "./firebase";
import { STRUKTUR_KOLEKSI } from "./backup";

export type CakupanReset = "transaksi" | "total";

/** Koleksi yang dianggap DATA INDUK (bukan transaksi) — dipertahankan
 *  saat cakupan "transaksi". Sisanya dianggap transaksi/laporan. */
const KOLEKSI_INDUK = new Set([
  "bahan_baku",
  "stok_kasir",
  "menu",
  "menu_harga",
  "profil_cafe",
  "slot_shift",
  "catatan_owner",
]);

/** Data induk yang dokumennya DIPERTAHANKAN tapi stoknya dinolkan
 *  (subkoleksi riwayatnya tetap dihapus). */
const KOLEKSI_STOK_DINOLKAN = new Set(["bahan_baku", "stok_kasir"]);

/** Batas aman operasi per writeBatch (limit Firestore 500). */
const BATAS_BATCH = 400;

/** Penghapus yang meng-commit BERTAHAP begitu batch penuh, bukan
 *  menumpuk semua batch di memori lalu commit di akhir. Outlet yang
 *  sudah lama berjalan bisa punya puluhan ribu dokumen — menahan
 *  semuanya di memori dulu berisiko gagal total di ujung. */
class PenghapusBertahap {
  private batch = writeBatch(db);
  private diBatch = 0;
  private terhapus = 0;

  private async commitBilaPenuh() {
    if (this.diBatch >= BATAS_BATCH) await this.commit();
  }

  async hapus(ref: DocumentReference) {
    this.batch.delete(ref);
    this.diBatch += 1;
    this.terhapus += 1;
    await this.commitBilaPenuh();
  }

  async perbarui(ref: DocumentReference, data: Record<string, unknown>) {
    this.batch.update(ref, data);
    this.diBatch += 1;
    await this.commitBilaPenuh();
  }

  async commit() {
    if (this.diBatch === 0) return;
    await this.batch.commit();
    this.batch = writeBatch(db);
    this.diBatch = 0;
  }

  get jumlahTerhapus() {
    return this.terhapus;
  }
}

export interface ProgresReset {
  /** Nama koleksi yang sedang dibersihkan — ditampilkan ke user. */
  koleksi: string;
  langkahKe: number;
  totalLangkah: number;
}

export interface HasilReset {
  jumlahDokumenDihapus: number;
}

/** Kosongkan isi satu Outlet. Lihat catatan atomisitas di kepala file. */
export async function resetDataOutlet(
  outletId: string,
  cakupan: CakupanReset,
  onProgres?: (progres: ProgresReset) => void,
): Promise<HasilReset> {
  const penghapus = new PenghapusBertahap();
  const daftar = Object.entries(STRUKTUR_KOLEKSI);

  for (let i = 0; i < daftar.length; i++) {
    const [nama, subKoleksi] = daftar[i];
    onProgres?.({ koleksi: nama, langkahKe: i + 1, totalLangkah: daftar.length });

    const induk = cakupan === "transaksi" && KOLEKSI_INDUK.has(nama);
    const dinolkan = induk && KOLEKSI_STOK_DINOLKAN.has(nama);

    // Data induk yang stoknya TIDAK perlu dinolkan (Menu, Resep,
    // Jadwal, Detail Perusahaan) dilewati sepenuhnya — termasuk
    // subkoleksinya, karena itu memang bagian dari data induk.
    if (induk && !dinolkan) continue;

    const snap = await getDocs(collection(db, "outlets", outletId, nama));
    for (const d of snap.docs) {
      // Subkoleksi selalu dibersihkan lebih dulu — dokumen induk yang
      // dihapus TIDAK otomatis menghapus subkoleksinya di Firestore,
      // dan sisa itu akan jadi data hantu yang tidak terjangkau lewat
      // UI mana pun tapi tetap terhitung di kuota.
      for (const sub of subKoleksi) {
        const subSnap = await getDocs(collection(db, "outlets", outletId, nama, d.id, sub));
        for (const s of subSnap.docs) {
          await penghapus.hapus(doc(db, "outlets", outletId, nama, d.id, sub, s.id));
        }
      }

      if (dinolkan) {
        await penghapus.perbarui(doc(db, "outlets", outletId, nama, d.id), { stokSaatIni: 0 });
      } else {
        await penghapus.hapus(doc(db, "outlets", outletId, nama, d.id));
      }
    }
  }

  await penghapus.commit();
  return { jumlahDokumenDihapus: penghapus.jumlahTerhapus };
}

/** Ringkasan apa saja yang akan hilang — ditampilkan di layar
 *  konfirmasi supaya tidak ada kejutan setelah tombol ditekan. */
export function ringkasanDampakReset(cakupan: CakupanReset): {
  dihapus: string[];
  dipertahankan: string[];
} {
  if (cakupan === "transaksi") {
    return {
      dihapus: [
        "Seluruh shift Kasir beserta penjualan & kas keluarnya",
        "Seluruh sesi Belanja Purchasing beserta item & notanya",
        "Saldo Finance, transaksi, mutasi, dan pengajuan dana",
        "Ringkasan harian/bulanan, refund, tanggungan Kasir, banding",
        "Riwayat harga & penyesuaian stok tiap bahan baku",
        "Stok semua bahan baku dikembalikan ke 0",
      ],
      dipertahankan: [
        "Daftar Menu, Resep, dan harga jual",
        "Daftar Bahan Baku (nama, satuan, harga beli terakhir)",
        "Jadwal Shift dan Detail Perusahaan (kop surat)",
        "Semua akun pengguna",
      ],
    };
  }
  return {
    dihapus: [
      "SEMUA isi Outlet tanpa kecuali — transaksi maupun data induk",
      "Daftar Menu, Resep, harga jual, dan Bahan Baku",
      "Jadwal Shift dan Detail Perusahaan (kop surat)",
      "Seluruh data keuangan, laporan, dan riwayat",
    ],
    dipertahankan: [
      "Outlet-nya sendiri tetap ada (hanya isinya yang dikosongkan)",
      "Semua akun pengguna beserta hak aksesnya",
    ],
  };
}
