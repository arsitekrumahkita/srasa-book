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

import { useEffect, useState } from "react";
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
import { Calculator, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { AppShell } from "@/shared/components/app-shell";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { hitungLabaHarian } from "@/shared/lib/laba-harian";
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
  const [daftarShift, setDaftarShift] = useState<RiwayatShift[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [dibuka, setDibuka] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "shift"), orderBy("tanggal", "desc")),
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
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          SRASA BOOK
        </p>
        <h1 className="text-2xl font-bold text-slate-900">Riwayat Shift</h1>
        <p className="mt-1 text-sm text-slate-600">
          Daftar seluruh shift, terbaru di atas.
        </p>
      </header>

      <div className="mb-6 flex flex-col gap-6">
        <TanggunganKasirKartu />
        <HitungUlangLabaKartu />
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
  const { showToast } = useToast();
  const [daftar, setDaftar] = useState<TanggunganKasir[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [sedangUbah, setSedangUbah] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "tanggungan_kasir"), where("status", "==", "belum_lunas")),
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
  }, []);

  async function tandaiLunas(id: string) {
    setSedangUbah(id);
    try {
      await updateDoc(doc(db, "tanggungan_kasir", id), { status: "lunas" });
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
  const { showToast } = useToast();
  const [tanggal, setTanggal] = useState(tanggalIniISO());
  const [sedangHitung, setSedangHitung] = useState(false);

  async function handleHitung() {
    setSedangHitung(true);
    try {
      const hasil = await hitungLabaHarian(tanggal);
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
        doc(db, "summary_harian", tanggal),
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
  const label = status === "buka" ? "Sedang Berjalan" : status === "tutup" ? "Ditutup" : "Terkunci";
  return <span>{label}</span>;
}
