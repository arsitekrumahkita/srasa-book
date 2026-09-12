"use client";

// ============================================================
// Halaman index `/` — tidak punya UI sendiri, cuma pengalih ke
// /login (belum masuk) atau beranda sesuai peran (sudah masuk).
// ============================================================

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/shared/lib/auth-context";
import { halamanBerandaPeran } from "@/shared/lib/role-home";

export default function Home() {
  const router = useRouter();
  const { user, profil, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (profil?.aktif) {
      router.replace(halamanBerandaPeran(profil.peran));
    }
  }, [loading, user, profil, router]);

  return (
    <main className="flex min-h-full flex-1 items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      <span className="sr-only">Memuat...</span>
    </main>
  );
}
