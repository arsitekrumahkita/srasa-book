"use client";

// ============================================================
// Kartu "Permintaan Koreksi Belanja" sisi FINANCE — menyetujui atau
// menolak permintaan Purchasing untuk mengubah/menghapus item belanja
// yang sudah tersimpan.
//
// Inilah gerbang anti-kecurangan yang diminta pemilik cafe: item
// belanja memotong Saldo Finance begitu disimpan, jadi koreksinya
// tidak boleh bisa dilakukan sendiri oleh yang mencatat. Finance
// melihat SELALU data lama vs data baru berdampingan supaya
// perbedaannya tidak bisa diselundupkan.
//
// Efek persetujuan (item, total belanja, stok, saldo, mutasi) ditulis
// satu batch atomik di setujuiPermintaanUbah() —
// src/shared/lib/permintaan-ubah-belanja.ts.
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { ArrowRight, CheckCircle2, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { useToast } from "@/shared/components/toast";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutletId } from "@/shared/lib/outlet-context";
import { formatRupiah } from "@/shared/lib/format";
import {
  bacaPermintaan,
  kueriPermintaanMenunggu,
  setujuiPermintaanUbah,
  tolakPermintaanUbah,
  type PermintaanUbahBelanja,
} from "@/shared/lib/permintaan-ubah-belanja";

function tanggalHariIni(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TinjauKoreksiBelanjaKartu({ bisaEksekusi }: { bisaEksekusi: boolean }) {
  const { user, profil } = useAuth();
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [daftar, setDaftar] = useState<PermintaanUbahBelanja[]>([]);
  const [catatan, setCatatan] = useState<Record<string, string>>({});
  const [sedangProses, setSedangProses] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(kueriPermintaanMenunggu(outletId), (snap) => {
      setDaftar(
        snap.docs
          .map((d) => bacaPermintaan(d.id, d.data()))
          .sort((a, b) => (a.waktu?.getTime() ?? 0) - (b.waktu?.getTime() ?? 0)),
      );
    });
    return unsub;
  }, [outletId]);

  async function handleSetuju(p: PermintaanUbahBelanja) {
    if (!user || !profil) return;
    setSedangProses(p.id);
    try {
      await setujuiPermintaanUbah(
        outletId,
        p,
        { uid: user.uid, nama: profil.nama },
        (catatan[p.id] ?? "").trim(),
        tanggalHariIni(),
      );
      showToast("success", "Koreksi disetujui — item, stok, dan saldo sudah disesuaikan.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menyetujui: ${error.message}` : "Gagal menyetujui koreksi.",
      );
    } finally {
      setSedangProses(null);
    }
  }

  async function handleTolak(p: PermintaanUbahBelanja) {
    if (!user || !profil) return;
    setSedangProses(p.id);
    try {
      await tolakPermintaanUbah(
        outletId,
        p.id,
        { uid: user.uid, nama: profil.nama },
        (catatan[p.id] ?? "").trim(),
      );
      showToast("success", "Permintaan koreksi ditolak. Tidak ada data yang berubah.");
    } catch (error) {
      showToast("error", error instanceof Error ? `Gagal menolak: ${error.message}` : "Gagal menolak.");
    } finally {
      setSedangProses(null);
    }
  }

  return (
    <section
      aria-labelledby="bagian-tinjau-koreksi"
      className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="bagian-tinjau-koreksi"
        className="flex items-center gap-2 text-sm font-semibold text-slate-900"
      >
        <ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />
        Permintaan Koreksi Belanja
        {daftar.length > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            {daftar.length} menunggu
          </span>
        ) : null}
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Item belanja terkunci setelah disimpan. Perubahan hanya berlaku setelah Anda menyetujuinya di sini.
      </p>

      {!bisaEksekusi ? (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          Anda bisa memantau, tapi persetujuan koreksi hanya bisa dieksekusi akun berperan Finance.
        </p>
      ) : null}

      {daftar.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          Tidak ada permintaan koreksi yang menunggu.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {daftar.map((p) => (
            <li key={p.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{p.bahanNama}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    p.jenis === "hapus" ? "bg-rose-50 text-rose-700" : "bg-sky-50 text-sky-700"
                  }`}
                >
                  {p.jenis === "hapus" ? "Minta HAPUS" : "Minta UBAH"}
                </span>
                <span className="text-xs text-slate-500">
                  oleh {p.purchasingNama} · {p.tanggal}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2.5 text-sm">
                <span className="tabular-nums text-slate-600">
                  {p.qtyLama} {p.satuan} · {formatRupiah(p.subtotalLama)}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span
                  className={`font-semibold tabular-nums ${
                    p.jenis === "hapus" ? "text-rose-700" : "text-slate-900"
                  }`}
                >
                  {p.jenis === "hapus"
                    ? "dihapus"
                    : `${p.qtyBaru} ${p.satuan} · ${formatRupiah(p.subtotalBaru)}`}
                </span>
              </div>

              <p className="mt-2 text-xs text-slate-600">
                <span className="font-semibold">Alasan:</span> {p.alasan}
              </p>

              {p.sumberDana === "saldo_finance" ? (
                <p className="mt-1 text-xs text-emerald-800">
                  Dampak Saldo Finance jika disetujui:{" "}
                  <span className="font-semibold tabular-nums">
                    {formatRupiah(p.subtotalLama - (p.jenis === "hapus" ? 0 : p.subtotalBaru))}
                  </span>{" "}
                  dikembalikan ke saldo.
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  Sumber dana Kas Resto/Outlet — Saldo Finance tidak terpengaruh.
                </p>
              )}

              {bisaEksekusi ? (
                <>
                  <div className="mt-2">
                    <label
                      htmlFor={`catatan-koreksi-${p.id}`}
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Catatan (opsional)
                    </label>
                    <input
                      id={`catatan-koreksi-${p.id}`}
                      type="text"
                      value={catatan[p.id] ?? ""}
                      onChange={(e) => setCatatan((prev) => ({ ...prev, [p.id]: e.target.value }))}
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
                      Setujui Koreksi
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
