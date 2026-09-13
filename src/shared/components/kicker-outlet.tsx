"use client";

// ============================================================
// Label kecil "ARCHIMAX · Nama Outlet" di atas judul setiap halaman
// — dulu teks statis "SRASA BOOK" (nama aplikasi lama), sekarang
// SRASA BOOK adalah nama OUTLET pertama (Multi-Cabang, permintaan
// pemilik cafe), jadi label ini menampilkan brand aplikasi + Outlet
// yang sedang aktif supaya jelas data yang ditampilkan milik Outlet
// mana. Dipakai di HAMPIR SEMUA halaman -> shared (Rule of Two).
// ============================================================

import { useOutlet } from "@/shared/lib/outlet-context";

export function KickerOutlet({ akhiran }: { akhiran?: string }) {
  const { outletNama } = useOutlet();
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
      ARCHIMAX{outletNama ? ` · ${outletNama}` : ""}
      {akhiran ? ` — ${akhiran}` : ""}
    </p>
  );
}
