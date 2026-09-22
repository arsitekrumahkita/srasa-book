// ============================================================
// Mode Demo — "Outlet percobaan" dengan data dummy yang bebas
// diotak-atik & di-reset, berjalan BERSAMAAN dengan Mode Riil (data
// asli Outlet) tanpa pernah saling menyentuh (permintaan pemilik
// cafe: menggantikan data dummy lama yang error/tidak bisa dipakai).
//
// Caranya: seluruh data aplikasi ini memang sudah hidup di bawah
// `outlets/{outletId}/...` (arsitektur Multi-Cabang). Mode Demo
// cukup mengarahkan outletId aktif ke SATU Outlet khusus ber-ID
// tetap (ID_OUTLET_DEMO) — semua halaman (Shift, Belanja, Finance,
// Cash Opname, Neraca, dst) otomatis bekerja di sana tanpa perlu
// diubah satu per satu, dan data Outlet asli tidak mungkin ikut
// tersentuh karena path-nya berbeda. Lihat outlet-context.tsx.
//
// Outlet Demo SENGAJA TIDAK punya dokumen di koleksi `outlets`
// (hanya sub-koleksinya) — supaya tidak pernah muncul di daftar
// Outlet asli (Kelola Outlet, layar Pilih Outlet, Backup Semua
// Outlet). Firestore mengizinkan sub-koleksi tanpa dokumen induk.
//
// SATU Outlet Demo dipakai BERSAMA oleh semua akun (bukan per akun)
// — supaya alur lintas peran bisa dicoba seperti aslinya: Kasir
// jualan di Demo -> Owner/Finance langsung melihatnya di Dashboard/
// Cash Opname Demo; Purchasing catat Hutang -> Finance melunasinya.
//
// firestore.rules: seluruh isi outlets/demo_archimax/** boleh
// dibaca-tulis-hapus SEMUA akun aktif (lihat bagian "Mode Demo" di
// firestore.rules) — itulah yang membuatnya "bebas otak-atik & bebas
// reset" untuk peran apa pun, tanpa melonggarkan aturan Outlet asli.
// ============================================================

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "./firebase";
import { STRUKTUR_KOLEKSI } from "./backup";
import { hitungLabaHarian } from "./laba-harian";
import { hitungHppBreakdown, PROFIL_HPP_DEFAULT_AWAL } from "./hpp-calculator";

/** ID tetap Outlet Demo. Tidak boleh berbentuk `__...__` (dicadangkan
 *  Firestore). Outlet asli selalu dibuat lewat addDoc (ID acak), jadi
 *  tidak mungkin bentrok dengan ID ini. HARUS sama dengan yang ditulis
 *  di firestore.rules. */
export const ID_OUTLET_DEMO = "demo_archimax";
export const NAMA_OUTLET_DEMO = "Outlet Demo (Percobaan)";

const KOLEKSI_META = "demo_meta";
const ID_META = "status";

/** Koleksi di luar STRUKTUR_KOLEKSI (backup.ts) yang juga ikut
 *  dibersihkan saat reset. */
const KOLEKSI_TAMBAHAN_RESET = ["backup_log"];

export type StatusDataDemo = "kosong" | "menyiapkan" | "siap";

export function refMetaDemo(): DocumentReference {
  return doc(db, "outlets", ID_OUTLET_DEMO, KOLEKSI_META, ID_META);
}

function refDemo(...segmen: string[]): DocumentReference {
  return doc(db, "outlets", ID_OUTLET_DEMO, ...segmen);
}

// ------------------------------------------------------------
// Penulisan massal — dipecah per 400 operasi (batas writeBatch 500).
// ------------------------------------------------------------

type Operasi =
  | { jenis: "set"; ref: DocumentReference; data: Record<string, unknown> }
  | { jenis: "hapus"; ref: DocumentReference };

async function jalankanOperasi(daftar: Operasi[]): Promise<void> {
  for (let i = 0; i < daftar.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of daftar.slice(i, i + 400)) {
      if (op.jenis === "set") batch.set(op.ref, op.data);
      else batch.delete(op.ref);
    }
    await batch.commit();
  }
}

// ------------------------------------------------------------
// Tanggal & waktu relatif terhadap HARI INI (data dummy selalu
// "segar": 6 hari terakhir, tanpa hari ini — supaya Kasir yang
// mencoba Mode Demo mulai dari shift hari ini yang masih kosong).
// ------------------------------------------------------------

function tanggalMundur(hari: number): string {
  const d = new Date();
  d.setDate(d.getDate() - hari);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function waktuMundur(hari: number, jam: number, menit = 0): Timestamp {
  const d = new Date();
  d.setDate(d.getDate() - hari);
  d.setHours(jam, menit, 0, 0);
  return Timestamp.fromDate(d);
}

/** Gambar pengganti foto nota (SVG kecil inline) — data demo tidak
 *  mengunggah ke Cloudinary sama sekali. */
const GAMBAR_NOTA_DEMO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="#f8fafc"/><rect x="30" y="16" width="60" height="88" rx="4" fill="#fff" stroke="#94a3b8"/><path d="M40 34h40M40 46h40M40 58h28M40 76h40" stroke="#cbd5e1" stroke-width="4" stroke-linecap="round"/><text x="60" y="114" font-family="sans-serif" font-size="11" text-anchor="middle" fill="#64748b">NOTA DEMO</text></svg>',
  );

// ------------------------------------------------------------
// Isi data dummy
// ------------------------------------------------------------

interface BahanDemo {
  id: string;
  nama: string;
  kategori: string;
  satuan: "gram" | "pcs";
  harga: number;
  stok: number;
  batas: number;
}

const BAHAN_DEMO: BahanDemo[] = [
  { id: "bahan-kopi", nama: "Biji Kopi Arabika", kategori: "Kopi", satuan: "gram", harga: 250, stok: 3000, batas: 500 },
  { id: "bahan-susu", nama: "Susu Full Cream", kategori: "Susu", satuan: "gram", harga: 20, stok: 8000, batas: 2000 },
  { id: "bahan-gula-aren", nama: "Gula Aren Cair", kategori: "Pemanis", satuan: "gram", harga: 40, stok: 1500, batas: 300 },
  { id: "bahan-teh", nama: "Teh Hitam", kategori: "Teh", satuan: "gram", harga: 150, stok: 400, batas: 100 },
  // Sengaja di bawah batas minimal -> banner "stok menipis" ikut bisa dicoba.
  { id: "bahan-coklat", nama: "Bubuk Coklat", kategori: "Coklat", satuan: "gram", harga: 120, stok: 150, batas: 200 },
  { id: "bahan-roti", nama: "Roti Tawar", kategori: "Makanan", satuan: "pcs", harga: 2500, stok: 30, batas: 10 },
  { id: "bahan-telur", nama: "Telur Ayam", kategori: "Makanan", satuan: "pcs", harga: 2200, stok: 40, batas: 12 },
  { id: "bahan-mie", nama: "Mie Instan", kategori: "Makanan", satuan: "pcs", harga: 3500, stok: 24, batas: 10 },
  { id: "bahan-es-batu", nama: "Es Batu", kategori: "Umum", satuan: "gram", harga: 2, stok: 20000, batas: 5000 },
  { id: "bahan-cup", nama: "Cup Plastik 16oz", kategori: "Kemasan", satuan: "pcs", harga: 900, stok: 200, batas: 50 },
  { id: "bahan-sedotan", nama: "Sedotan", kategori: "Kemasan", satuan: "pcs", harga: 150, stok: 300, batas: 50 },
  { id: "bahan-paper-box", nama: "Paper Box Makanan", kategori: "Kemasan", satuan: "pcs", harga: 1500, stok: 8, batas: 20 },
];

interface MenuDemo {
  id: string;
  nama: string;
  kategori: string;
  hargaJual: number;
  resep: { bahanId: string; takaran: number; jenis: "bahan" | "kemasan" }[];
}

const MENU_DEMO: MenuDemo[] = [
  {
    id: "menu-es-kopi-susu",
    nama: "Es Kopi Susu Aren",
    kategori: "Minuman",
    hargaJual: 22000,
    resep: [
      { bahanId: "bahan-kopi", takaran: 18, jenis: "bahan" },
      { bahanId: "bahan-susu", takaran: 150, jenis: "bahan" },
      { bahanId: "bahan-gula-aren", takaran: 25, jenis: "bahan" },
      { bahanId: "bahan-es-batu", takaran: 150, jenis: "bahan" },
      { bahanId: "bahan-cup", takaran: 1, jenis: "kemasan" },
      { bahanId: "bahan-sedotan", takaran: 1, jenis: "kemasan" },
    ],
  },
  {
    id: "menu-americano",
    nama: "Americano",
    kategori: "Minuman",
    hargaJual: 18000,
    resep: [
      { bahanId: "bahan-kopi", takaran: 18, jenis: "bahan" },
      { bahanId: "bahan-es-batu", takaran: 150, jenis: "bahan" },
      { bahanId: "bahan-cup", takaran: 1, jenis: "kemasan" },
      { bahanId: "bahan-sedotan", takaran: 1, jenis: "kemasan" },
    ],
  },
  {
    id: "menu-cafe-latte",
    nama: "Cafe Latte (Hot)",
    kategori: "Minuman",
    hargaJual: 25000,
    resep: [
      { bahanId: "bahan-kopi", takaran: 18, jenis: "bahan" },
      { bahanId: "bahan-susu", takaran: 200, jenis: "bahan" },
    ],
  },
  {
    id: "menu-es-teh",
    nama: "Es Teh Manis",
    kategori: "Minuman",
    hargaJual: 8000,
    resep: [
      { bahanId: "bahan-teh", takaran: 8, jenis: "bahan" },
      { bahanId: "bahan-gula-aren", takaran: 20, jenis: "bahan" },
      { bahanId: "bahan-es-batu", takaran: 150, jenis: "bahan" },
      { bahanId: "bahan-cup", takaran: 1, jenis: "kemasan" },
      { bahanId: "bahan-sedotan", takaran: 1, jenis: "kemasan" },
    ],
  },
  {
    id: "menu-es-coklat",
    nama: "Es Coklat",
    kategori: "Minuman",
    hargaJual: 20000,
    resep: [
      { bahanId: "bahan-coklat", takaran: 25, jenis: "bahan" },
      { bahanId: "bahan-susu", takaran: 150, jenis: "bahan" },
      { bahanId: "bahan-gula-aren", takaran: 15, jenis: "bahan" },
      { bahanId: "bahan-es-batu", takaran: 150, jenis: "bahan" },
      { bahanId: "bahan-cup", takaran: 1, jenis: "kemasan" },
      { bahanId: "bahan-sedotan", takaran: 1, jenis: "kemasan" },
    ],
  },
  {
    id: "menu-roti-bakar",
    nama: "Roti Bakar Coklat",
    kategori: "Makanan",
    hargaJual: 18000,
    resep: [
      { bahanId: "bahan-roti", takaran: 2, jenis: "bahan" },
      { bahanId: "bahan-coklat", takaran: 10, jenis: "bahan" },
      { bahanId: "bahan-paper-box", takaran: 1, jenis: "kemasan" },
    ],
  },
  {
    id: "menu-indomie-telur",
    nama: "Indomie Telur",
    kategori: "Makanan",
    hargaJual: 15000,
    resep: [
      { bahanId: "bahan-mie", takaran: 1, jenis: "bahan" },
      { bahanId: "bahan-telur", takaran: 1, jenis: "bahan" },
      { bahanId: "bahan-paper-box", takaran: 1, jenis: "kemasan" },
    ],
  },
];

const KASIR_DEMO = [
  { uid: "demo-kasir-andi", nama: "Andi (Kasir Demo)", slot: { nama: "Shift 1", jamMulai: "08:00", jamSelesai: "16:00" }, jamBuka: 8, jamTutup: 16 },
  { uid: "demo-kasir-sinta", nama: "Sinta (Kasir Demo)", slot: { nama: "Shift 2", jamMulai: "15:00", jamSelesai: "23:00" }, jamBuka: 15, jamTutup: 23 },
];
const PURCHASING_DEMO = { uid: "demo-purchasing-budi", nama: "Budi (Purchasing Demo)" };
const FINANCE_DEMO = { uid: "demo-finance-rina", nama: "Rina (Finance Demo)" };
const MODAL_KAS_AWAL = 500000;
const JUMLAH_HARI_DEMO = 6;

const DEFAULT_HPP = {
  persenSusut: PROFIL_HPP_DEFAULT_AWAL.persenSusut / 100,
  persenUtilitas: PROFIL_HPP_DEFAULT_AWAL.persenUtilitas / 100,
  persenTenagaKerja: PROFIL_HPP_DEFAULT_AWAL.persenTenagaKerja / 100,
  persenOverheadLain: PROFIL_HPP_DEFAULT_AWAL.persenOverheadLain / 100,
  targetFoodCost: PROFIL_HPP_DEFAULT_AWAL.targetFoodCost / 100,
  metodeHargaDefault: "margin" as const,
};

function hargaBahan(id: string): number {
  return BAHAN_DEMO.find((b) => b.id === id)?.harga ?? 0;
}

function namaBahan(id: string): string {
  return BAHAN_DEMO.find((b) => b.id === id)?.nama ?? id;
}

function satuanBahan(id: string): "gram" | "pcs" {
  return BAHAN_DEMO.find((b) => b.id === id)?.satuan ?? "gram";
}

/** Qty terjual "acak tapi tetap" (deterministik) per hari/menu/shift —
 *  supaya setiap reset menghasilkan data yang sama & mudah dijelaskan. */
function qtyDemo(hari: number, idxMenu: number, idxShift: number): number {
  return ((hari * 7 + idxMenu * 3 + idxShift * 5) % 9) + 2;
}

interface BelanjaDemo {
  id: string;
  hari: number;
  sumberDana: "kas_resto" | "saldo_finance";
  modal: number;
  item: { bahanId: string; qty: number; subtotal: number }[];
  nota: { nominal: number; metodeBayar: "tunai" | "utang"; supplier?: string }[];
}

const BELANJA_DEMO: BelanjaDemo[] = [
  {
    id: "demo-belanja-1",
    hari: 6,
    sumberDana: "kas_resto",
    modal: 400000,
    item: [
      { bahanId: "bahan-susu", qty: 12500, subtotal: 250000 },
      { bahanId: "bahan-es-batu", qty: 20000, subtotal: 40000 },
    ],
    nota: [
      { nominal: 250000, metodeBayar: "utang", supplier: "Toko Susu Segar" },
      { nominal: 40000, metodeBayar: "tunai" },
    ],
  },
  {
    id: "demo-belanja-2",
    hari: 4,
    sumberDana: "kas_resto",
    modal: 300000,
    item: [
      { bahanId: "bahan-telur", qty: 30, subtotal: 66000 },
      { bahanId: "bahan-roti", qty: 20, subtotal: 50000 },
      { bahanId: "bahan-mie", qty: 24, subtotal: 84000 },
    ],
    nota: [{ nominal: 200000, metodeBayar: "tunai" }],
  },
  {
    id: "demo-belanja-3",
    hari: 3,
    sumberDana: "saldo_finance",
    modal: 500000,
    item: [
      { bahanId: "bahan-kopi", qty: 1000, subtotal: 250000 },
      { bahanId: "bahan-cup", qty: 200, subtotal: 180000 },
    ],
    nota: [{ nominal: 430000, metodeBayar: "tunai" }],
  },
  {
    id: "demo-belanja-4",
    hari: 1,
    sumberDana: "kas_resto",
    modal: 200000,
    item: [
      { bahanId: "bahan-gula-aren", qty: 2000, subtotal: 80000 },
      { bahanId: "bahan-teh", qty: 500, subtotal: 75000 },
    ],
    nota: [{ nominal: 155000, metodeBayar: "utang", supplier: "CV Sumber Rasa" }],
  },
];

async function isiDataDummy(): Promise<void> {
  const ops: Operasi[] = [];
  const set = (ref: DocumentReference, data: Record<string, unknown>) => ops.push({ jenis: "set", ref, data });

  // --- Detail Perusahaan (kop laporan) ---
  set(refDemo("profil_cafe", "utama"), {
    nama: "Cafe Demo Archimax",
    bidangUsaha: "Coffee & Eatery (Data Percobaan)",
    alamat: "Jl. Contoh No. 1, Kota Demo",
    telepon: "0800-0000-0000",
    email: "demo@archimax.local",
    website: "",
    npwp: "",
    catatanKaki: "Dokumen ini berasal dari MODE DEMO — bukan data asli Outlet.",
    updatedAt: serverTimestamp(),
  });

  // --- Jadwal Shift ---
  KASIR_DEMO.forEach((k, i) => {
    set(refDemo("slot_shift", `default-shift-${i + 1}`), {
      nama: k.slot.nama,
      jamMulai: k.slot.jamMulai,
      jamSelesai: k.slot.jamSelesai,
      aktif: true,
      dibuatPada: serverTimestamp(),
    });
  });

  // --- Bahan Baku + cermin stok_kasir (tanpa harga) ---
  for (const b of BAHAN_DEMO) {
    set(refDemo("bahan_baku", b.id), {
      nama: b.nama,
      kategori: b.kategori,
      satuan: b.satuan,
      hargaSatuanTerakhir: b.harga,
      stokSaatIni: b.stok,
      batasMinimalStok: b.batas,
      aktif: true,
      updatedAt: serverTimestamp(),
    });
    set(refDemo("stok_kasir", b.id), {
      nama: b.nama,
      kategori: b.kategori,
      satuan: b.satuan,
      stokSaatIni: b.stok,
      batasMinimalStok: b.batas,
      aktif: true,
    });
  }

  // --- Produk (menu_harga untuk Kasir, menu + resep untuk Owner) ---
  for (const m of MENU_DEMO) {
    const hppBahan = m.resep.filter((r) => r.jenis === "bahan").reduce((t, r) => t + r.takaran * hargaBahan(r.bahanId), 0);
    const biayaKemasan = m.resep
      .filter((r) => r.jenis === "kemasan")
      .reduce((t, r) => t + r.takaran * hargaBahan(r.bahanId), 0);
    const breakdown = hitungHppBreakdown({ hppBahan, biayaKemasan }, DEFAULT_HPP);
    set(refDemo("menu_harga", m.id), {
      nama: m.nama,
      kategori: m.kategori,
      punyaVarian: false,
      hargaJual: m.hargaJual,
      aktif: true,
      updatedAt: serverTimestamp(),
    });
    set(refDemo("menu", m.id), {
      hppCache: breakdown.hppTotal,
      foodCostPersen: breakdown.hppTotal / m.hargaJual,
      hppBahanOtomatis: hppBahan,
      biayaKemasanOtomatis: biayaKemasan,
      overridePersenSusut: null,
      overridePersenUtilitas: null,
      overridePersenTenagaKerja: null,
      overridePersenOverheadLain: null,
      updatedAt: serverTimestamp(),
    });
    for (const r of m.resep) {
      set(refDemo("menu", m.id, "resep", r.bahanId), {
        bahanId: r.bahanId,
        bahanNama: namaBahan(r.bahanId),
        takaran: r.takaran,
        satuan: satuanBahan(r.bahanId),
        jenis: r.jenis,
      });
    }
  }

  // --- Shift 6 hari terakhir (2 shift/hari, semua sudah ditutup) ---
  const totalBelanjaPerTanggal = new Map<string, number>();
  for (let hari = JUMLAH_HARI_DEMO; hari >= 1; hari--) {
    const tanggal = tanggalMundur(hari);
    KASIR_DEMO.forEach((kasir, idxShift) => {
      const shiftId = `demo-shift-${tanggal}-${idxShift + 1}`;
      let omsetTunai = 0;
      let omsetNonTunai = 0;
      MENU_DEMO.forEach((m, idxMenu) => {
        const qty = qtyDemo(hari, idxMenu, idxShift);
        const qtyNonTunai = Math.floor(qty * 0.4);
        const qtyTunai = qty - qtyNonTunai;
        omsetTunai += qtyTunai * m.hargaJual;
        omsetNonTunai += qtyNonTunai * m.hargaJual;
        set(refDemo("shift", shiftId, "penjualan", m.id), {
          menuId: m.id,
          menuNama: m.nama,
          kategori: m.kategori,
          qtyTunai,
          qtyNonTunai,
          qty,
          subtotalTunai: qtyTunai * m.hargaJual,
          subtotalNonTunai: qtyNonTunai * m.hargaJual,
          qtyBonus: 0,
          qtyRefund: 0,
          qtyRefundNonTunai: 0,
          hargaJualSnapshot: m.hargaJual,
          subtotal: qty * m.hargaJual,
        });
      });

      const kasKeluar: { kategori: string; nominal: number; keterangan: string }[] = [];
      if ((hari + idxShift) % 2 === 0) {
        kasKeluar.push({ kategori: "Kebersihan", nominal: 15000, keterangan: "Beli sabun cuci piring" });
      }
      if (hari === 4 && idxShift === 1) {
        kasKeluar.push({ kategori: "Perlengkapan", nominal: 35000, keterangan: "Tisu & kantong plastik" });
      }
      kasKeluar.forEach((k, i) => {
        set(refDemo("shift", shiftId, "kas_keluar", `kk-${i + 1}`), {
          ...k,
          waktu: waktuMundur(hari, kasir.jamBuka + 2 + i),
        });
      });
      const totalKasKeluar = kasKeluar.reduce((t, k) => t + k.nominal, 0);

      // Dua contoh selisih kas: satu kurang (-> jadi Tanggungan Kasir),
      // satu lebih — supaya fitur Tanggungan & Cash Opname bisa dicoba.
      let selisihKas = 0;
      let keteranganSelisih = "";
      if (hari === 3 && idxShift === 1) {
        selisihKas = -20000;
        keteranganSelisih = "Uang kembalian kurang (contoh data demo)";
      } else if (hari === 5 && idxShift === 0) {
        selisihKas = 5000;
        keteranganSelisih = "Kelebihan dari pembulatan kembalian (contoh data demo)";
      }
      const kasSeharusnya = MODAL_KAS_AWAL + omsetTunai - totalKasKeluar;

      set(refDemo("shift", shiftId), {
        tanggal,
        kasirUid: kasir.uid,
        kasirNama: kasir.nama,
        modalKasAwal: MODAL_KAS_AWAL,
        totalOmset: omsetTunai + omsetNonTunai,
        omsetTunai,
        omsetNonTunai,
        totalKasKeluar,
        kasSeharusnya,
        kasFisik: kasSeharusnya + selisihKas,
        selisihKas,
        keteranganSelisih,
        status: "terkunci",
        waktuBuka: waktuMundur(hari, kasir.jamBuka),
        waktuTutup: waktuMundur(hari, kasir.jamTutup),
        slotNama: kasir.slot.nama,
        slotJamMulai: kasir.slot.jamMulai,
        slotJamSelesai: kasir.slot.jamSelesai,
      });

      if (selisihKas < 0) {
        set(refDemo("tanggungan_kasir", `demo-tanggungan-${shiftId}`), {
          shiftId,
          tanggal,
          kasirUid: kasir.uid,
          kasirNama: kasir.nama,
          nominal: Math.abs(selisihKas),
          keterangan: keteranganSelisih,
          status: "belum_lunas",
          waktu: waktuMundur(hari, kasir.jamTutup),
        });
      }
    });
  }

  // --- Belanja Purchasing + Nota + Hutang Supplier ---
  for (const b of BELANJA_DEMO) {
    const tanggal = tanggalMundur(b.hari);
    const totalBelanja = b.item.reduce((t, i) => t + i.subtotal, 0);
    const totalBelanjaUtang = b.nota.filter((n) => n.metodeBayar === "utang").reduce((t, n) => t + n.nominal, 0);
    totalBelanjaPerTanggal.set(tanggal, (totalBelanjaPerTanggal.get(tanggal) ?? 0) + totalBelanja);

    set(refDemo("kas_belanja", b.id), {
      tanggal,
      purchasingUid: PURCHASING_DEMO.uid,
      purchasingNama: PURCHASING_DEMO.nama,
      modalDiberikan: b.modal,
      sumberDana: b.sumberDana,
      totalBelanja,
      totalBelanjaUtang,
      sisaKas: b.modal - totalBelanja,
      status: "selesai",
    });
    b.item.forEach((i, idx) => {
      set(refDemo("kas_belanja", b.id, "item", `item-${idx + 1}`), {
        bahanId: i.bahanId,
        bahanNama: namaBahan(i.bahanId),
        qty: i.qty,
        satuan: satuanBahan(i.bahanId),
        hargaSatuan: i.subtotal / i.qty,
        subtotal: i.subtotal,
      });
    });
    b.nota.forEach((n, idx) => {
      set(refDemo("kas_belanja", b.id, "nota", `nota-${idx + 1}`), {
        cloudinaryUrl: GAMBAR_NOTA_DEMO,
        publicId: "",
        nominalTertera: n.nominal,
        metodeBayar: n.metodeBayar,
        diunggahPada: waktuMundur(b.hari, 10, idx * 5),
      });
      if (n.metodeBayar === "utang") {
        // Hutang dari belanja paling lama (6 hari lalu) dicontohkan
        // sudah LUNAS; yang terbaru masih BELUM LUNAS.
        const sudahLunas = b.hari >= 5;
        set(refDemo("hutang_supplier", `demo-hutang-${b.id}-${idx + 1}`), {
          tanggal,
          namaSupplier: n.supplier ?? "Supplier Demo",
          nominal: n.nominal,
          catatan: "",
          notaUrl: GAMBAR_NOTA_DEMO,
          kasBelanjaId: b.id,
          purchasingUid: PURCHASING_DEMO.uid,
          purchasingNama: PURCHASING_DEMO.nama,
          status: sudahLunas ? "lunas" : "belum_lunas",
          waktuDibuat: waktuMundur(b.hari, 10),
          ...(sudahLunas
            ? {
                dilunasiOlehUid: FINANCE_DEMO.uid,
                dilunasiOlehNama: FINANCE_DEMO.nama,
                waktuLunas: waktuMundur(b.hari - 2, 14),
              }
            : {}),
        });
      }
    });
  }

  // --- Form Banding Purchasing (satu yang masih menunggu ditinjau) ---
  set(refDemo("banding_purchasing", "demo-banding-1"), {
    tanggal: tanggalMundur(1),
    purchasingUid: PURCHASING_DEMO.uid,
    purchasingNama: PURCHASING_DEMO.nama,
    jenis: "revisi_nota",
    nominal: 5000,
    keterangan: "Nota gula aren salah tulis Rp5.000 lebih mahal dari harga sebenarnya (contoh data demo).",
    status: "menunggu",
    waktu: waktuMundur(1, 16),
  });

  // --- Deposito Finance ---
  const transaksi = [
    { hari: 6, jam: 9, arah: "masuk", kategori: "Tambah Dana", subKategori: "", nominal: 5000000, keterangan: "Setoran modal kerja dari Owner (demo)" },
    { hari: 5, jam: 11, arah: "keluar", kategori: "Biaya Operasional", subKategori: "Listrik", nominal: 350000, keterangan: "Token listrik bulan ini" },
    { hari: 2, jam: 17, arah: "keluar", kategori: "Gaji Karyawan", subKategori: "Andi", nominal: 1500000, keterangan: "Gaji mingguan" },
  ];
  transaksi.forEach((t, i) => {
    set(refDemo("transaksi_finance", `demo-transaksi-${i + 1}`), {
      arah: t.arah,
      kategori: t.kategori,
      subKategori: t.subKategori,
      nominal: t.nominal,
      keterangan: t.keterangan,
      financeUid: FINANCE_DEMO.uid,
      financeNama: FINANCE_DEMO.nama,
      tanggal: tanggalMundur(t.hari),
      waktu: waktuMundur(t.hari, t.jam),
    });
  });
  // Saldo = dana masuk − transaksi keluar − belanja bersumber Saldo
  // Finance − Hutang Supplier yang sudah dilunasi (dipotong dari saldo).
  const saldo =
    transaksi.reduce((t, x) => t + (x.arah === "masuk" ? x.nominal : -x.nominal), 0) -
    BELANJA_DEMO.filter((b) => b.sumberDana === "saldo_finance").reduce((t, b) => t + b.modal, 0) -
    BELANJA_DEMO.filter((b) => b.hari >= 5)
      .flatMap((b) => b.nota.filter((n) => n.metodeBayar === "utang"))
      .reduce((t, n) => t + n.nominal, 0);
  set(refDemo("saldo_finance", "utama"), { saldo });

  await jalankanOperasi(ops);

  // --- Ringkasan harian: dihitung dengan rumus YANG SAMA PERSIS
  // dengan Riwayat > Hitung Ulang (laba-harian.ts), bukan dikarang,
  // supaya Dashboard/Tren/Riwayat Demo konsisten satu sama lain. ---
  const daftarTanggal = Array.from({ length: JUMLAH_HARI_DEMO }, (_, i) => tanggalMundur(i + 1));
  const hasil = await Promise.all(daftarTanggal.map((t) => hitungLabaHarian(ID_OUTLET_DEMO, t)));
  await jalankanOperasi(
    hasil.map((h) => ({
      jenis: "set" as const,
      ref: refDemo("summary_harian", h.tanggal),
      data: {
        totalOmset: h.totalOmset,
        omsetTunai: h.omsetTunai,
        omsetNonTunai: h.omsetNonTunai,
        totalKasKeluar: h.totalKasKeluar,
        selisihKas: h.selisihKas,
        jumlahShift: h.jumlahShift,
        labaBersih: h.labaBersih,
        totalHpp: h.totalHppTerjual,
        totalBelanja: totalBelanjaPerTanggal.get(h.tanggal) ?? 0,
      },
    })),
  );
}

/** Hapus SELURUH isi Outlet Demo (kecuali dokumen status/meta). */
async function hapusSemuaDataDemo(): Promise<void> {
  const daftarKoleksi: [string, string[]][] = [
    ...Object.entries(STRUKTUR_KOLEKSI),
    ...KOLEKSI_TAMBAHAN_RESET.map((k) => [k, []] as [string, string[]]),
  ];
  const ops: Operasi[] = [];
  await Promise.all(
    daftarKoleksi.map(async ([nama, subKoleksi]) => {
      const snap = await getDocs(collection(db, "outlets", ID_OUTLET_DEMO, nama));
      await Promise.all(
        snap.docs.map(async (d) => {
          for (const sub of subKoleksi) {
            const subSnap = await getDocs(collection(d.ref, sub));
            subSnap.docs.forEach((s) => ops.push({ jenis: "hapus", ref: s.ref }));
          }
          ops.push({ jenis: "hapus", ref: d.ref });
        }),
      );
    }),
  );
  await jalankanOperasi(ops);
}

/**
 * Siapkan data dummy HANYA kalau Outlet Demo belum pernah disiapkan.
 * Pakai transaksi di dokumen status supaya dua akun yang masuk Mode
 * Demo bersamaan tidak mengisi data dobel — yang kalah cukup menunggu.
 */
export async function siapkanDataDemoBilaKosong(namaPengguna: string): Promise<"sudah_ada" | "disiapkan"> {
  const ref = refMetaDemo();
  const dapatGiliran = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return false;
    tx.set(ref, { status: "menyiapkan", olehNama: namaPengguna, mulaiPada: serverTimestamp() });
    return true;
  });
  if (!dapatGiliran) return "sudah_ada";
  try {
    await isiDataDummy();
    await setDoc(ref, { status: "siap", olehNama: namaPengguna, siapPada: serverTimestamp() });
  } catch (error) {
    // Gagal di tengah -> lepas "kunci" supaya bisa dicoba lagi.
    await deleteDoc(ref).catch(() => {});
    throw error;
  }
  return "disiapkan";
}

/** Reset: hapus semua data demo lalu isi ulang data dummy awal. */
export async function resetDataDemo(namaPengguna: string): Promise<void> {
  const ref = refMetaDemo();
  await setDoc(ref, { status: "menyiapkan", olehNama: namaPengguna, mulaiPada: serverTimestamp() });
  try {
    await hapusSemuaDataDemo();
    await isiDataDummy();
    await setDoc(ref, { status: "siap", olehNama: namaPengguna, siapPada: serverTimestamp() });
  } catch (error) {
    await deleteDoc(ref).catch(() => {});
    throw error;
  }
}
