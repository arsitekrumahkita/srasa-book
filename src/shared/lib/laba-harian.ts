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
  /** Total unit yang SUNGGUH DIBUAT (qty reguler + Bonus/Gratis +
   *  Refund) — bukan cuma yang dibayar penuh, karena bahan bakunya
   *  sama-sama terpakai. Lihat catatan di hitungLabaHarian(). */
  qtyTerjual: number;
  hppPerPorsi: number;
  hppTotal: number;
}

export interface HasilLabaHarian {
  tanggal: string;
  totalOmset: number;
  /** Omset Tunai/Non-Tunai sekarang dihitung OTOMATIS dari metode bayar
   *  yang Kasir pilih per item saat input penjualan (subtotalTunai/
   *  subtotalNonTunai di shift/{id}/penjualan) — bukan lagi tebakan
   *  manual Kasir di akhir shift. Shift dari SEBELUM fitur ini ada tetap
   *  memakai field manual lama sebagai fallback (lihat hitungLabaHarian).
   *  Selisih Kas hanya terisi untuk shift yang sudah ditutup. Dipakai
   *  untuk membangun ulang summary_harian dari sumber aslinya bila
   *  ringkasan hari itu meleset — lihat Riwayat > Hitung Ulang. */
  omsetTunai: number;
  omsetNonTunai: number;
  selisihKas: number;
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

export async function hitungLabaHarian(outletId: string, tanggal: string): Promise<HasilLabaHarian> {
  const shiftSnap = await getDocs(
    query(collection(db, "outlets", outletId, "shift"), where("tanggal", "==", tanggal)),
  );

  let totalOmset = 0;
  let totalKasKeluar = 0;
  let omsetNonTunai = 0;
  let selisihKas = 0;
  const qtyPerMenu = new Map<string, { nama: string; qty: number }>();

  // Nota Refund lintas hari/shift terkunci (src/app/refund/page.tsx) —
  // BUKAN qtyRefund cepat di shift/{id}/penjualan yang sudah otomatis
  // tercermin lewat `subtotal` di atas. Dua metode dibedakan sengaja:
  // - "tunai" TIDAK dijumlahkan di sini sama sekali — sudah tercatat
  //   sebagai Kas Keluar di shift kasir pada tanggal REFUND terjadi
  //   (lihat komentar kepala halaman Refund), yang otomatis ikut
  //   mengurangi Laba Bersih lewat totalKasKeluar tepat di bawah ini.
  //   Kalau nota_refund tunai IKUT dijumlahkan lagi ke totalOmset di
  //   sini, biayanya akan terhitung dua kali.
  // - "non_tunai" TIDAK ada uang fisik yang keluar dari laci, jadi
  //   satu-satunya jejaknya adalah di sini: mengurangi Omset pada
  //   tanggal REFUND (bukan mengedit ulang laporan tanggal transaksi
  //   asli yang sudah final).
  const refundNonTunaiSnap = await getDocs(
    query(
      collection(db, "outlets", outletId, "nota_refund"),
      where("tanggalRefund", "==", tanggal),
      where("metode", "==", "non_tunai"),
    ),
  );
  let totalRefundNonTunai = 0;
  for (const r of refundNonTunaiSnap.docs) {
    totalRefundNonTunai += r.data().totalRefund ?? 0;
  }

  for (const shiftDoc of shiftSnap.docs) {
    const data = shiftDoc.data();
    totalKasKeluar += data.totalKasKeluar ?? 0;
    selisihKas += data.selisihKas ?? 0;

    // Omset dihitung dari subkoleksi penjualan, BUKAN dari field
    // shift.totalOmset. Alasannya: field itu baru terisi saat Kasir
    // menutup shift, sedangkan HPP Terjual di bawah selalu dihitung dari
    // subkoleksi penjualan yang terisi sepanjang hari. Kalau sumbernya
    // beda, sepanjang hari berjalan Dashboard menampilkan omset 0 tapi
    // HPP penuh — Laba Bersih jadi minus besar dan bikin panik padahal
    // datanya baik-baik saja. Dengan satu sumber yang sama, angkanya
    // konsisten kapan pun dibuka, dan hasilnya tetap identik setelah
    // shift ditutup.
    const penjualanSnap = await getDocs(
      collection(db, "outlets", outletId, "shift", shiftDoc.id, "penjualan"),
    );

    // Rincian metode bayar (Tunai/QRIS-Non-Tunai) SEKARANG dicatat per
    // ITEM sejak Kasir memilih metode bayar saat input penjualan (lihat
    // src/app/shift/page.tsx, subtotalTunai/subtotalNonTunai) — jauh
    // lebih akurat daripada field manual `omsetNonTunai` lama yang dulu
    // diisi Kasir sebagai TOTAL tebakan di akhir shift.
    let omsetNonTunaiShiftIni = 0;
    let adaRincianMetodeBayar = false;

    for (const item of penjualanSnap.docs) {
      const d = item.data();
      const menuId = d.menuId as string | undefined;
      // `subtotal` SUDAH benar hanya mencerminkan qty REGULER (lihat
      // src/app/shift/page.tsx) — Bonus/Gratis selalu subtotal 0, dan
      // Refund sudah dikurangkan dari subtotal saat direkam. Jadi Omset
      // di sini otomatis TIDAK PERNAH memasukkan nilai Bonus/Refund,
      // tanpa perlu logika tambahan.
      totalOmset += d.subtotal ?? 0;

      if (d.subtotalTunai !== undefined || d.subtotalNonTunai !== undefined) {
        adaRincianMetodeBayar = true;
        omsetNonTunaiShiftIni += d.subtotalNonTunai ?? 0;
      }

      // TAPI bahan baku yang benar-benar terpakai (dan karenanya HARUS
      // ikut dihitung sebagai HPP Terjual / biaya) mencakup SEMUA unit
      // yang sungguh dibuat: qty reguler + Bonus/Gratis + Refund (yang
      // terakhir ini bahannya TIDAK dikembalikan ke gudang saat
      // direfund — lihat ubahQtyRefund). Kalau hanya `qty` reguler yang
      // dihitung di sini, biaya bahan Bonus/Refund akan "menghilang"
      // dari pembukuan padahal stoknya sungguh berkurang — itulah
      // sebabnya totalnya dijumlahkan dari ketiga field ini.
      const qtyTotalDibuat = (d.qty ?? 0) + (d.qtyBonus ?? 0) + (d.qtyRefund ?? 0);
      if (!menuId || qtyTotalDibuat <= 0) continue;
      const existing = qtyPerMenu.get(menuId);
      qtyPerMenu.set(menuId, {
        nama: d.menuNama ?? existing?.nama ?? "",
        qty: (existing?.qty ?? 0) + qtyTotalDibuat,
      });
    }

    // Shift LAMA dari sebelum fitur pemisahan metode bayar per-item ada
    // TIDAK PUNYA subtotalTunai/subtotalNonTunai sama sekali di setiap
    // dokumen penjualannya — supaya laporan hari-hari lama itu tidak
    // tiba-tiba menunjukkan Rp0 di kedua bucket, jatuhkan kembali ke
    // field manual `omsetNonTunai` lama KHUSUS untuk shift itu saja.
    omsetNonTunai += adaRincianMetodeBayar ? omsetNonTunaiShiftIni : (data.omsetNonTunai ?? 0);
  }

  // Cache harga bahan supaya satu bahan yang dipakai di banyak menu
  // tidak dibaca berkali-kali dari Firestore.
  const cacheHargaBahan = new Map<string, number>();
  async function ambilHargaBahan(bahanId: string): Promise<number> {
    const cached = cacheHargaBahan.get(bahanId);
    if (cached !== undefined) return cached;
    const snap = await getDoc(doc(db, "outlets", outletId, "bahan_baku", bahanId));
    const harga = snap.exists() ? (snap.data().hargaSatuanTerakhir ?? 0) : 0;
    cacheHargaBahan.set(bahanId, harga);
    return harga;
  }

  let totalHppTerjual = 0;
  const rincianPerMenu: RincianLabaMenu[] = [];

  for (const [menuId, info] of qtyPerMenu.entries()) {
    const menuSnap = await getDoc(doc(db, "outlets", outletId, "menu", menuId));
    const menuData = menuSnap.exists() ? menuSnap.data() : null;

    // Resep dan Packaging Cost disimpan di SUBKOLEKSI YANG SAMA
    // (menu/{menuId}/resep) — dibedakan lewat field `jenis` per baris
    // ("bahan" default, atau "kemasan"). Keduanya dijumlahkan terpisah
    // di sini dari harga bahan_baku TERKINI, BUKAN dari cache
    // `biayaKemasanManual`/`hppBahanOtomatis` di dokumen menu — cache
    // itu cuma untuk ditampilkan di Kalkulator HPP saat menu terakhir
    // diedit, sedangkan di sini kita mau angka yang selalu mutakhir
    // (harga bahan & kemasan bisa berubah kapan pun Purchasing belanja
    // lagi, tanpa Owner perlu membuka-tutup Kalkulator HPP lagi).
    const resepSnap = await getDocs(collection(db, "outlets", outletId, "menu", menuId, "resep"));
    let hppBahan = 0;
    let biayaKemasan = 0;
    for (const r of resepSnap.docs) {
      const rd = r.data();
      const takaran: number = rd.takaran ?? 0;
      const bahanId: string = rd.bahanId ?? r.id;
      if (takaran <= 0 || !bahanId) continue;
      const biaya = takaran * (await ambilHargaBahan(bahanId));
      if (rd.jenis === "kemasan") biayaKemasan += biaya;
      else hppBahan += biaya;
    }

    const breakdown = hitungHppBreakdown(
      {
        hppBahan,
        biayaKemasan,
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

  // Refund non-tunai mengurangi Omset PADA TANGGAL REFUND ini — dan
  // karena tidak menyentuh kas fisik, ikut dikurangkan dari bucket
  // non-tunai juga (bukan bucket tunai), supaya omsetTunai turunan di
  // bawah tidak ikut salah terpotong.
  totalOmset = Math.max(totalOmset - totalRefundNonTunai, 0);
  omsetNonTunai = Math.max(omsetNonTunai - totalRefundNonTunai, 0);

  const labaBersih = totalOmset - totalHppTerjual - totalKasKeluar;

  return {
    tanggal,
    totalOmset,
    omsetTunai: Math.max(totalOmset - omsetNonTunai, 0),
    omsetNonTunai,
    selisihKas,
    totalKasKeluar,
    totalHppTerjual,
    labaBersih,
    jumlahShift: shiftSnap.size,
    rincianPerMenu,
  };
}
