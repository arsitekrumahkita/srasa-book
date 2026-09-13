import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/shared/components/toast";
import { AuthProvider } from "@/shared/lib/auth-context";
import { OutletProvider } from "@/shared/lib/outlet-context";

// Sengaja memakai font sistem (bukan next/font/google) supaya build
// tidak bergantung pada koneksi ke Google Fonts sama sekali — lebih
// tahan untuk solo developer yang mungkin build di jaringan terbatas,
// dan menghindari satu titik kegagalan eksternal yang tidak perlu.

export const metadata: Metadata = {
  title: "Archimax — Food n Beverages Lifestyle Accounting",
  description:
    "Aplikasi accounting multi-outlet untuk bisnis Food & Beverages — omset, kas, dan HPP dalam satu layar, satu Owner terpusat untuk semua Outlet.",
};

// Wajib untuk PWA/mobile-friendly (webrules-hikimori poin 5). Batas zoom
// SENGAJA tidak dikunci (tidak ada maximumScale/userScalable: false) —
// mengunci pinch-zoom melanggar WCAG (pengguna low-vision butuh zoom).
// viewportFit "cover" + CSS env(safe-area-inset-*) di globals.css supaya
// layout tidak ketiban notch/pill kamera di HP layar penuh (iPhone dsb).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
