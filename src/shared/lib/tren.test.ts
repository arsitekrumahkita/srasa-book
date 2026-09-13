// ============================================================
// Unit test untuk bagian MURNI dari analitik tren custom rentang
// waktu — pembangun daftar tanggal/bulan yang jadi dasar query
// range documentId() ke summary_harian/summary_bulanan. Fungsi yang
// memanggil Firestore (ambilTren, dst.) sengaja tidak diuji di sini
// (butuh emulator), tapi bug paling gampang terjadi di sini: kalau
// daftar tanggal/bulannya salah, seluruh grafik custom rentang bisa
// bolong atau kebalik tanpa error yang kelihatan.
// ============================================================

import { describe, expect, it } from "vitest";
import {
  daftarBulanAntara,
  daftarTanggalAntara,
  formatBulanId,
  formatTanggalId,
  resolveRentangTanggal,
} from "./tren-tanggal";

describe("daftarTanggalAntara", () => {
  it("menghasilkan daftar tanggal berurutan termasuk kedua ujungnya", () => {
    expect(daftarTanggalAntara("2026-09-01", "2026-09-05")).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ]);
  });

  it("mengembalikan satu tanggal saja bila mulai == selesai", () => {
    expect(daftarTanggalAntara("2026-09-01", "2026-09-01")).toEqual(["2026-09-01"]);
  });

  it("melewati batas akhir bulan/tahun dengan benar", () => {
    expect(daftarTanggalAntara("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
    expect(daftarTanggalAntara("2025-12-30", "2026-01-02")).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("mengembalikan daftar kosong bila selesai lebih awal dari mulai (input kebalik ditangani pemanggil)", () => {
    expect(daftarTanggalAntara("2026-09-05", "2026-09-01")).toEqual([]);
  });
});

describe("daftarBulanAntara", () => {
  it("menghasilkan daftar bulan berurutan termasuk kedua ujungnya", () => {
    expect(daftarBulanAntara("2026-01", "2026-04")).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
  });

  it("melewati batas akhir tahun dengan benar", () => {
    expect(daftarBulanAntara("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("mengembalikan satu bulan saja bila mulai == selesai", () => {
    expect(daftarBulanAntara("2026-06", "2026-06")).toEqual(["2026-06"]);
  });
});

describe("formatTanggalId & formatBulanId", () => {
  it("memformat tanggal sebagai YYYY-MM-DD dengan padding nol", () => {
    expect(formatTanggalId(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("memformat bulan sebagai YYYY-MM dengan padding nol", () => {
    expect(formatBulanId(new Date(2026, 8, 5))).toBe("2026-09");
  });
});

describe("resolveRentangTanggal", () => {
  it("custom-tanggal: memakai tanggalMulai/tanggalSelesai apa adanya", () => {
    expect(
      resolveRentangTanggal("custom-tanggal", { tanggalMulai: "2026-09-01", tanggalSelesai: "2026-09-10" }),
    ).toEqual({ mulai: "2026-09-01", selesai: "2026-09-10" });
  });

  it("custom-tanggal: menukar urutan kalau input kebalik", () => {
    expect(
      resolveRentangTanggal("custom-tanggal", { tanggalMulai: "2026-09-10", tanggalSelesai: "2026-09-01" }),
    ).toEqual({ mulai: "2026-09-01", selesai: "2026-09-10" });
  });

  it("custom-tanggal: null kalau salah satu tanggal belum diisi", () => {
    expect(resolveRentangTanggal("custom-tanggal", { tanggalMulai: "2026-09-01" })).toBeNull();
  });

  it("custom-bulan: rentang dari tanggal 1 bulan awal sampai akhir bulan selesai", () => {
    expect(
      resolveRentangTanggal("custom-bulan", { bulanMulai: "2026-01", bulanSelesai: "2026-02" }),
    ).toEqual({ mulai: "2026-01-01", selesai: "2026-02-28" });
  });

  it("custom-bulan: akhir bulan Februari kabisat dihitung benar", () => {
    expect(
      resolveRentangTanggal("custom-bulan", { bulanMulai: "2024-02", bulanSelesai: "2024-02" }),
    ).toEqual({ mulai: "2024-02-01", selesai: "2024-02-29" });
  });

  it("custom-bulan: menukar urutan kalau input kebalik", () => {
    expect(
      resolveRentangTanggal("custom-bulan", { bulanMulai: "2026-03", bulanSelesai: "2026-01" }),
    ).toEqual({ mulai: "2026-01-01", selesai: "2026-03-31" });
  });

  it("custom-bulan: null kalau salah satu bulan belum diisi", () => {
    expect(resolveRentangTanggal("custom-bulan", { bulanMulai: "2026-01" })).toBeNull();
  });

  it("harian/mingguan/bulanan: selesai selalu hari ini", () => {
    const hariIni = formatTanggalId(new Date());
    expect(resolveRentangTanggal("harian")?.selesai).toBe(hariIni);
    expect(resolveRentangTanggal("mingguan")?.selesai).toBe(hariIni);
    expect(resolveRentangTanggal("bulanan")?.selesai).toBe(hariIni);
  });
});
