import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/shared/components/toast";
import { AuthProvider } from "@/shared/lib/auth-context";
import { OutletProvider } from "@/shared/lib/outlet-context";
import { JUDUL_LENGKAP_BRAND, NAMA_BRAND } from "@/shared/lib/brand";

// Sengaja memakai font sistem (bukan next/font/google) supaya build
// tidak bergantung pada koneksi ke Google Fonts sama sekali — lebih
// tahan untuk solo developer yang mungkin build di jaringan terbatas,
// dan menghindari satu titik kegagalan eksternal yang tidak perlu.

export const metadata: Metadata = {
  title: JUDUL_LENGKAP_BRAND,
  description:
    "Aplikasi accounting multi-outlet untuk bisnis Food & Beverages — omset, kas, dan HPP dalam satu layar, satu Owner terpusat untuk semua Outlet.",
  // Supaya kalau Owner/Kasir/Purchasing menambahkan aplikasi ini ke
  // Layar Utama HP-nya (umum untuk aplikasi internal seperti ini,
  // dipakai seperti app asli tanpa lewat browser), tampilannya
  // standalone (tanpa address bar) dengan status bar yang wajar —
  // bukan wajib, tapi kalau tidak diisi Safari memakai bawaan yang
  // kurang rapi.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: NAMA_BRAND,
  },
};

// Wajib untuk PWA/mobile-friendly (webrules-hikimori poin 5). Batas zoom
// SENGAJA tidak dikunci (tidak ada maximumScale/userScalable: false) —
// mengunci pinch-zoom melanggar WCAG (pengguna low-vision butuh zoom).
// viewportFit "cover" + CSS env(safe-area-inset-*) di globals.css supaya
// layout tidak ketiban notch/pill kamera di HP layar penuh (iPhone dsb).
//
// themeColor: warna bar status/tab browser di Android & saat di-Add to
// Home Screen ikut hijau brand, bukan putih/hitam bawaan browser.
// colorScheme "light": app ini SATU tema saja (belum ada mode gelap) —
// tanpa ini, HP yang mode gelap sistemnya aktif bisa membuat kontrol
// bawaan browser (mis. date/time picker bawaan iOS/Android) ikut
// bergaya gelap padahal seluruh halaman di sekitarnya tetap terang,
// jadinya belang dan kurang kebaca.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#047857",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <ToastProvider>
          <AuthProvider>
            <OutletProvider>{children}</OutletProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
