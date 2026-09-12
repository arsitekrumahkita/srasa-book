// ============================================================
// Unit test untuk format angka — khususnya formatRupiahSatuan.
//
// Ini bukan sekadar tes kosmetik. Harga bahan baku disimpan per
// satuan terkecil (gram/pcs) dan untuk bahan murah bervolume besar
// nilainya PECAHAN di bawah Rp1 — misalnya air galon isi ulang
// Rp6.000 untuk 19.000 ml = Rp0,32 per ml. Bila ditampilkan (atau
// lebih buruk: disimpan) dengan pembulatan Rupiah biasa, bahan itu
// terlihat berharga Rp0 alias gratis, dan HPP jadi terlalu rendah
// tanpa ada yang curiga. Tes ini mengunci perilaku itu supaya bug
// tersebut tidak kembali diam-diam.
// ============================================================

import { describe, expect, it } from "vitest";
import { formatPersen, formatRupiah, formatRupiahSatuan } from "./format";

/** Intl memakai spasi non-breaking setelah "Rp"; disamakan dulu
 *  supaya perbandingan string tidak rapuh antar-lingkungan. */
function normalkan(teks: string): string {
  return teks.replace(/ /g, " ");
}

describe("formatRupiahSatuan", () => {
  it("menampilkan desimal untuk harga satuan di bawah Rp1 (tidak jadi Rp0)", () => {
    const hasil = normalkan(formatRupiahSatuan(0.32));
    expect(hasil).toContain("0,32");
    expect(hasil).not.toBe("Rp 0");
  });

  it("tetap menampilkan nilai kecil tapi bukan nol sebagai bukan-nol", () => {
    expect(normalkan(formatRupiahSatuan(0.05))).toContain("0,05");
  });

  it("menampilkan desimal untuk harga satuan di bawah Rp100", () => {
    expect(normalkan(formatRupiahSatuan(20.5))).toContain("20,50");
  });

  it("membulatkan seperti biasa untuk harga Rp100 ke atas", () => {
    expect(normalkan(formatRupiahSatuan(100))).toBe("Rp 100");
    expect(normalkan(formatRupiahSatuan(100_000))).toBe("Rp 100.000");
  });

  it("nol tetap ditampilkan sebagai Rp0 tanpa desimal", () => {
    expect(normalkan(formatRupiahSatuan(0))).toBe("Rp 0");
  });

  it("menangani nilai tidak valid tanpa error", () => {
    expect(normalkan(formatRupiahSatuan(Number.NaN))).toBe("Rp 0");
  });
});

describe("formatRupiah", () => {
  it("membulatkan ke Rupiah utuh", () => {
    expect(normalkan(formatRupiah(12_345.67))).toBe("Rp 12.346");
  });

  it("menangani nilai tidak valid tanpa error", () => {
    expect(normalkan(formatRupiah(Number.NaN))).toBe("Rp 0");
  });
});

describe("formatPersen", () => {
  it("memakai satu angka desimal secara default", () => {
    expect(formatPersen(35)).toBe("35.0%");
  });
});
