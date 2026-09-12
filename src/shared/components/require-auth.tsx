"use client";

// ============================================================
// Pembungkus proteksi halaman berdasarkan status login + peran.
// Dipakai di SEMUA halaman selain /login -> shared (Rule of Two
// terpenuhi berkali-kali lipat).
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth, type PeranPengguna } from "@/shared/lib/auth-context";

export function RequireAuth({
  children,
  peranDiizinkan,
}: {
  children: ReactNode;
  /** Kosongkan untuk mengizinkan semua peran aktif (asal sudah login). */
  peranDiizinkan?: PeranPengguna[];
}) {
  const { user, profil, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

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
