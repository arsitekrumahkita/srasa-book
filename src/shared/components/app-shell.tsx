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
  Calculator,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  ShoppingBasket,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { auth } from "@/shared/lib/firebase";
import { useAuth, type PeranPengguna } from "@/shared/lib/auth-context";
import { useToast } from "@/shared/components/toast";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  peran: PeranPengguna[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, peran: ["superadmin"] },
  { href: "/shift", label: "Shift", icon: Wallet, peran: ["superadmin", "kasir"] },
  {
    href: "/belanja-nota",
    label: "Belanja & Nota",
    icon: ShoppingBasket,
    peran: ["superadmin", "purchasing"],
  },
  {
    href: "/kalkulator-hpp",
    label: "Kalkulator HPP",
    icon: Calculator,
    peran: ["superadmin"],
  },
  { href: "/riwayat", label: "Riwayat", icon: History, peran: ["superadmin"] },
  { href: "/kelola-akun", label: "Kelola Akun", icon: Users, peran: ["superadmin"] },
  {
    href: "/notifikasi",
    label: "Notifikasi",
    icon: Bell,
    peran: ["superadmin", "kasir", "purchasing"],
  },
];

const LABEL_PERAN: Record<PeranPengguna, string> = {
  superadmin: "Owner",
  kasir: "Kasir",
  purchasing: "Purchasing",
};

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerTerbuka, setDrawerTerbuka] = useState(false);

  return (
    <div className="min-h-full flex-1 bg-[var(--color-app-bg)]">
      {/* --- Topbar mobile (hilang di md ke atas) --- */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <span className="text-sm font-bold text-emerald-700">SRASA BOOK</span>
        <button
          type="button"
          onClick={() => setDrawerTerbuka(true)}
          aria-label="Buka menu navigasi"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 motion-safe:transition hover:bg-slate-100"
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
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 motion-safe:transition hover:bg-slate-100 md:hidden"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {profil ? (
        <div className="mx-4 mb-4 flex items-center gap-3 rounded-xl bg-emerald-50 px-3 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
            {inisial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{profil.nama}</p>
            <p className="text-xs text-slate-500">{LABEL_PERAN[profil.peran]}</p>
          </div>
        </div>
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
