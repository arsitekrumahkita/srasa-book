// ============================================================
// Tipe data untuk Inventaris Bahan Baku + Resep (Sprint 2, atas
// permintaan pemilik cafe — lihat komentar di src/shared/lib/resep.ts
// untuk penjelasan arsitektur keamanannya).
//
// Satuan SENGAJA dibatasi ke "gram" | "pcs" saja (bukan kg/liter +
// faktor konversi seperti draft awal PRD 8.3) — Purchasing input
// harga & jumlah langsung dalam satuan pakai, tanpa konversi, atas
// permintaan pemilik cafe.
// ============================================================

export type SatuanBahan = "gram" | "pcs";

/** Bahan baku — dibaca Owner/Finance/Purchasing (harga tetap privat
 *  dari Kasir, lihat firestore.rules). */
export interface BahanBaku {
  id: string;
  nama: string;
  kategori: string;
  satuan: SatuanBahan;
  /** Rupiah per satuan (per gram atau per pcs), dihitung otomatis
   *  dari (total harga dibayar ÷ jumlah dibeli) saat Purchasing
   *  mencatat belanja — BUKAN diinput manual per-satuan. */
  hargaSatuanTerakhir: number;
  /** Stok saat ini, dalam satuan yang sama. Bertambah otomatis saat
   *  Purchasing belanja, berkurang otomatis saat Kasir mencatat
   *  penjualan (lewat Resep), dan bisa dikurangi manual (rusak/
   *  expired) lewat Penyesuaian Stok. */
  stokSaatIni: number;
  aktif: boolean;
}

/** Satu baris Resep = satu bahan + takarannya untuk SATU porsi menu.
 *  Disimpan di menu/{menuId}/resep/{bahanId}. Sengaja TIDAK menyimpan
 *  harga apa pun — hanya bahanId + takaran — supaya subkoleksi ini
 *  aman dibaca Kasir (perlu tahu takaran untuk mengurangi stok saat
 *  penjualan), tanpa membocorkan biaya. */
export interface ResepItem {
  /** == bahanId, dipakai juga sebagai document ID. */
  id: string;
  bahanId: string;
  bahanNama: string;
  takaran: number;
  /** Ikut satuan bahan_baku terkait (ditentukan otomatis saat bahan
   *  dipilih, bukan diketik ulang manual — mencegah salah satuan). */
  satuan: SatuanBahan;
}

/** Penyesuaian stok manual TANPA approval — untuk bahan rusak/
 *  kedaluwarsa yang harus dikeluarkan dari inventaris tanpa ada
 *  penjualan. Wajib foto sebagai bukti, tapi tidak perlu persetujuan
 *  Owner (atas permintaan pemilik cafe). */
export interface PenyesuaianStok {
  id: string;
  bahanId: string;
  bahanNama: string;
  jumlah: number;
  satuan: SatuanBahan;
  alasan: "rusak" | "kedaluwarsa" | "lainnya";
  keterangan: string;
  fotoUrl: string;
  dicatatOlehUid: string;
  dicatatOlehNama: string;
}

/** Tanggungan Kasir — dibuat otomatis saat Tutup Shift dengan Selisih
 *  Kas negatif (kekurangan). Owner/Finance menandai lunas setelah
 *  kasir mengganti secara nyata (di luar aplikasi). */
export interface TanggunganKasir {
  id: string;
  shiftId: string;
  tanggal: string;
  kasirUid: string;
  kasirNama: string;
  nominal: number;
  keterangan: string;
  status: "belum_lunas" | "lunas";
}
