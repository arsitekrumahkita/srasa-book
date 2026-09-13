"use client";

// ============================================================
// Kerangka halaman terautentikasi: sidebar navigasi + konten.
// Dipakai di SEMUA halaman selain /login -> shared (Rule of Two
// terpenuhi berkali lipat, sama seperti RequireAuth).
//
// Menggantikan navbar horizontal lama (nav.tsx) dengan sidebar
// mengikuti referensi layout dashboard yang diberikan Owner/user:
// palet hijau emerald, kartu putih di atas latar bertona mint tipis.
//
// Responsif (webrules-hikimori poin 5 — viewport mobile WAJIB):
// - md ke atas: sidebar tetap di kiri, konten diberi padding kiri.
// - di bawah md: sidebar jadi drawer geser dari kiri, dibuka lewat
//   tombol hamburger di topbar tipis, ditutup lewat overlay gelap
//   atau otomatis saat sebuah link diklik.
//
// Top-level components, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import {
  Bell,
  History,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  RotateCcw,
  ShoppingBasket,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { auth } from "@/shared/lib/firebase";
import { useAuth, type PeranPengguna } from "@/shared/lib/auth-context";
import { useToast } from "@/shared/components/toast";
import { AutoLogout } from "@/shared/components/auto-logout";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  peran: PeranPengguna[];
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    // Dulu khusus Owner/Finance. Sekarang Kasir & Purchasing juga
    // dapat Dashboard mereka sendiri (rincian stok bahan baku) — lihat
    // komentar kepala src/app/dashboard/page.tsx untuk pembagian
    // tampilannya per peran.
    peran: ["superadmin", "finance", "kasir", "purchasing"],
  },
  { href: "/shift", label: "Shift", icon: Wallet, peran: ["kasir"] },
  {
    href: "/refund",
    label: "Refund",
    icon: RotateCcw,
    // Untuk transaksi dari shift yang SUDAH ditutup/hari lain — beda
    // dengan stepper Refund cepat di halaman Shift (khusus shift hari
    // ini yang masih berjalan). Lihat src/app/refund/page.tsx.
    peran: ["kasir"],
  },
  {
    href: "/belanja-nota",
    label: "Belanja & Nota",
    icon: ShoppingBasket,
    peran: ["purchasing"],
  },
  {
    href: "/kalkulator-hpp",
    label: "Kelola Produk",
    icon: Package,
    peran: ["superadmin", "finance"],
  },
  { href: "/riwayat", label: "Riwayat", icon: History, peran: ["superadmin", "finance"] },
  {
    href: "/transaksi-finance",
    label: "Transaksi Finance",
    icon: Landmark,
    // Owner (superadmin) TETAP bisa membuka & memantau halaman ini
    // (saldo & riwayat) — yang dibatasi hanya EKSEKUSI Uang Masuk/
    // Keluar-nya (khusus akun Finance), lihat firestore.rules bagian
    // saldo_finance/transaksi_finance & src/app/transaksi-finance/page.tsx.
    peran: ["superadmin", "finance"],
  },
  {
    href: "/kelola-akun",
    label: "Kelola Akun",
    icon: Users,
    peran: ["superadmin", "finance"],
  },
  {
    href: "/notifikasi",
    label: "Notifikasi",
    icon: Bell,
    peran: ["superadmin", "finance", "kasir", "purchasing"],
  },
  {
    href: "/profil",
    label: "Profil Akun",
    icon: UserRound,
    peran: ["superadmin", "finance", "kasir", "purchasing"],
  },
];

const LABEL_PERAN: Record<PeranPengguna, string> = {
  superadmin: "Owner",
  finance: "Finance",
  kasir: "Kasir",
  purchasing: "Purchasing",
};

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerTerbuka, setDrawerTerbuka] = useState(false);

  return (
    <div className="min-h-full flex-1 bg-[var(--color-app-bg)]">
      {/* --- Topbar mobile (hilang di md ke atas) --- */}
      <header className="aman-notch-atas sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <span className="text-sm font-bold text-emerald-700">SRASA BOOK</span>
        <button
          type="button"
          onClick={() => setDrawerTerbuka(true)}
          aria-label="Buka menu navigasi"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 motion-safe:transition active:scale-95 hover:bg-slate-100"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      {/* --- Overlay gelap saat drawer mobile terbuka --- */}
      {drawerTerbuka ? (
        <button
          type="button"
          aria-label="Tutup menu navigasi"
          onClick={() => setDrawerTerbuka(false)}
          className="fixed inset-0 z-40 bg-slate-900/40 md:hidden"
        />
      ) : null}

      <Sidebar drawerTerbuka={drawerTerbuka} onTutupDrawer={() => setDrawerTerbuka(false)} />

      <div className="flex min-h-full flex-1 flex-col md:pl-64">{children}</div>

      {/* Timer idle 60 menit — dipasang di sini supaya berlaku di SEMUA
          halaman terautentikasi sekaligus (setiap halaman memakai
          AppShell), bukan dipasang ulang satu per satu. */}
      <AutoLogout />
    </div>
  );
}

function Sidebar({
  drawerTerbuka,
  onTutupDrawer,
}: {
  drawerTerbuka: boolean;
  onTutupDrawer: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { profil } = useAuth();
  const { showToast } = useToast();

  const items = NAV_ITEMS.filter((item) => profil && item.peran.includes(profil.peran));
  const inisial = (profil?.nama ?? "?").trim().charAt(0).toUpperCase() || "?";

  async function handleLogout() {
    try {
      await signOut(auth);
      router.replace("/login");
    } catch {
      showToast("error", "Gagal keluar. Coba lagi.");
    }
  }

  return (
    <aside
      className={[
        "aman-notch-atas aman-notch-bawah aman-notch-kiri",
        "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white",
        "motion-safe:transition-transform motion-safe:duration-200",
        drawerTerbuka ? "translate-x-0" : "-translate-x-full",
        "md:translate-x-0",
      ].join(" ")}
      aria-label="Navigasi utama"
    >
      <div className="flex items-center justify-between px-5 py-5">
        <span className="text-base font-bold text-emerald-700">SRASA BOOK</span>
        <button
          type="button"
          onClick={onTutupDrawer}
          aria-label="Tutup menu navigasi"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 motion-safe:transition active:scale-95 hover:bg-slate-100 md:hidden"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {profil ? (
        <Link
          href="/profil"
          onClick={onTutupDrawer}
          aria-label="Buka Profil Akun"
          className="mx-4 mb-4 flex items-center gap-3 rounded-xl bg-emerald-50 px-3 py-2.5 motion-safe:transition active:scale-[0.98] hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
            {inisial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{profil.nama}</p>
            <p className="text-xs text-slate-500">{LABEL_PERAN[profil.peran]}</p>
          </div>
        </Link>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const aktif = pathname === item.href;
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onTutupDrawer}
                  aria-current={aktif ? "page" : undefined}
                  className={[
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                    "motion-safe:transition motion-safe:duration-150",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
                    aktif
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-800",
                  ].join(" ")}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-slate-100 p-3">
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 motion-safe:transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          Keluar
        </button>
      </div>
    </aside>
  );
}
