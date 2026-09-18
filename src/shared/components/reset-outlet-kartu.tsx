"use client";

// ============================================================
// "Zona Berbahaya" di halaman Backup Data — tombol merah kecil untuk
// MENGOSONGKAN data satu Outlet, atas permintaan pemilik cafe.
//
// KHUSUS OWNER. Finance boleh membuka halaman Backup (mengunduh
// salinan), tapi TIDAK boleh menghapus isi Outlet — menghapus data
// perusahaan adalah keputusan pemilik, bukan operasional harian.
// Pemanggil yang memutuskan merender kartu ini atau tidak; di
// firestore.rules penegakan sungguhannya ada pada izin `delete` yang
// sebagian memang hanya diberikan ke isOwner().
//
// TIGA PENGAMAN SEBELUM EKSEKUSI, karena aksi ini tidak bisa
// dibatalkan dan tidak ada tombol "undo":
//   1. Panelnya tertutup secara bawaan — tombolnya kecil dan harus
//      dibuka dulu, tidak mungkin tersenggol.
//   2. Rincian dampak ditampilkan apa adanya (apa yang hilang DAN apa
//      yang aman), jadi tidak ada kejutan sesudahnya.
//   3. Nama Outlet harus diketik ulang persis — tombol eksekusi tetap
//      mati sampai cocok.
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { useToast } from "@/shared/components/toast";
import { useOutlet } from "@/shared/lib/outlet-context";
import {
  resetDataOutlet,
  ringkasanDampakReset,
  type CakupanReset,
  type ProgresReset,
} from "@/shared/lib/reset-outlet";

export function ResetOutletKartu() {
  const { showToast } = useToast();
  const { outletId, daftarOutletAktif } = useOutlet();
  const [terbuka, setTerbuka] = useState(false);
  const [target, setTarget] = useState(outletId ?? "");
  const [cakupan, setCakupan] = useState<CakupanReset>("transaksi");
  const [konfirmasiNama, setKonfirmasiNama] = useState("");
  const [sedangReset, setSedangReset] = useState(false);
  const [progres, setProgres] = useState<ProgresReset | null>(null);

  const outletTarget = daftarOutletAktif.find((o) => o.id === target);
  const namaTarget = outletTarget?.nama ?? "";
  const namaCocok =
    namaTarget.length > 0 &&
    konfirmasiNama.trim().toLowerCase() === namaTarget.trim().toLowerCase();
  const dampak = ringkasanDampakReset(cakupan);
  const meresetOutletAktif = target === outletId;

  function tutup() {
    setTerbuka(false);
    setKonfirmasiNama("");
    setProgres(null);
  }

  async function jalankanReset() {
    if (!target || !namaCocok || sedangReset) return;
    setSedangReset(true);
    setProgres(null);
    try {
      const hasil = await resetDataOutlet(target, cakupan, setProgres);
      showToast(
        "success",
        `Reset selesai — ${hasil.jumlahDokumenDihapus} dokumen dihapus dari "${namaTarget}".`,
      );
      tutup();
      // Data di layar lain (dan konteks Outlet aktif) sudah tidak
      // mencerminkan kondisi sebenarnya kalau yang di-reset adalah
      // Outlet yang sedang dibuka — muat ulang supaya tidak ada sisa
      // angka lama yang membingungkan.
      if (meresetOutletAktif) {
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? `Reset berhenti di tengah jalan: ${error.message}. Sebagian data mungkin sudah terhapus — jalankan lagi untuk meneruskan.`
          : "Reset gagal. Jalankan lagi untuk meneruskan.",
      );
    } finally {
      setSedangReset(false);
      setProgres(null);
    }
  }

  return (
    <section
      aria-labelledby="bagian-zona-berbahaya"
      className="mt-6 rounded-xl border border-rose-200 bg-rose-50/40 p-5"
    >
      <h2
        id="bagian-zona-berbahaya"
        className="flex items-center gap-2 text-sm font-semibold text-rose-900"
      >
        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        Zona Berbahaya
      </h2>
      <p className="mt-1 text-xs text-rose-800">
        Mengosongkan data sebuah Outlet. Tidak bisa dibatalkan dan tidak ada tombol kembali — unduh
        backup di atas dulu sebelum melanjutkan.
      </p>

      {!terbuka ? (
        <button
          type="button"
          onClick={() => setTerbuka(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-400 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 motion-safe:transition hover:bg-rose-600 hover:text-white active:scale-[0.98]"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Reset Total Data Outlet
        </button>
      ) : (
        <div className="mt-4 rounded-lg border border-rose-300 bg-white p-4">
          <div>
            <label htmlFor="reset-outlet-target" className="block text-sm font-semibold text-slate-800">
              Outlet yang akan di-reset
            </label>
            <select
              id="reset-outlet-target"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setKonfirmasiNama("");
              }}
              disabled={sedangReset}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-rose-600 focus:ring-2 focus:ring-rose-100 disabled:opacity-60"
            >
              {daftarOutletAktif.length === 0 && <option value="">Belum ada Outlet aktif</option>}
              {daftarOutletAktif.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nama}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="mt-4">
            <legend className="text-sm font-semibold text-slate-800">Seberapa dalam reset-nya</legend>
            <div className="mt-2 flex flex-col gap-2">
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 has-[:checked]:border-rose-500 has-[:checked]:bg-rose-50">
                <input
                  type="radio"
                  name="cakupan-reset"
                  checked={cakupan === "transaksi"}
                  onChange={() => setCakupan("transaksi")}
                  disabled={sedangReset}
                  className="mt-0.5 h-4 w-4 accent-rose-600"
                />
                <span>
                  <span className="font-medium">Hanya Data Transaksi</span>
                  <span className="block text-xs text-slate-500">
                    Menu, Resep, dan daftar Bahan Baku tetap aman. Cocok untuk membuang data ujicoba.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 has-[:checked]:border-rose-500 has-[:checked]:bg-rose-50">
                <input
                  type="radio"
                  name="cakupan-reset"
                  checked={cakupan === "total"}
                  onChange={() => setCakupan("total")}
                  disabled={sedangReset}
                  className="mt-0.5 h-4 w-4 accent-rose-600"
                />
                <span>
                  <span className="font-medium">Total — kosong seperti Outlet baru</span>
                  <span className="block text-xs text-slate-500">
                    Semuanya hilang, termasuk Menu, Resep, dan Bahan Baku.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-800">Akan Dihapus</p>
              <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-xs text-rose-900">
                {dampak.dihapus.map((baris) => (
                  <li key={baris}>{baris}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Tetap Aman</p>
              <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-xs text-emerald-900">
                {dampak.dipertahankan.map((baris) => (
                  <li key={baris}>{baris}</li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Penghapusan berjalan bertahap dari perangkat ini. Jangan tutup halaman sampai selesai — kalau
            terputus di tengah, sebagian data sudah terhapus dan prosesnya perlu dijalankan ulang untuk
            meneruskan sisanya.
          </p>

          <div className="mt-4">
            <label htmlFor="reset-konfirmasi" className="block text-sm font-semibold text-slate-800">
              Ketik nama Outlet untuk mengonfirmasi
            </label>
            <p className="mt-0.5 text-xs text-slate-500">
              Ketik persis: <span className="font-semibold text-slate-700">{namaTarget || "—"}</span>
            </p>
            <input
              id="reset-konfirmasi"
              type="text"
              value={konfirmasiNama}
              onChange={(e) => setKonfirmasiNama(e.target.value)}
              disabled={sedangReset || !namaTarget}
              autoComplete="off"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-rose-600 focus:ring-2 focus:ring-rose-100 disabled:opacity-60"
            />
          </div>

          {progres ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-slate-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Membersihkan {progres.koleksi}… ({progres.langkahKe}/{progres.totalLangkah})
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={jalankanReset}
              disabled={!namaCocok || sedangReset}
              aria-busy={sedangReset}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white shadow-sm motion-safe:transition hover:bg-rose-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-rose-300"
            >
              {sedangReset ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
              {sedangReset ? "Menghapus..." : "Reset Sekarang"}
            </button>
            <button
              type="button"
              onClick={tutup}
              disabled={sedangReset}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 motion-safe:transition hover:bg-slate-50 disabled:opacity-60"
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
