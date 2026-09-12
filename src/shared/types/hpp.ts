// ============================================================
// Tipe data untuk Kalkulator HPP (versi manual, Sprint 1)
// Lihat PRD bagian 8.3.1 dan 9.4 untuk rumus & konteks bisnis.
// Semua nilai persentase disimpan sebagai FRAKSI (0.03 = 3%),
// bukan sebagai angka 0-100, supaya perhitungan tidak perlu
// bolak-balik dibagi/dikali 100 di banyak tempat.
// ============================================================

/** Metode penentuan harga jual ideal dari HPP. */
export type MetodeHarga = "margin" | "markup";

/**
 * Nilai default persentase komponen HPP yang diatur satu kali
 * di Profil Cafe, dan dipakai sebagai fallback untuk semua menu
 * yang tidak meng-override nilainya sendiri.
 */
export interface ProfilHppDefault {
  /** Persentase susut/waste bahan, dihitung dari HPP Bahan. Fraksi 0-1. */
  persenSusut: number;
  /** Persentase alokasi utilitas (listrik/air/gas), dari HPP Bahan. Fraksi 0-1. */
  persenUtilitas: number;
  /** Persentase alokasi tenaga kerja, dari HPP Bahan. Fraksi 0-1. Boleh 0. */
  persenTenagaKerja: number;
  /** Persentase overhead lain-lain (sewa, marketing, dll), dari HPP Bahan. Fraksi 0-1. */
  persenOverheadLain: number;
  /** Target food cost % yang dipakai sebagai peringatan margin tipis. Fraksi 0-1. */
  targetFoodCost: number;
  /** Metode harga default yang ditampilkan lebih dulu di kalkulator. */
  metodeHargaDefault: MetodeHarga;
}

/**
 * Input HPP satu menu (atau satu varian). `hppBahan` wajib diisi manual
 * oleh Owner pada Sprint 1; field override bernilai `null`/`undefined`
 * berarti "pakai nilai default dari Profil Cafe".
 */
export interface MenuHppInput {
  hppBahan: number;
  biayaKemasan?: number;
  overridePersenSusut?: number | null;
  overridePersenUtilitas?: number | null;
  overridePersenTenagaKerja?: number | null;
  overridePersenOverheadLain?: number | null;
}

/** Rincian tiap komponen biaya yang membentuk HPP Total satu porsi. */
export interface HppBreakdown {
  hppBahan: number;
  biayaKemasan: number;
  biayaSusut: number;
  biayaUtilitas: number;
  biayaTenagaKerja: number;
  biayaOverheadLain: number;
  hppTotal: number;
}

/** Hasil rekomendasi harga jual, ditampilkan berdampingan (bagian 8.3.1). */
export interface RekomendasiHarga {
  hargaJualIdealMargin: number | null;
  hargaJualIdealMarkup: number | null;
}

/** Ringkasan margin & food cost untuk satu harga jual yang sudah ditetapkan. */
export interface EvaluasiHargaJual {
  hargaJual: number;
  hppTotal: number;
  marginRupiah: number;
  marginPersen: number;
  foodCostPersen: number;
  /** true bila food cost % melebihi target profil cafe -> tampilkan peringatan. */
  marginTipis: boolean;
}
