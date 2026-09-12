"use client";

// ============================================================
// Halaman: Login (PRD bagian 9.7). Satu-satunya halaman publik —
// semua halaman lain dibungkus <RequireAuth>.
//
// Mendukung TIGA cara masuk, semuanya tetap terdeteksi oleh Firebase
// Auth yang SAMA lewat `onAuthStateChanged` di auth-context.tsx —
// tidak ada jalur "login" yang di luar Firebase Auth:
//   1. Email + kata sandi (bawaan Firebase Auth).
//   2. Username + kata sandi — Firebase Auth TIDAK PUNYA konsep
//      username, jadi ini "terjemahan" di sisi klien: baca dokumen
//      publik `usernames/{username}` (lihat firestore.rules) untuk
//      dapatkan email aslinya, baru panggil
//      signInWithEmailAndPassword dengan email hasil terjemahan itu.
//   3. Google Sign-In (signInWithPopup) — akun Google yang belum
//      terdaftar (belum ada dokumen users/{uid} dibuat Owner) akan
//      kena pesan "belum diaktifkan" yang sama seperti akun
//      email/password biasa (lihat blok di bawah `handleGoogle`),
//      SESUAI PRD 9.7: staff tidak bisa mendaftar sendiri.
//
// "Lupa Kata Sandi" memakai sendPasswordResetEmail — juga menerima
// input Email ATAU Username (diterjemahkan dulu jadi email).
// ============================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { KeyRound, LogIn, Loader2 } from "lucide-react";
import { auth, db } from "@/shared/lib/firebase";
import { useAuth } from "@/shared/lib/auth-context";
import { halamanBerandaPeran } from "@/shared/lib/role-home";
import { useToast } from "@/shared/components/toast";

/** Ikon Google resmi (multi-warna) — SATU-SATUNYA pengecualian dari
 *  aturan "tanpa ikon berwarna" (webrules-hikimori poin 3), karena ini
 *  identitas merek Google yang wajib ditampilkan apa adanya di tombol
 *  Sign-In, bukan ikon dekoratif bebas pilih warna. */
function IkonGoogle() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4c-7.4 0-13.8 4.1-17.1 10.1"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.4-2.1 14.2-5.6l-6.5-5.5C29.6 34.7 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.6 5.1C9.9 39.8 16.4 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C41.4 36.4 44 30.6 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}

/** Menerjemahkan input "Email atau Username" menjadi email asli.
 *  Kalau isinya sudah berbentuk email (mengandung "@"), dipakai apa
 *  adanya. Kalau tidak, dianggap username -> cari di koleksi publik
 *  `usernames/{username}` (lihat firestore.rules). */
async function terjemahkanKeEmail(pengenal: string): Promise<string> {
  const nilai = pengenal.trim();
  if (nilai.includes("@")) return nilai;

  const snap = await getDoc(doc(db, "usernames", nilai.toLowerCase()));
  if (!snap.exists()) {
    throw new Error("USERNAME_TIDAK_DITEMUKAN");
  }
  const email = snap.data().email as string | undefined;
  if (!email) throw new Error("USERNAME_TIDAK_DITEMUKAN");
  return email;
}

export default function LoginPage() {
  const router = useRouter();
  const { user, profil, loading } = useAuth();
  const { showToast } = useToast();

  const [pengenal, setPengenal] = useState(""); // Email ATAU Username
  const [password, setPassword] = useState("");
  const [sedangMasuk, setSedangMasuk] = useState(false);
  const [sedangGoogle, setSedangGoogle] = useState(false);
  const [sedangResetSandi, setSedangResetSandi] = useState(false);

  // Sudah login dan profil lengkap -> langsung lempar ke beranda
  // sesuai peran, jangan biarkan tersangkut di halaman login.
  useEffect(() => {
    if (!loading && user && profil?.aktif) {
      router.replace(halamanBerandaPeran(profil.peran));
    }
  }, [loading, user, profil, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!pengenal || !password) {
      showToast("error", "Email/Username dan kata sandi wajib diisi.");
      return;
    }

    setSedangMasuk(true);
    try {
      const email = await terjemahkanKeEmail(pengenal);
      await signInWithEmailAndPassword(auth, email, password);
      // Redirect ditangani oleh useEffect di atas begitu profil termuat.
    } catch (error) {
      showToast("error", pesanErrorLogin(error));
    } finally {
      setSedangMasuk(false);
    }
  }

  async function handleGoogle() {
    setSedangGoogle(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      // Kalau akun Google ini belum punya dokumen users/{uid} (staff
      // memang tidak bisa daftar sendiri, PRD 9.7), blok "profil
      // belum diaktifkan" di bawah yang akan menjelaskan ke pengguna
      // — bukan bug, ini pagar yang disengaja.
    } catch (error) {
      const kode = (error as { code?: string })?.code ?? "";
      if (kode !== "auth/popup-closed-by-user" && kode !== "auth/cancelled-popup-request") {
        showToast("error", "Gagal masuk dengan Google. Coba lagi.");
      }
    } finally {
      setSedangGoogle(false);
    }
  }

  async function handleLupaSandi() {
    if (!pengenal) {
      showToast("error", "Isi Email atau Username Anda dulu, baru tekan Lupa Kata Sandi.");
      return;
    }
    setSedangResetSandi(true);
    try {
      const email = await terjemahkanKeEmail(pengenal);
      await sendPasswordResetEmail(auth, email);
      showToast("success", `Link reset kata sandi sudah dikirim ke ${email}.`);
    } catch (error) {
      showToast("error", pesanErrorLogin(error));
    } finally {
      setSedangResetSandi(false);
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
            <label htmlFor="pengenal" className="block text-sm font-semibold text-slate-800">
              Email atau Username
            </label>
            <input
              id="pengenal"
              type="text"
              autoComplete="username"
              required
              value={pengenal}
              onChange={(event) => setPengenal(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-semibold text-slate-800">
                Kata Sandi
              </label>
              <button
                type="button"
                onClick={handleLupaSandi}
                disabled={sedangResetSandi}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 motion-safe:transition hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sedangResetSandi ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <KeyRound className="h-3 w-3" aria-hidden="true" />
                )}
                Lupa Kata Sandi?
              </button>
            </div>
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
              "mt-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm",
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

        <div className="my-5 flex items-center gap-3" role="separator" aria-label="atau">
          <span className="h-px flex-1 bg-slate-200" />
          <span className="text-xs font-medium text-slate-400">atau</span>
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={sedangGoogle}
          aria-busy={sedangGoogle}
          className={[
            "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm",
            "motion-safe:transition motion-safe:duration-150 hover:bg-slate-50",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
            sedangGoogle ? "cursor-not-allowed opacity-60" : "",
          ].join(" ")}
        >
          {sedangGoogle ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <IkonGoogle />
          )}
          {sedangGoogle ? "Menghubungkan..." : "Masuk dengan Google"}
        </button>

        <p className="mt-6 text-center text-xs text-slate-500">
          Akun dibuat oleh Owner lewat menu Kelola Akun — belum ada pendaftaran
          mandiri.
        </p>
      </div>
    </main>
  );
}

function pesanErrorLogin(error: unknown): string {
  if (error instanceof Error && error.message === "USERNAME_TIDAK_DITEMUKAN") {
    return "Username tidak ditemukan.";
  }
  const kode = (error as { code?: string })?.code ?? "";
  switch (kode) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email/Username atau kata sandi salah.";
    case "auth/too-many-requests":
      return "Terlalu banyak percobaan gagal. Coba lagi beberapa saat lagi.";
    case "auth/invalid-email":
      return "Format email tidak valid.";
    default:
      return "Gagal masuk. Periksa koneksi internet dan coba lagi.";
  }
}
