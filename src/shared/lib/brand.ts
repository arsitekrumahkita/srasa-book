// ============================================================
// Identitas brand aplikasi — SATU sumber kebenaran.
//
// Sebelumnya nama brand ditulis ulang di 8 tempat berbeda (sidebar,
// kicker tiap halaman, halaman Login, Pilih Outlet, Kelola Outlet,
// metadata <head>, isi berkas backup, dan kop surat ekspor). Saat
// pemilik meminta ganti nama, satu saja yang terlewat berarti ada
// layar yang masih memakai nama lama tanpa ada yang sadar. Dipusatkan
// di sini (Rule of Two) supaya pergantian nama berikutnya cukup
// mengubah file ini.
//
// Riwayat nama: "SRASA BOOK" -> "ARCHIMAX" -> "Jurnal F A T A".
// Catatan: SRASA BOOK kini adalah nama OUTLET pertama, bukan lagi
// nama aplikasi (lihat komentar di src/shared/components/app-shell.tsx).
//
// TIDAK ADA "use client" di file ini dengan sengaja — nilainya juga
// dipakai dari src/app/layout.tsx yang berjalan di sisi server.
// ============================================================

/** Nama brand aplikasi apa adanya, termasuk spasi & kapitalisasinya —
 *  ditulis persis seperti yang diminta pemilik. Jangan dipaksa
 *  uppercase lewat CSS di tempat pemakaian, nanti bentuknya berubah. */
export const NAMA_BRAND = "Jurnal F A T A";

export const TAGLINE_BRAND = "Food n Beverages Lifestyle Accounting";

/** Huruf pertama brand untuk avatar/logo kotak kecil — diturunkan
 *  otomatis supaya tidak ikut basi saat namanya berganti lagi. */
export const INISIAL_BRAND = NAMA_BRAND.trim().charAt(0).toUpperCase();

/** Versi aman-untuk-nama-berkas (tanpa spasi), dipakai saat menamai
 *  file unduhan seperti backup JSON. */
export const SLUG_BRAND = "jurnal-fata";

/** Judul lengkap untuk <title> dan kop dokumen. */
export const JUDUL_LENGKAP_BRAND = `${NAMA_BRAND} — ${TAGLINE_BRAND}`;
