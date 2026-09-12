// ============================================================
// Unit test untuk Kalkulator HPP (PRD bagian 8.3.1 & 17.3).
// Ini komponen dengan prioritas pengujian TERTINGGI di seluruh
// aplikasi karena langsung memengaruhi angka laba yang dilihat
// Owner — kesalahan di sini paling mahal akibatnya.
// ============================================================

import { describe, expect, it } from "vitest";
import {
  evaluasiHargaJual,
  fraksiKePersen,
  hargaJualIdealMargin,
  hargaJualIdealMarkup,
  hitungHppBreakdown,
  hitungKalkulatorHpp,
  persenKeFraksi,
} from "./hpp-calculator";
import type { ProfilHppDefault } from "@/shared/types/hpp";

const defaultProfil: ProfilHppDefault = {
  persenSusut: 0.03, // 3%
  persenUtilitas: 0.05, // 5%
  persenTenagaKerja: 0.1, // 10%
  persenOverheadLain: 0.07, // 7%
  targetFoodCost: 0.35, // 35%
  metodeHargaDefault: "margin",
};

describe("persenKeFraksi & fraksiKePersen", () => {
  it("saling berkebalikan", () => {
    expect(persenKeFraksi(35)).toBeCloseTo(0.35);
    expect(fraksiKePersen(0.35)).toBeCloseTo(35);
  });
});

describe("hitungHppBreakdown", () => {
  it("menghitung rincian dengan nilai default profil cafe (contoh Kopi Susu)", () => {
    // HPP Bahan Rp5.000, kemasan Rp500
    const hasil = hitungHppBreakdown(
      { hppBahan: 5000, biayaKemasan: 500 },
      defaultProfil,
    );

    expect(hasil.hppBahan).toBe(5000);
    expect(hasil.biayaKemasan).toBe(500);
    expect(hasil.biayaSusut).toBe(150); // 3% x 5000
    expect(hasil.biayaUtilitas).toBe(250); // 5% x 5000
    expect(hasil.biayaTenagaKerja).toBe(500); // 10% x 5000
    expect(hasil.biayaOverheadLain).toBe(350); // 7% x 5000
    // 5000 + 500 + 150 + 250 + 500 + 350 = 6750
    expect(hasil.hppTotal).toBe(6750);
  });

  it("memakai override per menu, bukan default profil, bila diisi", () => {
    const hasil = hitungHppBreakdown(
      {
        hppBahan: 4000,
        overridePersenSusut: 0.15, // minuman dingin, susut es lebih tinggi
      },
      defaultProfil,
    );

    expect(hasil.biayaSusut).toBe(600); // 15% x 4000, bukan 3%
    // komponen lain tetap pakai default: utilitas 5%, tenaga kerja 10%, overhead 7%
    expect(hasil.biayaUtilitas).toBe(200);
    expect(hasil.biayaTenagaKerja).toBe(400);
    expect(hasil.biayaOverheadLain).toBe(280);
  });

  it("menganggap tenaga kerja 0% sebagai pilihan sah (opsional)", () => {
    const profilTanpaTenagaKerja: ProfilHppDefault = {
      ...defaultProfil,
      persenTenagaKerja: 0,
    };
    const hasil = hitungHppBreakdown({ hppBahan: 1000 }, profilTanpaTenagaKerja);
    expect(hasil.biayaTenagaKerja).toBe(0);
  });

  it("menolak HPP Bahan negatif", () => {
    expect(() => hitungHppBreakdown({ hppBahan: -100 }, defaultProfil)).toThrow(
      RangeError,
    );
  });

  it("HPP Bahan nol menghasilkan seluruh komponen persentase juga nol", () => {
    const hasil = hitungHppBreakdown({ hppBahan: 0 }, defaultProfil);
    expect(hasil.hppTotal).toBe(0);
  });
});

describe("hargaJualIdealMargin vs hargaJualIdealMarkup", () => {
  // Kasus ini yang membuktikan kedua metode BEDA hasilnya
  // meski persennya sama — inilah alasan bagian 8.3.1 menampilkan
  // keduanya berdampingan, bukan salah satu saja.
  it("menghasilkan angka berbeda untuk persentase yang sama", () => {
    const hppTotal = 6750;
    const persen = 0.3; // 30%

    const margin = hargaJualIdealMargin(hppTotal, persen);
    const markup = hargaJualIdealMarkup(hppTotal, persen);

    expect(margin).toBe(Math.round(6750 / 0.7)); // 9643
    expect(markup).toBe(Math.round(6750 * 1.3)); // 8775
    expect(margin).not.toBe(markup);
    expect(margin! > markup!).toBe(true); // margin 30% selalu >= markup 30%
  });

  it("hargaJualIdealMargin mengembalikan null bila persen margin >= 100%", () => {
    expect(hargaJualIdealMargin(5000, 1)).toBeNull();
    expect(hargaJualIdealMargin(5000, 1.2)).toBeNull();
  });

  it("hargaJualIdealMarkup mengembalikan null bila persen markup negatif", () => {
    expect(hargaJualIdealMarkup(5000, -0.1)).toBeNull();
  });
});

describe("evaluasiHargaJual", () => {
  it("menghitung margin & food cost % dengan benar", () => {
    const hasil = evaluasiHargaJual(15000, 6750, 0.35);

    expect(hasil.marginRupiah).toBe(8250);
    // food cost = 6750/15000 = 45%
    expect(hasil.foodCostPersen).toBeCloseTo(45, 1);
    expect(hasil.marginPersen).toBeCloseTo(55, 1);
    // 45% > target 35% -> margin tipis
    expect(hasil.marginTipis).toBe(true);
  });

  it("tidak menandai margin tipis bila food cost di bawah target", () => {
    const hasil = evaluasiHargaJual(20000, 6750, 0.35);
    // food cost = 6750/20000 = 33.75% < 35%
    expect(hasil.marginTipis).toBe(false);
  });

  it("menolak harga jual nol atau negatif", () => {
    expect(() => evaluasiHargaJual(0, 6750, 0.35)).toThrow(RangeError);
    expect(() => evaluasiHargaJual(-1000, 6750, 0.35)).toThrow(RangeError);
  });
});

describe("hitungKalkulatorHpp (fungsi gabungan untuk halaman UI)", () => {
  it("mengembalikan breakdown + rekomendasi tanpa evaluasi bila harga jual belum diisi", () => {
    const hasil = hitungKalkulatorHpp(
      { hppBahan: 5000, biayaKemasan: 500 },
      defaultProfil,
      { persenMarginDiinginkan: 0.3, persenMarkupDiinginkan: 0.3 },
    );

    expect(hasil.breakdown.hppTotal).toBe(6750);
    expect(hasil.rekomendasi.hargaJualIdealMargin).not.toBeNull();
    expect(hasil.evaluasi).toBeNull();
  });

  it("menyertakan evaluasi margin tipis bila harga jual diisi", () => {
    const hasil = hitungKalkulatorHpp(
      { hppBahan: 5000, biayaKemasan: 500 },
      defaultProfil,
      { hargaJual: 15000, persenMarginDiinginkan: 0.3, persenMarkupDiinginkan: 0.3 },
    );

    expect(hasil.evaluasi).not.toBeNull();
    expect(hasil.evaluasi?.hargaJual).toBe(15000);
  });
});
