// ============================================================
// Backup Data (JSON) — PRD 9.10, dibangun dengan format cakupan
// pilihan pemilik cafe: **Semua Outlet sekaligus** ATAU **satu
// Outlet saja**. Dipakai halaman src/app/backup-data/page.tsx.
//
// Ini backup MANUAL yang diunduh langsung ke perangkat Owner/Finance
// (Spark Plan, tidak ada Cloud Functions untuk backup terjadwal
// otomatis) — murni pembacaan Firestore lewat SDK client yang sama
// seperti halaman lain, dirangkai jadi satu objek JSON lalu
// diunduh sebagai file lewat Blob di browser.
//
// Struktur sub-koleksi tiap koleksi operasional DIDAFTAR MANUAL di
// bawah (STRUKTUR_KOLEKSI) — beda dari skrip migrasi/hapus Node.js
// (yang pakai firebase-admin, punya listCollections() untuk
// menemukannya otomatis) — SDK client Firestore TIDAK punya operasi
// itu, jadi strukturnya perlu diketahui di depan. Daftar ini HARUS
// disinkronkan manual kalau ada sub-koleksi baru ditambahkan di
// firestore.rules/halaman lain.
//
// Timestamp Firestore dikonversi ke string ISO 8601 supaya hasilnya
// JSON murni yang valid (JSON.stringify tidak tahu cara menulis
// object Timestamp apa adanya).
// ============================================================

import { collection, getDocs, Timestamp } from "firebase/firestore";
import { db } from "./firebase";

/** Koleksi operasional per Outlet (di bawah outlets/{outletId}/...)
 *  beserta daftar sub-koleksi SATU TINGKAT di bawah tiap dokumennya.
 *  `backup_log` SENGAJA tidak diikutkan — itu jejak audit backup itu
 *  sendiri, bukan data yang perlu dicadangkan. */
const STRUKTUR_KOLEKSI: Record<string, string[]> = {
  bahan_baku: ["riwayat_harga", "penyesuaian_stok"],
  stok_kasir: [],
  menu_harga: ["varian"],
  menu: ["varian", "resep", "biaya_tambahan"],
  shift: ["penjualan", "kas_keluar"],
  kas_belanja: ["item", "nota"],
  summary_harian: [],
  summary_bulanan: [],
  tiket_approval: [],
  profil_cafe: [],
  notifikasi: [],
  tanggungan_kasir: [],
  banding_purchasing: [],
  hutang_supplier: [],
  nota_refund: [],
  nota_refund_counter: [],
  saldo_finance: [],
  transaksi_finance: [],
  slot_shift: [],
  serah_terima_kas: [],
  catatan_owner: [],
};

function konversiNilai(nilai: unknown): unknown {
  if (nilai instanceof Timestamp) return nilai.toDate().toISOString();
  if (Array.isArray(nilai)) return nilai.map(konversiNilai);
  if (nilai && typeof nilai === "object") {
    const hasil: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(nilai as Record<string, unknown>)) {
      hasil[k] = konversiNilai(v);
    }
    return hasil;
  }
  return nilai;
}

async function bacaKoleksiOutlet(
  outletId: string,
  namaKoleksi: string,
  subKoleksi: string[],
): Promise<Record<string, unknown>[]> {
  const snap = await getDocs(collection(db, "outlets", outletId, namaKoleksi));
  const hasil: Record<string, unknown>[] = [];
  for (const dokumen of snap.docs) {
    const data: Record<string, unknown> = {
      _id: dokumen.id,
      ...(konversiNilai(dokumen.data()) as Record<string, unknown>),
    };
    for (const sub of subKoleksi) {
      const subSnap = await getDocs(
        collection(db, "outlets", outletId, namaKoleksi, dokumen.id, sub),
      );
      data[sub] = subSnap.docs.map((subDok) => ({
        _id: subDok.id,
        ...(konversiNilai(subDok.data()) as Record<string, unknown>),
      }));
    }
    hasil.push(data);
  }
  return hasil;
}

/** Backup lengkap SATU Outlet — seluruh koleksi di STRUKTUR_KOLEKSI. */
export async function ambilBackupOutlet(outletId: string): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};
  for (const [namaKoleksi, subKoleksi] of Object.entries(STRUKTUR_KOLEKSI)) {
    data[namaKoleksi] = await bacaKoleksiOutlet(outletId, namaKoleksi, subKoleksi);
  }
  return data;
}

export interface RingkasanOutlet {
  id: string;
  nama: string;
}

/** Daftar SEMUA Outlet (termasuk yang nonaktif) — dipakai backup
 *  cakupan "Semua Outlet" supaya tidak ada Outlet yang lolos
 *  tercadangkan hanya karena sedang dinonaktifkan sementara. */
export async function ambilDaftarSemuaOutlet(): Promise<RingkasanOutlet[]> {
  const snap = await getDocs(collection(db, "outlets"));
  return snap.docs.map((d) => ({ id: d.id, nama: (d.data().nama as string) ?? d.id }));
}

/** Backup SEMUA Outlet sekaligus, dikelompokkan per outletId. */
export async function ambilBackupSemuaOutlet(
  daftarOutlet: RingkasanOutlet[],
): Promise<Record<string, unknown>> {
  const hasil: Record<string, unknown> = {};
  for (const outlet of daftarOutlet) {
    hasil[outlet.id] = {
      nama: outlet.nama,
      data: await ambilBackupOutlet(outlet.id),
    };
  }
  return hasil;
}

/** Memicu unduhan file JSON langsung dari browser (Blob + link
 *  sementara) — tidak ada endpoint server yang terlibat, semuanya
 *  di sisi klien seperti ekspor Excel/PDF (src/shared/lib/ekspor.ts). */
export function unduhJson(objek: unknown, namaFile: string): void {
  const blob = new Blob([JSON.stringify(objek, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = namaFile;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
