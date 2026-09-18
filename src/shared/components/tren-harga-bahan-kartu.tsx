"use client";

// ============================================================
// Kartu "Analitik Tren Harga Bahan Baku" — dipakai BERSAMA oleh
// Purchasing (src/app/belanja-nota/page.tsx) dan Owner
// (src/app/dashboard/page.tsx), lihat komentar arsitektur di
// src/shared/lib/tren-harga-bahan.ts (Rule of Two).
//
// Dua bagian: (1) tabel ranking kenaikan/penurunan harga tiap bahan
// dalam periode terpilih (paling penting dilihat cepat — "bahan apa
// yang lagi naik?"), dan (2) grafik tren SATU bahan yang dipilih
// (sepanjang riwayat yang tercatat, bukan dibatasi periode, supaya
// pola musiman/jangka panjang tetap kelihatan).
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { useOutletId } from "@/shared/lib/outlet-context";
import { formatRupiahSatuan } from "@/shared/lib/format";
import { PeriodePicker } from "@/shared/components/periode-picker";
import { rentangPeriodeLaporan, type PeriodeLaporan } from "@/shared/lib/periode-laporan";
import {
  ambilTrenHargaSemuaBahan,
  ringkasPerubahanHargaPeriode,
  type TrenHargaBahan,
} from "@/shared/lib/tren-harga-bahan";

export function TrenHargaBahanKartu() {
  const outletId = useOutletId();
  const [memuat, setMemuat] = useState(true);
  const [daftar, setDaftar] = useState<TrenHargaBahan[]>([]);
  const [dariTanggal, setDariTanggal] = useState(() => rentangPeriodeLaporan("bulanan").mulai);
  const [sampaiTanggal, setSampaiTanggal] = useState(() => rentangPeriodeLaporan("bulanan").selesai);
  const [bahanDipilih, setBahanDipilih] = useState<string | null>(null);

  useEffect(() => {
    let dibatalkan = false;
    setMemuat(true);
    ambilTrenHargaSemuaBahan(outletId)
      .then((hasil) => {
        if (dibatalkan) return;
        setDaftar(hasil);
        setMemuat(false);
      })
      .catch(() => {
        if (!dibatalkan) setMemuat(false);
      });
    return () => {
      dibatalkan = true;
    };
  }, [outletId]);

  const periodeAktif =
    (["harian", "mingguan", "bulanan", "tahunan"] as PeriodeLaporan[]).find((p) => {
      const r = rentangPeriodeLaporan(p);
      return r.mulai === dariTanggal && r.selesai === sampaiTanggal;
    }) ?? null;

  const ringkasan = useMemo(
    () => ringkasPerubahanHargaPeriode(daftar, dariTanggal, sampaiTanggal),
    [daftar, dariTanggal, sampaiTanggal],
  );

  // Bahan aktif untuk grafik — default ke yang paling naik dalam
  // periode (paling relevan dilihat pertama kali), fallback ke bahan
  // pertama yang PUNYA riwayat kalau tidak ada perubahan di periode.
  const bahanUntukGrafik =
    daftar.find((b) => b.bahanId === bahanDipilih) ??
    daftar.find((b) => b.bahanId === ringkasan[0]?.bahanId) ??
    daftar.find((b) => b.riwayat.length > 0) ??
    null;

  const dataGrafik = useMemo(
    () => (bahanUntukGrafik?.riwayat ?? []).map((r) => ({ label: r.tanggal.slice(5), harga: r.harga })),
    [bahanUntukGrafik],
  );

  return (
    <section
      aria-labelledby="bagian-tren-harga"
      className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="bagian-tren-harga" className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <TrendingUp className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Analitik Tren Harga Bahan Baku
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Dihitung dari riwayat perubahan harga tiap kali bahan dibeli (Belanja &amp; Nota) — bahan yang
        harganya belum pernah berubah tidak ikut muncul di ranking.
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
      ) : ringkasan.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          Belum ada perubahan harga bahan yang tercatat pada rentang tanggal ini.
        </p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Bahan</th>
                  <th className="py-2 pr-3 font-semibold">Awal Periode</th>
                  <th className="py-2 pr-3 font-semibold">Akhir Periode</th>
                  <th className="py-2 font-semibold">Perubahan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ringkasan.map((b) => {
                  const naik = b.selisihPersenPeriode > 0;
                  const turun = b.selisihPersenPeriode < 0;
                  return (
                    <tr
                      key={b.bahanId}
                      onClick={() => setBahanDipilih(b.bahanId)}
                      className={`cursor-pointer motion-safe:transition hover:bg-slate-50 ${
                        bahanUntukGrafik?.bahanId === b.bahanId ? "bg-emerald-50/60" : ""
                      }`}
                    >
                      <td className="py-2 pr-3 font-medium text-slate-900">{b.nama}</td>
                      <td className="py-2 pr-3 tabular-nums text-slate-600">
                        {formatRupiahSatuan(b.hargaAwalPeriode)}/{b.satuan}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-slate-900">
                        {formatRupiahSatuan(b.hargaAkhirPeriode)}/{b.satuan}
                      </td>
                      <td
                        className={`flex items-center gap-1 py-2 font-semibold tabular-nums ${
                          naik ? "text-rose-700" : turun ? "text-emerald-700" : "text-slate-500"
                        }`}
                      >
                        {naik ? (
                          <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : turun ? (
                          <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : null}
                        {(b.selisihPersenPeriode * 100).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Klik salah satu baris untuk melihat grafik trennya di bawah.</p>

          {bahanUntukGrafik ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">
                Tren Harga — {bahanUntukGrafik.nama} (seluruh riwayat)
              </p>
              <div className="mt-2 h-48 w-full">
                {dataGrafik.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-slate-400">
                    Belum ada riwayat perubahan harga untuk bahan ini.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dataGrafik} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                      />
                      <Tooltip
                        formatter={(value) => formatRupiahSatuan(Number(value))}
                        contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="harga"
                        name="Harga"
                        stroke="var(--color-chart-hijau)"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        isAnimationActive
                        animationDuration={400}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
