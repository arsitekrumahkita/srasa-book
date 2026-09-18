// ============================================================
// Analitik Tren Harga Bahan Baku — permintaan pemilik cafe: tren
// kenaikan/penurunan harga bahan harus terlihat oleh Purchasing
// (yang belanja langsung, paling tahu situasi pasar) MAUPUN Owner
// (yang perlu tahu kalau HPP mulai naik lintas outlet) -> shared di
// sini (Rule of Two), dipakai dari src/app/belanja-nota/page.tsx dan
// src/app/dashboard/page.tsx.
//
// Sumbernya subkoleksi bahan_baku/{bahanId}/riwayat_harga — SUDAH
// ADA sejak fitur "Kenaikan harga >10% -> notifikasi Owner" (lihat
// belanja-nota/page.tsx, handleTambahItem): setiap kali harga beli
// SEBUAH bahan berubah dari harga terakhir, satu baris dicatat di
// situ (harga, tanggal, selisihPersen). Modul ini HANYA membaca ulang
// data yang sudah tercatat itu, tidak menulis apa pun.
//
// firestore.rules: riwayat_harga bisa dibaca isManagerOutlet() ATAU
// isPurchasingOutlet() — jadi fungsi ini aman dipanggil dari kedua
// peran tanpa perlu perubahan rules.
//
// Tidak ada collectionGroup query (konsisten dengan pola lain di app
// ini, lihat komentar di cash-opname/page.tsx) — bahan_baku dibaca
// dulu (biasanya cuma belasan/puluhan item untuk cafe), baru
// riwayat_harga tiap bahan dibaca satu-satu. Biaya baca sebanding
// dengan src/shared/lib/backup.ts, dianggap wajar untuk laporan yang
// tidak dibuka setiap detik.
// ============================================================

import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "./firebase";

export interface TitikHargaBahan {
  tanggal: string;
  harga: number;
  selisihPersen: number;
}

export interface TrenHargaBahan {
  bahanId: string;
  nama: string;
  kategori: string;
  satuan: string;
  hargaSaatIni: number;
  riwayat: TitikHargaBahan[];
}

/** Ambil riwayat perubahan harga SEMUA bahan baku aktif di Outlet ini.
 *  Bahan yang belum pernah mengalami perubahan harga (riwayat kosong)
 *  tetap disertakan (riwayat: []) supaya daftar bahan tetap lengkap —
 *  pemanggil yang memutuskan mau menyaring/mengabaikannya. */
export async function ambilTrenHargaSemuaBahan(outletId: string): Promise<TrenHargaBahan[]> {
  const bahanSnap = await getDocs(collection(db, "outlets", outletId, "bahan_baku"));
  const hasil = await Promise.all(
    bahanSnap.docs.map(async (b) => {
      const riwayatSnap = await getDocs(
        query(collection(db, "outlets", outletId, "bahan_baku", b.id, "riwayat_harga"), orderBy("tanggal")),
      );
      return {
        bahanId: b.id,
        nama: (b.data().nama as string) ?? "",
        kategori: (b.data().kategori as string) ?? "Umum",
        satuan: (b.data().satuan as string) ?? "gram",
        hargaSaatIni: (b.data().hargaSatuanTerakhir as number) ?? 0,
        riwayat: riwayatSnap.docs.map((r) => ({
          tanggal: (r.data().tanggal as string) ?? "",
          harga: (r.data().harga as number) ?? 0,
          selisihPersen: (r.data().selisihPersen as number) ?? 0,
        })),
      } satisfies TrenHargaBahan;
    }),
  );
  return hasil;
}

export interface RingkasanPerubahanHarga {
  bahanId: string;
  nama: string;
  satuan: string;
  hargaAwalPeriode: number;
  hargaAkhirPeriode: number;
  selisihPersenPeriode: number;
  jumlahPerubahan: number;
}

/** Ringkas tren per bahan dalam SATU rentang tanggal — harga di awal
 *  vs akhir periode (bukan sekadar titik pertama/terakhir sepanjang
 *  masa) supaya laporan periode Mingguan/Bulanan/dst tetap relevan
 *  dengan rentang yang dipilih. Bahan tanpa perubahan harga di dalam
 *  rentang itu (0 baris riwayat_harga jatuh di rentang) DIKELUARKAN
 *  dari hasil — tidak ada tren untuk ditampilkan. */
export function ringkasPerubahanHargaPeriode(
  daftar: TrenHargaBahan[],
  dariTanggal: string,
  sampaiTanggal: string,
): RingkasanPerubahanHarga[] {
  const hasil: RingkasanPerubahanHarga[] = [];
  for (const bahan of daftar) {
    const dalamPeriode = bahan.riwayat.filter((r) => r.tanggal >= dariTanggal && r.tanggal <= sampaiTanggal);
    if (dalamPeriode.length === 0) continue;
    const awal = dalamPeriode[0].harga;
    const akhir = dalamPeriode[dalamPeriode.length - 1].harga;
    hasil.push({
      bahanId: bahan.bahanId,
      nama: bahan.nama,
      satuan: bahan.satuan,
      hargaAwalPeriode: awal,
      hargaAkhirPeriode: akhir,
      selisihPersenPeriode: awal > 0 ? (akhir - awal) / awal : 0,
      jumlahPerubahan: dalamPeriode.length,
    });
  }
  // Kenaikan terbesar dulu — itu yang paling penting segera dilihat
  // Purchasing/Owner (biaya belanja/HPP yang paling menekan).
  return hasil.sort((a, b) => b.selisihPersenPeriode - a.selisihPersenPeriode);
}
