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
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { AppShell } from "@/shared/components/app-shell";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";

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
    <RequireAuth peranDiizinkan={["superadmin"]}>
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

function StatusBadge({ status }: { status: RiwayatShift["status"] }) {
  const label = status === "buka" ? "Sedang Berjalan" : status === "tutup" ? "Ditutup" : "Terkunci";
  return <span>{label}</span>;
}
