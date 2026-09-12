// ============================================================
// Unit test untuk Auto Draft.
//
// Yang diuji di sini bukan React-nya, melainkan aturan main
// penyimpanannya — bagian yang kalau salah, kerugiannya berupa
// PEKERJAAN HILANG atau draf orang lain bocor ke akun lain:
//   - draf dikunci per-uid (dua kasir satu tablet tidak tertukar)
//   - draf basi dibuang, bukan ditawarkan berhari-hari kemudian
//   - penyimpanan yang error tidak pernah melempar ke pemanggil
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ambilDraf, hapusDraf, simpanDraf, usiaDraf } from "./draf";

/** localStorage tiruan — lingkungan test Node tidak punya window. */
function pasangPenyimpananTiruan(): Map<string, string> {
  const isi = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => isi.get(k) ?? null,
      setItem: (k: string, v: string) => void isi.set(k, v),
      removeItem: (k: string) => void isi.delete(k),
    },
  });
  return isi;
}

beforeEach(() => {
  pasangPenyimpananTiruan();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("simpanDraf & ambilDraf", () => {
  it("menyimpan lalu mengembalikan data yang sama", () => {
    simpanDraf("uid-1", "menu", { nama: "Kopi Hitam", takaran: 100 });
    const hasil = ambilDraf<{ nama: string; takaran: number }>("uid-1", "menu");
    expect(hasil?.data).toEqual({ nama: "Kopi Hitam", takaran: 100 });
  });

  it("mengembalikan null bila belum ada draf", () => {
    expect(ambilDraf("uid-1", "belum-ada")).toBeNull();
  });

  it("memisahkan draf antar-pengguna di perangkat yang sama", () => {
    // Kasir pagi & kasir sore memakai tablet yang sama: draf satu orang
    // TIDAK BOLEH terbaca oleh akun lain.
    simpanDraf("kasir-pagi", "tutup-shift", { kasFisik: 500_000 });
    simpanDraf("kasir-sore", "tutup-shift", { kasFisik: 750_000 });

    expect(ambilDraf<{ kasFisik: number }>("kasir-pagi", "tutup-shift")?.data.kasFisik).toBe(
      500_000,
    );
    expect(ambilDraf<{ kasFisik: number }>("kasir-sore", "tutup-shift")?.data.kasFisik).toBe(
      750_000,
    );
  });

  it("memisahkan draf antar-kunci form", () => {
    simpanDraf("uid-1", "form-a", { nilai: 1 });
    simpanDraf("uid-1", "form-b", { nilai: 2 });
    expect(ambilDraf<{ nilai: number }>("uid-1", "form-a")?.data.nilai).toBe(1);
    expect(ambilDraf<{ nilai: number }>("uid-1", "form-b")?.data.nilai).toBe(2);
  });

  it("menimpa draf lama dengan yang baru", () => {
    simpanDraf("uid-1", "menu", { nama: "Lama" });
    simpanDraf("uid-1", "menu", { nama: "Baru" });
    expect(ambilDraf<{ nama: string }>("uid-1", "menu")?.data.nama).toBe("Baru");
  });

  it("mencatat waktu penyimpanan", () => {
    const sebelum = Date.now();
    simpanDraf("uid-1", "menu", { nama: "Kopi" });
    const hasil = ambilDraf("uid-1", "menu");
    expect(hasil?.disimpanPada).toBeGreaterThanOrEqual(sebelum);
    expect(hasil?.disimpanPada).toBeLessThanOrEqual(Date.now());
  });
});

describe("kedaluwarsa draf", () => {
  it("membuang draf yang lebih tua dari batas umur", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T08:00:00Z"));
    simpanDraf("uid-1", "menu", { nama: "Kopi" });

    // Tiga hari kemudian, dengan batas 48 jam -> dianggap basi.
    vi.setSystemTime(new Date("2026-09-04T08:00:00Z"));
    expect(ambilDraf("uid-1", "menu", 48)).toBeNull();
  });

  it("draf yang basi ikut dihapus dari penyimpanan, bukan sekadar disembunyikan", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T08:00:00Z"));
    simpanDraf("uid-1", "menu", { nama: "Kopi" });

    vi.setSystemTime(new Date("2026-09-04T08:00:00Z"));
    ambilDraf("uid-1", "menu", 48);

    // Dibaca lagi dengan batas yang jauh lebih longgar pun tetap kosong,
    // membuktikan dokumennya benar-benar sudah dibuang.
    expect(ambilDraf("uid-1", "menu", 24 * 365)).toBeNull();
  });

  it("mempertahankan draf yang masih dalam batas umur", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T08:00:00Z"));
    simpanDraf("uid-1", "menu", { nama: "Kopi" });

    vi.setSystemTime(new Date("2026-09-01T20:00:00Z")); // 12 jam kemudian
    expect(ambilDraf<{ nama: string }>("uid-1", "menu", 48)?.data.nama).toBe("Kopi");
  });
});

describe("hapusDraf", () => {
  it("menghapus draf yang dimaksud saja", () => {
    simpanDraf("uid-1", "form-a", { nilai: 1 });
    simpanDraf("uid-1", "form-b", { nilai: 2 });
    hapusDraf("uid-1", "form-a");
    expect(ambilDraf("uid-1", "form-a")).toBeNull();
    expect(ambilDraf("uid-1", "form-b")).not.toBeNull();
  });
});

describe("ketahanan terhadap penyimpanan bermasalah", () => {
  it("tidak melempar error saat penyimpanan menolak menulis (mode privat/kuota penuh)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
      },
    });
    // Draf adalah fitur kenyamanan — kegagalannya tidak boleh
    // menjatuhkan halaman yang sedang dipakai bekerja.
    expect(() => simpanDraf("uid-1", "menu", { nama: "Kopi" })).not.toThrow();
    expect(() => hapusDraf("uid-1", "menu")).not.toThrow();
    expect(ambilDraf("uid-1", "menu")).toBeNull();
  });

  it("mengabaikan isi penyimpanan yang rusak/bukan JSON", () => {
    const isi = pasangPenyimpananTiruan();
    isi.set("srasa-draf:uid-1:menu", "{ini bukan json");
    expect(ambilDraf("uid-1", "menu")).toBeNull();
  });

  it("mengabaikan draf tanpa stempel waktu yang sah", () => {
    const isi = pasangPenyimpananTiruan();
    isi.set("srasa-draf:uid-1:menu", JSON.stringify({ data: { nama: "Kopi" } }));
    expect(ambilDraf("uid-1", "menu")).toBeNull();
  });
});

describe("usiaDraf", () => {
  it("menyebut detik sebagai 'beberapa detik lalu'", () => {
    expect(usiaDraf(Date.now() - 5_000)).toBe("beberapa detik lalu");
  });

  it("menghitung menit", () => {
    expect(usiaDraf(Date.now() - 5 * 60_000)).toBe("5 menit lalu");
  });

  it("menghitung jam", () => {
    expect(usiaDraf(Date.now() - 3 * 3_600_000)).toBe("3 jam lalu");
  });

  it("menghitung hari", () => {
    expect(usiaDraf(Date.now() - 2 * 24 * 3_600_000)).toBe("2 hari lalu");
  });

  it("tidak pernah menghasilkan waktu negatif walau jam perangkat mundur", () => {
    expect(usiaDraf(Date.now() + 60_000)).toBe("beberapa detik lalu");
  });
});
