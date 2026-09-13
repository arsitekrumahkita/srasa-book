"use client";

// ============================================================
// Halaman: Riwayat (PRD bagian 9.6) — "Prioritas: P0 (riwayat
// dasar)". Peran: SUPERADMIN saja untuk versi ini (Owner melihat
// semua shift lintas Kasir, lihat firestore.rules bagian shift:
// hanya Owner yang boleh `list` seluruh koleksi).
//
// BELUM ADA di versi ini (P1 lanjutan): filter rentang tanggal,
// laporan bulanan/tahunan dengan perbandingan periode, dan tombol
// Export Excel/PDF (PRD menyebut SheetJS & jsPDF, sisi klien murni
// — akan ditambah sebagai modul terpisah, bukan bagian riwayat
// dasar ini).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  Calculator,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { useOutletId } from "@/shared/lib/outlet-context";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { hitungLabaHarian } from "@/shared/lib/laba-harian";
import { eksporExcel, eksporPdf, type OpsiLaporan } from "@/shared/lib/ekspor";
import { useDetailPerusahaan } from "@/shared/lib/perusahaan";
import type { TanggunganKasir } from "@/shared/types/inventaris";

interface RiwayatShift {
  id: string;
  tanggal: string;
  kasirNama: string;
  totalOmset: number;
  totalKasKeluar: number;
  selisihKas: number;
  status: "buka" | "tutup" | "terkunci";
}

export default function RiwayatPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]}>
      <AppShell>
        <RiwayatIsi />
      </AppShell>
    </RequireAuth>
  );
}

function RiwayatIsi() {
  const outletId = useOutletId();
  const [daftarShift, setDaftarShift] = useState<RiwayatShift[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [dibuka, setDibuka] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "shift"), orderBy("tanggal", "desc")),
      (snap) => {
        setDaftarShift(
          snap.docs.map((d) => ({
            id: d.id,
            tanggal: d.data().tanggal ?? "",
            kasirNama: d.data().kasirNama ?? "",
            totalOmset: d.data().totalOmset ?? 0,
            totalKasKeluar: d.data().totalKasKeluar ?? 0,
            selisihKas: d.data().selisihKas ?? 0,
            status: d.data().status ?? "buka",
          })),
        );
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, [outletId]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <KickerOutlet />
        <h1 className="text-2xl font-bold text-slate-900">Riwayat Shift</h1>
        <p className="mt-1 text-sm text-slate-600">
          Daftar seluruh shift, terbaru di atas.
        </p>
      </header>

      <div className="mb-6 flex flex-col gap-6">
        <TanggunganKasirKartu />
        <RiwayatRefundKartu />
        {/* Ekspor Laporan & Hitung Ulang sama-sama panel aksi ringkas —
            berdampingan di layar lebar supaya tidak ada ruang kosong,
            otomatis turun jadi 1 kolom di layar sempit. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <EksporLaporanKartu daftarShift={daftarShift} />
          <HitungUlangLabaKartu />
        </div>
      </div>

      {memuat ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      ) : daftarShift.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
          Belum ada riwayat shift.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
          {daftarShift.map((shift) => {
            const terbuka = dibuka === shift.id;
            return (
              <li key={shift.id}>
                <button
                  type="button"
                  onClick={() => setDibuka(terbuka ? null : shift.id)}
                  aria-expanded={terbuka}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left motion-safe:transition motion-safe:duration-150 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-700"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{shift.tanggal}</p>
                    <p className="text-xs text-slate-500">
                      {shift.kasirNama} ·{" "}
                      <StatusBadge status={shift.status} />
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatRupiah(shift.totalOmset)}
                    </p>
                    {terbuka ? (
                      <ChevronUp className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    )}
                  </div>
                </button>
                {terbuka ? (
                  <dl className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-slate-500">Total Omset</dt>
                      <dd className="font-medium tabular-nums text-slate-900">
                        {formatRupiah(shift.totalOmset)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Total Kas Keluar</dt>
                      <dd className="font-medium tabular-nums text-slate-900">
                        {formatRupiah(shift.totalKasKeluar)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Selisih Kas</dt>
                      <dd
                        className={`font-medium tabular-nums ${shift.selisihKas === 0 ? "text-emerald-700" : "text-amber-700"}`}
                      >
                        {formatRupiah(shift.selisihKas)}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

/**
 * Tanggungan Kasir — daftar Selisih Kas negatif yang belum diganti,
 * dibuat otomatis saat Kasir Tutup Shift dengan kekurangan (lihat
 * src/app/shift/page.tsx). Owner/Finance menandai lunas dari sini
 * setelah Kasir mengganti secara nyata (di luar aplikasi — tidak ada
 * pencatatan pembayaran tunai di dalam sistem ini).
 */
function TanggunganKasirKartu() {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [daftar, setDaftar] = useState<TanggunganKasir[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [sedangUbah, setSedangUbah] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "tanggungan_kasir"), where("status", "==", "belum_lunas")),
      (snap) => {
        setDaftar(
          snap.docs.map((d) => ({
            id: d.id,
            shiftId: d.data().shiftId ?? "",
            tanggal: d.data().tanggal ?? "",
            kasirUid: d.data().kasirUid ?? "",
            kasirNama: d.data().kasirNama ?? "",
            nominal: d.data().nominal ?? 0,
            keterangan: d.data().keterangan ?? "",
            status: "belum_lunas",
          })),
        );
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, [outletId]);

  async function tandaiLunas(id: string) {
    setSedangUbah(id);
    try {
      await updateDoc(doc(db, "outlets", outletId, "tanggungan_kasir", id), { status: "lunas" });
      showToast("success", "Tanggungan ditandai lunas.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menandai lunas: ${error.message}` : "Gagal menandai lunas.",
      );
    } finally {
      setSedangUbah(null);
    }
  }

  if (memuat || daftar.length === 0) return null;

  return (
    <section
      aria-labelledby="bagian-tanggungan"
      className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm"
    >
      <h2 id="bagian-tanggungan" className="text-base font-semibold text-rose-900">
        Tanggungan Kasir (Selisih Kas Minus, Belum Lunas)
      </h2>
      <ul className="mt-3 flex flex-col divide-y divide-rose-100">
        {daftar.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div>
              <p className="font-medium text-rose-900">
                {t.kasirNama} · {t.tanggal}
              </p>
              <p className="text-xs text-rose-700">
                {formatRupiah(t.nominal)}
                {t.keterangan ? ` — ${t.keterangan}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => tandaiLunas(t.id)}
              disabled={sedangUbah === t.id}
              aria-busy={sedangUbah === t.id}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
            >
              {sedangUbah === t.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              Tandai Lunas
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface RiwayatNotaRefund {
  id: string;
  tanggalTransaksiAsal: string;
  tanggalRefund: string;
  menuNama: string;
  qty: number;
  totalRefund: number;
  alasan: string;
  metode: "tunai" | "non_tunai";
  kasirNama: string;
}

/**
 * Riwayat Nota Refund — jejak audit SEMUA refund lintas shift/hari
 * (src/app/refund/page.tsx), khusus untuk Owner/Finance melihat POLA
 * dan ALASAN refund terjadi (rasa tidak sesuai, salah pesan Kasir,
 * dll). Kasir sengaja tidak butuh approval untuk membuat Nota Refund
 * (atas permintaan pemilik cafe, supaya operasional tetap cepat) —
 * jejak transparansi untuk Owner justru ada DI SINI, bukan di alur
 * approval sebelum refund terjadi.
 */
function RiwayatRefundKartu() {
  const outletId = useOutletId();
  const [daftar, setDaftar] = useState<RiwayatNotaRefund[]>([]);
  const [memuat, setMemuat] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "nota_refund"), orderBy("waktuDibuat", "desc")),
      (snap) => {
        setDaftar(
          snap.docs.slice(0, 50).map((d) => ({
            id: d.id,
            tanggalTransaksiAsal: d.data().tanggalTransaksiAsal ?? "",
            tanggalRefund: d.data().tanggalRefund ?? "",
            menuNama: d.data().menuNama ?? "",
            qty: d.data().qty ?? 0,
            totalRefund: d.data().totalRefund ?? 0,
            alasan: d.data().alasan ?? "",
            metode: (d.data().metode ?? "tunai") as "tunai" | "non_tunai",
            kasirNama: d.data().kasirNama ?? "",
          })),
        );
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, [outletId]);

  if (memuat || daftar.length === 0) return null;

  return (
    <section
      aria-labelledby="bagian-refund"
      className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="bagian-refund" className="text-base font-semibold text-slate-900">
        Riwayat Nota Refund (50 terbaru)
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Refund transaksi dari shift yang sudah ditutup/hari lain — bukan Bonus/Refund cepat di shift
        yang masih berjalan (itu sudah tercermin langsung di Omset shift terkait).
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-slate-100">
        {daftar.map((r) => (
          <li key={r.id} className="py-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-slate-900">
                {r.menuNama} × {r.qty}
              </p>
              <p className="font-semibold tabular-nums text-rose-700">{formatRupiah(r.totalRefund)}</p>
            </div>
            <p className="text-xs text-slate-500">
              Transaksi asal {r.tanggalTransaksiAsal} · direfund {r.tanggalRefund} oleh {r.kasirNama} ·{" "}
              {r.metode === "tunai" ? "Tunai" : "Non-tunai"}
            </p>
            <p className="text-xs text-slate-500">Alasan: {r.alasan}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Ekspor Laporan Shift ke Excel (.xlsx) & PDF (A4) berkop surat.
 *
 * Rentang tanggal disaring DI SISI KLIEN dari daftar shift yang sudah
 * ada di layar, bukan lewat query Firestore baru — daftarnya memang
 * sudah dimuat seluruhnya untuk ditampilkan di halaman ini, jadi
 * query tambahan hanya akan memakan kuota baca tanpa menambah apa pun.
 */
function EksporLaporanKartu({ daftarShift }: { daftarShift: RiwayatShift[] }) {
  const { showToast } = useToast();
  const { detail: perusahaan } = useDetailPerusahaan();
  const [dariTanggal, setDariTanggal] = useState(tanggalAwalBulanISO());
  const [sampaiTanggal, setSampaiTanggal] = useState(tanggalIniISO());
  const [sedangEkspor, setSedangEkspor] = useState<"excel" | "pdf" | null>(null);

  const terpilih = useMemo(
    () =>
      daftarShift
        .filter((s) => s.tanggal >= dariTanggal && s.tanggal <= sampaiTanggal)
        .slice()
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    [daftarShift, dariTanggal, sampaiTanggal],
  );

  const total = useMemo(
    () => ({
      omset: terpilih.reduce((t, s) => t + s.totalOmset, 0),
      kasKeluar: terpilih.reduce((t, s) => t + s.totalKasKeluar, 0),
      selisih: terpilih.reduce((t, s) => t + s.selisihKas, 0),
    }),
    [terpilih],
  );

  function susunOpsi(): OpsiLaporan<RiwayatShift> {
    return {
      judul: "LAPORAN SHIFT HARIAN",
      periode: `${formatTanggalPanjang(dariTanggal)} s/d ${formatTanggalPanjang(sampaiTanggal)}`,
      perusahaan,
      namaBerkas: `Laporan-Shift_${dariTanggal}_sd_${sampaiTanggal}`,
      kolom: [
        { judul: "Tanggal", ambil: (s) => s.tanggal, lebar: 14 },
        { judul: "Kasir", ambil: (s) => s.kasirNama || "—", lebar: 22 },
        { judul: "Status", ambil: (s) => labelStatus(s.status), lebar: 16 },
        { judul: "Total Omset", ambil: (s) => s.totalOmset, angka: true, lebar: 16 },
        { judul: "Kas Keluar", ambil: (s) => s.totalKasKeluar, angka: true, lebar: 16 },
        { judul: "Selisih Kas", ambil: (s) => s.selisihKas, angka: true, lebar: 16 },
      ],
      baris: terpilih,
      ringkasan: [
        { label: "Jumlah Shift", nilai: String(terpilih.length) },
        { label: "Total Omset", nilai: formatRupiah(total.omset) },
        { label: "Total Kas Keluar", nilai: formatRupiah(total.kasKeluar) },
        { label: "Total Selisih Kas", nilai: formatRupiah(total.selisih) },
      ],
    };
  }

  async function handleEkspor(jenis: "excel" | "pdf") {
    if (terpilih.length === 0) {
      showToast("error", "Tidak ada shift pada rentang tanggal itu.");
      return;
    }
    setSedangEkspor(jenis);
    try {
      const opsi = susunOpsi();
      if (jenis === "excel") await eksporExcel(opsi);
      else await eksporPdf(opsi);
      showToast("success", `Laporan ${jenis === "excel" ? "Excel" : "PDF"} berhasil diunduh.`);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mengekspor: ${error.message}` : "Gagal mengekspor.",
      );
    } finally {
      setSedangEkspor(null);
    }
  }

  return (
    <section
      aria-labelledby="bagian-ekspor"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="bagian-ekspor"
        className="flex items-center gap-2 text-base font-semibold text-slate-900"
      >
        <Download className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Ekspor Laporan (Excel / PDF A4)
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Laporan dicetak dengan KOP SURAT berisi Detail Perusahaan. Atur
        datanya di menu Profil Akun bagian Detail Perusahaan.
      </p>

      {!perusahaan.nama ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          Detail Perusahaan belum diisi — kop surat akan tercetak kosong.
          Isi dulu lewat Profil Akun → Detail Perusahaan.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ekspor-dari" className="block text-sm font-semibold text-slate-800">
            Dari Tanggal
          </label>
          <input
            id="ekspor-dari"
            type="date"
            value={dariTanggal}
            onChange={(event) => setDariTanggal(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label htmlFor="ekspor-sampai" className="block text-sm font-semibold text-slate-800">
            Sampai Tanggal
          </label>
          <input
            id="ekspor-sampai"
            type="date"
            value={sampaiTanggal}
            onChange={(event) => setSampaiTanggal(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-600">
        {terpilih.length} shift terpilih · Total Omset {formatRupiah(total.omset)}
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => handleEkspor("excel")}
          disabled={sedangEkspor !== null}
          aria-busy={sedangEkspor === "excel"}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-emerald-400"
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
          disabled={sedangEkspor !== null}
          aria-busy={sedangEkspor === "pdf"}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-emerald-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
  );
}

function labelStatus(status: RiwayatShift["status"]): string {
  return status === "buka" ? "Sedang Berjalan" : status === "tutup" ? "Ditutup" : "Terkunci";
}

function formatTanggalPanjang(iso: string): string {
  const [tahun, bulan, hari] = iso.split("-").map(Number);
  if (!tahun || !bulan || !hari) return iso;
  return new Date(tahun, bulan - 1, hari).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function tanggalAwalBulanISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function tanggalIniISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Hitung ulang Laba Bersih & HPP Terjual untuk hari LAMPAU secara
 * manual. Dashboard sudah menghitung otomatis untuk HARI INI setiap
 * dibuka (lihat src/app/dashboard/page.tsx) — tombol ini untuk
 * mem-back-fill hari-hari sebelumnya (mis. resep baru disusun
 * belakangan, atau Owner belum sempat buka Dashboard hari itu).
 */
function HitungUlangLabaKartu() {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [tanggal, setTanggal] = useState(tanggalIniISO());
  const [sedangHitung, setSedangHitung] = useState(false);

  async function handleHitung() {
    setSedangHitung(true);
    try {
      const hasil = await hitungLabaHarian(outletId, tanggal);
      // Ringkasan harian ditulis ULANG dari sumber aslinya (dokumen shift
      // + subkoleksi penjualan), bukan sekadar menambah labaBersih.
      // summary_harian normalnya dibentuk lewat increment() oleh Kasir
      // saat Tutup Shift; kalau penulisan itu sempat gagal (internet
      // putus di tengah jalan) atau terlanjur terhitung dobel oleh data
      // lama, angkanya akan meleset selamanya karena increment tidak
      // bisa "diperbaiki" tanpa tahu nilai benarnya. Tombol ini jadi
      // pemulihannya: menimpa semua angka hari itu dengan hasil hitung
      // ulang yang otoritatif.
      await setDoc(
        doc(db, "outlets", outletId, "summary_harian", tanggal),
        {
          totalOmset: hasil.totalOmset,
          omsetTunai: hasil.omsetTunai,
          omsetNonTunai: hasil.omsetNonTunai,
          totalKasKeluar: hasil.totalKasKeluar,
          selisihKas: hasil.selisihKas,
          jumlahShift: hasil.jumlahShift,
          labaBersih: hasil.labaBersih,
          totalHpp: hasil.totalHppTerjual,
        },
        { merge: true },
      );
      showToast(
        "success",
        `${tanggal} — Omset ${formatRupiah(hasil.totalOmset)}, HPP Terjual ${formatRupiah(hasil.totalHppTerjual)}, Laba Bersih ${formatRupiah(hasil.labaBersih)}.`,
      );
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menghitung: ${error.message}` : "Gagal menghitung Laba Bersih.",
      );
    } finally {
      setSedangHitung(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-hitung-laba"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="bagian-hitung-laba" className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <Calculator className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Hitung Ulang Laporan Harian
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Dashboard sudah otomatis menghitung Laba Bersih hari ini setiap
        dibuka. Pakai ini untuk hari-hari sebelumnya, atau bila angka
        ringkasan suatu hari terlihat janggal — omset, kas keluar, selisih
        kas, HPP, dan laba hari itu akan dihitung ulang dari data shift
        aslinya lalu ditimpa.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div>
          <label htmlFor="tanggal-hitung-laba" className="block text-sm font-semibold text-slate-800">
            Tanggal
          </label>
          <input
            id="tanggal-hitung-laba"
            type="date"
            value={tanggal}
            onChange={(event) => setTanggal(event.target.value)}
            className="mt-1.5 rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <button
          type="button"
          onClick={handleHitung}
          disabled={sedangHitung}
          aria-busy={sedangHitung}
          className={[
            "inline-flex h-[42px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm",
            "motion-safe:transition motion-safe:duration-150",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
            sedangHitung
              ? "cursor-not-allowed bg-emerald-400"
              : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
          ].join(" ")}
        >
          {sedangHitung ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Hitung"}
        </button>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: RiwayatShift["status"] }) {
  // Pakai labelStatus() yang sama dengan yang dicetak di ekspor — kalau
  // istilahnya diubah, layar dan laporan berubah bersamaan.
  return <span>{labelStatus(status)}</span>;
}
