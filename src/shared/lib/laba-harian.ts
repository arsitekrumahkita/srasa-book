// ============================================================
// Kalkulasi HPP Terjual & Laba Bersih harian OTOMATIS dari data
// penjualan + Resep + harga bahan TERKINI — dipakai Dashboard
// (hari ini, dihitung ulang tiap kali dibuka) DAN Riwayat (Owner
// bisa hitung ulang untuk hari lampau secara manual) -> shared
// (Rule of Two).
//
// HANYA boleh dijalankan sisi Owner/Finance (superadmin) — fungsi
// ini membaca bahan_baku (harga) dan menu (breakdown biaya) yang
// memang privat dari Kasir/Purchasing (lihat firestore.rules).
// Kasir SAMA SEKALI tidak terlibat di sini; yang Kasir lakukan
// hanyalah mencatat qty terjual (shift/{id}/penjualan) dan
// mengurangi stok gudang lewat Resep (lihat src/shared/lib/resep.ts)
// — dua hal itu TIDAK PERNAH menyingkap harga ke Kasir. Kalkulasi
// Rupiah/laba baru terjadi DI SINI, sisi Owner.
//
// Caranya: ambil semua dokumen shift pada tanggal tsb (siapa pun
// Kasir-nya), jumlahkan qty terjual per menuId dari subkoleksi
// penjualan tiap shift, lalu untuk setiap menu yang terjual hitung
// HPP per porsi SAAT INI (bukan cache lama dari saat menu dibuat)
// dari Resep + harga bahan_baku TERKINI + breakdown persentase
// (susut/utilitas/tenaga kerja/overhead) yang tersimpan di
// menu/{menuId} — pakai fungsi murni yang sama dengan Kalkulator
// HPP (hitungHppBreakdown) supaya rumusnya konsisten satu sumber
// kebenaran, bukan diduplikasi.
//
// Asumsi bisnis (didokumentasikan di sini karena tidak eksplisit
// di PRD): Laba Bersih = Total Omset − HPP Terjual − Total Kas
// Keluar. Total Belanja (kas_belanja) SENGAJA TIDAK dikurangkan
// lagi di sini — itu sudah "menjadi" HPP Terjual begitu bahannya
// terpakai (lewat Resep), jadi mengurangkannya lagi akan menghitung
// dua kali (double counting).
// ============================================================

import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { hitungHppBreakdown, PROFIL_HPP_DEFAULT_AWAL } from "./hpp-calculator";
import type { ProfilHppDefault } from "@/shared/types/hpp";

export interface RincianLabaMenu {
  menuId: string;
  menuNama: string;
  qtyTerjual: number;
  hppPerPorsi: number;
  hppTotal: number;
}

export interface HasilLabaHarian {
  tanggal: string;
  totalOmset: number;
  totalKasKeluar: number;
  totalHppTerjual: number;
  labaBersih: number;
  jumlahShift: number;
  rincianPerMenu: RincianLabaMenu[];
}

const DEFAULTS_PROFIL_CAFE: ProfilHppDefault = {
  persenSusut: PROFIL_HPP_DEFAULT_AWAL.persenSusut / 100,
  persenUtilitas: PROFIL_HPP_DEFAULT_AWAL.persenUtilitas / 100,
  persenTenagaKerja: PROFIL_HPP_DEFAULT_AWAL.persenTenagaKerja / 100,
  persenOverheadLain: PROFIL_HPP_DEFAULT_AWAL.persenOverheadLain / 100,
  targetFoodCost: PROFIL_HPP_DEFAULT_AWAL.targetFoodCost / 100,
  metodeHargaDefault: "margin",
};

export async function hitungLabaHarian(tanggal: string): Promise<HasilLabaHarian> {
  const shiftSnap = await getDocs(query(collection(db, "shift"), where("tanggal", "==", tanggal)));

  let totalOmset = 0;
  let totalKasKeluar = 0;
  const qtyPerMenu = new Map<string, { nama: string; qty: number }>();

  for (const shiftDoc of shiftSnap.docs) {
    const data = shiftDoc.data();
    totalOmset += data.totalOmset ?? 0;
    totalKasKeluar += data.totalKasKeluar ?? 0;

    const penjualanSnap = await getDocs(collection(db, "shift", shiftDoc.id, "penjualan"));
    for (const item of penjualanSnap.docs) {
      const d = item.data();
      const menuId = d.menuId as string | undefined;
      const qty = d.qty ?? 0;
      if (!menuId || qty <= 0) continue;
      const existing = qtyPerMenu.get(menuId);
      qtyPerMenu.set(menuId, {
        nama: d.menuNama ?? existing?.nama ?? "",
        qty: (existing?.qty ?? 0) + qty,
      });
    }
  }

  // Cache harga bahan supaya satu bahan yang dipakai di banyak menu
  // tidak dibaca berkali-kali dari Firestore.
  const cacheHargaBahan = new Map<string, number>();
  async function ambilHargaBahan(bahanId: string): Promise<number> {
    const cached = cacheHargaBahan.get(bahanId);
    if (cached !== undefined) return cached;
    const snap = await getDoc(doc(db, "bahan_baku", bahanId));
    const harga = snap.exists() ? (snap.data().hargaSatuanTerakhir ?? 0) : 0;
    cacheHargaBahan.set(bahanId, harga);
    return harga;
  }

  let totalHppTerjual = 0;
  const rincianPerMenu: RincianLabaMenu[] = [];

  for (const [menuId, info] of qtyPerMenu.entries()) {
    const menuSnap = await getDoc(doc(db, "menu", menuId));
    const menuData = menuSnap.exists() ? menuSnap.data() : null;

    const resepSnap = await getDocs(collection(db, "menu", menuId, "resep"));
    let hppBahan = 0;
    for (const r of resepSnap.docs) {
      const rd = r.data();
      const takaran: number = rd.takaran ?? 0;
      const bahanId: string = rd.bahanId ?? r.id;
      if (takaran <= 0 || !bahanId) continue;
      hppBahan += takaran * (await ambilHargaBahan(bahanId));
    }

    const breakdown = hitungHppBreakdown(
      {
        hppBahan,
        biayaKemasan: menuData?.biayaKemasanManual ?? 0,
        overridePersenSusut: menuData?.overridePersenSusut ?? null,
        overridePersenUtilitas: menuData?.overridePersenUtilitas ?? null,
        overridePersenTenagaKerja: menuData?.overridePersenTenagaKerja ?? null,
        overridePersenOverheadLain: menuData?.overridePersenOverheadLain ?? null,
      },
      DEFAULTS_PROFIL_CAFE,
    );

    const hppTotalPorsi = breakdown.hppTotal;
    totalHppTerjual += hppTotalPorsi * info.qty;
    rincianPerMenu.push({
      menuId,
      menuNama: info.nama,
      qtyTerjual: info.qty,
      hppPerPorsi: hppTotalPorsi,
      hppTotal: Math.round(hppTotalPorsi * info.qty),
    });
  }

  totalHppTerjual = Math.round(totalHppTerjual);
  const labaBersih = totalOmset - totalHppTerjual - totalKasKeluar;

  return {
    tanggal,
    totalOmset,
    totalKasKeluar,
    totalHppTerjual,
    labaBersih,
    jumlahShift: shiftSnap.size,
    rincianPerMenu,
  };
}
