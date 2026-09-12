// ============================================================
// Halaman "beranda" tiap peran setelah login. Dipakai oleh
// /login (redirect setelah sign-in) dan halaman index `/`
// (redirect ke beranda peran masing-masing) -> shared.
// ============================================================

import type { PeranPengguna } from "./auth-context";

export function halamanBerandaPeran(peran: PeranPengguna): string {
  switch (peran) {
    case "superadmin":
      return "/dashboard";
    case "kasir":
      return "/shift";
    case "purchasing":
      return "/belanja-nota";
    default:
      return "/login";
  }
}
