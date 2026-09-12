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
import {
  collection,
  doc,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Loader2,
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
import { AppShell } from "@/shared/components/app-shell";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { useNotifikasiGabungan } from "@/shared/lib/notifikasi";
import { hitungLabaHarian } from "@/shared/lib/laba-harian";

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
    <RequireAuth peranDiizinkan={["superadmin", "finance"]}>
      <AppShell>
        <DashboardIsi />
      </AppShell>
    </RequireAuth>
  );
}

function DashboardIsi() {
  const [ringkasanHarian, setRingkasanHarian] = useState<SummaryHarian | null>(null);
  const [ringkasanKemarin, setRingkasanKemarin] = useState<SummaryHarian | null>(null);
  const [ringkasanBulanan, setRingkasanBulanan] = useState<SummaryHarian | null>(null);
  const [tren7Hari, setTren7Hari] = useState<{ tanggal: string; omset: number; laba: number }[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { daftar: notifikasi, memuat: memuatNotifikasi } = useNotifikasiGabungan();

  useEffect(() => {
    const idHarian = tanggalKe(0);
    const idKemarin = tanggalKe(1);
    const idBulanan = bulanIni();

    const unsubHarian = onSnapshot(
      doc(db, "summary_harian", idHarian),
      (snap) => {
        setRingkasanHarian(snap.exists() ? (snap.data() as SummaryHarian) : null);
        setMemuat(false);
      },
      () => {
        setError("Gagal memuat ringkasan hari ini.");
        setMemuat(false);
      },
    );

    const unsubKemarin = onSnapshot(doc(db, "summary_harian", idKemarin), (snap) => {
      setRingkasanKemarin(snap.exists() ? (snap.data() as SummaryHarian) : null);
    });

    const unsubBulanan = onSnapshot(doc(db, "summary_bulanan", idBulanan), (snap) => {
      setRingkasanBulanan(snap.exists() ? (snap.data() as SummaryHarian) : null);
    });

    const unsubTren = onSnapshot(
      query(collection(db, "summary_harian"), orderBy(documentId(), "desc"), limit(7)),
      (snap) => {
        const data = snap.docs
          .map((d) => {
            const v = d.data() as SummaryHarian;
            return {
              tanggal: d.id.slice(5), // "MM-DD" saja, biar ringkas di sumbu-X
              omset: v.totalOmset ?? 0,
              laba: v.labaBersih ?? 0,
            };
          })
          .reverse();
        setTren7Hari(data);
      },
    );

    return () => {
      unsubHarian();
      unsubKemarin();
      unsubBulanan();
      unsubTren();
    };
  }, []);

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
    hitungLabaHarian(tanggal)
      .then((hasil) =>
        setDoc(
          doc(db, "summary_harian", tanggal),
          { labaBersih: hasil.labaBersih, totalHpp: hasil.totalHppTerjual },
          { merge: true },
        ),
      )
      .catch(() => {
        // Diamkan — kartu Laba Bersih cukup menampilkan nilai lama/0.
      });
  }, []);

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
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          SRASA BOOK
        </p>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ringkasan hari ini, tren 7 hari terakhir, dan aktivitas terbaru.
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
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              <h2 className="text-sm font-semibold text-slate-900">Tren 7 Hari Terakhir</h2>
              <p className="text-xs text-slate-500">Omset vs Laba Bersih per hari.</p>
              <div className="mt-4 h-64 w-full">
                {tren7Hari.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    Belum ada data.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={tren7Hari} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="tanggal" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
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
                      />
                      <Line
                        type="monotone"
                        dataKey="laba"
                        name="Laba Bersih"
                        stroke="var(--color-chart-kuning)"
                        strokeWidth={2.5}
                        dot={false}
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

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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

          {/* --- Bulan Ini + Aktivitas Terbaru --- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
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

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
