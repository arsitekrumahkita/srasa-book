"use client";

// ============================================================
// Data Dummy (Beta) — Outlet Demo yang TERPISAH PENUH dari Outlet
// asli, supaya Owner bisa ujicoba fitur baru tanpa risiko menyentuh
// data asli sama sekali (permintaan pemilik cafe). Semua tulisan di
// sini masuk ke SATU Outlet bertanda `demo: true` di dokumen
// outlets/{id} — mekanisme "switch" antara Data Dummy dan Data Aktual
// TIDAK perlu tombol baru: cukup pakai pengalih Outlet yang sudah ada
// di Sidebar (AppShell) / halaman Pilih Outlet, karena arsitektur
// aplikasi ini SEJAK AWAL sudah memisahkan data per-Outlet
// (outlets/{outletId}/...). Outlet Demo otomatis muncul di daftar itu
// begitu dibuat, ditandai badge "DEMO" + pita kuning di AppShell.
//
// Dijalankan langsung dari BROWSER Owner yang sedang login (bukan
// skrip admin terpisah) — proyek ini Firebase Spark Plan, TIDAK ADA
// Cloud Functions/Admin SDK, jadi satu-satunya cara menulis banyak
// dokumen sekaligus adalah writeBatch dari client, memakai izin
// firestore.rules Owner yang sudah ada (isOwner() bisa menulis
// dokumen outlets/{id} itu sendiri; isManagerOutlet() menulis semua
// subkoleksi di bawahnya tanpa perlu uid Kasir/Purchasing yang
// cocok).
//
// SEMUA kasirUid/purchasingUid di data dummy ini adalah STRING
// KARANGAN ("demo-kasir-pagi" dst) — BUKAN uid akun Firebase Auth
// sungguhan, karena Owner menulisnya lewat isManagerOutlet() yang
// tidak mewajibkan kecocokan uid. Ini cukup untuk ujicoba tampilan
// Owner/Finance (Dashboard, Riwayat, Cash Opname, Laporan, dst — semua
// baca lewat isManagerOutlet, akses penuh). TAPI untuk ujicoba layar
// Kasir/Purchasing itu SENDIRI (yang perlu login sungguhan & firestore
// rules mencocokkan request.auth.uid), buat akun staf baru lewat
// Kelola Akun dan pilih Outlet = Outlet Demo — begitu login, shift
// hari ini otomatis tersedia seperti biasa (lihat komentar
// auto-provisioning di src/app/shift/page.tsx).
//
// PENTING buat developer (permintaan eksplisit pemilik cafe: "Setiap
// ada permintaan fitur baru maka update juga data dummy nya"): setiap
// kali ada field/koleksi Firestore BARU ditambahkan ke aplikasi,
// tambahkan juga contohnya di seedDataDummy() di bawah supaya Outlet
// Demo selalu mewakili kondisi aplikasi TERKINI, bukan versi lama yang
// bisa bikin ujicoba fitur baru terasa "kosong"/tidak representatif.
// ============================================================

import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "./firebase";
// Nominal petty cash dipakai bersama halaman Shift & Cash Opname —
// diimpor dari sumber tunggal supaya data contoh tidak pernah memakai
// angka yang beda dari data asli.
import { MODAL_KAS_AWAL_HARIAN } from "./petty-cash";

export const NAMA_OUTLET_DEMO = "🧪 Demo / Beta (Data Dummy)";
const ALAMAT_OUTLET_DEMO = "Outlet contoh — hasil ujicoba TIDAK memengaruhi data asli manapun";

type SatuanBahan = "gram" | "pcs";

function tanggalOffset(offsetHari: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetHari);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Cari Outlet Demo yang sudah ada (kalau ada) — SATU per aplikasi
 *  (bukan per Owner), supaya semua Owner/Finance melihat Outlet Demo
 *  yang sama, bukan masing-masing bikin sendiri-sendiri. */
export async function cariOutletDemo(): Promise<{ id: string; nama: string } | null> {
  const snap = await getDocs(query(collection(db, "outlets"), where("demo", "==", true)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, nama: (d.data().nama as string) ?? NAMA_OUTLET_DEMO };
}

// ------------------------------------------------------------
// BAHAN, MENU & RESEP — dipakai untuk hitung HPP otomatis supaya
// konsisten dengan Kalkulator HPP asli, bukan angka karangan.
// ------------------------------------------------------------

interface BahanDummy {
  id: string;
  nama: string;
  kategori: string;
  satuan: SatuanBahan;
  hargaSatuanTerakhir: number;
  stokSaatIni: number;
  batasMinimalStok: number;
}

const BAHAN_BAKU_DUMMY: BahanDummy[] = [
  { id: "kopi-bubuk", nama: "Kopi Bubuk", kategori: "Bahan Baku", satuan: "gram", hargaSatuanTerakhir: 250, stokSaatIni: 5000, batasMinimalStok: 1000 },
  { id: "susu-uht", nama: "Susu UHT", kategori: "Bahan Baku", satuan: "gram", hargaSatuanTerakhir: 18, stokSaatIni: 12000, batasMinimalStok: 3000 },
  { id: "gula-cair", nama: "Gula Cair", kategori: "Bahan Baku", satuan: "gram", hargaSatuanTerakhir: 15, stokSaatIni: 6000, batasMinimalStok: 1500 },
  { id: "teh-celup", nama: "Teh Celup", kategori: "Bahan Baku", satuan: "pcs", hargaSatuanTerakhir: 500, stokSaatIni: 200, batasMinimalStok: 40 },
  { id: "es-batu", nama: "Es Batu", kategori: "Bahan Baku", satuan: "gram", hargaSatuanTerakhir: 3, stokSaatIni: 20000, batasMinimalStok: 5000 },
  // SENGAJA stoknya di bawah batas minimal — supaya kartu "Kondisi
  // Bahan Baku Sebelum Setor/Oper" di Cash Opname & peringatan stok
  // menipis punya contoh nyata untuk diujicoba, bukan selalu "aman".
  { id: "cup-16oz", nama: "Cup Plastik 16oz", kategori: "Kemasan", satuan: "pcs", hargaSatuanTerakhir: 700, stokSaatIni: 80, batasMinimalStok: 100 },
  { id: "sedotan", nama: "Sedotan", kategori: "Kemasan", satuan: "pcs", hargaSatuanTerakhir: 100, stokSaatIni: 300, batasMinimalStok: 100 },
];

interface BarisResepDummy {
  bahanId: string;
  takaran: number;
  jenis: "bahan" | "kemasan";
}

interface MenuDummy {
  id: string;
  nama: string;
  kategori: string;
  hargaJual: number;
  resep: BarisResepDummy[];
}

const MENU_DUMMY: MenuDummy[] = [
  {
    id: "kopi-susu",
    nama: "Kopi Susu",
    kategori: "Kopi",
    hargaJual: 18000,
    resep: [
      { bahanId: "kopi-bubuk", takaran: 18, jenis: "bahan" },
      { bahanId: "susu-uht", takaran: 120, jenis: "bahan" },
      { bahanId: "gula-cair", takaran: 15, jenis: "bahan" },
      { bahanId: "es-batu", takaran: 100, jenis: "bahan" },
      { bahanId: "cup-16oz", takaran: 1, jenis: "kemasan" },
      { bahanId: "sedotan", takaran: 1, jenis: "kemasan" },
    ],
  },
  {
    id: "es-teh-manis",
    nama: "Es Teh Manis",
    kategori: "Teh",
    hargaJual: 10000,
    resep: [
      { bahanId: "teh-celup", takaran: 1, jenis: "bahan" },
      { bahanId: "gula-cair", takaran: 20, jenis: "bahan" },
      { bahanId: "es-batu", takaran: 120, jenis: "bahan" },
      { bahanId: "cup-16oz", takaran: 1, jenis: "kemasan" },
      { bahanId: "sedotan", takaran: 1, jenis: "kemasan" },
    ],
  },
  {
    id: "americano",
    nama: "Americano",
    kategori: "Kopi",
    hargaJual: 15000,
    resep: [
      { bahanId: "kopi-bubuk", takaran: 20, jenis: "bahan" },
      { bahanId: "es-batu", takaran: 100, jenis: "bahan" },
      { bahanId: "cup-16oz", takaran: 1, jenis: "kemasan" },
      { bahanId: "sedotan", takaran: 1, jenis: "kemasan" },
    ],
  },
  {
    id: "cappuccino",
    nama: "Cappuccino",
    kategori: "Kopi",
    hargaJual: 20000,
    resep: [
      { bahanId: "kopi-bubuk", takaran: 18, jenis: "bahan" },
      { bahanId: "susu-uht", takaran: 150, jenis: "bahan" },
      { bahanId: "cup-16oz", takaran: 1, jenis: "kemasan" },
      { bahanId: "sedotan", takaran: 1, jenis: "kemasan" },
    ],
  },
];

function hargaBahan(bahanId: string): number {
  return BAHAN_BAKU_DUMMY.find((b) => b.id === bahanId)?.hargaSatuanTerakhir ?? 0;
}

function hitungHpp(menu: MenuDummy): { hppBahan: number; hppKemasan: number } {
  let hppBahan = 0;
  let hppKemasan = 0;
  for (const r of menu.resep) {
    const subtotal = r.takaran * hargaBahan(r.bahanId);
    if (r.jenis === "kemasan") hppKemasan += subtotal;
    else hppBahan += subtotal;
  }
  return { hppBahan, hppKemasan };
}

const SLOT_SHIFT_DUMMY = [
  { id: "pagi", nama: "Shift Pagi", jamMulai: "07:00", jamSelesai: "15:00" },
  { id: "sore", nama: "Shift Sore", jamMulai: "15:00", jamSelesai: "23:00" },
];


/** Satu baris penjualan sederhana (dipakai buat 2 hari x 2 shift). */
interface BarisPenjualanDummy {
  menuId: string;
  qtyTunai: number;
  qtyNonTunai: number;
  qtyBonus: number;
  qtyRefund: number;
}

interface ShiftDummy {
  slotId: "pagi" | "sore";
  kasirUid: string;
  kasirNama: string;
  penjualan: BarisPenjualanDummy[];
  kasKeluar: { kategori: string; nominal: number; keterangan: string }[];
  /** Kalau diisi, kasFisik dipaksa ke nilai ini (dipakai untuk contoh
   *  shift MINUS — supaya fitur Tanggungan Kasir & Form Ganti Rugi
   *  punya contoh nyata). Kalau kosong, kasFisik = kasSeharusnya
   *  (pas/balance). */
  paksaSelisih?: number;
}

function buatRencanaHari(hariKe: 0 | 1): ShiftDummy[] {
  // hariKe 0 = kemarin (H-1), 1 = hari ini (H0) — variasi kecil supaya
  // dua hari tidak identik persis.
  return [
    {
      slotId: "pagi",
      kasirUid: "demo-kasir-pagi",
      kasirNama: "Kasir Demo (Pagi)",
      penjualan: [
        { menuId: "kopi-susu", qtyTunai: 8, qtyNonTunai: 5, qtyBonus: 1, qtyRefund: 0 },
        { menuId: "es-teh-manis", qtyTunai: 6, qtyNonTunai: 2, qtyBonus: 0, qtyRefund: hariKe === 1 ? 1 : 0 },
        { menuId: "americano", qtyTunai: 3, qtyNonTunai: 4, qtyBonus: 0, qtyRefund: 0 },
      ],
      kasKeluar: [
        { kategori: "Wifi", nominal: 150000, keterangan: "Bayar wifi bulanan" },
        { kategori: "Kebersihan", nominal: 20000, keterangan: "Sabun cuci piring + lap" },
      ],
    },
    {
      slotId: "sore",
      kasirUid: "demo-kasir-sore",
      kasirNama: "Kasir Demo (Sore)",
      penjualan: [
        { menuId: "kopi-susu", qtyTunai: 10, qtyNonTunai: 6, qtyBonus: 0, qtyRefund: 0 },
        { menuId: "cappuccino", qtyTunai: 5, qtyNonTunai: 3, qtyBonus: 0, qtyRefund: 0 },
        { menuId: "es-teh-manis", qtyTunai: 4, qtyNonTunai: 1, qtyBonus: 0, qtyRefund: 0 },
      ],
      kasKeluar: [{ kategori: "Perlengkapan", nominal: 45000, keterangan: "Beli tisu & plastik" }],
      // Contoh shift MINUS (H0/hari ini saja) — supaya Tanggungan Kasir
      // & rekonsiliasi Cash Opname punya kasus "tidak balance" nyata
      // untuk diujicoba, bukan selalu sempurna.
      paksaSelisih: hariKe === 1 ? -25000 : undefined,
    },
  ];
}

function hargaJualMenu(menuId: string): number {
  return MENU_DUMMY.find((m) => m.id === menuId)?.hargaJual ?? 0;
}

// ------------------------------------------------------------
// SEED — menulis SEMUA data contoh ke SATU Outlet Demo.
// ------------------------------------------------------------

/** Batas aman jumlah operasi per writeBatch (limit Firestore 500) —
 *  dataset dummy ini jauh di bawahnya, tapi dipecah tetap dijaga rapi
 *  kalau daftarnya membesar di kemudian hari (lihat catatan developer
 *  di kepala berkas). */
const BATAS_BATCH = 400;

class KumpulanBatch {
  private batchAktif: ReturnType<typeof writeBatch>;
  private jumlah = 0;
  private semuaBatch: ReturnType<typeof writeBatch>[] = [];

  constructor() {
    this.batchAktif = writeBatch(db);
    this.semuaBatch.push(this.batchAktif);
  }

  private pastikanRuang() {
    if (this.jumlah >= BATAS_BATCH) {
      this.batchAktif = writeBatch(db);
      this.semuaBatch.push(this.batchAktif);
      this.jumlah = 0;
    }
  }

  set(ref: DocumentReference, data: Record<string, unknown>) {
    this.pastikanRuang();
    this.batchAktif.set(ref, data);
    this.jumlah += 1;
  }

  hapus(ref: DocumentReference) {
    this.pastikanRuang();
    this.batchAktif.delete(ref);
    this.jumlah += 1;
  }

  async commitSemua() {
    for (const b of this.semuaBatch) {
      await b.commit();
    }
  }
}

export interface HasilSeedDummy {
  outletId: string;
  jumlahDokumen: number;
}

/** Buat (kalau belum ada) atau ISI ULANG Outlet Demo dengan data
 *  contoh terbaru. Aman dipanggil berkali-kali — data lama Outlet
 *  Demo TIDAK dihapus dulu di sini (pakai hapusDataDummy() dulu kalau
 *  mau benar-benar bersih), jadi menjalankan ini dua kali akan
 *  menimpa dokumen dengan id sama (bahan_baku/menu/dst pakai id
 *  tetap) tapi BISA menyisakan data transaksi lama (shift/kas_belanja
 *  pakai id acak) — untuk reset total, hapus dulu lewat halaman Data
 *  Dummy. */
export async function seedDataDummy(): Promise<HasilSeedDummy> {
  let outletId: string;
  const existing = await cariOutletDemo();
  const kumpulan = new KumpulanBatch();

  if (existing) {
    outletId = existing.id;
  } else {
    const outletRef = doc(collection(db, "outlets"));
    outletId = outletRef.id;
    kumpulan.set(outletRef, {
      nama: NAMA_OUTLET_DEMO,
      alamat: ALAMAT_OUTLET_DEMO,
      aktif: true,
      demo: true,
      dibuatPada: serverTimestamp(),
    });
  }

  // --- Bahan Baku + mirror stok_kasir ---
  for (const b of BAHAN_BAKU_DUMMY) {
    const ref = doc(db, "outlets", outletId, "bahan_baku", b.id);
    kumpulan.set(ref, {
      nama: b.nama,
      kategori: b.kategori,
      satuan: b.satuan,
      hargaSatuanTerakhir: b.hargaSatuanTerakhir,
      stokSaatIni: b.stokSaatIni,
      batasMinimalStok: b.batasMinimalStok,
      aktif: true,
      updatedAt: serverTimestamp(),
    });
    const refMirror = doc(db, "outlets", outletId, "stok_kasir", b.id);
    kumpulan.set(refMirror, {
      nama: b.nama,
      kategori: b.kategori,
      satuan: b.satuan,
      stokSaatIni: b.stokSaatIni,
      batasMinimalStok: b.batasMinimalStok,
      aktif: true,
    });
  }

  // --- Slot Shift ---
  for (const s of SLOT_SHIFT_DUMMY) {
    const ref = doc(db, "outlets", outletId, "slot_shift", s.id);
    kumpulan.set(ref, {
      nama: s.nama,
      jamMulai: s.jamMulai,
      jamSelesai: s.jamSelesai,
      aktif: true,
      dibuatPada: serverTimestamp(),
    });
  }

  // --- Menu (menu_harga + menu/HPP) + Resep ---
  for (const m of MENU_DUMMY) {
    const { hppBahan, hppKemasan } = hitungHpp(m);
    const hppTotal = hppBahan + hppKemasan;
    const refHarga = doc(db, "outlets", outletId, "menu_harga", m.id);
    kumpulan.set(refHarga, {
      nama: m.nama,
      kategori: m.kategori,
      punyaVarian: false,
      hargaJual: m.hargaJual,
      aktif: true,
      updatedAt: serverTimestamp(),
    });
    const refHpp = doc(db, "outlets", outletId, "menu", m.id);
    kumpulan.set(refHpp, {
      hppCache: hppTotal,
      foodCostPersen: m.hargaJual > 0 ? Math.round((hppTotal / m.hargaJual) * 1000) / 10 : null,
      hppBahanOtomatis: hppBahan,
      biayaKemasanOtomatis: hppKemasan,
      overridePersenSusut: null,
      overridePersenUtilitas: null,
      overridePersenTenagaKerja: null,
      overridePersenOverheadLain: null,
      updatedAt: serverTimestamp(),
    });
    for (const r of m.resep) {
      const bahan = BAHAN_BAKU_DUMMY.find((b) => b.id === r.bahanId);
      const refResep = doc(db, "outlets", outletId, "menu", m.id, "resep", r.bahanId);
      kumpulan.set(refResep, {
        bahanId: r.bahanId,
        bahanNama: bahan?.nama ?? "",
        takaran: r.takaran,
        satuan: bahan?.satuan ?? "gram",
        jenis: r.jenis,
      });
    }
  }

  // --- Shift + Penjualan + Kas Keluar, 2 hari (kemarin & hari ini) ---
  let totalBelanjaKasRestoKemarin = 0;
  for (const hariKe of [0, 1] as const) {
    const tanggal = tanggalOffset(hariKe === 0 ? -1 : 0);
    const rencanaHari = buatRencanaHari(hariKe);
    let jumlahShiftHari = 0;
    let omsetTunaiHari = 0;
    let omsetNonTunaiHari = 0;
    let kasKeluarHari = 0;
    let selisihHari = 0;

    for (const rencana of rencanaHari) {
      const shiftRef = doc(collection(db, "outlets", outletId, "shift"));
      const slot = SLOT_SHIFT_DUMMY.find((s) => s.id === rencana.slotId)!;

      let omsetTunai = 0;
      let omsetNonTunai = 0;
      for (const p of rencana.penjualan) {
        const harga = hargaJualMenu(p.menuId);
        omsetTunai += p.qtyTunai * harga;
        omsetNonTunai += p.qtyNonTunai * harga;
      }
      const totalOmset = omsetTunai + omsetNonTunai;
      const totalKasKeluar = rencana.kasKeluar.reduce((t, k) => t + k.nominal, 0);
      const kasSeharusnya = MODAL_KAS_AWAL_HARIAN + omsetTunai - totalKasKeluar;
      const kasFisik = rencana.paksaSelisih !== undefined ? kasSeharusnya + rencana.paksaSelisih : kasSeharusnya;
      const selisihKas = kasFisik - kasSeharusnya;

      kumpulan.set(shiftRef, {
        tanggal,
        kasirUid: rencana.kasirUid,
        kasirNama: rencana.kasirNama,
        modalKasAwal: MODAL_KAS_AWAL_HARIAN,
        totalOmset,
        omsetTunai,
        omsetNonTunai,
        totalKasKeluar,
        kasSeharusnya,
        kasFisik,
        selisihKas,
        keteranganSelisih: selisihKas !== 0 ? "Contoh selisih dummy — uji Tanggungan Kasir" : "",
        status: "terkunci",
        slotNama: slot.nama,
        slotJamMulai: slot.jamMulai,
        slotJamSelesai: slot.jamSelesai,
        waktuBuka: serverTimestamp(),
        waktuTutup: serverTimestamp(),
      });

      for (const p of rencana.penjualan) {
        const menu = MENU_DUMMY.find((m) => m.id === p.menuId)!;
        const qty = p.qtyTunai + p.qtyNonTunai;
        const penjualanRef = doc(collection(db, "outlets", outletId, "shift", shiftRef.id, "penjualan"));
        kumpulan.set(penjualanRef, {
          menuId: menu.id,
          menuNama: menu.nama,
          kategori: menu.kategori,
          qtyTunai: p.qtyTunai,
          qtyNonTunai: p.qtyNonTunai,
          qty,
          subtotalTunai: p.qtyTunai * menu.hargaJual,
          subtotalNonTunai: p.qtyNonTunai * menu.hargaJual,
          qtyBonus: p.qtyBonus,
          qtyRefund: p.qtyRefund,
          qtyRefundNonTunai: 0,
          hargaJualSnapshot: menu.hargaJual,
          subtotal: qty * menu.hargaJual,
        });
      }

      for (const k of rencana.kasKeluar) {
        const kasKeluarRef = doc(collection(db, "outlets", outletId, "shift", shiftRef.id, "kas_keluar"));
        kumpulan.set(kasKeluarRef, {
          kategori: k.kategori,
          nominal: k.nominal,
          keterangan: k.keterangan,
          waktu: serverTimestamp(),
        });
      }

      if (selisihKas < 0) {
        const tanggunganRef = doc(collection(db, "outlets", outletId, "tanggungan_kasir"));
        kumpulan.set(tanggunganRef, {
          shiftId: shiftRef.id,
          tanggal,
          kasirUid: rencana.kasirUid,
          kasirNama: rencana.kasirNama,
          nominal: Math.abs(selisihKas),
          keterangan: "Contoh selisih dummy — uji Tanggungan Kasir",
          status: "belum_lunas",
          waktu: serverTimestamp(),
        });
      }

      jumlahShiftHari += 1;
      omsetTunaiHari += omsetTunai;
      omsetNonTunaiHari += omsetNonTunai;
      kasKeluarHari += totalKasKeluar;
      selisihHari += selisihKas;
    }

    const summaryRef = doc(db, "outlets", outletId, "summary_harian", tanggal);
    kumpulan.set(summaryRef, {
      totalOmset: omsetTunaiHari + omsetNonTunaiHari,
      omsetTunai: omsetTunaiHari,
      omsetNonTunai: omsetNonTunaiHari,
      totalKasKeluar: kasKeluarHari,
      selisihKas: selisihHari,
      jumlahShift: jumlahShiftHari,
    });

    if (hariKe === 0) {
      // Dipakai di bawah untuk contoh kas_belanja "kemarin" (sumber
      // Kas Resto) — dihitung terpisah dari loop shift supaya nilai
      // Kas Tunai Seharusnya Disetor di Cash Opname tetap masuk akal.
      totalBelanjaKasRestoKemarin = 350000;
    }
  }

  // --- Belanja Purchasing (kemarin): 2 sesi berantai (nomorShift 1 & 2)
  //     contoh fitur "Lanjutkan Shift" Purchasing ---
  {
    const tanggal = tanggalOffset(-1);
    const modalShift1 = 500000;
    const belanjaShift1 = 320000;
    const sisaShift1 = modalShift1 - belanjaShift1;
    const belanjaShift2 = totalBelanjaKasRestoKemarin - belanjaShift1; // total kemarin = 350.000

    const belanja1Ref = doc(collection(db, "outlets", outletId, "kas_belanja"));
    kumpulan.set(belanja1Ref, {
      tanggal,
      purchasingUid: "demo-purchasing",
      purchasingNama: "Purchasing Demo",
      modalDiberikan: modalShift1,
      sumberDana: "kas_resto",
      totalBelanja: belanjaShift1,
      sisaKas: sisaShift1,
      status: "selesai",
      nomorShift: 1,
    });
    const item1Ref = doc(collection(db, "outlets", outletId, "kas_belanja", belanja1Ref.id, "item"));
    kumpulan.set(item1Ref, {
      bahanNama: "Kopi Bubuk",
      qty: 1000,
      satuan: "gram",
      hargaSatuan: 250,
      subtotal: 250000,
    });
    const item1bRef = doc(collection(db, "outlets", outletId, "kas_belanja", belanja1Ref.id, "item"));
    kumpulan.set(item1bRef, {
      bahanNama: "Teh Celup",
      qty: 140,
      satuan: "pcs",
      hargaSatuan: 500,
      subtotal: 70000,
    });

    const belanja2Ref = doc(collection(db, "outlets", outletId, "kas_belanja"));
    kumpulan.set(belanja2Ref, {
      tanggal,
      purchasingUid: "demo-purchasing",
      purchasingNama: "Purchasing Demo",
      modalDiberikan: sisaShift1,
      sumberDana: "kas_resto",
      totalBelanja: belanjaShift2,
      sisaKas: sisaShift1 - belanjaShift2,
      status: "selesai",
      nomorShift: 2,
      lanjutanDariShift: 1,
    });
    const item2Ref = doc(collection(db, "outlets", outletId, "kas_belanja", belanja2Ref.id, "item"));
    kumpulan.set(item2Ref, {
      bahanNama: "Sedotan",
      qty: 300,
      satuan: "pcs",
      hargaSatuan: 100,
      subtotal: 30000,
    });
  }

  // --- Form Banding/Revisi Purchasing (contoh menunggu ditinjau) ---
  {
    const bandingRef = doc(collection(db, "outlets", outletId, "banding_purchasing"));
    kumpulan.set(bandingRef, {
      tanggal: tanggalOffset(-1),
      purchasingUid: "demo-purchasing",
      purchasingNama: "Purchasing Demo",
      jenis: "transaksi_belum_tercatat",
      nominal: 45000,
      keterangan: "Contoh dummy: beli gula cair dadakan, nota kelupaan difoto.",
      status: "menunggu",
    });
  }

  // --- Saldo Finance ---
  //
  // CATATAN PENTING: transaksi_finance SENGAJA TIDAK diisi di sini.
  // firestore.rules mewajibkan pembuat dokumen transaksi_finance
  // adalah akun Finance sungguhan (`isFinanceOutlet(outletId) &&
  // financeUid == request.auth.uid`) — Owner (yang menjalankan seed
  // ini) tidak lolos aturan itu. Karena SEMUA operasi dalam satu
  // writeBatch bersifat atomik (satu ditolak = semua batal), memaksa
  // menulis transaksi_finance di sini akan membuat SELURUH data dummy
  // gagal tersimpan, bukan cuma bagian ini. saldo_finance (dokumen
  // ringkasannya, BUKAN riwayatnya) tetap diisi seperti biasa karena
  // aturannya mengizinkan isOwner().
  {
    const saldoRef = doc(db, "outlets", outletId, "saldo_finance", "utama");
    kumpulan.set(saldoRef, { saldo: 2000000 });
  }

  await kumpulan.commitSemua();

  const jumlahDokumen =
    1 +
    BAHAN_BAKU_DUMMY.length * 2 +
    SLOT_SHIFT_DUMMY.length +
    MENU_DUMMY.reduce((t, m) => t + 2 + m.resep.length, 0) +
    4 /* shift */ +
    9 /* penjualan (3 per shift x ~ variasi) -- perkiraan tampilan saja */ +
    3 /* kas_keluar */ +
    2 /* kas_belanja */ +
    3 /* item kas_belanja */ +
    1 /* banding */ +
    1 /* saldo_finance */ +
    2 /* summary_harian */;

  return { outletId, jumlahDokumen };
}

// ------------------------------------------------------------
// HAPUS — bersihkan total Outlet Demo (dipakai tombol "Reset" /
// "Hapus" di halaman Data Dummy). Firestore Spark Plan tidak punya
// recursive delete otomatis, jadi tiap subkoleksi dibaca lalu dihapus
// dokumen per dokumen (dibatch).
// ------------------------------------------------------------

async function hapusSemuaDokumenKoleksi(
  kumpulan: KumpulanBatch,
  path: string[],
): Promise<void> {
  const snap = await getDocs(collection(db, ...path));
  for (const d of snap.docs) {
    kumpulan.hapus(doc(db, ...path, d.id));
  }
}

export async function hapusDataDummy(): Promise<void> {
  const existing = await cariOutletDemo();
  if (!existing) return;
  const outletId = existing.id;
  const kumpulan = new KumpulanBatch();

  // Shift + subkoleksinya (penjualan, kas_keluar) — perlu daftar shift
  // dulu untuk tahu subkoleksi mana saja yang ada.
  const shiftSnap = await getDocs(collection(db, "outlets", outletId, "shift"));
  for (const s of shiftSnap.docs) {
    await hapusSemuaDokumenKoleksi(kumpulan, ["outlets", outletId, "shift", s.id, "penjualan"]);
    await hapusSemuaDokumenKoleksi(kumpulan, ["outlets", outletId, "shift", s.id, "kas_keluar"]);
    kumpulan.hapus(doc(db, "outlets", outletId, "shift", s.id));
  }

  const belanjaSnap = await getDocs(collection(db, "outlets", outletId, "kas_belanja"));
  for (const b of belanjaSnap.docs) {
    await hapusSemuaDokumenKoleksi(kumpulan, ["outlets", outletId, "kas_belanja", b.id, "item"]);
    await hapusSemuaDokumenKoleksi(kumpulan, ["outlets", outletId, "kas_belanja", b.id, "nota"]);
    kumpulan.hapus(doc(db, "outlets", outletId, "kas_belanja", b.id));
  }

  const menuSnap = await getDocs(collection(db, "outlets", outletId, "menu"));
  for (const m of menuSnap.docs) {
    await hapusSemuaDokumenKoleksi(kumpulan, ["outlets", outletId, "menu", m.id, "resep"]);
    kumpulan.hapus(doc(db, "outlets", outletId, "menu", m.id));
  }

  const koleksiDatar = [
    "bahan_baku",
    "stok_kasir",
    "slot_shift",
    "menu_harga",
    "tanggungan_kasir",
    "banding_purchasing",
    "summary_harian",
    "notifikasi",
    "serah_terima_kas",
    // SENGAJA TIDAK termasuk "saldo_finance" & "transaksi_finance" di
    // sini — firestore.rules tidak punya `allow delete` sama sekali
    // untuk saldo_finance (default-deny), dan transaksi_finance hanya
    // bisa dihapus oleh akun Finance (isFinanceOutlet), bukan Owner.
    // Mencoba menghapusnya akan menggagalkan SELURUH batch (atomik).
    // Dokumen ini dibiarkan yatim kalau Outlet Demo dihapus — tidak
    // masalah, tidak lagi terjangkau lewat path manapun di aplikasi
    // begitu dokumen outlets/{id} induknya sudah tidak ada.
  ];
  for (const nama of koleksiDatar) {
    await hapusSemuaDokumenKoleksi(kumpulan, ["outlets", outletId, nama]);
  }

  kumpulan.hapus(doc(db, "outlets", outletId));

  await kumpulan.commitSemua();
}
