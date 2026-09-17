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
  Building2,
  CalendarClock,
  DatabaseBackup,
  FlaskConical,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Repeat,
  RotateCcw,
  ShoppingBasket,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { auth } from "@/shared/lib/firebase";
import { useAuth, type PeranPengguna } from "@/shared/lib/auth-context";
import { useOutlet } from "@/shared/lib/outlet-context";
import { useToast } from "@/shared/components/toast";
import { AutoLogout } from "@/shared/components/auto-logout";

/** Nama brand APLIKASI (global, lintas Outlet) — SRASA BOOK sekarang
 *  adalah nama Outlet PERTAMA, bukan lagi nama aplikasi (permintaan
 *  pemilik cafe: Multi-Cabang dengan satu Owner terpusat). Dipakai di
 *  header sidebar/topbar; nama Outlet aktif ditampilkan terpisah di
 *  bawahnya lewat useOutlet(). */
const NAMA_BRAND = "ARCHIMAX";
const TAGLINE_BRAND = "Food n Beverages Lifestyle Accounting";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  peran: PeranPengguna[];
  /** true HANYA untuk halaman lintas-Outlet khusus Owner murni (mis.
   *  Kelola Outlet) — mengecualikan "finance" walau finance ada di
   *  daftar peran superadmin+finance yang biasa. */
  khususOwnerMurni?: boolean;
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
    href: "/cash-opname",
    label: "Cash Opname",
    icon: Calculator,
    // Checkpoint rekap dana sebelum setor/oper ke Finance (permintaan
    // pemilik cafe) — gabungan semua shift + Purchasing + Saldo
    // Finance per tanggal. Owner & Finance saja, sama seperti Riwayat &
    // Transaksi Finance.
    peran: ["superadmin", "finance"],
  },
  {
    href: "/kelola-jadwal-shift",
    label: "Jadwal Shift",
    icon: CalendarClock,
    peran: ["superadmin", "finance"],
  },
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
    href: "/kelola-outlet",
    label: "Kelola Outlet",
    icon: Building2,
    // Lintas-Outlet (tambah/nonaktifkan Outlet) — khusus Owner murni,
    // BUKAN Finance. Ini keputusan STRUKTURAL (Outlet apa saja yang
    // ada), beda dari data operasional DI DALAM Outlet yang sudah
    // setara penuh untuk Finance sejak revisi "Finance juga terpusat".
    peran: ["superadmin"],
    khususOwnerMurni: true,
  },
  {
    href: "/data-dummy",
    label: "Data Dummy (Beta)",
    icon: FlaskConical,
    // Buat/hapus Outlet Demo berisi data contoh untuk ujicoba fitur
    // baru TANPA menyentuh data asli (permintaan pemilik cafe) — lihat
    // src/shared/lib/data-dummy.ts & src/app/data-dummy/page.tsx.
    // Khusus Owner murni: firestore.rules cuma mengizinkan isOwner()
    // menulis dokumen outlets/{outletId} itu sendiri.
    peran: ["superadmin"],
    khususOwnerMurni: true,
  },
  {
    href: "/backup-data",
    label: "Backup Data",
    icon: DatabaseBackup,
    // Owner & Finance (keduanya terpusat) bisa mengunduh backup JSON
    // — Semua Outlet sekaligus, atau satu Outlet saja. Lihat
    // src/app/backup-data/page.tsx & src/shared/lib/backup.ts.
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
  const { outletDemo } = useOutlet();

  return (
    <div className="min-h-full flex-1 bg-[var(--color-app-bg)]">
      {/* --- Topbar mobile (hilang di md ke atas) --- */}
      <header className="aman-notch-atas sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <BrandTopbarMobile />
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

      <div className="flex min-h-full flex-1 flex-col md:pl-64">
        {/* Pita MODE DATA DUMMY — muncul di SEMUA halaman selagi Outlet
            aktif adalah Outlet Demo/Beta (permintaan pemilik cafe: harus
            jelas kelihatan supaya tidak pernah keliru sama data asli).
            sticky supaya tetap kelihatan walau halamannya panjang &
            di-scroll. */}
        {outletDemo ? (
          <div
            role="status"
            className="sticky top-0 z-20 flex items-center justify-center gap-1.5 bg-amber-400 px-3 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-amber-950 md:top-0"
          >
            <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Mode Data Dummy (Beta) — bukan data asli, aman untuk ujicoba
          </div>
        ) : null}
        {children}
      </div>

      {/* Timer idle 60 menit — dipasang di sini supaya berlaku di SEMUA
          halaman terautentikasi sekaligus (setiap halaman memakai
          AppShell), bukan dipasang ulang satu per satu. */}
      <AutoLogout />
    </div>
  );
}

function BrandTopbarMobile() {
  const { outletNama, outletDemo } = useOutlet();
  return (
    <span className="min-w-0 leading-tight">
      <span className="block truncate text-sm font-bold text-emerald-700">{NAMA_BRAND}</span>
      {outletNama ? (
        <span className="block truncate text-[11px] text-slate-500">
          {outletNama}
          {outletDemo ? (
            <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-800">
              Demo
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
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
  const { outletNama, bisaGantiOutlet, gantiOutlet, outletDemo } = useOutlet();
  const { showToast } = useToast();

  const items = NAV_ITEMS.filter((item) => profil && item.peran.includes(profil.peran));
  const inisial = (profil?.nama ?? "?").trim().charAt(0).toUpperCase() || "?";

  function handleGantiOutlet() {
    gantiOutlet();
    onTutupDrawer();
    router.push("/pilih-outlet");
  }

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
        <span className="min-w-0 leading-tight">
          <span className="block text-base font-bold text-emerald-700">{NAMA_BRAND}</span>
          <span className="block text-[10px] uppercase tracking-wide text-slate-400">
            {TAGLINE_BRAND}
          </span>
        </span>
        <button
          type="button"
          onClick={onTutupDrawer}
          aria-label="Tutup menu navigasi"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 motion-safe:transition active:scale-95 hover:bg-slate-100 md:hidden"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {outletNama ? (
        <div
          className={[
            "mx-4 mb-4 flex items-center justify-between gap-2 rounded-xl px-3 py-2",
            outletDemo ? "border border-amber-300 bg-amber-50" : "bg-slate-50",
          ].join(" ")}
        >
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400">
              Outlet
              {outletDemo ? (
                <span className="rounded-full bg-amber-400 px-1.5 py-0.5 font-bold text-amber-950">Demo</span>
              ) : null}
            </span>
            <span className="block truncate text-sm font-semibold text-slate-800">{outletNama}</span>
          </span>
          {bisaGantiOutlet ? (
            <button
              type="button"
              onClick={handleGantiOutlet}
              aria-label="Ganti Outlet"
              title="Ganti Outlet"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-emerald-700 motion-safe:transition hover:bg-emerald-100"
            >
              <Repeat className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

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

      {/* overscroll-contain: scroll menu ini tidak "menyeret" body di
          belakangnya begitu mentok atas/bawah (pantulan iOS/Android) —
          penting karena drawer ini sendiri posisinya fixed di atas body. */}
      <nav className="flex-1 overflow-y-auto overscroll-contain px-3">
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
