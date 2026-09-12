// ============================================================
// Kalkulator HPP — versi manual dengan komponen persentase
// (PRD bagian 8.3.1). Fungsi murni, tanpa efek samping, tanpa
// bergantung pada Firestore/React — supaya bisa diuji otomatis
// (lihat hpp-calculator.test.ts) dan dipakai ulang di halaman
// manapun (form menu, dashboard, kalkulasi laba shift).
//
// Kenapa dipisah jadi file sendiri di src/shared/lib:
// logika ini akan dipakai oleh LEBIH DARI SATU halaman
// (form Kalkulator HPP, dashboard laba, tutup shift) —
// sesuai "Rule of Two", bukan cocok ditaruh di dalam satu
// folder halaman saja.
// ============================================================

import type {
  EvaluasiHargaJual,
  HppBreakdown,
  MenuHppInput,
  ProfilHppDefault,
  RekomendasiHarga,
} from "@/shared/types/hpp";

// ------------------------------------------------------------
// SECTION: Util angka kecil
// ------------------------------------------------------------

/** Ubah persen (0-100) menjadi fraksi (0-1). Dipakai di lapisan UI/form. */
export function persenKeFraksi(persen: number): number {
  return persen / 100;
}

/** Ubah fraksi (0-1) menjadi persen (0-100) untuk ditampilkan di UI. */
export function fraksiKePersen(fraksi: number): number {
  return fraksi * 100;
}

function bulatkanRupiah(nilai: number): number {
  // Nominal Rupiah dibulatkan ke satuan penuh — tidak ada sen.
  return Math.round(nilai);
}

// ------------------------------------------------------------
// SECTION: Rincian komponen HPP (bagian 8.3.1)
// ------------------------------------------------------------

/**
 * Menghitung rincian HPP Total per porsi dari HPP Bahan manual
 * ditambah komponen persentase (susut, utilitas, tenaga kerja,
 * overhead lain), dengan override per menu bila ada.
 *
 * Melempar RangeError bila hppBahan negatif — nilai HPP tidak
 * boleh negatif secara bisnis, dan lebih baik gagal cepat di
 * sini daripada menghasilkan laporan laba yang salah.
 */
export function hitungHppBreakdown(
  input: MenuHppInput,
  defaults: ProfilHppDefault,
): HppBreakdown {
  if (input.hppBahan < 0) {
    throw new RangeError("HPP Bahan tidak boleh bernilai negatif.");
  }

  const hppBahan = input.hppBahan;
  const biayaKemasan = input.biayaKemasan ?? 0;

  const persenSusut = input.overridePersenSusut ?? defaults.persenSusut;
  const persenUtilitas = input.overridePersenUtilitas ?? defaults.persenUtilitas;
  const persenTenagaKerja =
    input.overridePersenTenagaKerja ?? defaults.persenTenagaKerja;
  const persenOverheadLain =
    input.overridePersenOverheadLain ?? defaults.persenOverheadLain;

  const biayaSusut = hppBahan * persenSusut;
  const biayaUtilitas = hppBahan * persenUtilitas;
  const biayaTenagaKerja = hppBahan * persenTenagaKerja;
  const biayaOverheadLain = hppBahan * persenOverheadLain;

  const hppTotal =
    hppBahan +
    biayaKemasan +
    biayaSusut +
    biayaUtilitas +
    biayaTenagaKerja +
    biayaOverheadLain;

  return {
    hppBahan: bulatkanRupiah(hppBahan),
    biayaKemasan: bulatkanRupiah(biayaKemasan),
    biayaSusut: bulatkanRupiah(biayaSusut),
    biayaUtilitas: bulatkanRupiah(biayaUtilitas),
    biayaTenagaKerja: bulatkanRupiah(biayaTenagaKerja),
    biayaOverheadLain: bulatkanRupiah(biayaOverheadLain),
    hppTotal: bulatkanRupiah(hppTotal),
  };
}

// ------------------------------------------------------------
// SECTION: Rekomendasi harga jual (Margin vs Markup)
// ------------------------------------------------------------

/**
 * Harga Jual Ideal metode MARGIN: persentase dihitung dari harga
 * jual itu sendiri. Mengembalikan null bila persenMargin >= 1
 * (100%), karena rumus akan membagi dengan nol atau negatif —
 * itu bukan skenario bisnis yang valid.
 */
export function hargaJualIdealMargin(
  hppTotal: number,
  persenMargin: number,
): number | null {
  if (persenMargin >= 1) return null;
  return bulatkanRupiah(hppTotal / (1 - persenMargin));
}

/**
 * Harga Jual Ideal metode MARKUP: persentase dihitung dari HPP
 * (biaya), bukan dari harga jual. Selalu terdefinisi untuk
 * persenMarkup >= 0.
 */
export function hargaJualIdealMarkup(
  hppTotal: number,
  persenMarkup: number,
): number | null {
  if (persenMarkup < 0) return null;
  return bulatkanRupiah(hppTotal * (1 + persenMarkup));
}

/** Menghitung kedua metode sekaligus untuk ditampilkan berdampingan di UI. */
export function hitungRekomendasiHarga(
  hppTotal: number,
  persenMargin: number,
  persenMarkup: number,
): RekomendasiHarga {
  return {
    hargaJualIdealMargin: hargaJualIdealMargin(hppTotal, persenMargin),
    hargaJualIdealMarkup: hargaJualIdealMarkup(hppTotal, persenMarkup),
  };
}

// ------------------------------------------------------------
// SECTION: Evaluasi harga jual yang sudah ditetapkan
// ------------------------------------------------------------

/**
 * Menghitung margin dan food cost % dari HPP Total dan harga jual
 * yang sudah ditetapkan Owner, lalu menandai apakah food cost-nya
 * melebihi target profil cafe (margin tipis).
 *
 * Melempar RangeError bila hargaJual <= 0, karena food cost %
 * tidak bermakna dibagi nol/negatif — form di UI wajib memvalidasi
 * ini sebelum memanggil fungsi ini.
 */
export function evaluasiHargaJual(
  hargaJual: number,
  hppTotal: number,
  targetFoodCost: number,
): EvaluasiHargaJual {
  if (hargaJual <= 0) {
    throw new RangeError("Harga jual harus lebih besar dari nol.");
  }

  const marginRupiah = hargaJual - hppTotal;
  const marginPersen = (marginRupiah / hargaJual) * 100;
  const foodCostPersen = (hppTotal / hargaJual) * 100;
  const marginTipis = foodCostPersen > fraksiKePersen(targetFoodCost);

  return {
    hargaJual: bulatkanRupiah(hargaJual),
    hppTotal: bulatkanRupiah(hppTotal),
    marginRupiah: bulatkanRupiah(marginRupiah),
    marginPersen: Math.round(marginPersen * 10) / 10, // 1 desimal
    foodCostPersen: Math.round(foodCostPersen * 10) / 10,
    marginTipis,
  };
}

// ------------------------------------------------------------
// SECTION: Fungsi gabungan — dipakai langsung dari halaman UI
// ------------------------------------------------------------

export interface HasilKalkulatorHpp {
  breakdown: HppBreakdown;
  rekomendasi: RekomendasiHarga;
  evaluasi: EvaluasiHargaJual | null;
}

/**
 * Satu pintu masuk yang dipakai halaman Kalkulator HPP: dari input
 * menu + default profil cafe + (opsional) harga jual yang sudah
 * ditetapkan, hasilkan rincian HPP, rekomendasi harga, dan evaluasi
 * margin sekaligus.
 */
export function hitungKalkulatorHpp(
  input: MenuHppInput,
  defaults: ProfilHppDefault,
  opsi: { hargaJual?: number; persenMarginDiinginkan: number; persenMarkupDiinginkan: number },
): HasilKalkulatorHpp {
  const breakdown = hitungHppBreakdown(input, defaults);
  const rekomendasi = hitungRekomendasiHarga(
    breakdown.hppTotal,
    opsi.persenMarginDiinginkan,
    opsi.persenMarkupDiinginkan,
  );
  const evaluasi =
    opsi.hargaJual && opsi.hargaJual > 0
      ? evaluasiHargaJual(opsi.hargaJual, breakdown.hppTotal, defaults.targetFoodCost)
      : null;

  return { breakdown, rekomendasi, evaluasi };
}
