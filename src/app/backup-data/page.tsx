"use client";

// ============================================================
// Halaman: Backup Data (PRD 9.10) — Owner & Finance (keduanya
// terpusat). Mengunduh backup JSON lengkap langsung ke perangkat,
// dengan CAKUPAN pilihan pemilik cafe:
//   - "Semua Outlet"  — satu file JSON berisi seluruh Outlet.
//   - "Satu Outlet"   — satu file JSON untuk Outlet yang dipilih saja.
//
// Ini backup MANUAL (Spark Plan, tidak ada Cloud Functions untuk
// backup terjadwal otomatis) — dipicu tombol, hasilnya file .json
// yang bisa disimpan sendiri oleh Owner/Finance (Google Drive, email
// ke diri sendiri, dsb). Lihat src/shared/lib/backup.ts untuk logika
// pembacaan datanya.
//
// Top-level components, tidak bersarang.
// ============================================================

import { useState } from "react";
import { DatabaseBackup, Download, Loader2 } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { useToast } from "@/shared/components/toast";
import { useOutlet } from "@/shared/lib/outlet-context";
import {
  ambilBackupOutlet,
  ambilBackupSemuaOutlet,
  ambilDaftarSemuaOutlet,
  unduhJson,
} from "@/shared/lib/backup";

type CakupanBackup = "semua" | "satu";

export default function BackupDataPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]}>
      <AppShell>
        <BackupDataIsi />
      </AppShell>
    </RequireAuth>
  );
}

function tanggalHariIni(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function BackupDataIsi() {
  const { showToast } = useToast();
  const { outletId, daftarOutletAktif } = useOutlet();
  const [cakupan, setCakupan] = useState<CakupanBackup>("satu");
  const [outletDipilih, setOutletDipilih] = useState(outletId ?? "");
  const [sedangUnduh, setSedangUnduh] = useState(false);

  async function handleUnduh() {
    const targetOutlet = outletDipilih || outletId;
    if (cakupan === "satu" && !targetOutlet) {
      showToast("error", "Pilih Outlet dulu.");
      return;
    }

    setSedangUnduh(true);
    try {
      if (cakupan === "semua") {
        const daftar = await ambilDaftarSemuaOutlet();
        if (daftar.length === 0) {
          showToast("error", "Belum ada Outlet sama sekali — tidak ada yang bisa dicadangkan.");
          return;
        }
        const payload = {
          jenis: "backup-semua-outlet",
          aplikasi: "Archimax — Food n Beverages Lifestyle Accounting",
          dibuatPada: new Date().toISOString(),
          jumlahOutlet: daftar.length,
          outlets: await ambilBackupSemuaOutlet(daftar),
        };
        unduhJson(payload, `backup-archimax-semua-outlet-${tanggalHariIni()}.json`);
      } else {
        const namaOutlet = daftarOutletAktif.find((o) => o.id === targetOutlet)?.nama ?? targetOutlet;
        const payload = {
          jenis: "backup-satu-outlet",
          aplikasi: "Archimax — Food n Beverages Lifestyle Accounting",
          dibuatPada: new Date().toISOString(),
          outletId: targetOutlet,
          outletNama: namaOutlet,
          data: await ambilBackupOutlet(targetOutlet as string),
        };
        unduhJson(payload, `backup-archimax-${targetOutlet}-${tanggalHariIni()}.json`);
      }
      showToast("success", "Backup berhasil diunduh — simpan filenya di tempat yang aman.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal membuat backup: ${error.message}` : "Gagal membuat backup.",
      );
    } finally {
      setSedangUnduh(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center gap-2">
        <DatabaseBackup className="h-5 w-5 text-emerald-700" aria-hidden="true" />
        <div>
          <KickerOutlet />
          <h1 className="text-2xl font-bold text-slate-900">Backup Data</h1>
        </div>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">
          Unduh salinan data dalam format JSON langsung ke perangkat Anda —
          simpan sendiri di tempat yang aman (Google Drive, email ke diri
          sendiri, dsb). Ini bukan backup otomatis terjadwal, jadi lakukan
          secara berkala sesuai kebutuhan.
        </p>

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-slate-800">Cakupan Backup</legend>
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50">
              <input
                type="radio"
                name="cakupan-backup"
                value="satu"
                checked={cakupan === "satu"}
                onChange={() => setCakupan("satu")}
                className="h-4 w-4 accent-emerald-600"
              />
              Satu Outlet saja
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50">
              <input
                type="radio"
                name="cakupan-backup"
                value="semua"
                checked={cakupan === "semua"}
                onChange={() => setCakupan("semua")}
                className="h-4 w-4 accent-emerald-600"
              />
              Semua Outlet sekaligus
            </label>
          </div>
        </fieldset>

        {cakupan === "satu" ? (
          <div className="mt-4">
            <label htmlFor="outlet-backup" className="block text-sm font-semibold text-slate-800">
              Outlet
            </label>
            <select
              id="outlet-backup"
              value={outletDipilih}
              onChange={(event) => setOutletDipilih(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            >
              {daftarOutletAktif.length === 0 && <option value="">Belum ada Outlet aktif</option>}
              {daftarOutletAktif.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nama}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
            Mencakup SEMUA Outlet asli yang pernah dibuat (termasuk yang
            sedang dinonaktifkan) dalam satu file JSON, dikelompokkan per
            Outlet. Outlet Demo/Beta (Data Dummy) TIDAK ikut tercakup di
            sini — kalau ingin mencadangkannya juga, pilih cakupan
            &quot;Satu Outlet saja&quot; lalu pilih Outlet Demo/Beta secara
            khusus.
          </p>
        )}

        <button
          type="button"
          onClick={handleUnduh}
          disabled={sedangUnduh}
          aria-busy={sedangUnduh}
          className={[
            "mt-5 inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm",
            "motion-safe:transition motion-safe:duration-150",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
            sedangUnduh
              ? "cursor-not-allowed bg-emerald-400"
              : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
          ].join(" ")}
        >
          {sedangUnduh ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          {sedangUnduh ? "Menyiapkan Backup..." : "Unduh Backup (.json)"}
        </button>

        <p className="mt-3 text-xs text-slate-500">
          Untuk Outlet dengan data yang sangat banyak, proses ini bisa
          memakan waktu beberapa detik — jangan tutup halaman sampai
          unduhan dimulai.
        </p>
      </section>
    </main>
  );
}
