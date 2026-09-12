import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/shared/components/toast";
import { AuthProvider } from "@/shared/lib/auth-context";

// Sengaja memakai font sistem (bukan next/font/google) supaya build
// tidak bergantung pada koneksi ke Google Fonts sama sekali — lebih
// tahan untuk solo developer yang mungkin build di jaringan terbatas,
// dan menghindari satu titik kegagalan eksternal yang tidak perlu.

export const metadata: Metadata = {
  title: "SRASA BOOK",
  description:
    "Aplikasi accounting pendamping Majoo POS — omset, kas, dan HPP dalam satu layar.",
};

// Wajib untuk PWA/mobile-friendly (webrules-hikimori poin 5).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
