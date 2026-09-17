"use client";

// ============================================================
// Halaman: Dashboard Analitik (PRD bagian 9.1).
// Peran: SUPERADMIN (Owner) saja — firestore.rules menolak baca
// summary_harian/summary_bulanan untuk peran lain (data laba
// sensitif, lihat PRD 6.2 & firestore.rules bagian summary_*).
//
// Layout mengikuti referensi dashboard finance yang diberikan
// Owner/user: kartu hero gradien hijau, kartu KPI kecil dengan
// indikator naik/turun, grafik tren garis, donut komposisi, dan
// daftar aktivitas terbaru — semua dalam satu palet emerald
// (lihat token warna di src/app/globals.css).
//
// "Prioritas: P0 (versi dasar)" PRD 9.1 sudah lengkap di sini:
// kartu besar kontras tinggi + indikator naik/turun (warna DAN
// ikon panah, demi pengguna buta warna), grafik tren, dan kartu
// dibaca dari dokumen ringkasan teragregasi (bukan hitung ulang
// dari transaksi mentah, demi kuota).
//
// SENGAJA BELUM ADA di versi ini (P1 lanjutan): pita peringatan
// otomatis (stok menipis, tiket menunggu), toggle periode grafik
// Mingguan/Bulanan/Tahunan (baru Harian 7 hari), dan kartu yang
// bisa diperluas di tempat untuk rincian laba.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Bell,
  CalendarRange,
  CreditCard,
  Loader2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RequireAuth } from "@/shared/components/require-auth";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { SearchBar, cocokDenganPencarian } from "@/shared/components/search-bar";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutletId } from "@/shared/lib/outlet-context";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { useNotifikasiGabungan } from "@/shared/lib/notifikasi";
import { hitungLabaHarian } from "@/shared/lib/laba-harian";
import { ambilTren, LABEL_PERIODE_TREN, type PeriodeTren, type TitikTren } from "@/shared/lib/tren";
import { ambilRingkasanPeriode, type RingkasanPeriode } from "@/shared/lib/produk-terlaris";

interface SummaryHarian {
  totalOmset?: number;
  omsetTunai?: number;
  omsetNonTunai?: number;
  totalHpp?: number;
  labaKotor?: number;
  totalKasKeluar?: number;
  totalBelanja?: number;
  labaBersih?: number;
  selisihKas?: number;
  jumlahShift?: number;
}

const WARNA_DONUT = [
  "var(--color-chart-hijau)",
  "var(--color-chart-teal)",
  "var(--color-chart-kuning)",
];

function tanggalKe(offsetHari: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetHari);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function bulanIni(): string {
  const sekarang = new Date();
  return `${sekarang.getFullYear()}-${String(sekarang.getMonth() + 1).padStart(2, "0")}`;
}

export default function DashboardPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance", "kasir", "purchasing"]}>
      <AppShell>
        <DashboardRouter />
      </AppShell>
    </RequireAuth>
  );
}

/**
 * Dashboard dibagi berdasarkan peran: Owner/Finance melihat Analitik
 * Tren + Laba Bersih (data finansial, "zona privasi otoritas tinggi"
 * atas permintaan pemilik cafe — TIDAK boleh terlihat Kasir/Purchasing
 * sama sekali, bukan cuma disembunyikan tombolnya, makanya percabangan
 * dilakukan di sini SEBELUM komponen finansial di bawah pernah
 * dirender). Kasir/Purchasing mendapat Dashboard yang sama sekali
 * berbeda: rincian stok bahan baku (lihat DashboardStokIsi di bawah).
 */
function DashboardRouter() {
  const { profil } = useAuth();
  if (!profil) return null;
  if (profil.peran === "kasir" || profil.peran === "purchasing") {
    return <DashboardStokIsi peran={profil.peran} />;
  }
  return <DashboardIsi />;
}

function DashboardIsi() {
  const outletId = useOutletId();
  const [ringkasanHarian, setRingkasanHarian] = useState<SummaryHarian | null>(null);
  const [ringkasanKemarin, setRingkasanKemarin] = useState<SummaryHarian | null>(null);
  const [ringkasanBulanan, setRingkasanBulanan] = useState<SummaryHarian | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { daftar: notifikasi, memuat: memuatNotifikasi } = useNotifikasiGabungan();

  // --- Analitik Tren dengan rentang waktu custom (Harian/Mingguan/
  // Bulanan/Custom Tanggal/Custom Bulan) — lihat src/shared/lib/tren.ts.
  const [periodeTren, setPeriodeTren] = useState<PeriodeTren>("harian");
  const [tanggalMulaiInput, setTanggalMulaiInput] = useState(tanggalKe(6));
  const [tanggalSelesaiInput, setTanggalSelesaiInput] = useState(tanggalKe(0));
  const [bulanMulaiInput, setBulanMulaiInput] = useState(bulanIni());
  const [bulanSelesaiInput, setBulanSelesaiInput] = useState(bulanIni());
  const [dataTren, setDataTren] = useState<TitikTren[]>([]);
  const [memuatTren, setMemuatTren] = useState(true);
  const [errorTren, setErrorTren] = useState<string | null>(null);

  // Opsi rentang custom dipakai BERSAMA oleh grafik Analitik Tren (di
  // atas) DAN Rekap Metode Bayar + Best Seller/Slow Moving (baru) di
  // bawah — supaya keduanya selalu menampilkan periode yang SAMA persis
  // begitu Owner mengganti toggle Harian/Mingguan/Bulanan/Custom.
  const opsiTren = useMemo(
    () =>
      periodeTren === "custom-tanggal"
        ? { tanggalMulai: tanggalMulaiInput, tanggalSelesai: tanggalSelesaiInput }
        : periodeTren === "custom-bulan"
          ? { bulanMulai: bulanMulaiInput, bulanSelesai: bulanSelesaiInput }
          : {},
    [periodeTren, tanggalMulaiInput, tanggalSelesaiInput, bulanMulaiInput, bulanSelesaiInput],
  );

  useEffect(() => {
    let dibatalkan = false;
    // setState "mulai memuat" SENGAJA ditunda satu microtask (bukan
    // dipanggil langsung di badan efek) — pola yang sama seperti
    // ambilDrafAsync di src/shared/lib/draf.ts, supaya dianggap
    // callback sistem eksternal (Promise), bukan setState sinkron di
    // dalam efek (react-hooks/set-state-in-effect).
    Promise.resolve().then(() => {
      if (!dibatalkan) {
        setMemuatTren(true);
        setErrorTren(null);
      }
    });
    ambilTren(outletId, periodeTren, opsiTren)
      .then((hasil) => {
        if (!dibatalkan) setDataTren(hasil);
      })
      .catch(() => {
        if (!dibatalkan) setErrorTren("Gagal memuat data tren untuk periode ini.");
      })
      .finally(() => {
        if (!dibatalkan) setMemuatTren(false);
      });
    return () => {
      dibatalkan = true;
    };
  }, [outletId, periodeTren, opsiTren]);

  // --- Rekap Metode Bayar (Tunai/Non-Tunai) + Best Seller/Slow Moving,
  // untuk rentang PeriodeTren yang sama dengan grafik di atas (atas
  // permintaan pemilik cafe: "diatur di grafik analitik tren"). ---
  const [ringkasanPeriode, setRingkasanPeriode] = useState<RingkasanPeriode | null>(null);
  const [memuatRingkasanPeriode, setMemuatRingkasanPeriode] = useState(true);
  const [errorRingkasanPeriode, setErrorRingkasanPeriode] = useState<string | null>(null);

  useEffect(() => {
    let dibatalkan = false;
    Promise.resolve().then(() => {
      if (!dibatalkan) {
        setMemuatRingkasanPeriode(true);
        setErrorRingkasanPeriode(null);
      }
    });
    ambilRingkasanPeriode(outletId, periodeTren, opsiTren)
      .then((hasil) => {
        if (!dibatalkan) setRingkasanPeriode(hasil);
      })
      .catch(() => {
        if (!dibatalkan) setErrorRingkasanPeriode("Gagal memuat rekap metode bayar & produk untuk periode ini.");
      })
      .finally(() => {
        if (!dibatalkan) setMemuatRingkasanPeriode(false);
      });
    return () => {
      dibatalkan = true;
    };
  }, [outletId, periodeTren, opsiTren]);

  // Banner Stok Menipis — kriteria "Batas Minimal Stok" ditentukan
  // manual per bahan (lihat Belanja & Nota / Kelola Produk). Owner/
  // Finance sudah punya akses baca penuh ke bahan_baku, jadi dibaca
  // langsung di sini (bukan lewat cermin stok_kasir yang dipakai
  // Kasir/Purchasing).
  const [bahanMenipis, setBahanMenipis] = useState<{ id: string; nama: string; stokSaatIni: number; satuan: string; batasMinimalStok: number }[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "outlets", outletId, "bahan_baku"), (snap) => {
      setBahanMenipis(
        snap.docs
          .map((d) => ({
            id: d.id,
            nama: d.data().nama ?? "",
            stokSaatIni: d.data().stokSaatIni ?? 0,
            satuan: d.data().satuan ?? "gram",
            batasMinimalStok: d.data().batasMinimalStok ?? 0,
          }))
          .filter((b) => b.batasMinimalStok > 0 && b.stokSaatIni <= b.batasMinimalStok),
      );
    });
    return unsub;
  }, [outletId]);

  useEffect(() => {
    const idHarian = tanggalKe(0);
    const idKemarin = tanggalKe(1);
    const idBulanan = bulanIni();

    const unsubHarian = onSnapshot(
      doc(db, "outlets", outletId, "summary_harian", idHarian),
      (snap) => {
        setRingkasanHarian(snap.exists() ? (snap.data() as SummaryHarian) : null);
        setMemuat(false);
      },
      () => {
        setError("Gagal memuat ringkasan hari ini.");
        setMemuat(false);
      },
    );

    const unsubKemarin = onSnapshot(doc(db, "outlets", outletId, "summary_harian", idKemarin), (snap) => {
      setRingkasanKemarin(snap.exists() ? (snap.data() as SummaryHarian) : null);
    });

    const unsubBulanan = onSnapshot(doc(db, "outlets", outletId, "summary_bulanan", idBulanan), (snap) => {
      setRingkasanBulanan(snap.exists() ? (snap.data() as SummaryHarian) : null);
    });

    return () => {
      unsubHarian();
      unsubKemarin();
      unsubBulanan();
    };
  }, [outletId]);

  // --- Laba Bersih & HPP Terjual OTOMATIS, dihitung dari Resep +
  // harga bahan TERKINI (lihat src/shared/lib/laba-harian.ts) —
  // TIDAK PERNAH melibatkan Kasir, hanya sisi Owner yang boleh baca
  // harga bahan. Dijalankan SEKALI setiap Dashboard dibuka (bukan
  // tiap snapshot berubah, supaya tidak menulis berulang ke dokumen
  // yang sedang didengarkan sendiri) — buka ulang halaman ini untuk
  // angka terbaru sepanjang hari. Gagal-lunak: kalau ada menu tanpa
  // resep, kartu lain di Dashboard tetap tampil normal.
  const sudahHitungLabaRef = useRef(false);
  useEffect(() => {
    if (sudahHitungLabaRef.current) return;
    sudahHitungLabaRef.current = true;
    const tanggal = tanggalKe(0);
    hitungLabaHarian(outletId, tanggal)
      .then((hasil) =>
        setDoc(
          doc(db, "outlets", outletId, "summary_harian", tanggal),
          { labaBersih: hasil.labaBersih, totalHpp: hasil.totalHppTerjual },
          { merge: true },
        ),
      )
      .catch(() => {
        // Diamkan — kartu Laba Bersih cukup menampilkan nilai lama/0.
      });
  }, [outletId]);

  const komposisiHariIni = useMemo(() => {
    if (!ringkasanHarian) return [];
    return [
      { nama: "Omset Tunai", nilai: ringkasanHarian.omsetTunai ?? 0 },
      { nama: "Omset Non-Tunai", nilai: ringkasanHarian.omsetNonTunai ?? 0 },
      { nama: "Kas Keluar", nilai: ringkasanHarian.totalKasKeluar ?? 0 },
    ].filter((item) => item.nilai > 0);
  }, [ringkasanHarian]);

  if (memuat) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        <span className="sr-only">Memuat dashboard...</span>
      </main>
    );
  }

  return (
    <main className="animasi-masuk mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <KickerOutlet />
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ringkasan hari ini, analitik tren, dan aktivitas terbaru.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {bahanMenipis.length > 0 ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">Stok bahan menipis — perlu segera dibeli:</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {bahanMenipis.map((b) => (
                    <li key={b.id}>
                      {b.nama}: tersisa {b.stokSaatIni} {b.satuan} (batas warning{" "}
                      {b.batasMinimalStok} {b.satuan})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {!ringkasanHarian ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
              Belum ada shift yang ditutup hari ini. Ringkasan akan muncul di
              sini otomatis setelah Kasir menutup shift pertama.
            </p>
          ) : null}

          {/* --- Baris hero: kartu gradien + KPI kecil --- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <KartuHero
              totalOmset={ringkasanHarian?.totalOmset ?? 0}
              omsetKemarin={ringkasanKemarin?.totalOmset ?? 0}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
              <KartuKpi
                label="Laba Bersih"
                nilai={ringkasanHarian?.labaBersih ?? 0}
                nilaiKemarin={ringkasanKemarin?.labaBersih ?? 0}
              />
              <KartuKpi
                label="Total Kas Keluar"
                nilai={ringkasanHarian?.totalKasKeluar ?? 0}
                nilaiKemarin={ringkasanKemarin?.totalKasKeluar ?? 0}
                turunItuBagus
              />
              <KartuKpi
                label="Total Belanja"
                nilai={ringkasanHarian?.totalBelanja ?? 0}
                nilaiKemarin={ringkasanKemarin?.totalBelanja ?? 0}
                turunItuBagus
              />
              <KartuKpi label="Jumlah Shift" nilai={ringkasanHarian?.jumlahShift ?? 0} format="angka" />
            </div>
          </div>

          {ringkasanHarian?.selisihKas ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                Selisih Kas hari ini: {formatRupiah(ringkasanHarian.selisihKas)}. Periksa
                penutupan shift terkait.
              </p>
            </div>
          ) : null}

          {/* --- Baris grafik --- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="animasi-masuk kartu-interaktif rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Analitik Tren</h2>
                  <p className="text-xs text-slate-500">Omset vs Laba Bersih — {LABEL_PERIODE_TREN[periodeTren]}.</p>
                </div>
                <div className="flex items-center gap-1.5 rounded-full bg-slate-100 p-1">
                  {(
                    [
                      ["harian", "Harian"],
                      ["mingguan", "Mingguan"],
                      ["bulanan", "Bulanan"],
                      ["custom-tanggal", "Tgl"],
                      ["custom-bulan", "Bulan"],
                    ] as [PeriodeTren, string][]
                  ).map(([nilai, label]) => (
                    <button
                      key={nilai}
                      type="button"
                      onClick={() => setPeriodeTren(nilai)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium motion-safe:transition ${
                        periodeTren === nilai
                          ? "bg-white text-emerald-700 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {periodeTren === "custom-tanggal" ? (
                <div className="animasi-masuk-halus mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <CalendarRange className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <label className="flex items-center gap-1.5">
                    Dari
                    <input
                      type="date"
                      value={tanggalMulaiInput}
                      max={tanggalSelesaiInput}
                      onChange={(e) => setTanggalMulaiInput(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Sampai
                    <input
                      type="date"
                      value={tanggalSelesaiInput}
                      min={tanggalMulaiInput}
                      onChange={(e) => setTanggalSelesaiInput(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    />
                  </label>
                </div>
              ) : null}

              {periodeTren === "custom-bulan" ? (
                <div className="animasi-masuk-halus mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <CalendarRange className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <label className="flex items-center gap-1.5">
                    Dari
                    <input
                      type="month"
                      value={bulanMulaiInput}
                      max={bulanSelesaiInput}
                      onChange={(e) => setBulanMulaiInput(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Sampai
                    <input
                      type="month"
                      value={bulanSelesaiInput}
                      min={bulanMulaiInput}
                      onChange={(e) => setBulanSelesaiInput(e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    />
                  </label>
                </div>
              ) : null}

              <div className="mt-4 h-64 w-full">
                {errorTren ? (
                  <div className="flex h-full items-center justify-center text-sm text-rose-600">
                    {errorTren}
                  </div>
                ) : memuatTren ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
                  </div>
                ) : dataTren.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    Belum ada data.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dataTren} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v: number) => `${Math.round(v / 1000)}rb`}
                        width={44}
                      />
                      <Tooltip
                        formatter={(value) => formatRupiah(Number(value))}
                        contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="omset"
                        name="Omset"
                        stroke="var(--color-chart-hijau)"
                        strokeWidth={2.5}
                        dot={false}
                        isAnimationActive
                        animationDuration={400}
                      />
                      <Line
                        type="monotone"
                        dataKey="laba"
                        name="Laba Bersih"
                        stroke="var(--color-chart-kuning)"
                        strokeWidth={2.5}
                        dot={false}
                        isAnimationActive
                        animationDuration={400}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[var(--color-chart-hijau)]" /> Omset
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[var(--color-chart-kuning)]" /> Laba Bersih
                </span>
              </div>
            </section>

            <section className="animasi-masuk kartu-interaktif rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Komposisi Hari Ini</h2>
              <p className="text-xs text-slate-500">Tunai, non-tunai, dan kas keluar.</p>
              <div className="mt-2 h-48 w-full">
                {komposisiHariIni.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    Belum ada data.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={komposisiHariIni}
                        dataKey="nilai"
                        nameKey="nama"
                        innerRadius="60%"
                        outerRadius="90%"
                        paddingAngle={2}
                      >
                        {komposisiHariIni.map((entry, index) => (
                          <Cell key={entry.nama} fill={WARNA_DONUT[index % WARNA_DONUT.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatRupiah(Number(value))} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {komposisiHariIni.map((item, index) => (
                  <li key={item.nama} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: WARNA_DONUT[index % WARNA_DONUT.length] }}
                      />
                      {item.nama}
                    </span>
                    <span className="font-medium tabular-nums text-slate-900">
                      {formatRupiah(item.nilai)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* --- Rekap Metode Bayar + Best Seller/Slow Moving, mengikuti
              periode yang sama dengan Analitik Tren di atas. --- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="animasi-masuk kartu-interaktif rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Rekap Metode Bayar</h2>
              <p className="text-xs text-slate-500">{LABEL_PERIODE_TREN[periodeTren]}.</p>
              {errorRingkasanPeriode ? (
                <p className="mt-4 text-sm text-rose-600">{errorRingkasanPeriode}</p>
              ) : memuatRingkasanPeriode ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2.5">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-800">
                      <Banknote className="h-4 w-4" aria-hidden="true" />
                      Tunai
                    </span>
                    <span className="font-semibold tabular-nums text-emerald-900">
                      {formatRupiah(ringkasanPeriode?.omsetTunai ?? 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-sky-50 px-3 py-2.5">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-sky-800">
                      <CreditCard className="h-4 w-4" aria-hidden="true" />
                      Non-Tunai
                    </span>
                    <span className="font-semibold tabular-nums text-sky-900">
                      {formatRupiah(ringkasanPeriode?.omsetNonTunai ?? 0)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Otomatis dari metode bayar yang Kasir pilih per item saat Input Penjualan. Rekap Omset
                    total di kartu lain TIDAK terpengaruh — ini murni rincian tambahan.
                  </p>
                </div>
              )}
            </section>

            <section className="animasi-masuk kartu-interaktif rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-900">Produk Terlaris</h2>
              </div>
              <p className="text-xs text-slate-500">{LABEL_PERIODE_TREN[periodeTren]}.</p>
              {memuatRingkasanPeriode ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
                </div>
              ) : !ringkasanPeriode || ringkasanPeriode.terlaris.every((p) => p.qtyTerjual === 0) ? (
                <p className="mt-4 text-sm text-slate-500">Belum ada penjualan di periode ini.</p>
              ) : (
                <ol className="mt-3 flex flex-col divide-y divide-slate-100">
                  {ringkasanPeriode.terlaris.map((p, i) => (
                    <li key={p.menuId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-semibold text-emerald-700">
                          {i + 1}
                        </span>
                        <span className="truncate text-slate-800">{p.menuNama}</span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums text-slate-900">
                        {p.qtyTerjual} pcs
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="animasi-masuk kartu-interaktif rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-amber-700" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-900">Produk Kurang Laris</h2>
              </div>
              <p className="text-xs text-slate-500">{LABEL_PERIODE_TREN[periodeTren]}.</p>
              {memuatRingkasanPeriode ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
                </div>
              ) : !ringkasanPeriode || ringkasanPeriode.kurangLaris.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Belum ada data menu untuk periode ini.</p>
              ) : (
                <ul className="mt-3 flex flex-col divide-y divide-slate-100">
                  {ringkasanPeriode.kurangLaris.map((p) => (
                    <li key={p.menuId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="truncate text-slate-800">{p.menuNama}</span>
                      <span
                        className={`shrink-0 font-medium tabular-nums ${
                          p.qtyTerjual === 0 ? "text-amber-700" : "text-slate-900"
                        }`}
                      >
                        {p.qtyTerjual === 0 ? "Tidak laku" : `${p.qtyTerjual} pcs`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* --- Bulan Ini + Aktivitas Terbaru --- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="animasi-masuk kartu-interaktif rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              <h2 className="text-sm font-semibold text-slate-900">Bulan Ini</h2>
              {ringkasanBulanan ? (
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <MiniAngka label="Total Omset" nilai={formatRupiah(ringkasanBulanan.totalOmset ?? 0)} />
                  <MiniAngka label="Laba Bersih" nilai={formatRupiah(ringkasanBulanan.labaBersih ?? 0)} />
                  <MiniAngka label="Jumlah Shift" nilai={String(ringkasanBulanan.jumlahShift ?? 0)} />
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Belum ada ringkasan bulan ini.</p>
              )}
            </section>

            <section className="animasi-masuk kartu-interaktif rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <Bell className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-900">Aktivitas Terbaru</h2>
              </div>
              {memuatNotifikasi ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden="true" />
                </div>
              ) : notifikasi.length === 0 ? (
                <p className="text-sm text-slate-500">Tidak ada notifikasi.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {notifikasi.slice(0, 5).map((notif) => (
                    <li key={notif.id} className="text-sm">
                      <p className="font-medium text-slate-900">{notif.judul}</p>
                      <p className="text-xs whitespace-pre-line text-slate-500">{notif.pesan}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </main>
  );
}

function IndikatorTren({ persen, turunItuBagus = false }: { persen: number; turunItuBagus?: boolean }) {
  if (!Number.isFinite(persen) || persen === 0) return null;
  const naik = persen > 0;
  const bagus = turunItuBagus ? !naik : naik;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold ${bagus ? "text-emerald-700" : "text-rose-700"}`}
    >
      {naik ? (
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {Math.abs(persen).toFixed(0)}%
    </span>
  );
}

function hitungPersenPerubahan(sekarang: number, sebelumnya: number): number {
  if (!sebelumnya) return 0;
  return ((sekarang - sebelumnya) / sebelumnya) * 100;
}

function KartuHero({ totalOmset, omsetKemarin }: { totalOmset: number; omsetKemarin: number }) {
  const persen = hitungPersenPerubahan(totalOmset, omsetKemarin);
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-700 to-emerald-500 p-6 text-white shadow-sm">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10"
      />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 -left-6 h-32 w-32 rounded-full bg-white/10" />
      <div className="relative flex items-center gap-2 text-sm font-medium text-emerald-50">
        <Wallet className="h-4 w-4" aria-hidden="true" />
        Total Omset Hari Ini
      </div>
      <p className="relative mt-3 text-3xl font-bold tabular-nums">{formatRupiah(totalOmset)}</p>
      <div className="relative mt-2 flex items-center gap-2 text-sm text-emerald-50">
        <span
          className={`inline-flex items-center gap-0.5 rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold ${
            persen < 0 ? "text-rose-100" : "text-white"
          }`}
        >
          {persen === 0 ? null : persen > 0 ? (
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {persen === 0 ? "Sama seperti kemarin" : `${Math.abs(persen).toFixed(0)}% vs kemarin`}
        </span>
      </div>
    </div>
  );
}

function KartuKpi({
  label,
  nilai,
  nilaiKemarin,
  turunItuBagus = false,
  format = "rupiah",
}: {
  label: string;
  nilai: number;
  nilaiKemarin?: number;
  turunItuBagus?: boolean;
  format?: "rupiah" | "angka";
}) {
  const persen = nilaiKemarin !== undefined ? hitungPersenPerubahan(nilai, nilaiKemarin) : 0;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <p className="text-lg font-bold tabular-nums text-slate-900">
          {format === "rupiah" ? formatRupiah(nilai) : nilai}
        </p>
        {nilaiKemarin !== undefined ? (
          <IndikatorTren persen={persen} turunItuBagus={turunItuBagus} />
        ) : null}
      </div>
    </div>
  );
}

function MiniAngka({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-bold tabular-nums text-slate-900">{nilai}</p>
    </div>
  );
}

// ============================================================
// SECTION: Dashboard Kasir & Purchasing — rincian stok bahan baku
// (atas permintaan pemilik cafe), SAMA SEKALI TIDAK menampilkan Omset,
// Laba Bersih, atau Analitik Tren apa pun — itu "zona privasi otoritas
// tinggi" khusus Owner/Finance.
//
// Purchasing SUDAH diberi akses baca penuh ke `bahan_baku` (termasuk
// harga) di firestore.rules — jadi dashboard Purchasing membaca
// koleksi itu langsung, tapi kartu di bawah SENGAJA tidak menampilkan
// kolom harga sama sekali (tetap bukan urusan dashboard ini).
//
// Kasir TIDAK PERNAH diberi izin baca `bahan_baku` (harga harus rahasia
// darinya, lihat src/shared/lib/resep.ts) — jadi dashboard Kasir
// membaca `stok_kasir`, cermin bahan_baku TANPA field harga sama
// sekali, ditulis ulang setiap kali stok/nama/kategori bahan berubah.
// ============================================================

interface BarisStok {
  id: string;
  nama: string;
  kategori: string;
  satuan: string;
  stokSaatIni: number;
  batasMinimalStok: number;
}

function DashboardStokIsi({ peran }: { peran: "kasir" | "purchasing" }) {
  const outletId = useOutletId();
  const [daftar, setDaftar] = useState<BarisStok[]>([]);
  const [memuat, setMemuat] = useState(true);

  useEffect(() => {
    const koleksi = peran === "purchasing" ? "bahan_baku" : "stok_kasir";
    const unsub = onSnapshot(
      collection(db, "outlets", outletId, koleksi),
      (snap) => {
        setDaftar(
          snap.docs.map((d) => ({
            id: d.id,
            nama: d.data().nama ?? "",
            kategori: d.data().kategori ?? "Umum",
            satuan: d.data().satuan ?? "gram",
            stokSaatIni: d.data().stokSaatIni ?? 0,
            batasMinimalStok: d.data().batasMinimalStok ?? 0,
          })),
        );
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, [outletId, peran]);

  const [pencarian, setPencarian] = useState("");

  const menipis = useMemo(
    () => daftar.filter((b) => b.batasMinimalStok > 0 && b.stokSaatIni <= b.batasMinimalStok),
    [daftar],
  );

  const daftarTersaring = useMemo(
    () => daftar.filter((b) => cocokDenganPencarian(pencarian, b.nama, b.kategori)),
    [daftar, pencarian],
  );

  const perKategori = useMemo(() => {
    const map = new Map<string, BarisStok[]>();
    for (const b of daftarTersaring) {
      const list = map.get(b.kategori) ?? [];
      list.push(b);
      map.set(b.kategori, list);
    }
    return map;
  }, [daftarTersaring]);

  if (memuat) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        <span className="sr-only">Memuat dashboard...</span>
      </main>
    );
  }

  return (
    <main className="animasi-masuk mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <KickerOutlet />
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">Rincian stok bahan baku gudang.</p>
      </header>

      {menipis.length > 0 ? (
        <div
          role="alert"
          className="mb-6 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Stok menipis — perlu segera dibeli:</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {menipis.map((b) => (
                <li key={b.id}>
                  {b.nama}: tersisa {b.stokSaatIni} {b.satuan} (batas warning {b.batasMinimalStok}{" "}
                  {b.satuan})
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {daftar.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
          Belum ada Bahan Baku tercatat.
        </p>
      ) : (
        <>
          <div className="mb-5 max-w-sm">
            <SearchBar
              id="cari-stok"
              value={pencarian}
              onChange={setPencarian}
              placeholder="Cari nama atau kategori bahan..."
              ariaLabel="Cari bahan baku"
            />
          </div>
          {daftarTersaring.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
              Tidak ada bahan yang cocok dengan pencarian &quot;{pencarian}&quot;.
            </p>
          ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[...perKategori.entries()].map(([kategori, items]) => (
            <section
              key={kategori}
              className="animasi-masuk kartu-interaktif rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {kategori}
              </h2>
              <ul className="flex flex-col divide-y divide-slate-100">
                {items.map((b) => {
                  const rendah = b.batasMinimalStok > 0 && b.stokSaatIni <= b.batasMinimalStok;
                  return (
                    <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className={rendah ? "font-medium text-amber-800" : "text-slate-700"}>
                        {b.nama}
                      </span>
                      <span
                        className={`tabular-nums ${rendah ? "font-semibold text-amber-800" : "text-slate-900"}`}
                      >
                        {b.stokSaatIni} {b.satuan}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
          )}
        </>
      )}
    </main>
  );
}
