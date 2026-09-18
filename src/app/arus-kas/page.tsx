"use client";

// ============================================================
// Halaman: Arus Kas & Arus Saldo Finance — permintaan pemilik cafe:
// tracking pergerakan MASUK/KELUAR harian untuk dua "dompet" yang
// sengaja terpisah (lihat komentar kepala src/app/transaksi-finance/
// page.tsx): Kas Outlet (uang tunai fisik di laci tiap Outlet) dan
// Saldo Finance (deposito terpusat, lihat src/shared/lib/arus-kas.ts
// untuk penjelasan lengkap sumber datanya).
//
// Owner & Finance saja (sama seperti Riwayat, Cash Opname, Transaksi
// Finance) — data ini murni laporan/monitoring, tidak ada aksi tulis
// di halaman ini sama sekali.
//
// Top-level components, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Loader2, Repeat, Wallet } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { PeriodePicker } from "@/shared/components/periode-picker";
import { useToast } from "@/shared/components/toast";
import { useOutletId } from "@/shared/lib/outlet-context";
import { formatRupiah } from "@/shared/lib/format";
import { useDetailPerusahaan } from "@/shared/lib/perusahaan";
import { eksporExcel, eksporPdf, type OpsiLaporan } from "@/shared/lib/ekspor";
import { rentangPeriodeLaporan, formatTanggalPanjangId, type PeriodeLaporan } from "@/shared/lib/periode-laporan";
import {
  ambilArusKasOutlet,
  ambilArusSaldoFinance,
  type TitikArusKasOutlet,
  type TitikArusSaldoFinance,
} from "@/shared/lib/arus-kas";

export default function ArusKasPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]}>
      <AppShell>
        <ArusKasIsi />
      </AppShell>
    </RequireAuth>
  );
}

function ArusKasIsi() {
  return (
    <div className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <div>
        <KickerOutlet />
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Repeat className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          Arus Kas &amp; Arus Saldo Finance
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Pergerakan uang masuk/keluar harian — Kas Outlet (laci fisik tiap Outlet) dan Saldo Finance
          (deposito terpusat) dilacak terpisah karena keduanya memang dua sumber dana yang berbeda.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ArusKasOutletKartu />
        <ArusSaldoFinanceKartu />
      </div>
    </div>
  );
}

/** Format tanggal ISO ("2026-09-14") jadi "14/09/2026" — singkat,
 *  supaya tabel harian yang rapat tidak perlu tanggal panjang. */
function formatTanggalSingkat(tanggal: string): string {
  const [tahun, bulan, hari] = tanggal.split("-");
  if (!tahun || !bulan || !hari) return tanggal;
  return `${hari}/${bulan}/${tahun}`;
}

function ArusKasOutletKartu() {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const { detail: perusahaan } = useDetailPerusahaan();
  const [memuat, setMemuat] = useState(true);
  const [dariTanggal, setDariTanggal] = useState(() => rentangPeriodeLaporan("bulanan").mulai);
  const [sampaiTanggal, setSampaiTanggal] = useState(() => rentangPeriodeLaporan("bulanan").selesai);
  const [daftar, setDaftar] = useState<TitikArusKasOutlet[]>([]);
  const [sedangEkspor, setSedangEkspor] = useState<"excel" | "pdf" | null>(null);

  const periodeAktif =
    (["harian", "mingguan", "bulanan", "tahunan"] as PeriodeLaporan[]).find((p) => {
      const r = rentangPeriodeLaporan(p);
      return r.mulai === dariTanggal && r.selesai === sampaiTanggal;
    }) ?? null;

  useEffect(() => {
    let dibatalkan = false;
    setMemuat(true);
    ambilArusKasOutlet(outletId, dariTanggal, sampaiTanggal)
      .then((hasil) => {
        if (!dibatalkan) {
          setDaftar(hasil);
          setMemuat(false);
        }
      })
      .catch(() => {
        if (!dibatalkan) setMemuat(false);
      });
    return () => {
      dibatalkan = true;
    };
  }, [outletId, dariTanggal, sampaiTanggal]);

  const total = useMemo(
    () =>
      daftar.reduce(
        (t, b) => ({
          kasMasuk: t.kasMasuk + b.kasMasuk,
          kasKeluarOperasional: t.kasKeluarOperasional + b.kasKeluarOperasional,
          kasKeluarBelanja: t.kasKeluarBelanja + b.kasKeluarBelanja,
          netArusKas: t.netArusKas + b.netArusKas,
        }),
        { kasMasuk: 0, kasKeluarOperasional: 0, kasKeluarBelanja: 0, netArusKas: 0 },
      ),
    [daftar],
  );

  async function handleEkspor(jenis: "excel" | "pdf") {
    if (daftar.length === 0) {
      showToast("error", "Tidak ada data pada rentang tanggal ini.");
      return;
    }
    setSedangEkspor(jenis);
    try {
      const opsi: OpsiLaporan<TitikArusKasOutlet> = {
        judul: "LAPORAN ARUS KAS OUTLET",
        periode: `${formatTanggalPanjangId(dariTanggal)} s/d ${formatTanggalPanjangId(sampaiTanggal)}`,
        perusahaan,
        namaBerkas: `Arus-Kas-Outlet_${dariTanggal}_sd_${sampaiTanggal}`,
        kolom: [
          { judul: "Tanggal", ambil: (b) => b.tanggal, lebar: 14 },
          { judul: "Kas Masuk (Omset Tunai)", ambil: (b) => b.kasMasuk, angka: true, lebar: 18 },
          { judul: "Kas Keluar Operasional", ambil: (b) => b.kasKeluarOperasional, angka: true, lebar: 18 },
          { judul: "Kas Keluar Belanja", ambil: (b) => b.kasKeluarBelanja, angka: true, lebar: 16 },
          { judul: "Arus Kas Bersih", ambil: (b) => b.netArusKas, angka: true, lebar: 16 },
        ],
        baris: daftar,
        ringkasan: [
          { label: "Total Kas Masuk", nilai: formatRupiah(total.kasMasuk) },
          { label: "Total Kas Keluar Operasional", nilai: formatRupiah(total.kasKeluarOperasional) },
          { label: "Total Kas Keluar Belanja Purchasing", nilai: formatRupiah(total.kasKeluarBelanja) },
          { label: "Arus Kas Bersih Periode", nilai: formatRupiah(total.netArusKas) },
        ],
      };
      if (jenis === "excel") await eksporExcel(opsi);
      else await eksporPdf(opsi);
      showToast("success", `Laporan ${jenis === "excel" ? "Excel" : "PDF"} berhasil diunduh.`);
    } catch (error) {
      showToast("error", error instanceof Error ? `Gagal mengekspor: ${error.message}` : "Gagal mengekspor.");
    } finally {
      setSedangEkspor(null);
    }
  }

  return (
    <section
      aria-labelledby="bagian-arus-kas-outlet"
      className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="bagian-arus-kas-outlet" className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <Wallet className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Arus Kas Outlet
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Omset Tunai (masuk) vs Kas Keluar Kasir (Wifi/Listrik/PDAM dll) &amp; modal belanja Purchasing dari
        Kas Resto/Outlet (keluar), per hari.
      </p>

      <div className="mt-4">
        <PeriodePicker
          periodeAktif={periodeAktif}
          onPilih={(r) => {
            setDariTanggal(r.mulai);
            setSampaiTanggal(r.selesai);
          }}
        />
      </div>

      {memuat ? (
        <div className="mt-4 flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      ) : daftar.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          Belum ada data arus kas pada rentang tanggal ini.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniTotal label="Kas Masuk" nilai={total.kasMasuk} warna="emerald" />
            <MiniTotal label="Keluar Operasional" nilai={total.kasKeluarOperasional} warna="amber" />
            <MiniTotal label="Keluar Belanja" nilai={total.kasKeluarBelanja} warna="amber" />
            <MiniTotal label="Bersih" nilai={total.netArusKas} warna={total.netArusKas >= 0 ? "emerald" : "rose"} />
          </div>

          <div className="mt-4 max-h-80 overflow-y-auto overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pl-3 pr-2 font-semibold">Tanggal</th>
                  <th className="py-2 pr-2 font-semibold">Masuk</th>
                  <th className="py-2 pr-2 font-semibold">Keluar Ops.</th>
                  <th className="py-2 pr-2 font-semibold">Keluar Belanja</th>
                  <th className="py-2 pr-3 font-semibold">Bersih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {[...daftar].reverse().map((b) => (
                  <tr key={b.tanggal}>
                    <td className="py-1.5 pl-3 pr-2 text-slate-700">{formatTanggalSingkat(b.tanggal)}</td>
                    <td className="py-1.5 pr-2 tabular-nums text-emerald-700">{formatRupiah(b.kasMasuk)}</td>
                    <td className="py-1.5 pr-2 tabular-nums text-rose-600">
                      {b.kasKeluarOperasional > 0 ? `− ${formatRupiah(b.kasKeluarOperasional)}` : formatRupiah(0)}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-rose-600">
                      {b.kasKeluarBelanja > 0 ? `− ${formatRupiah(b.kasKeluarBelanja)}` : formatRupiah(0)}
                    </td>
                    <td
                      className={`py-1.5 pr-3 font-semibold tabular-nums ${
                        b.netArusKas >= 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {formatRupiah(b.netArusKas)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleEkspor("excel")}
          disabled={sedangEkspor !== null || memuat}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 motion-safe:transition hover:bg-slate-50 disabled:opacity-50"
        >
          {sedangEkspor === "excel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          Ekspor Excel
        </button>
        <button
          type="button"
          onClick={() => handleEkspor("pdf")}
          disabled={sedangEkspor !== null || memuat}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 motion-safe:transition hover:bg-slate-50 disabled:opacity-50"
        >
          {sedangEkspor === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          Ekspor PDF
        </button>
      </div>
    </section>
  );
}

function ArusSaldoFinanceKartu() {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const { detail: perusahaan } = useDetailPerusahaan();
  const [memuat, setMemuat] = useState(true);
  const [dariTanggal, setDariTanggal] = useState(() => rentangPeriodeLaporan("bulanan").mulai);
  const [sampaiTanggal, setSampaiTanggal] = useState(() => rentangPeriodeLaporan("bulanan").selesai);
  const [daftar, setDaftar] = useState<TitikArusSaldoFinance[]>([]);
  const [sedangEkspor, setSedangEkspor] = useState<"excel" | "pdf" | null>(null);

  const periodeAktif =
    (["harian", "mingguan", "bulanan", "tahunan"] as PeriodeLaporan[]).find((p) => {
      const r = rentangPeriodeLaporan(p);
      return r.mulai === dariTanggal && r.selesai === sampaiTanggal;
    }) ?? null;

  useEffect(() => {
    let dibatalkan = false;
    setMemuat(true);
    ambilArusSaldoFinance(outletId, dariTanggal, sampaiTanggal)
      .then((hasil) => {
        if (!dibatalkan) {
          setDaftar(hasil);
          setMemuat(false);
        }
      })
      .catch(() => {
        if (!dibatalkan) setMemuat(false);
      });
    return () => {
      dibatalkan = true;
    };
  }, [outletId, dariTanggal, sampaiTanggal]);

  const total = useMemo(
    () =>
      daftar.reduce(
        (t, b) => ({
          masuk: t.masuk + b.masuk,
          keluarManual: t.keluarManual + b.keluarManual,
          keluarBelanja: t.keluarBelanja + b.keluarBelanja,
          netHarian: t.netHarian + b.netHarian,
        }),
        { masuk: 0, keluarManual: 0, keluarBelanja: 0, netHarian: 0 },
      ),
    [daftar],
  );

  async function handleEkspor(jenis: "excel" | "pdf") {
    if (daftar.length === 0) {
      showToast("error", "Tidak ada data pada rentang tanggal ini.");
      return;
    }
    setSedangEkspor(jenis);
    try {
      const opsi: OpsiLaporan<TitikArusSaldoFinance> = {
        judul: "LAPORAN ARUS SALDO FINANCE",
        periode: `${formatTanggalPanjangId(dariTanggal)} s/d ${formatTanggalPanjangId(sampaiTanggal)}`,
        perusahaan,
        namaBerkas: `Arus-Saldo-Finance_${dariTanggal}_sd_${sampaiTanggal}`,
        kolom: [
          { judul: "Tanggal", ambil: (b) => b.tanggal, lebar: 14 },
          { judul: "Masuk", ambil: (b) => b.masuk, angka: true, lebar: 16 },
          { judul: "Keluar (Gaji/Operasional/Lain)", ambil: (b) => b.keluarManual, angka: true, lebar: 20 },
          { judul: "Keluar (Belanja Purchasing)", ambil: (b) => b.keluarBelanja, angka: true, lebar: 18 },
          { judul: "Bersih Harian", ambil: (b) => b.netHarian, angka: true, lebar: 16 },
        ],
        baris: daftar,
        ringkasan: [
          { label: "Total Masuk", nilai: formatRupiah(total.masuk) },
          { label: "Total Keluar (Gaji/Operasional/Lain)", nilai: formatRupiah(total.keluarManual) },
          { label: "Total Keluar (Belanja Purchasing)", nilai: formatRupiah(total.keluarBelanja) },
          { label: "Bersih Periode", nilai: formatRupiah(total.netHarian) },
          {
            label: "Catatan",
            nilai: "Saldo akhir Real-time lihat halaman Transaksi Finance — laporan ini rincian pergerakan per hari.",
          },
        ],
      };
      if (jenis === "excel") await eksporExcel(opsi);
      else await eksporPdf(opsi);
      showToast("success", `Laporan ${jenis === "excel" ? "Excel" : "PDF"} berhasil diunduh.`);
    } catch (error) {
      showToast("error", error instanceof Error ? `Gagal mengekspor: ${error.message}` : "Gagal mengekspor.");
    } finally {
      setSedangEkspor(null);
    }
  }

  return (
    <section
      aria-labelledby="bagian-arus-saldo-finance"
      className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="bagian-arus-saldo-finance"
        className="flex items-center gap-2 text-base font-semibold text-slate-900"
      >
        <ArrowUpCircle className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Arus Saldo Finance
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Uang Masuk/Keluar manual Finance (Gaji, Biaya Operasional, dll) digabung dengan modal belanja
        Purchasing dari Saldo Finance, per hari. Saldo akhir real-time ada di halaman Transaksi Finance.
      </p>

      <div className="mt-4">
        <PeriodePicker
          periodeAktif={periodeAktif}
          onPilih={(r) => {
            setDariTanggal(r.mulai);
            setSampaiTanggal(r.selesai);
          }}
        />
      </div>

      {memuat ? (
        <div className="mt-4 flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      ) : daftar.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          Belum ada data arus Saldo Finance pada rentang tanggal ini.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniTotal label="Masuk" nilai={total.masuk} warna="emerald" />
            <MiniTotal label="Keluar Manual" nilai={total.keluarManual} warna="amber" />
            <MiniTotal label="Keluar Belanja" nilai={total.keluarBelanja} warna="amber" />
            <MiniTotal label="Bersih" nilai={total.netHarian} warna={total.netHarian >= 0 ? "emerald" : "rose"} />
          </div>

          <div className="mt-4 max-h-80 overflow-y-auto overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pl-3 pr-2 font-semibold">Tanggal</th>
                  <th className="py-2 pr-2 font-semibold">Masuk</th>
                  <th className="py-2 pr-2 font-semibold">Keluar Manual</th>
                  <th className="py-2 pr-2 font-semibold">Keluar Belanja</th>
                  <th className="py-2 pr-3 font-semibold">Bersih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {[...daftar].reverse().map((b) => (
                  <tr key={b.tanggal}>
                    <td className="py-1.5 pl-3 pr-2 text-slate-700">{formatTanggalSingkat(b.tanggal)}</td>
                    <td className="py-1.5 pr-2 tabular-nums text-emerald-700">{formatRupiah(b.masuk)}</td>
                    <td className="py-1.5 pr-2 tabular-nums text-rose-600">
                      {b.keluarManual > 0 ? `− ${formatRupiah(b.keluarManual)}` : formatRupiah(0)}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-rose-600">
                      {b.keluarBelanja > 0 ? `− ${formatRupiah(b.keluarBelanja)}` : formatRupiah(0)}
                    </td>
                    <td
                      className={`py-1.5 pr-3 font-semibold tabular-nums ${
                        b.netHarian >= 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {formatRupiah(b.netHarian)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleEkspor("excel")}
          disabled={sedangEkspor !== null || memuat}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 motion-safe:transition hover:bg-slate-50 disabled:opacity-50"
        >
          {sedangEkspor === "excel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          Ekspor Excel
        </button>
        <button
          type="button"
          onClick={() => handleEkspor("pdf")}
          disabled={sedangEkspor !== null || memuat}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 motion-safe:transition hover:bg-slate-50 disabled:opacity-50"
        >
          {sedangEkspor === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          Ekspor PDF
        </button>
      </div>
    </section>
  );
}

function MiniTotal({
  label,
  nilai,
  warna,
}: {
  label: string;
  nilai: number;
  warna: "emerald" | "amber" | "rose";
}) {
  const kelas =
    warna === "emerald"
      ? "bg-emerald-50 text-emerald-800"
      : warna === "amber"
        ? "bg-amber-50 text-amber-800"
        : "bg-rose-50 text-rose-800";
  return (
    <div className={`rounded-lg px-2.5 py-2 ${kelas}`}>
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide opacity-80">
        {warna === "emerald" ? (
          <ArrowUpCircle className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ArrowDownCircle className="h-3 w-3" aria-hidden="true" />
        )}
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatRupiah(nilai)}</p>
    </div>
  );
}
