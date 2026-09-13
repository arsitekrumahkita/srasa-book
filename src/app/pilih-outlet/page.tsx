"use client";

// ============================================================
// Halaman: Pilih Outlet — Multi-Cabang dengan Owner & Finance terpusat
// (revisi permintaan pemilik cafe: "Finance juga terpusat login pilih
// outlet"). Owner DAN Finance satu akun untuk SEMUA Outlet, jadi setiap
// sesi (atau saat sengaja berpindah lewat pengalih di AppShell) memilih
// dulu Outlet mana yang sedang dikerjakan sebelum masuk Dashboard.
// Kasir/Purchasing TIDAK PERNAH melihat halaman ini — Outlet mereka
// tetap (profil.outletId), lihat require-auth.tsx & outlet-context.tsx.
//
// SENGAJA `lewatiGatingOutlet` di RequireAuth — halaman inilah yang
// MENYELESAIKAN gating itu, kalau ikut digating akan redirect
// berputar ke dirinya sendiri.
// ============================================================

import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutlet } from "@/shared/lib/outlet-context";

export default function PilihOutletPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]} lewatiGatingOutlet>
      <PilihOutletIsi />
    </RequireAuth>
  );
}

function PilihOutletIsi() {
  const router = useRouter();
  const { profil } = useAuth();
  const { daftarOutletAktif, memuat, pilihOutlet } = useOutlet();

  function pilih(id: string) {
    pilihOutlet(id);
    router.replace("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <header className="mb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          ARCHIMAX — Food n Beverages Lifestyle Accounting
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Pilih Outlet</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pilih Outlet yang ingin Anda kelola sekarang. Anda bisa berpindah
          Outlet kapan saja lewat menu di halaman berikutnya.
        </p>
      </header>

      {memuat ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Memuat daftar Outlet...
        </div>
      ) : daftarOutletAktif.length === 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-center shadow-sm">
          <p className="text-sm text-amber-900">
            {profil?.peran === "superadmin"
              ? "Belum ada Outlet aktif. Tambahkan Outlet pertama lewat halaman Kelola Outlet (buka /kelola-outlet langsung karena Dashboard sendiri butuh Outlet terpilih lebih dulu)."
              : "Belum ada Outlet aktif. Hubungi Owner untuk menambahkan Outlet pertama lewat halaman Kelola Outlet."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {daftarOutletAktif.map((outlet) => (
            <button
              key={outlet.id}
              type="button"
              onClick={() => pilih(outlet.id)}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm motion-safe:transition motion-safe:duration-150 hover:border-emerald-600 hover:bg-emerald-50 active:scale-[0.98]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Building2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-900">
                  {outlet.nama}
                </span>
                {outlet.alamat ? (
                  <span className="block truncate text-xs text-slate-500">{outlet.alamat}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
