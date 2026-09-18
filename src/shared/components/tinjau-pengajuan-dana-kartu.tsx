"use client";

// ============================================================
// Kartu "Tinjau Pengajuan Dana" sisi FINANCE — menyetujui/menolak
// pengajuan dana dari Purchasing. Persetujuan inilah satu-satunya
// cara Purchasing bisa menambah Saldo Finance.
//
// AKSES: sama dengan seluruh halaman Transaksi Finance — Owner boleh
// MEMANTAU, tapi hanya akun berperan "finance" yang boleh
// MENGEKSEKUSI (permintaan eksplisit pemilik cafe: "Owner tidak
// bisa"). UI di bawah menonaktifkan tombolnya untuk Owner, dan
// firestore.rules yang menegakkan sungguhan (update pengajuan_dana &
// saldo_finance HANYA isFinanceOutlet()).
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { CheckCircle2, ClipboardCheck, Loader2, XCircle } from "lucide-react";
import { NumberField } from "@/shared/components/number-field";
import { useToast } from "@/shared/components/toast";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutletId } from "@/shared/lib/outlet-context";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import {
  setujuiPengajuanDana,
  tolakPengajuanDana,
  type PengajuanDana,
  type StatusPengajuan,
} from "@/shared/lib/pengajuan-dana";

function tanggalHariIni(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TinjauPengajuanDanaKartu({ bisaEksekusi }: { bisaEksekusi: boolean }) {
  const { user, profil } = useAuth();
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [daftar, setDaftar] = useState<PengajuanDana[]>([]);
  const [nominalSetuju, setNominalSetuju] = useState<Record<string, number>>({});
  const [catatan, setCatatan] = useState<Record<string, string>>({});
  const [sedangProses, setSedangProses] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "pengajuan_dana"), where("status", "==", "menunggu")),
      (snap) => {
        const baris = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              tanggal: data.tanggal ?? "",
              waktu: data.waktu?.toDate?.() ?? null,
              purchasingUid: data.purchasingUid ?? "",
              purchasingNama: data.purchasingNama ?? "",
              nominal: data.nominal ?? 0,
              nominalDisetujui: data.nominalDisetujui ?? 0,
              keperluan: data.keperluan ?? "",
              status: (data.status ?? "menunggu") as StatusPengajuan,
              ditinjauOlehNama: data.ditinjauOlehNama ?? "",
              catatanFinance: data.catatanFinance ?? "",
            } satisfies PengajuanDana;
          })
          .sort((a, b) => (a.waktu?.getTime() ?? 0) - (b.waktu?.getTime() ?? 0));
        setDaftar(baris);
        // Nominal persetujuan default = yang diminta; Finance bebas
        // menurunkannya (persetujuan sebagian) sebelum menekan Setujui.
        setNominalSetuju((prev) => {
          const berikutnya = { ...prev };
          for (const p of baris) {
            if (berikutnya[p.id] === undefined) berikutnya[p.id] = p.nominal;
          }
          return berikutnya;
        });
      },
    );
    return unsub;
  }, [outletId]);

  async function handleSetuju(pengajuan: PengajuanDana) {
    if (!user || !profil) return;
    const nominal = nominalSetuju[pengajuan.id] ?? pengajuan.nominal;
    if (nominal <= 0) {
      showToast("error", "Nominal yang disetujui harus lebih besar dari 0. Pakai Tolak bila tidak disetujui.");
      return;
    }
    setSedangProses(pengajuan.id);
    try {
      await setujuiPengajuanDana(
        outletId,
        pengajuan,
        nominal,
        { uid: user.uid, nama: profil.nama },
        (catatan[pengajuan.id] ?? "").trim(),
        tanggalHariIni(),
      );
      showToast("success", `Pengajuan disetujui — Saldo Finance bertambah ${formatRupiah(nominal)}.`);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menyetujui: ${error.message}` : "Gagal menyetujui pengajuan.",
      );
    } finally {
      setSedangProses(null);
    }
  }

  async function handleTolak(pengajuan: PengajuanDana) {
    if (!user || !profil) return;
    setSedangProses(pengajuan.id);
    try {
      await tolakPengajuanDana(
        outletId,
        pengajuan.id,
        { uid: user.uid, nama: profil.nama },
        (catatan[pengajuan.id] ?? "").trim(),
      );
      showToast("success", "Pengajuan ditolak. Saldo Finance tidak berubah.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menolak: ${error.message}` : "Gagal menolak pengajuan.",
      );
    } finally {
      setSedangProses(null);
    }
  }

  return (
    <section
      aria-labelledby="bagian-tinjau-pengajuan"
      className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="bagian-tinjau-pengajuan"
        className="flex items-center gap-2 text-sm font-semibold text-slate-900"
      >
        <ClipboardCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Pengajuan Dana Purchasing
        {daftar.length > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            {daftar.length} menunggu
          </span>
        ) : null}
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Menyetujui akan menambah Saldo Finance sejumlah nominal yang disetujui, dan tercatat di Mutasi.
      </p>

      {!bisaEksekusi ? (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          Anda bisa memantau, tapi persetujuan dana hanya bisa dieksekusi akun berperan Finance.
        </p>
      ) : null}

      {daftar.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          Tidak ada pengajuan yang menunggu.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {daftar.map((p) => (
            <li key={p.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{p.purchasingNama}</p>
                  <p className="text-xs text-slate-500">
                    {p.tanggal} · minta {formatRupiah(p.nominal)}
                  </p>
                </div>
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm text-slate-700">{p.keperluan}</p>

              {bisaEksekusi ? (
                <>
                  <div className="mt-3">
                    <NumberField
                      id={`setuju-nominal-${p.id}`}
                      label="Nominal Disetujui"
                      value={nominalSetuju[p.id] ?? p.nominal}
                      onChange={(v) => setNominalSetuju((prev) => ({ ...prev, [p.id]: v }))}
                      prefix="Rp"
                    />
                  </div>
                  <div className="mt-2">
                    <label
                      htmlFor={`catatan-${p.id}`}
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Catatan (opsional)
                    </label>
                    <input
                      id={`catatan-${p.id}`}
                      type="text"
                      value={catatan[p.id] ?? ""}
                      onChange={(e) => setCatatan((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder="misalnya: disetujui sebagian, sisanya minggu depan"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                    />
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => handleSetuju(p)}
                      disabled={sedangProses !== null}
                      className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white motion-safe:transition hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-60"
                    >
                      {sedangProses === p.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      )}
                      Setujui
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTolak(p)}
                      disabled={sedangProses !== null}
                      className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-300 px-3 text-sm font-semibold text-rose-700 motion-safe:transition hover:bg-rose-50 active:scale-[0.98] disabled:opacity-60"
                    >
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                      Tolak
                    </button>
                  </div>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
