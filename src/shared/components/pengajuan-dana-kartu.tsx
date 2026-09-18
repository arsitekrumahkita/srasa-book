"use client";

// ============================================================
// Kartu "Pengajuan Dana" sisi PURCHASING — mengajukan tambahan dana
// ke Saldo Finance dan memantau statusnya.
//
// Ditaruh di src/shared/components (bukan di dalam page) SENGAJA:
// src/app/belanja-nota/page.tsx sudah sangat panjang, dan kartu ini
// benar-benar mandiri (mengurus datanya sendiri lewat onSnapshot).
// Bukan pelanggaran Rule of Two — ini pemisahan supaya file halaman
// tetap terbaca.
//
// Purchasing TIDAK PERNAH bisa menaikkan saldo sendiri: kartu ini
// hanya membuat dokumen pengajuan berstatus 'menunggu'. Penambahan
// saldo baru terjadi saat Finance menekan Setujui (lihat
// setujuiPengajuanDana di src/shared/lib/pengajuan-dana.ts dan
// bagian pengajuan_dana di firestore.rules).
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { HandCoins, Loader2, Send } from "lucide-react";
import { NumberField } from "@/shared/components/number-field";
import { useToast } from "@/shared/components/toast";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutletId } from "@/shared/lib/outlet-context";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { ajukanDana, type PengajuanDana, type StatusPengajuan } from "@/shared/lib/pengajuan-dana";

function tanggalHariIni(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const GAYA_STATUS: Record<StatusPengajuan, string> = {
  menunggu: "bg-amber-50 text-amber-700",
  disetujui: "bg-emerald-50 text-emerald-700",
  ditolak: "bg-rose-50 text-rose-700",
};

const LABEL_STATUS: Record<StatusPengajuan, string> = {
  menunggu: "Menunggu Finance",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
};

export function PengajuanDanaKartu() {
  const { user, profil } = useAuth();
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [nominal, setNominal] = useState(0);
  const [keperluan, setKeperluan] = useState("");
  const [sedangKirim, setSedangKirim] = useState(false);
  const [daftar, setDaftar] = useState<PengajuanDana[]>([]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "pengajuan_dana"), where("purchasingUid", "==", user.uid)),
      (snap) => {
        setDaftar(
          snap.docs
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
            .sort((a, b) => (b.waktu?.getTime() ?? 0) - (a.waktu?.getTime() ?? 0))
            .slice(0, 10),
        );
      },
    );
    return unsub;
  }, [user, outletId]);

  async function handleKirim() {
    if (!user || !profil) return;
    if (nominal <= 0) {
      showToast("error", "Nominal pengajuan harus lebih besar dari 0.");
      return;
    }
    if (!keperluan.trim()) {
      showToast("error", "Isi keperluan dananya — Finance perlu tahu untuk apa dana ini.");
      return;
    }
    setSedangKirim(true);
    try {
      await ajukanDana(outletId, {
        purchasingUid: user.uid,
        purchasingNama: profil.nama,
        nominal,
        keperluan: keperluan.trim(),
        tanggal: tanggalHariIni(),
      });
      showToast("success", `Pengajuan ${formatRupiah(nominal)} terkirim — menunggu persetujuan Finance.`);
      setNominal(0);
      setKeperluan("");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mengirim pengajuan: ${error.message}` : "Gagal mengirim pengajuan.",
      );
    } finally {
      setSedangKirim(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-pengajuan-dana"
      className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="bagian-pengajuan-dana"
        className="flex items-center gap-2 text-base font-semibold text-slate-900"
      >
        <HandCoins className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Pengajuan Dana
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Minta tambahan dana ke Saldo Finance. Saldo baru bertambah setelah Finance menyetujui — Anda tidak
        bisa menambah saldo sendiri.
      </p>

      <div className="mt-4">
        <NumberField
          id="pengajuan-nominal"
          label="Nominal Diajukan"
          value={nominal}
          onChange={setNominal}
          prefix="Rp"
        />
      </div>

      <div className="mt-3">
        <label htmlFor="pengajuan-keperluan" className="block text-sm font-semibold text-slate-800">
          Keperluan
        </label>
        <textarea
          id="pengajuan-keperluan"
          value={keperluan}
          onChange={(e) => setKeperluan(e.target.value)}
          rows={2}
          placeholder="misalnya: Belanja stok kopi & gula minggu ini"
          className="mt-1.5 w-full whitespace-pre-line rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 motion-safe:transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700"
        />
      </div>

      <button
        type="button"
        onClick={handleKirim}
        disabled={sedangKirim}
        className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm motion-safe:transition active:scale-[0.98] disabled:opacity-60"
      >
        {sedangKirim ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="h-4 w-4" aria-hidden="true" />
        )}
        {sedangKirim ? "Mengirim..." : "Kirim Pengajuan"}
      </button>

      {daftar.length > 0 ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pengajuan Terakhir</p>
          <ul className="mt-2 flex flex-col divide-y divide-slate-100">
            {daftar.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium tabular-nums text-slate-900">
                    {formatRupiah(p.nominal)}
                    {p.status === "disetujui" && p.nominalDisetujui !== p.nominal ? (
                      <span className="ml-1 text-xs font-normal text-emerald-700">
                        (disetujui {formatRupiah(p.nominalDisetujui)})
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-slate-500">{p.keperluan}</p>
                  {p.catatanFinance ? (
                    <p className="mt-0.5 text-xs text-slate-400">
                      Catatan Finance: {p.catatanFinance}
                    </p>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${GAYA_STATUS[p.status]}`}
                >
                  {LABEL_STATUS[p.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
