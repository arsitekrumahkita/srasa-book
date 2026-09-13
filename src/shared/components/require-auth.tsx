"use client";

// ============================================================
// Pembungkus proteksi halaman berdasarkan status login + peran +
// Outlet (Multi-Cabang, permintaan pemilik cafe). Dipakai di SEMUA
// halaman selain /login -> shared (Rule of Two terpenuhi berkali-
// kali lipat).
//
// Gating Outlet: Owner (superadmin) DAN Finance — KEDUANYA "terpusat",
// satu akun untuk SEMUA Outlet (revisi pemilik cafe: "Finance juga
// terpusat login pilih outlet") — jadi setiap halaman selain
// /pilih-outlet & /kelola-outlet WAJIB menunggu akun terpusat memilih
// Outlet dulu (redirect ke /pilih-outlet kalau belum). Kasir/Purchasing
// SAJA yang outletnya tetap (profil.outletId), jadi TIDAK PERNAH
// melihat redirect ini — resolusinya instan begitu profil termuat
// (lihat outlet-context.tsx).
//
// `hanyaOwnerMurni` (dipakai /kelola-outlet & /kelola-akun untuk aksi
// lintas-outlet tertentu) mengecualikan peran "finance" walau
// biasanya finance setara Owner di dalam SATU Outlet — Kelola Outlet
// itu sendiri adalah struktur DI ATAS Outlet manapun, jadi murni hak
// Owner.
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth, type PeranPengguna } from "@/shared/lib/auth-context";
import { useOutlet } from "@/shared/lib/outlet-context";

export function RequireAuth({
  children,
  peranDiizinkan,
  hanyaOwnerMurni = false,
  lewatiGatingOutlet = false,
}: {
  children: ReactNode;
  /** Kosongkan untuk mengizinkan semua peran aktif (asal sudah login). */
  peranDiizinkan?: PeranPengguna[];
  /** true HANYA untuk halaman yang eksplisit khusus Owner (superadmin)
   *  murni, mengecualikan "finance" walau finance biasanya setara Owner
   *  di dalam satu Outlet (dipakai /kelola-outlet). */
  hanyaOwnerMurni?: boolean;
  /** true HANYA untuk /pilih-outlet sendiri — supaya tidak terjadi
   *  redirect berputar (halaman itulah yang menyelesaikan gating ini). */
  lewatiGatingOutlet?: boolean;
}) {
  const { user, profil, loading } = useAuth();
  const { outletId, memuat: memuatOutlet } = useOutlet();
  const router = useRouter();

  // "Terpusat" = Owner ATAU Finance — keduanya satu akun untuk semua
  // Outlet, jadi keduanya melalui layar /pilih-outlet (lihat komentar
  // kepala berkas & outlet-context.tsx).
  const terpusat = profil?.peran === "superadmin" || profil?.peran === "finance";

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (lewatiGatingOutlet) return;
    if (loading || !user || !profil?.aktif) return;
    if (terpusat && !memuatOutlet && !outletId) {
      router.replace("/pilih-outlet");
    }
  }, [lewatiGatingOutlet, loading, user, profil, terpusat, memuatOutlet, outletId, router]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        <span className="sr-only">Memuat...</span>
      </div>
    );
  }

  if (!user) {
    // Sedang redirect ke /login (efek di atas) — tampilkan kosong
    // sebentar daripada flash konten yang seharusnya dilindungi.
    return null;
  }

  if (!profil || !profil.aktif) {
    return (
      <PesanAksesDitolak pesan="Akun Anda belum diaktifkan atau profil belum diatur oleh Owner. Hubungi Owner untuk mengaktifkan akun." />
    );
  }

  if (peranDiizinkan && !peranDiizinkan.includes(profil.peran)) {
    return (
      <PesanAksesDitolak pesan="Anda tidak memiliki akses ke halaman ini." />
    );
  }

  if (hanyaOwnerMurni && profil.peran !== "superadmin") {
    return (
      <PesanAksesDitolak pesan="Halaman ini khusus Owner (mengatur seluruh Outlet)." />
    );
  }

  if (!lewatiGatingOutlet) {
    // Akun terpusat (Owner/Finance) belum memilih Outlet -> sedang
    // redirect (efek di atas), ATAU status Outlet masih dimuat ->
    // tampilkan spinner, bukan konten yang butuh outletId, supaya
    // halaman tidak sempat query dengan outletId null.
    if (terpusat && (memuatOutlet || !outletId)) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
          <span className="sr-only">Memuat Outlet...</span>
        </div>
      );
    }
    // Kasir/Purchasing tapi outletId belum ada di profilnya sama
    // sekali (data lama sebelum fitur Multi-Cabang, atau kesalahan
    // input Owner) — jangan biarkan lanjut ke halaman yang akan query
    // dengan outletId kosong.
    if (!terpusat && !outletId) {
      return (
        <PesanAksesDitolak pesan="Akun ini belum ditautkan ke Outlet mana pun. Hubungi Owner untuk mengatur Outlet akun Anda." />
      );
    }
  }

  return <>{children}</>;
}

function PesanAksesDitolak({ pesan }: { pesan: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <ShieldAlert className="h-8 w-8 text-amber-600" aria-hidden="true" />
      <p className="text-sm text-slate-700">{pesan}</p>
    </div>
  );
}
