"use client";

// ============================================================
// Komponen Mode Riil / Mode Demo (permintaan pemilik cafe: "Tampilkan
// toggle slide Ganti Mode di atas Profil").
//
// - ToggleModeAplikasi  : saklar geser di sidebar (di atas kartu
//   Profil) + status & tombol Reset Data Demo.
// - BannerModeDemo      : pita peringatan di atas konten setiap
//   halaman selama Mode Demo aktif, supaya tidak ada yang mengira
//   sedang mengisi data asli.
// - PesanHalamanDiblokirDemo : pengganti isi halaman yang mengelola
//   data GLOBAL asli (Kelola Akun, Kelola Outlet, Backup) — halaman
//   itu tidak berada di bawah outlets/{outletId}, jadi TIDAK ikut
//   terpisah ke Outlet Demo dan sengaja dinonaktifkan di Mode Demo.
//
// Logika data demo (isi dummy, reset) ada di src/shared/lib/mode-demo.ts.
// Top-level components, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { FlaskConical, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutlet, type ModeAplikasi } from "@/shared/lib/outlet-context";
import { useToast } from "@/shared/components/toast";
import {
  refMetaDemo,
  resetDataDemo,
  siapkanDataDemoBilaKosong,
  type StatusDataDemo,
} from "@/shared/lib/mode-demo";

function pesanGalat(error: unknown): string {
  return error instanceof Error ? error.message : "Terjadi kesalahan.";
}

export function ToggleModeAplikasi() {
  const { profil } = useAuth();
  const { mode, gantiMode } = useOutlet();
  const { showToast } = useToast();
  const [statusDemo, setStatusDemo] = useState<StatusDataDemo | null>(null);
  const [sedangProses, setSedangProses] = useState<"siapkan" | "reset" | null>(null);
  const [konfirmasiReset, setKonfirmasiReset] = useState(false);
  const demo = mode === "demo";

  // Pantau status data demo (kosong / sedang disiapkan / siap) — hanya
  // selama Mode Demo aktif, supaya Mode Riil tidak membaca apa pun dari
  // Outlet Demo.
  useEffect(() => {
    if (!demo) return;
    const unsub = onSnapshot(
      refMetaDemo(),
      (snap) => {
        const status = snap.exists() ? (snap.data().status as StatusDataDemo) : "kosong";
        setStatusDemo(status === "siap" || status === "menyiapkan" ? status : "kosong");
      },
      () => setStatusDemo("kosong"),
    );
    return unsub;
  }, [demo]);

  async function siapkan() {
    if (!profil) return;
    setSedangProses("siapkan");
    try {
      const hasil = await siapkanDataDemoBilaKosong(profil.nama);
      if (hasil === "disiapkan") {
        showToast("success", "Data demo siap — silakan dicoba bebas, data asli Outlet tidak tersentuh.");
      }
    } catch (error) {
      showToast("error", `Gagal menyiapkan data demo: ${pesanGalat(error)}`);
    } finally {
      setSedangProses(null);
    }
  }

  function pilih(modeBaru: ModeAplikasi) {
    if (modeBaru === mode) return;
    gantiMode(modeBaru);
    setKonfirmasiReset(false);
    if (modeBaru === "demo") {
      showToast("warning", "Mode Demo aktif — semua yang Anda isi sekarang hanya data percobaan.");
      void siapkan();
    } else {
      showToast("success", "Kembali ke Mode Riil — sekarang bekerja dengan data asli Outlet.");
    }
  }

  async function reset() {
    if (!profil) return;
    setKonfirmasiReset(false);
    setSedangProses("reset");
    try {
      await resetDataDemo(profil.nama);
      showToast("success", "Data demo berhasil di-reset ke kondisi awal.");
    } catch (error) {
      showToast("error", `Gagal me-reset data demo: ${pesanGalat(error)}`);
    } finally {
      setSedangProses(null);
    }
  }

  const statusTampil = sedangProses ? "menyiapkan" : statusDemo;

  return (
    <div
      className={[
        "mx-4 mb-3 rounded-xl border px-3 py-2.5 motion-safe:transition-colors motion-safe:duration-300",
        demo ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white",
      ].join(" ")}
    >
      <p id="label-ganti-mode" className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Ganti Mode
      </p>
      <div
        role="radiogroup"
        aria-labelledby="label-ganti-mode"
        className="relative grid grid-cols-2 rounded-full bg-slate-100 p-1"
      >
        {/* Latar geser — bergeser ke kanan saat Mode Demo. */}
        <span
          aria-hidden="true"
          className={[
            "absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full shadow-sm",
            "motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out",
            demo ? "translate-x-full bg-amber-500" : "translate-x-0 bg-emerald-600",
          ].join(" ")}
        />
        <TombolMode label="Mode Riil" aktif={!demo} onPilih={() => pilih("riil")} Ikon={ShieldCheck} />
        <TombolMode label="Mode Demo" aktif={demo} onPilih={() => pilih("demo")} Ikon={FlaskConical} />
      </div>

      {demo ? (
        <div className="mt-2 text-[11px] leading-snug text-amber-900">
          {statusTampil === "menyiapkan" ? (
            <p className="flex items-center gap-1.5" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {sedangProses === "reset" ? "Me-reset data demo..." : "Menyiapkan data demo..."}
            </p>
          ) : statusTampil === "kosong" ? (
            <button
              type="button"
              onClick={() => void siapkan()}
              className="font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-950"
            >
              Data demo belum ada — siapkan sekarang
            </button>
          ) : konfirmasiReset ? (
            <div className="flex flex-col gap-1.5">
              <p>Semua isi Mode Demo akan dihapus & diisi ulang data awal. Lanjutkan?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void reset()}
                  className="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-amber-600 px-2 text-xs font-semibold text-white motion-safe:transition active:scale-[0.98] hover:bg-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  Ya, Reset
                </button>
                <button
                  type="button"
                  onClick={() => setKonfirmasiReset(false)}
                  className="inline-flex h-8 flex-1 items-center justify-center rounded-lg border border-amber-300 bg-white px-2 text-xs font-semibold text-amber-900 motion-safe:transition active:scale-[0.98] hover:bg-amber-100"
                >
                  Batal
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span>Data percobaan — bebas diubah.</span>
              <button
                type="button"
                onClick={() => setKonfirmasiReset(true)}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-amber-800 motion-safe:transition active:scale-95 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reset
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TombolMode({
  label,
  aktif,
  onPilih,
  Ikon,
}: {
  label: string;
  aktif: boolean;
  onPilih: () => void;
  Ikon: typeof ShieldCheck;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={aktif}
      onClick={onPilih}
      className={[
        "relative z-10 inline-flex h-9 items-center justify-center gap-1.5 rounded-full text-xs font-semibold",
        "motion-safe:transition-colors motion-safe:duration-300 active:scale-[0.97]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
        aktif ? "text-white" : "text-slate-600 hover:text-slate-900",
      ].join(" ")}
    >
      <Ikon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

export function BannerModeDemo() {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        <strong className="font-semibold">MODE DEMO</strong> — Anda sedang memakai data percobaan. Data asli Outlet
        tidak ikut berubah.
      </span>
    </div>
  );
}

export function PesanHalamanDiblokirDemo() {
  const { gantiMode } = useOutlet();
  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <FlaskConical className="h-8 w-8 text-amber-600" aria-hidden="true" />
      <p className="text-sm text-slate-700">
        Halaman ini mengelola data <strong>asli</strong> (akun staff, daftar Outlet, atau backup), sehingga
        dinonaktifkan selama Mode Demo supaya tidak ada data asli yang terubah tanpa sengaja.
      </p>
      <button
        type="button"
        onClick={() => gantiMode("riil")}
        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm motion-safe:transition active:scale-[0.98] hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
      >
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        Pindah ke Mode Riil
      </button>
    </main>
  );
}
