// ============================================================
// Unit test Mode Demo — isi data dummy & reset, dijalankan terhadap
// Firestore TIRUAN di memori (lingkungan test tidak punya akses ke
// Firebase asli maupun emulator). Yang diuji:
//   - data dummy terisi lengkap & konsisten (saldo, hutang, laba)
//   - tidak ada nilai `undefined` (Firestore asli MENOLAK undefined —
//     bug semacam ini baru ketahuan di produksi kalau tidak dites)
//   - siapkan hanya sekali (panggilan kedua tidak mengisi dobel)
//   - reset menghapus perubahan pengguna & mengembalikan data awal
//   - SEMUA tulisan hanya terjadi di bawah outlets/demo_archimax
// ============================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

const toko = new Map<string, Record<string, unknown>>();

vi.mock("./firebase", () => ({ db: {} }));

vi.mock("firebase/firestore", () => {
  class Timestamp {
    constructor(public ms: number) {}
    static fromDate(d: Date) {
      return new Timestamp(d.getTime());
    }
    toDate() {
      return new Date(this.ms);
    }
  }
  type Ref = { path: string; id: string };
  type Kueri = { path: string; filter: { field: string; nilai: unknown }[] };

  const gabung = (awal: unknown, segmen: string[]) => {
    const basis = typeof awal === "object" && awal && "path" in awal ? [(awal as Ref).path] : [];
    return [...basis, ...segmen].join("/");
  };
  const buatRef = (path: string): Ref => ({ path, id: path.split("/").pop() ?? "" });
  let hitungId = 0;

  const bacaKoleksi = (q: Kueri) => {
    const kedalaman = q.path.split("/").length + 1;
    const docs = [...toko.entries()]
      .filter(([p]) => p.startsWith(q.path + "/") && p.split("/").length === kedalaman)
      .filter(([, d]) => q.filter.every((f) => d[f.field] === f.nilai))
      .map(([p, d]) => ({ id: buatRef(p).id, ref: buatRef(p), data: () => d }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };

  return {
    Timestamp,
    serverTimestamp: () => "SERVER_TS",
    collection: (awal: unknown, ...segmen: string[]) => ({ path: gabung(awal, segmen), filter: [] }),
    doc: (awal: unknown, ...segmen: string[]) =>
      segmen.length === 0 ? buatRef(`${(awal as Ref).path}/auto-${++hitungId}`) : buatRef(gabung(awal, segmen)),
    where: (field: string, _op: string, nilai: unknown) => ({ field, nilai }),
    query: (k: Kueri, ...filter: { field: string; nilai: unknown }[]) => ({ path: k.path, filter: [...k.filter, ...filter] }),
    getDocs: async (q: Kueri) => bacaKoleksi(q),
    getDoc: async (r: Ref) => ({ exists: () => toko.has(r.path), data: () => toko.get(r.path) }),
    setDoc: async (r: Ref, data: Record<string, unknown>) => void toko.set(r.path, data),
    deleteDoc: async (r: Ref) => void toko.delete(r.path),
    writeBatch: () => {
      const antre: (() => void)[] = [];
      return {
        set: (r: Ref, data: Record<string, unknown>) => antre.push(() => toko.set(r.path, data)),
        delete: (r: Ref) => antre.push(() => toko.delete(r.path)),
        commit: async () => {
          if (antre.length > 500) throw new Error("batch > 500 operasi");
          antre.forEach((f) => f());
        },
      };
    },
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async (r: Ref) => ({ exists: () => toko.has(r.path), data: () => toko.get(r.path) }),
        set: (r: Ref, data: Record<string, unknown>) => void toko.set(r.path, data),
      }),
  };
});

import { ID_OUTLET_DEMO, resetDataDemo, siapkanDataDemoBilaKosong } from "./mode-demo";

const AWALAN = `outlets/${ID_OUTLET_DEMO}/`;

function isiKoleksi(nama: string): Record<string, unknown>[] {
  const kedalaman = `${AWALAN}${nama}`.split("/").length + 1;
  return [...toko.entries()]
    .filter(([p]) => p.startsWith(`${AWALAN}${nama}/`) && p.split("/").length === kedalaman)
    .map(([, d]) => d);
}

function adaUndefined(nilai: unknown): boolean {
  if (nilai === undefined) return true;
  if (nilai && typeof nilai === "object") return Object.values(nilai).some(adaUndefined);
  return false;
}

describe("Mode Demo", () => {
  beforeEach(() => toko.clear());

  it("mengisi data dummy lengkap, konsisten, dan hanya di Outlet Demo", async () => {
    expect(await siapkanDataDemoBilaKosong("Tester")).toBe("disiapkan");

    expect([...toko.keys()].every((p) => p.startsWith(AWALAN))).toBe(true);
    expect([...toko.values()].some(adaUndefined)).toBe(false);

    expect(isiKoleksi("bahan_baku")).toHaveLength(12);
    expect(isiKoleksi("stok_kasir")).toHaveLength(12);
    expect(isiKoleksi("menu_harga")).toHaveLength(7);
    expect(isiKoleksi("shift")).toHaveLength(12);
    expect(isiKoleksi("shift").every((s) => s.status === "terkunci")).toBe(true);

    // Saldo = 5.000.000 − 350.000 − 1.500.000 − 500.000 (belanja
    // sumber Saldo Finance) − 250.000 (Hutang yang sudah lunas).
    expect(toko.get(`${AWALAN}saldo_finance/utama`)?.saldo).toBe(2400000);

    const hutang = isiKoleksi("hutang_supplier");
    expect(hutang.map((h) => h.status).sort()).toEqual(["belum_lunas", "lunas"]);
    expect(hutang.find((h) => h.status === "belum_lunas")?.nominal).toBe(155000);

    const belanjaUtang = isiKoleksi("kas_belanja").filter((b) => (b.totalBelanjaUtang as number) > 0);
    expect(belanjaUtang).toHaveLength(2);

    const tanggungan = isiKoleksi("tanggungan_kasir");
    expect(tanggungan).toHaveLength(1);
    expect(tanggungan[0].nominal).toBe(20000);

    // Ringkasan harian dihitung lewat laba-harian.ts: omset > 0 dan
    // laba = omset − HPP − kas keluar.
    const ringkasan = isiKoleksi("summary_harian");
    expect(ringkasan).toHaveLength(6);
    for (const r of ringkasan) {
      expect(r.totalOmset as number).toBeGreaterThan(0);
      expect(r.labaBersih).toBe((r.totalOmset as number) - (r.totalHpp as number) - (r.totalKasKeluar as number));
    }

    expect(toko.get(`${AWALAN}demo_meta/status`)?.status).toBe("siap");
  });

  it("tidak mengisi dobel kalau sudah pernah disiapkan", async () => {
    await siapkanDataDemoBilaKosong("A");
    const jumlah = toko.size;
    expect(await siapkanDataDemoBilaKosong("B")).toBe("sudah_ada");
    expect(toko.size).toBe(jumlah);
  });

  it("reset menghapus perubahan pengguna dan mengembalikan data awal", async () => {
    await siapkanDataDemoBilaKosong("A");
    const jumlahAwal = toko.size;

    // Simulasi pengguna mengotak-atik data demo.
    toko.set(`${AWALAN}shift/shift-coba`, { tanggal: "2099-01-01", status: "buka" });
    toko.set(`${AWALAN}shift/shift-coba/penjualan/x`, { qty: 3 });
    toko.set(`${AWALAN}saldo_finance/utama`, { saldo: -999 });
    toko.set(`${AWALAN}hutang_supplier/baru`, { nominal: 1, status: "belum_lunas" });

    await resetDataDemo("A");

    expect(toko.size).toBe(jumlahAwal);
    expect(toko.has(`${AWALAN}shift/shift-coba`)).toBe(false);
    expect(toko.has(`${AWALAN}shift/shift-coba/penjualan/x`)).toBe(false);
    expect(toko.has(`${AWALAN}hutang_supplier/baru`)).toBe(false);
    expect(toko.get(`${AWALAN}saldo_finance/utama`)?.saldo).toBe(2400000);
  });

  it("reset tidak pernah menyentuh data Outlet asli", async () => {
    toko.set("outlets/srasa-book/shift/asli", { status: "terkunci" });
    toko.set("outlets/srasa-book/saldo_finance/utama", { saldo: 123 });
    await siapkanDataDemoBilaKosong("A");
    await resetDataDemo("A");
    expect(toko.get("outlets/srasa-book/shift/asli")).toEqual({ status: "terkunci" });
    expect(toko.get("outlets/srasa-book/saldo_finance/utama")).toEqual({ saldo: 123 });
  });
});
