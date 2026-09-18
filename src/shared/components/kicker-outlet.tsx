"use client";

// ============================================================
// Label kecil "Jurnal F A T A · Nama Outlet" di atas judul setiap
// halaman — dulu teks statis "SRASA BOOK" (nama aplikasi lama),
// sekarang SRASA BOOK adalah nama OUTLET pertama (Multi-Cabang,
// permintaan pemilik cafe), jadi label ini menampilkan brand aplikasi
// + Outlet yang sedang aktif supaya jelas data yang ditampilkan milik
// Outlet mana. Dipakai di HAMPIR SEMUA halaman -> shared (Rule of Two).
//
// Nama brandnya sendiri diambil dari src/shared/lib/brand.ts, dan
// class `uppercase` SENGAJA tidak dipakai di sini supaya kapitalisasi
// nama brand tampil persis seperti yang ditulis pemilik.
// ============================================================

import { useOutlet } from "@/shared/lib/outlet-context";
import { NAMA_BRAND } from "@/shared/lib/brand";

export function KickerOutlet({ akhiran }: { akhiran?: string }) {
  const { outletNama } = useOutlet();
  return (
    <p className="text-xs font-semibold tracking-wide text-emerald-700">
      {NAMA_BRAND}
      {outletNama ? ` · ${outletNama}` : ""}
      {akhiran ? ` — ${akhiran}` : ""}
    </p>
  );
}
