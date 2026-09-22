"use client";

// ============================================================
// Komponen: Hutang Supplier (Hutang Usaha) — dipakai LINTAS HALAMAN
// (Belanja & Nota untuk Purchasing, Transaksi Finance untuk Finance)
// -> shared (Rule of Two). Menampilkan daftar Hutang Supplier per
// Outlet: supplier titip barang dulu, dibayar belakangan (termin) —
// atas pertanyaan pemilik cafe apakah ini bisa masuk Neraca (bisa,
// sebagai Kewajiban, lihat NeracaFinanceKartu di dashboard/page.tsx).
//
// Pencatatan HUTANG BARU dilakukan Purchasing lewat NotaKartu di
// belanja-nota/page.tsx (bukan komponen ini) — komponen ini HANYA
// menampilkan daftar & tombol "Tandai Lunas". Kedua peran (Finance
// MAUPUN Purchasing) boleh menandai lunas, sesuai permintaan pemilik
// cafe ("siapa pun yang lebih dulu tahu pembayaran terjadi") — lihat
// firestore.rules bagian hutang_supplier.
//
// Menandai lunas SEKALIGUS memotong Saldo Deposito Finance (writeBatch
// atomik) — pembayaran ke supplier dianggap keluar dari situ, sama
// seperti sumber dana belanja lain di aplikasi ini.
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, increment, writeBatch, serverTimestamp } from "firebase/firestore";
import { CheckCircle2, Landmark, Loader2 } from "lucide-react";
import { useAuth } from "@/shared/lib/auth-context";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { useToast } from "@/shared/components/toast";

/** ID dokumen tunggal Saldo Deposito Finance — sama dengan
 *  src/app/transaksi-finance/page.tsx & src/app/belanja-nota/page.tsx. */
const ID_SALDO_FINANCE = "utama";

export interface HutangSupplier {
  id: string;
  tanggal: string;
  namaSupplier: string;
  nominal: number;
  catatan: string;
  purchasingNama: string;
  status: "belum_lunas" | "lunas";
  dilunasiOlehNama?: string;
}

export function useHutangSupplier(outletId: string): { daftar: HutangSupplier[]; memuat: boolean } {
  const [daftar, setDaftar] = useState<HutangSupplier[]>([]);
  const [memuat, setMemuat] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "hutang_supplier"), orderBy("tanggal", "desc")),
      (snap) => {
        setDaftar(
          snap.docs.map((d) => ({
            id: d.id,
            tanggal: d.data().tanggal ?? "",
            namaSupplier: d.data().namaSupplier ?? "",
            nominal: d.data().nominal ?? 0,
            catatan: d.data().catatan ?? "",
            purchasingNama: d.data().purchasingNama ?? "",
            status: d.data().status === "lunas" ? "lunas" : "belum_lunas",
            dilunasiOlehNama: d.data().dilunasiOlehNama ?? undefined,
          })),
        );
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, [outletId]);

  return { daftar, memuat };
}

export function HutangSupplierKartu({ outletId }: { outletId: string }) {
  const { user, profil } = useAuth();
  const { showToast } = useToast();
  const { daftar, memuat } = useHutangSupplier(outletId);
  const [sedangLunas, setSedangLunas] = useState<string | null>(null);

  const belumLunas = daftar.filter((h) => h.status === "belum_lunas");
  const totalBelumLunas = belumLunas.reduce((t, h) => t + h.nominal, 0);

  async function tandaiLunas(hutang: HutangSupplier) {
    if (!user || !profil) return;
    setSedangLunas(hutang.id);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "outlets", outletId, "hutang_supplier", hutang.id), {
        status: "lunas",
        dilunasiOlehUid: user.uid,
        dilunasiOlehNama: profil.nama,
        waktuLunas: serverTimestamp(),
      });
      batch.set(
        doc(db, "outlets", outletId, "saldo_finance", ID_SALDO_FINANCE),
        { saldo: increment(-hutang.nominal) },
        { merge: true },
      );
      await batch.commit();
      showToast("success", `Hutang ke "${hutang.namaSupplier}" (${formatRupiah(hutang.nominal)}) ditandai lunas.`);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menandai lunas: ${error.message}` : "Gagal menandai lunas.",
      );
    } finally {
      setSedangLunas(null);
    }
  }

  return (
    <section
      aria-labelledby="bagian-hutang-supplier"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="bagian-hutang-supplier" className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Landmark className="h-4 w-4 text-emerald-700" aria-hidden="true" />
          Hutang Supplier
        </h2>
        {belumLunas.length > 0 ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
            {formatRupiah(totalBelumLunas)} belum lunas
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Nota yang dibayar belakangan (supplier titip barang dulu, dibayar di akhir/termin). Barangnya sudah
        masuk stok seperti biasa — ini cuma catatan Hutang-nya, ikut ditampilkan di Neraca sebagai Kewajiban.
      </p>

      {memuat ? (
        <div className="mt-4 flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      ) : daftar.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          Belum ada Hutang Supplier tercatat.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200">
          {daftar.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5 text-sm">
              <div>
                <p className="font-medium text-slate-900">
                  {h.namaSupplier} <span className="text-xs font-normal text-slate-500">· {h.tanggal}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {formatRupiah(h.nominal)} · dicatat {h.purchasingNama}
                  {h.catatan ? ` · ${h.catatan}` : ""}
                </p>
              </div>
              {h.status === "lunas" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Lunas{h.dilunasiOlehNama ? ` · ${h.dilunasiOlehNama}` : ""}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => tandaiLunas(h)}
                  disabled={sedangLunas === h.id}
                  aria-busy={sedangLunas === h.id}
                  className={[
                    "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white shadow-sm",
                    "motion-safe:transition motion-safe:duration-150",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
                    sedangLunas === h.id
                      ? "cursor-not-allowed bg-emerald-400"
                      : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
                  ].join(" ")}
                >
                  {sedangLunas === h.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Tandai Lunas
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
