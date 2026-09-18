"use client";

// ============================================================
// Halaman: Laporan Persediaan Keluar & Masuk Bahan Baku — permintaan
// pemilik cafe: rekap per bahan berapa banyak MASUK (dibeli
// Purchasing) vs KELUAR (terjual + penyesuaian rusak/kedaluwarsa)
// dalam rentang tanggal, dengan filter preset Harian/Mingguan/
// Bulanan/Tahunan + tanggal manual, siap diekspor Excel/PDF.
//
// Owner & Finance saja — laporan ini menggabungkan data shift/
// penjualan (Kasir, TIDAK bisa dibaca Purchasing per firestore.rules)
// dengan kas_belanja (Purchasing) dan bahan_baku (harga privat), jadi
// gatingnya sama seperti Riwayat/Arus Kas/Cash Opname, BUKAN
// Purchasing (lihat src/shared/lib/laporan-persediaan.ts untuk
// penjelasan lengkap sumber datanya).
//
// Top-level components, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Boxes, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { SearchBar, cocokDenganPencarian } from "@/shared/components/search-bar";
import { PeriodePicker } from "@/shared/components/periode-picker";
import { useToast } from "@/shared/components/toast";
import { useOutletId } from "@/shared/lib/outlet-context";
import { useDetailPerusahaan } from "@/shared/lib/perusahaan";
import { eksporExcel, eksporPdf, type OpsiLaporan } from "@/shared/lib/ekspor";
import { rentangPeriodeLaporan, formatTanggalPanjangId, type PeriodeLaporan } from "@/shared/lib/periode-laporan";
import { ambilLaporanPersediaan, type RincianPersediaanBahan } from "@/shared/lib/laporan-persediaan";

export default function LaporanPersediaanPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]}>
      <AppShell>
        <LaporanPersediaanIsi />
      </AppShell>
    </RequireAuth>
  );
}

/** Format KUANTITAS bahan (gram/pcs), BUKAN Rupiah — sengaja fungsi
 *  sendiri, bukan formatRupiahSatuan, supaya angka di tabel ini tidak
 *  tercetak berawalan "Rp" (yang jadi keliru untuk satuan gram/pcs). */
function formatKuantitas(nilai: number): string {
  return nilai.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

function LaporanPersediaanIsi() {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const { detail: perusahaan } = useDetailPerusahaan();
  const [memuat, setMemuat] = useState(true);
  const [dariTanggal, setDariTanggal] = useState(() => rentangPeriodeLaporan("mingguan").mulai);
  const [sampaiTanggal, setSampaiTanggal] = useState(() => rentangPeriodeLaporan("mingguan").selesai);
  const [daftar, setDaftar] = useState<RincianPersediaanBahan[]>([]);
  const [pencarian, setPencarian] = useState("");
  const [sedangEkspor, setSedangEkspor] = useState<"excel" | "pdf" | null>(null);

  const periodeAktif =
    (["harian", "mingguan", "bulanan", "tahunan"] as PeriodeLaporan[]).find((p) => {
      const r = rentangPeriodeLaporan(p);
      return r.mulai === dariTanggal && r.selesai === sampaiTanggal;
    }) ?? null;

  useEffect(() => {
    let dibatalkan = false;
    setMemuat(true);
    ambilLaporanPersediaan(outletId, dariTanggal, sampaiTanggal)
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

  const daftarTersaring = daftar.filter((b) => cocokDenganPencarian(pencarian, b.nama));

  const total = useMemo(
    () =>
      daftar.reduce(
        (t, b) => ({
          masuk: t.masuk + b.masuk,
          keluarPenjualan: t.keluarPenjualan + b.keluarPenjualan,
          keluarPenyesuaian: t.keluarPenyesuaian + b.keluarPenyesuaian,
        }),
        { masuk: 0, keluarPenjualan: 0, keluarPenyesuaian: 0 },
      ),
    [daftar],
  );

  async function handleEkspor(jenis: "excel" | "pdf") {
    if (daftar.length === 0) {
      showToast("error", "Tidak ada pergerakan bahan baku pada rentang tanggal ini.");
      return;
    }
    setSedangEkspor(jenis);
    try {
      const opsi: OpsiLaporan<RincianPersediaanBahan> = {
        judul: "LAPORAN PERSEDIAAN KELUAR & MASUK BAHAN BAKU",
        periode: `${formatTanggalPanjangId(dariTanggal)} s/d ${formatTanggalPanjangId(sampaiTanggal)}`,
        perusahaan,
        namaBerkas: `Laporan-Persediaan-Bahan-Baku_${dariTanggal}_sd_${sampaiTanggal}`,
        kolom: [
          { judul: "Bahan", ambil: (b) => b.nama, lebar: 22 },
          { judul: "Satuan", ambil: (b) => b.satuan, lebar: 10 },
          { judul: "Masuk", ambil: (b) => b.masuk, angka: true, lebar: 14 },
          { judul: "Keluar (Penjualan)", ambil: (b) => b.keluarPenjualan, angka: true, lebar: 18 },
          { judul: "Keluar (Rusak/Kedaluwarsa)", ambil: (b) => b.keluarPenyesuaian, angka: true, lebar: 20 },
          { judul: "Total Keluar", ambil: (b) => b.totalKeluar, angka: true, lebar: 16 },
          { judul: "Selisih Bersih", ambil: (b) => b.selisihBersih, angka: true, lebar: 16 },
        ],
        baris: daftar,
        ringkasan: [
          { label: "Jumlah Bahan Bergerak", nilai: String(daftar.length) },
          { label: "Total Masuk (semua bahan, satuan campur)", nilai: String(total.masuk) },
          { label: "Total Keluar Penjualan", nilai: String(total.keluarPenjualan) },
          { label: "Total Keluar Rusak/Kedaluwarsa", nilai: String(total.keluarPenyesuaian) },
          {
            label: "Catatan",
            nilai: "Angka Masuk/Keluar dihitung ulang dari data Belanja & Nota, Penjualan, dan Penyesuaian Stok — bukan dari log tersendiri.",
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
    <div className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <div>
        <KickerOutlet />
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Boxes className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          Laporan Persediaan Bahan Baku
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Rekap MASUK (dibeli Purchasing) vs KELUAR (terjual + rusak/kedaluwarsa) per bahan, pada rentang
          tanggal terpilih.
        </p>
      </div>

      <section className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <PeriodePicker
            periodeAktif={periodeAktif}
            onPilih={(r) => {
              setDariTanggal(r.mulai);
              setSampaiTanggal(r.selesai);
            }}
          />
          <div className="w-full sm:max-w-xs">
            <SearchBar
              id="cari-bahan-persediaan"
              value={pencarian}
              onChange={setPencarian}
              placeholder="Cari nama bahan..."
              ariaLabel="Cari nama bahan baku di laporan persediaan"
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="persediaan-dari" className="block text-sm font-semibold text-slate-800">
              Dari Tanggal
            </label>
            <input
              id="persediaan-dari"
              type="date"
              value={dariTanggal}
              onChange={(event) => setDariTanggal(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <div>
            <label htmlFor="persediaan-sampai" className="block text-sm font-semibold text-slate-800">
              Sampai Tanggal
            </label>
            <input
              id="persediaan-sampai"
              type="date"
              value={sampaiTanggal}
              onChange={(event) => setSampaiTanggal(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
        </div>

        {!perusahaan.nama ? (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            Detail Perusahaan belum diisi — kop surat akan tercetak kosong. Isi dulu lewat Profil Akun →
            Detail Perusahaan.
          </p>
        ) : null}

        {memuat ? (
          <div className="mt-6 flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
          </div>
        ) : daftar.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            Belum ada pergerakan bahan baku (masuk/keluar) pada rentang tanggal ini.
          </p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-100">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pl-3 pr-2 font-semibold">Bahan</th>
                    <th className="py-2 pr-2 font-semibold">Masuk</th>
                    <th className="py-2 pr-2 font-semibold">Keluar Penjualan</th>
                    <th className="py-2 pr-2 font-semibold">Keluar Rusak/Kedaluwarsa</th>
                    <th className="py-2 pr-2 font-semibold">Total Keluar</th>
                    <th className="py-2 pr-3 font-semibold">Selisih Bersih</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {daftarTersaring.map((b) => (
                    <tr key={b.bahanId}>
                      <td className="py-2 pl-3 pr-2 font-medium text-slate-900">{b.nama}</td>
                      <td className="py-2 pr-2 tabular-nums text-emerald-700">
                        + {formatKuantitas(b.masuk)} {b.satuan}
                      </td>
                      <td className="py-2 pr-2 tabular-nums text-rose-600">
                        {b.keluarPenjualan > 0 ? `− ${formatKuantitas(b.keluarPenjualan)} ${b.satuan}` : "—"}
                      </td>
                      <td className="py-2 pr-2 tabular-nums text-rose-600">
                        {b.keluarPenyesuaian > 0
                          ? `− ${formatKuantitas(b.keluarPenyesuaian)} ${b.satuan}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-2 tabular-nums font-medium text-slate-900">
                        {formatKuantitas(b.totalKeluar)} {b.satuan}
                      </td>
                      <td
                        className={`py-2 pr-3 font-semibold tabular-nums ${
                          b.selisihBersih >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {b.selisihBersih >= 0 ? "+" : ""}
                        {formatKuantitas(b.selisihBersih)} {b.satuan}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {daftarTersaring.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Tidak ada bahan yang cocok dengan pencarian.</p>
            ) : null}
          </>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleEkspor("excel")}
            disabled={sedangEkspor !== null || memuat}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm motion-safe:transition hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-emerald-400"
          >
            {sedangEkspor === "excel" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            )}
            {sedangEkspor === "excel" ? "Menyiapkan..." : "Ekspor Excel"}
          </button>
          <button
            type="button"
            onClick={() => handleEkspor("pdf")}
            disabled={sedangEkspor !== null || memuat}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm motion-safe:transition hover:bg-emerald-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sedangEkspor === "pdf" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileText className="h-4 w-4" aria-hidden="true" />
            )}
            {sedangEkspor === "pdf" ? "Menyiapkan..." : "Ekspor PDF (A4)"}
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <RingkasTotal label="Total Masuk" nilai={total.masuk} ikon={<ArrowUpCircle className="h-4 w-4" aria-hidden="true" />} warna="emerald" />
        <RingkasTotal
          label="Total Keluar Penjualan"
          nilai={total.keluarPenjualan}
          ikon={<ArrowDownCircle className="h-4 w-4" aria-hidden="true" />}
          warna="amber"
        />
        <RingkasTotal
          label="Total Keluar Rusak/Kedaluwarsa"
          nilai={total.keluarPenyesuaian}
          ikon={<ArrowDownCircle className="h-4 w-4" aria-hidden="true" />}
          warna="rose"
        />
      </section>
    </div>
  );
}

function RingkasTotal({
  label,
  nilai,
  ikon,
  warna,
}: {
  label: string;
  nilai: number;
  ikon: React.ReactNode;
  warna: "emerald" | "amber" | "rose";
}) {
  const kelas =
    warna === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : warna === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-rose-200 bg-rose-50 text-rose-800";
  return (
    <div className={`rounded-xl border p-4 ${kelas}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-80">
        {ikon}
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums">
        {nilai.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
      </p>
      <p className="text-[11px] opacity-70">
        Satuan campur — lihat tabel di atas untuk rincian per bahan per satuan aslinya.
      </p>
    </div>
  );
}
