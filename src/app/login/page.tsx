"use client";

// ============================================================
// Halaman: Login (PRD bagian 9.7). Satu-satunya halaman publik —
// semua halaman lain dibungkus <RequireAuth>.
// ============================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { LogIn, Loader2 } from "lucide-react";
import { auth } from "@/shared/lib/firebase";
import { useAuth } from "@/shared/lib/auth-context";
import { halamanBerandaPeran } from "@/shared/lib/role-home";
import { useToast } from "@/shared/components/toast";

export default function LoginPage() {
  const router = useRouter();
  const { user, profil, loading } = useAuth();
  const { showToast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sedangMasuk, setSedangMasuk] = useState(false);

  // Sudah login dan profil lengkap -> langsung lempar ke beranda
  // sesuai peran, jangan biarkan tersangkut di halaman login.
  useEffect(() => {
    if (!loading && user && profil?.aktif) {
      router.replace(halamanBerandaPeran(profil.peran));
    }
  }, [loading, user, profil, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email || !password) {
      showToast("error", "Email dan kata sandi wajib diisi.");
      return;
    }

    setSedangMasuk(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Redirect ditangani oleh useEffect di atas begitu profil termuat.
    } catch (error) {
      showToast("error", pesanErrorLogin(error));
    } finally {
      setSedangMasuk(false);
    }
  }

  async function handleKeluarDariAkunTanpaProfil() {
    await signOut(auth);
  }

  // Login berhasil (user ada) tapi dokumen users/{uid} belum diatur
  // Owner -> jangan diam saja, jelaskan dan beri jalan keluar.
  if (!loading && user && (!profil || !profil.aktif)) {
    return (
      <main className="mx-auto flex min-h-full max-w-sm flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <p className="text-sm text-slate-700">
          Akun Anda berhasil masuk, tapi profil pengguna belum diaktifkan Owner
          di SRASA BOOK. Hubungi Owner untuk mengaktifkan akses Anda.
        </p>
        <button
          type="button"
          onClick={handleKeluarDariAkunTanpaProfil}
          className="mt-4 text-sm font-semibold text-emerald-700 underline underline-offset-2"
        >
          Coba akun lain
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-700 to-emerald-500 text-lg font-bold text-white shadow-sm">
            S
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            SRASA BOOK
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Masuk Aplikasi</h1>
        </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="email" className="block text-sm font-semibold text-slate-800">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-semibold text-slate-800"
          >
            Kata Sandi
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>

        <button
          type="submit"
          disabled={sedangMasuk}
          aria-busy={sedangMasuk}
          className={[
            "mt-2 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm",
            "motion-safe:transition motion-safe:duration-150",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
            sedangMasuk
              ? "cursor-not-allowed bg-emerald-400"
              : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
          ].join(" ")}
        >
          {sedangMasuk ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogIn className="h-4 w-4" aria-hidden="true" />
          )}
          {sedangMasuk ? "Memeriksa..." : "Masuk"}
        </button>
      </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Akun dibuat oleh Owner lewat menu Kelola Akun — belum ada pendaftaran
          mandiri.
        </p>
      </div>
    </main>
  );
}

function pesanErrorLogin(error: unknown): string {
  const kode = (error as { code?: string })?.code ?? "";
  switch (kode) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email atau kata sandi salah.";
    case "auth/too-many-requests":
      return "Terlalu banyak percobaan gagal. Coba lagi beberapa saat lagi.";
    case "auth/invalid-email":
      return "Format email tidak valid.";
    default:
      return "Gagal masuk. Periksa koneksi internet dan coba lagi.";
  }
}
