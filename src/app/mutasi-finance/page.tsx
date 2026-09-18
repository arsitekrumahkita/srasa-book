"use client";

// ============================================================
// Halaman: Mutasi Saldo Finance — permintaan pemilik cafe "Sediakan
// Menu Mutasi layaknya Mutasi Rekening Bank".
//
// Tiap baris = satu pergerakan uang, dengan kolom Debit/Kredit dan
// SALDO BERJALAN di kanan, persis buku rekening. Sumbernya koleksi
// mutasi_finance yang ditulis atomik bersama tiap perubahan saldo
// (lihat src/shared/lib/mutasi-finance.ts).
//
// BEDA dengan halaman Arus Kas: di sana agregat HARIAN dua dompet
// (Kas Outlet & Saldo Finance) untuk melihat tren; di sini rincian
// PER TRANSAKSI satu dompet (Saldo Finance) untuk menelusuri "uang
// ini ke mana".
//
// Owner & Finance saja, sama seperti Transaksi Finance.
//
// Top-level components, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import {
  ArrowDownLeft,
  ArrowUpRight,
  FileSpreadsheet,
  FileText,
  Landmark,
  Loader2,
} from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { SearchBar, cocokDenganPencarian } from "@/shared/components/search-bar";
import { PeriodePicker } from "@/shared/components/periode-picker";
import { useToast } from "@/shared/components/toast";
import { useOutletId } from "@/shared/lib/outlet-context";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { useDetailPerusahaan } from "@/shared/lib/perusahaan";
import { eksporExcel, eksporPdf, type OpsiLaporan } from "@/shared/lib/ekspor";
import {
  rentangPeriodeLaporan,
  formatTanggalPanjangId,
  type PeriodeLaporan,
} from "@/shared/lib/periode-laporan";
import {
  ambilMutasiFinanceSejak,
  hitungSaldoBerjalan,
  LABEL_SUMBER_MUTASI,
  type BarisMutasiDenganSaldo,
} from "@/shared/lib/mutasi-finance";

const ID_SALDO_FINANCE = "utama";

export default function MutasiFinancePage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]}>
      <AppShell>
        <MutasiFinanceIsi />
      </AppShell>
    </RequireAuth>
  );
}

function formatWaktuSingkat(waktu: Date | null, tanggal: string): string {
  if (!waktu) return tanggal;
  return waktu.toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MutasiFinanceIsi() {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const { detail: perusahaan } = useDetailPerusahaan();
  const [memuat, setMemuat] = useState(true);
  const [dariTanggal, setDariTanggal] = useState(() => rentangPeriodeLaporan("bulanan").mulai);
  const [sampaiTanggal, setSampaiTanggal] = useState(() => rentangPeriodeLaporan("bulanan").selesai);
  const [pencarian, setPencarian] = useState("");
  const [sedangEkspor, setSedangEkspor] = useState<"excel" | "pdf" | null>(null);
  const [saldoSaatIni, setSaldoSaatIni] = useState(0);
  const [semuaMutasi, setSemuaMutasi] = useState<BarisMutasiDenganSaldo[]>([]);

  const periodeAktif =
    (["harian", "mingguan", "bulanan", "tahunan"] as PeriodeLaporan[]).find((p) => {
      const r = rentangPeriodeLaporan(p);
      return r.mulai === dariTanggal && r.selesai === sampaiTanggal;
    }) ?? null;

  // Saldo terkini dipantau real-time — dia titik jangkar untuk
  // menghitung saldo berjalan mundur (lihat hitungSaldoBerjalan).
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "outlets", outletId, "saldo_finance", ID_SALDO_FINANCE), (snap) => {
      setSaldoSaatIni(snap.exists() ? (snap.data().saldo ?? 0) : 0);
    });
    return unsub;
  }, [outletId]);

  useEffect(() => {
    let dibatalkan = false;
    setMemuat(true);
    // SENGAJA mengambil mutasi SAMPAI SEKARANG (bukan dipotong di
    // akhir periode): saldo berjalan dihitung mundur dari saldo
    // terkini, jadi baris-baris sesudah periode tetap dibutuhkan
    // sebagai jembatan. Penyaringan periode dilakukan setelahnya.
    ambilMutasiFinanceSejak(outletId, dariTanggal)
      .then((daftar) => {
        if (dibatalkan) return;
        setSemuaMutasi(hitungSaldoBerjalan(daftar, saldoSaatIni));
        setMemuat(false);
      })
      .catch(() => {
        if (!dibatalkan) setMemuat(false);
      });
    return () => {
      dibatalkan = true;
    };
  }, [outletId, dariTanggal, saldoSaatIni]);

  /** Baris dalam periode saja, terbaru di atas (seperti mutasi bank). */
  const dalamPeriode = useMemo(
    () =>
      semuaMutasi
        .filter((m) => m.tanggal >= dariTanggal && m.tanggal <= sampaiTanggal)
        .slice()
        .reverse(),
    [semuaMutasi, dariTanggal, sampaiTanggal],
  );

  const tersaring = dalamPeriode.filter((m) =>
    cocokDenganPencarian(pencarian, m.keterangan, m.olehNama, LABEL_SUMBER_MUTASI[m.sumber]),
  );

  const total = useMemo(
    () => ({
      masuk: dalamPeriode.filter((m) => m.arah === "masuk").reduce((t, m) => t + m.nominal, 0),
      keluar: dalamPeriode.filter((m) => m.arah === "keluar").reduce((t, m) => t + m.nominal, 0),
    }),
    [dalamPeriode],
  );

  async function handleEkspor(jenis: "excel" | "pdf") {
    if (dalamPeriode.length === 0) {
      showToast("error", "Tidak ada mutasi pada rentang tanggal ini.");
      return;
    }
    setSedangEkspor(jenis);
    try {
      const opsi: OpsiLaporan<BarisMutasiDenganSaldo> = {
        judul: "MUTASI SALDO FINANCE",
        periode: `${formatTanggalPanjangId(dariTanggal)} s/d ${formatTanggalPanjangId(sampaiTanggal)}`,
        perusahaan,
        namaBerkas: `Mutasi-Saldo-Finance_${dariTanggal}_sd_${sampaiTanggal}`,
        kolom: [
          { judul: "Waktu", ambil: (m) => formatWaktuSingkat(m.waktu, m.tanggal), lebar: 18 },
          { judul: "Keterangan", ambil: (m) => m.keterangan, lebar: 38 },
          { judul: "Sumber", ambil: (m) => LABEL_SUMBER_MUTASI[m.sumber], lebar: 18 },
          { judul: "Oleh", ambil: (m) => m.olehNama, lebar: 16 },
          { judul: "Masuk", ambil: (m) => (m.arah === "masuk" ? m.nominal : 0), angka: true, lebar: 15 },
          { judul: "Keluar", ambil: (m) => (m.arah === "keluar" ? m.nominal : 0), angka: true, lebar: 15 },
          { judul: "Saldo", ambil: (m) => m.saldoSesudah, angka: true, lebar: 16 },
        ],
        // Urutan lama -> baru di berkas ekspor (kebiasaan rekening
        // koran), walau di layar terbaru ditaruh di atas.
        baris: [...dalamPeriode].reverse(),
        ringkasan: [
          { label: "Jumlah Transaksi", nilai: String(dalamPeriode.length) },
          { label: "Total Uang Masuk", nilai: formatRupiah(total.masuk) },
          { label: "Total Uang Keluar", nilai: formatRupiah(total.keluar) },
          { label: "Selisih Periode", nilai: formatRupiah(total.masuk - total.keluar) },
          { label: "Saldo Akhir (terkini)", nilai: formatRupiah(saldoSaatIni) },
        ],
      };
      if (jenis === "excel") await eksporExcel(opsi);
      else await eksporPdf(opsi);
      showToast("success", `Mutasi ${jenis === "excel" ? "Excel" : "PDF"} berhasil diunduh.`);
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
          <Landmark className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          Mutasi Saldo Finance
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Setiap pergerakan Saldo Finance, satu baris per transaksi, lengkap dengan saldo berjalan — seperti
          mutasi rekening bank.
        </p>
      </div>

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">Saldo Saat Ini</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-900">{formatRupiah(saldoSaatIni)}</p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-emerald-800">
            <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
            Masuk periode ini: <strong className="font-semibold tabular-nums">{formatRupiah(total.masuk)}</strong>
          </span>
          <span className="flex items-center gap-1.5 text-rose-700">
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            Keluar periode ini: <strong className="font-semibold tabular-nums">{formatRupiah(total.keluar)}</strong>
          </span>
        </div>
      </section>

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
            <SearchBar value={pencarian} onChange={setPencarian} placeholder="Cari keterangan / nama..." />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="mutasi-dari" className="block text-sm font-semibold text-slate-800">
              Dari Tanggal
            </label>
            <input
              id="mutasi-dari"
              type="date"
              value={dariTanggal}
              onChange={(e) => setDariTanggal(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <div>
            <label htmlFor="mutasi-sampai" className="block text-sm font-semibold text-slate-800">
              Sampai Tanggal
            </label>
            <input
              id="mutasi-sampai"
              type="date"
              value={sampaiTanggal}
              onChange={(e) => setSampaiTanggal(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
        </div>

        {memuat ? (
          <div className="mt-6 flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
          </div>
        ) : dalamPeriode.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            <p>Belum ada mutasi tercatat pada rentang tanggal ini.</p>
            <p className="mt-1 text-xs">
              Catatan: buku mutasi mulai merekam sejak fitur ini aktif — transaksi yang lebih lama dari itu
              tidak muncul di sini, tapi tetap terhitung di angka Saldo Saat Ini.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pl-3 pr-2 font-semibold">Waktu</th>
                  <th className="py-2 pr-2 font-semibold">Keterangan</th>
                  <th className="py-2 pr-2 font-semibold">Masuk</th>
                  <th className="py-2 pr-2 font-semibold">Keluar</th>
                  <th className="py-2 pr-3 font-semibold">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tersaring.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap py-2 pl-3 pr-2 text-xs text-slate-600">
                      {formatWaktuSingkat(m.waktu, m.tanggal)}
                    </td>
                    <td className="py-2 pr-2">
                      <p className="text-slate-800">{m.keterangan}</p>
                      <p className="text-[11px] text-slate-400">
                        {LABEL_SUMBER_MUTASI[m.sumber]}
                        {m.olehNama ? ` · ${m.olehNama}` : ""}
                      </p>
                    </td>
                    <td className="py-2 pr-2 tabular-nums text-emerald-700">
                      {m.arah === "masuk" ? formatRupiah(m.nominal) : "—"}
                    </td>
                    <td className="py-2 pr-2 tabular-nums text-rose-600">
                      {m.arah === "keluar" ? formatRupiah(m.nominal) : "—"}
                    </td>
                    <td
                      className={`py-2 pr-3 font-semibold tabular-nums ${
                        m.saldoSesudah < 0 ? "text-rose-700" : "text-slate-900"
                      }`}
                    >
                      {formatRupiah(m.saldoSesudah)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tersaring.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">Tidak ada mutasi yang cocok dengan pencarian.</p>
            ) : null}
          </div>
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
    </div>
  );
}
