"use client";

// ============================================================
// Halaman: NERACA — permintaan pemilik cafe, "hanya pada akun
// Finance".
//
// AKSES SENGAJA BERBEDA DARI SEMUA HALAMAN LAIN: peranDiizinkan cuma
// ["finance"], TANPA "superadmin". Hampir semua halaman laporan di
// app ini dibuka Owner + Finance; di sini Owner TIDAK diikutkan atas
// permintaan eksplisit pemilik. (Bandingkan dengan Transaksi Finance
// yang tetap bisa DIBUKA Owner untuk memantau — di sana yang dibatasi
// hanya eksekusinya. Di halaman ini pembatasannya di level halaman.)
//
// Penjelasan istilah akuntansinya sengaja ditulis panjang di layar
// DAN ikut tercetak di ekspor, karena pemiliknya menyatakan sendiri
// belum tahu apa itu neraca. Rumus & asal-usul tiap angka
// didokumentasikan di src/shared/lib/neraca.ts.
//
// Top-level components, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useState } from "react";
import { FileSpreadsheet, FileText, Info, Loader2, Scale } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { useToast } from "@/shared/components/toast";
import { useOutletId } from "@/shared/lib/outlet-context";
import { formatRupiah } from "@/shared/lib/format";
import { useDetailPerusahaan } from "@/shared/lib/perusahaan";
import { eksporExcel, eksporPdf, type OpsiLaporan } from "@/shared/lib/ekspor";
import { formatTanggalPanjangId } from "@/shared/lib/periode-laporan";
import { hitungNeraca, type HasilNeraca, type PosNeraca } from "@/shared/lib/neraca";

function tanggalHariIni(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function NeracaPage() {
  return (
    <RequireAuth peranDiizinkan={["finance"]}>
      <AppShell>
        <NeracaIsi />
      </AppShell>
    </RequireAuth>
  );
}

/** Satu baris pos neraca: label + penjelasan awam + nominal. */
function BarisPos({ pos, tebal }: { pos: PosNeraca; tebal?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className={`text-sm text-slate-800 ${tebal ? "font-semibold" : ""}`}>{pos.label}</p>
        <p className="mt-0.5 text-xs text-slate-500">{pos.penjelasan}</p>
      </div>
      <p
        className={`shrink-0 tabular-nums ${tebal ? "font-semibold" : "font-medium"} ${
          pos.nilai < 0 ? "text-rose-700" : "text-slate-900"
        }`}
      >
        {formatRupiah(pos.nilai)}
      </p>
    </div>
  );
}

function BarisTotal({ label, nilai, warna }: { label: string; nilai: number; warna: "slate" | "emerald" }) {
  return (
    <div
      className={`mt-2 flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 ${
        warna === "emerald" ? "bg-emerald-50" : "bg-slate-100"
      }`}
    >
      <p className={`text-sm font-semibold ${warna === "emerald" ? "text-emerald-900" : "text-slate-800"}`}>
        {label}
      </p>
      <p
        className={`text-base font-bold tabular-nums ${
          warna === "emerald" ? "text-emerald-900" : "text-slate-900"
        }`}
      >
        {formatRupiah(nilai)}
      </p>
    </div>
  );
}

function NeracaIsi() {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const { detail: perusahaan } = useDetailPerusahaan();
  const [tanggal, setTanggal] = useState(tanggalHariIni());
  const [memuat, setMemuat] = useState(true);
  const [hasil, setHasil] = useState<HasilNeraca | null>(null);
  const [sedangEkspor, setSedangEkspor] = useState<"excel" | "pdf" | null>(null);

  useEffect(() => {
    let dibatalkan = false;
    setMemuat(true);
    hitungNeraca(outletId, tanggal)
      .then((h) => {
        if (dibatalkan) return;
        setHasil(h);
        setMemuat(false);
      })
      .catch(() => {
        if (!dibatalkan) setMemuat(false);
      });
    return () => {
      dibatalkan = true;
    };
  }, [outletId, tanggal]);

  async function handleEkspor(jenis: "excel" | "pdf") {
    if (!hasil) return;
    setSedangEkspor(jenis);
    try {
      // Satu tabel datar berisi semua pos — bentuk paling mudah dibaca
      // di Excel maupun PDF, dengan kolom Kelompok sebagai pemisahnya.
      const baris = [
        ...hasil.aset.map((p) => ({ kelompok: "ASET", ...p })),
        { kelompok: "ASET", label: "TOTAL ASET", nilai: hasil.totalAset, penjelasan: "" },
        ...hasil.liabilitas.map((p) => ({ kelompok: "LIABILITAS", ...p })),
        {
          kelompok: "LIABILITAS",
          label: "TOTAL LIABILITAS",
          nilai: hasil.totalLiabilitas,
          penjelasan: "",
        },
        ...hasil.rincianEkuitas.map((p) => ({ kelompok: "EKUITAS", ...p })),
        { kelompok: "EKUITAS", label: "TOTAL EKUITAS", nilai: hasil.totalEkuitas, penjelasan: "" },
      ];
      const opsi: OpsiLaporan<(typeof baris)[number]> = {
        judul: "NERACA (LAPORAN POSISI KEUANGAN)",
        periode: `Per ${formatTanggalPanjangId(hasil.tanggal)}`,
        perusahaan,
        namaBerkas: `Neraca_${hasil.tanggal}`,
        kolom: [
          { judul: "Kelompok", ambil: (b) => b.kelompok, lebar: 14 },
          { judul: "Pos", ambil: (b) => b.label, lebar: 34 },
          { judul: "Nilai", ambil: (b) => b.nilai, angka: true, lebar: 18 },
          { judul: "Keterangan", ambil: (b) => b.penjelasan, lebar: 60 },
        ],
        baris,
        ringkasan: [
          { label: "TOTAL ASET", nilai: formatRupiah(hasil.totalAset) },
          { label: "TOTAL LIABILITAS", nilai: formatRupiah(hasil.totalLiabilitas) },
          { label: "TOTAL EKUITAS", nilai: formatRupiah(hasil.totalEkuitas) },
          {
            label: "Uji Keseimbangan",
            nilai: `Aset ${formatRupiah(hasil.totalAset)} = Liabilitas ${formatRupiah(hasil.totalLiabilitas)} + Ekuitas ${formatRupiah(hasil.totalEkuitas)}`,
          },
          {
            label: "Catatan",
            nilai:
              "Neraca menunjukkan posisi keuangan pada SATU tanggal (apa yang dimiliki, apa yang diutang, dan sisanya hak pemilik) — berbeda dengan Laba/Rugi yang mengukur kinerja selama satu periode.",
          },
        ],
      };
      if (jenis === "excel") await eksporExcel(opsi);
      else await eksporPdf(opsi);
      showToast("success", `Neraca ${jenis === "excel" ? "Excel" : "PDF"} berhasil diunduh.`);
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
          <Scale className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          Neraca
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Posisi keuangan outlet pada satu tanggal — khusus akun Finance.
        </p>
      </div>

      {/* Penjelasan istilah: pemiliknya menyatakan belum tahu apa itu
          neraca, jadi definisinya ditaruh di depan, bukan di catatan
          kaki yang mudah terlewat. */}
      <section className="rounded-xl border border-sky-200 bg-sky-50 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-sky-900">
          <Info className="h-4 w-4" aria-hidden="true" />
          Sekilas: apa itu Neraca?
        </h2>
        <p className="mt-1.5 text-sm text-sky-900">
          Laporan Laba/Rugi menjawab <em>&ldquo;berapa untungnya selama periode ini&rdquo;</em>. Neraca
          menjawab hal lain: <em>&ldquo;pada tanggal ini, usaha saya punya apa saja, dan siapa yang berhak
          atasnya&rdquo;</em>. Isinya tiga kelompok dengan satu aturan yang selalu berlaku:
        </p>
        <p className="mt-2 rounded-lg bg-white px-3 py-2 text-center text-sm font-semibold text-sky-900">
          ASET (yang dimiliki) = LIABILITAS (utang) + EKUITAS (hak pemilik)
        </p>
        <p className="mt-2 text-xs text-sky-800">
          Contoh: kalau di laci ada Rp500.000 dan stok bahan senilai Rp2.000.000, berarti asetnya
          Rp2.500.000. Karena usaha ini belum punya utang tercatat, seluruhnya menjadi hak pemilik.
        </p>
      </section>

      <section className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full sm:max-w-xs">
            <label htmlFor="neraca-tanggal" className="block text-sm font-semibold text-slate-800">
              Posisi Per Tanggal
            </label>
            <input
              id="neraca-tanggal"
              type="date"
              value={tanggal}
              onChange={(e) => setTanggal(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleEkspor("excel")}
              disabled={sedangEkspor !== null || memuat || !hasil}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm motion-safe:transition hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-emerald-400"
            >
              {sedangEkspor === "excel" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              )}
              Ekspor Excel
            </button>
            <button
              type="button"
              onClick={() => handleEkspor("pdf")}
              disabled={sedangEkspor !== null || memuat || !hasil}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm motion-safe:transition hover:bg-emerald-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sedangEkspor === "pdf" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileText className="h-4 w-4" aria-hidden="true" />
              )}
              Ekspor PDF (A4)
            </button>
          </div>
        </div>

        {!perusahaan.nama ? (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            Detail Perusahaan belum diisi — kop surat akan tercetak kosong. Isi dulu lewat Profil Akun →
            Detail Perusahaan.
          </p>
        ) : null}
      </section>

      {memuat ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      ) : !hasil ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          Gagal memuat data neraca. Coba pilih ulang tanggalnya.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">Aset</h2>
              <p className="mt-0.5 text-xs text-slate-500">Semua yang dimiliki usaha ini per tanggal di atas.</p>
              <div className="mt-3 divide-y divide-slate-100">
                {hasil.aset.map((pos) => (
                  <BarisPos key={pos.label} pos={pos} />
                ))}
              </div>
              <BarisTotal label="TOTAL ASET" nilai={hasil.totalAset} warna="emerald" />
            </section>

            <div className="flex flex-col gap-6">
              <section className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-slate-900">Liabilitas (Utang)</h2>
                <p className="mt-0.5 text-xs text-slate-500">Kewajiban yang harus dibayar ke pihak lain.</p>
                <div className="mt-3 divide-y divide-slate-100">
                  {hasil.liabilitas.map((pos) => (
                    <BarisPos key={pos.label} pos={pos} />
                  ))}
                </div>
                <BarisTotal label="TOTAL LIABILITAS" nilai={hasil.totalLiabilitas} warna="slate" />
              </section>

              <section className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-slate-900">Ekuitas (Hak Pemilik)</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Sisa aset setelah dikurangi utang — inilah nilai bersih usaha Anda.
                </p>
                <BarisTotal label="TOTAL EKUITAS" nilai={hasil.totalEkuitas} warna="emerald" />
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Rincian Asal Ekuitas
                </p>
                <div className="mt-1 divide-y divide-slate-100">
                  {hasil.rincianEkuitas.map((pos) => (
                    <BarisPos key={pos.label} pos={pos} />
                  ))}
                </div>
              </section>
            </div>
          </div>

          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-900">Uji Keseimbangan</p>
            <p className="mt-1 text-sm tabular-nums text-emerald-900">
              Aset {formatRupiah(hasil.totalAset)} = Liabilitas {formatRupiah(hasil.totalLiabilitas)} + Ekuitas{" "}
              {formatRupiah(hasil.totalEkuitas)}
            </p>
            <p className="mt-1 text-xs text-emerald-800">
              Selalu seimbang, karena Ekuitas memang dihitung sebagai sisa Aset dikurangi Liabilitas. Yang
              perlu diperhatikan bukan keseimbangannya, melainkan besar &ldquo;Selisih Belum
              Terjelaskan&rdquo; di rincian ekuitas — makin kecil, makin rapi pembukuannya.
            </p>
          </section>

          {hasil.catatan.jumlahHariLabaBelumDihitung > 0 || hasil.catatan.jumlahBahanStokMinus > 0 ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">Yang Perlu Dirapikan</p>
              <ul className="mt-1.5 flex flex-col gap-1 text-sm text-amber-900">
                {hasil.catatan.jumlahHariLabaBelumDihitung > 0 ? (
                  <li>
                    {hasil.catatan.jumlahHariLabaBelumDihitung} hari belum punya angka Laba Bersih. Hitung
                    lewat menu Riwayat → Hitung Ulang Laba supaya Akumulasi Laba di atas akurat.
                  </li>
                ) : null}
                {hasil.catatan.jumlahBahanStokMinus > 0 ? (
                  <li>
                    {hasil.catatan.jumlahBahanStokMinus} bahan baku punya stok MINUS, sehingga nilai
                    Persediaan di atas lebih rendah dari kenyataan. Perbaiki lewat Belanja &amp; Nota.
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
