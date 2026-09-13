"use client";

// ============================================================
// Halaman: Transaksi Finance — Saldo Deposito Finance (permintaan
// pemilik cafe). Sumber dana yang SENGAJA dipisah dari uang hasil
// penjualan (Omset): dipakai untuk Gaji Karyawan, Biaya Operasional
// yang diinput Finance (beda dengan Biaya Operasional yang diinput
// Kasir — itu tetap potong kas shift, lihat KATEGORI_KAS_KELUAR di
// src/app/shift/page.tsx), dan modal belanja Purchasing kalau
// memilih sumber "Saldo Finance" saat "Mulai Belanja" (lihat
// src/app/belanja-nota/page.tsx).
//
// NUANSA AKSES KHUSUS (beda dari hampir semua halaman lain di app
// ini): peran "finance" BIASANYA setara penuh dengan Owner
// (superadmin) — TAPI khusus domain Deposito Finance ini, Owner
// SENGAJA hanya boleh MEMANTAU (baca saldo & riwayat), TIDAK BOLEH
// mengeksekusi Uang Masuk/Keluar sama sekali (permintaan eksplisit
// pemilik cafe: "Owner tidak bisa"). Halaman ini karena itu tetap
// bisa DIBUKA Owner (nav item peran superadmin+finance, lihat
// app-shell.tsx), tapi kedua form di bawah cuma dirender aktif untuk
// akun berperan "finance" — firestore.rules yang menegakkan
// sungguhan (create/update transaksi_finance & saldo_finance HANYA
// isFinance(), bukan isSuperadmin()), UI ini cuma memberi kejelasan.
//
// Top-level components, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useState } from "react";
import { addDoc, collection, doc, increment, onSnapshot, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { ArrowDownCircle, ArrowUpCircle, Landmark, Loader2, Save } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { AppShell } from "@/shared/components/app-shell";
import { NumberField } from "@/shared/components/number-field";
import { useAuth } from "@/shared/lib/auth-context";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";

/** Dokumen tunggal — satu-satunya sumber kebenaran saldo Deposito
 *  Finance saat ini, diperbarui lewat increment() tiap transaksi
 *  (pola "tulis tanpa baca berulang" yang sama seperti summary_harian). */
const ID_SALDO_FINANCE = "utama";

const KATEGORI_KELUAR = ["Gaji Karyawan", "Biaya Operasional", "Lainnya"] as const;
type KategoriKeluar = (typeof KATEGORI_KELUAR)[number];

const SUB_KATEGORI_OPERASIONAL = ["Wifi", "Listrik", "PDAM (Air)", "Lainnya"] as const;

interface TransaksiFinance {
  id: string;
  arah: "masuk" | "keluar";
  kategori: string;
  subKategori: string;
  nominal: number;
  keterangan: string;
  financeNama: string;
  tanggal: string;
  waktuLabel: string;
}

function tanggalHariIni(): string {
  const sekarang = new Date();
  return `${sekarang.getFullYear()}-${String(sekarang.getMonth() + 1).padStart(2, "0")}-${String(
    sekarang.getDate(),
  ).padStart(2, "0")}`;
}

export default function TransaksiFinancePage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]}>
      <AppShell>
        <TransaksiFinanceIsi />
      </AppShell>
    </RequireAuth>
  );
}

function TransaksiFinanceIsi() {
  const { profil } = useAuth();
  const bisaEksekusi = profil?.peran === "finance";

  const [saldo, setSaldo] = useState(0);
  const [memuatSaldo, setMemuatSaldo] = useState(true);
  const [riwayat, setRiwayat] = useState<TransaksiFinance[]>([]);
  const [memuatRiwayat, setMemuatRiwayat] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "saldo_finance", ID_SALDO_FINANCE),
      (snap) => {
        setSaldo(snap.exists() ? (snap.data().saldo ?? 0) : 0);
        setMemuatSaldo(false);
      },
      () => setMemuatSaldo(false),
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "transaksi_finance"), orderBy("waktu", "desc")),
      (snap) => {
        setRiwayat(
          snap.docs.slice(0, 50).map((d) => ({
            id: d.id,
            arah: (d.data().arah ?? "keluar") as "masuk" | "keluar",
            kategori: d.data().kategori ?? "",
            subKategori: d.data().subKategori ?? "",
            nominal: d.data().nominal ?? 0,
            keterangan: d.data().keterangan ?? "",
            financeNama: d.data().financeNama ?? "",
            tanggal: d.data().tanggal ?? "",
            waktuLabel: d.data().waktu?.toDate?.()?.toLocaleString("id-ID") ?? "",
          })),
        );
        setMemuatRiwayat(false);
      },
      () => setMemuatRiwayat(false),
    );
    return unsub;
  }, []);

  return (
    <main className="animasi-masuk mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">SRASA BOOK</p>
        <h1 className="text-2xl font-bold text-slate-900">Transaksi Finance</h1>
        <p className="mt-1 text-sm text-slate-600">
          Saldo Deposito Finance — sumber dana DI LUAR Omset penjualan (pemberian dana langsung dari
          Owner), dipakai untuk Gaji Karyawan, Biaya Operasional, dan modal belanja Purchasing.
        </p>
      </header>

      {!bisaEksekusi ? (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Anda login sebagai Owner — halaman ini hanya untuk MEMANTAU. Menambah dana atau mencatat
          transaksi hanya bisa dieksekusi oleh akun berperan Finance.
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <section className="kartu-interaktif rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-emerald-800">
            <Landmark className="h-5 w-5" aria-hidden="true" />
            <p className="text-sm font-semibold">Saldo Deposito Finance</p>
          </div>
          {memuatSaldo ? (
            <div className="mt-2 flex justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-700" aria-hidden="true" />
            </div>
          ) : (
            <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-900">{formatRupiah(saldo)}</p>
          )}
        </section>

        {bisaEksekusi ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <TambahDanaKartu saldo={saldo} />
            <CatatTransaksiKeluarKartu saldo={saldo} />
          </div>
        ) : null}

        <section
          aria-labelledby="bagian-riwayat-finance"
          className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 id="bagian-riwayat-finance" className="text-base font-semibold text-slate-900">
            Riwayat Transaksi (50 terbaru)
          </h2>
          {memuatRiwayat ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          ) : riwayat.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Belum ada transaksi.</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-slate-100">
              {riwayat.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium text-slate-900">
                      {t.arah === "masuk" ? (
                        <ArrowDownCircle className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <ArrowUpCircle className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
                      )}
                      {t.kategori}
                      {t.subKategori ? ` · ${t.subKategori}` : ""}
                    </p>
                    <p className="text-xs text-slate-500">
                      {t.waktuLabel || t.tanggal} · {t.financeNama}
                      {t.keterangan ? ` — ${t.keterangan}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-semibold tabular-nums ${
                      t.arah === "masuk" ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {t.arah === "masuk" ? "+" : "-"}
                    {formatRupiah(t.nominal)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

// TambahDanaKartu & CatatTransaksiKeluarKartu didefinisikan di BAWAH ini
// sebagai komponen TOP-LEVEL (bukan bersarang di dalam TransaksiFinanceIsi)
// — supaya tidak memicu bug fokus/kursor hilang tiap ketik satu huruf,
// lihat webrules-hikimori poin 11.

function TambahDanaKartu({ saldo }: { saldo: number }) {
  const { user, profil } = useAuth();
  const { showToast } = useToast();
  const [nominal, setNominal] = useState(0);
  const [keterangan, setKeterangan] = useState("");
  const [sedangSimpan, setSedangSimpan] = useState(false);

  async function simpan() {
    if (!user || !profil) return;
    if (nominal <= 0) {
      showToast("error", "Nominal harus lebih dari 0.");
      return;
    }
    setSedangSimpan(true);
    try {
      await addDoc(collection(db, "transaksi_finance"), {
        arah: "masuk",
        kategori: "Tambah Dana",
        subKategori: "",
        nominal,
        keterangan: keterangan.trim(),
        financeUid: user.uid,
        financeNama: profil.nama,
        tanggal: tanggalHariIni(),
        waktu: serverTimestamp(),
      });
      await setDoc(
        doc(db, "saldo_finance", ID_SALDO_FINANCE),
        { saldo: increment(nominal) },
        { merge: true },
      );
      showToast("success", `Dana ${formatRupiah(nominal)} berhasil ditambahkan ke Saldo Deposito.`);
      setNominal(0);
      setKeterangan("");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menambah dana: ${error.message}` : "Gagal menambah dana.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <section className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <ArrowDownCircle className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        Tambah Dana (Uang Masuk)
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Pemberian dana dari Owner DI LUAR Omset penjualan — menambah Saldo Deposito Finance.
      </p>
      <div className="mt-3">
        <NumberField id="tf-tambah-nominal" label="Nominal" value={nominal} onChange={setNominal} prefix="Rp" />
      </div>
      <div className="mt-3">
        <label htmlFor="tf-tambah-keterangan" className="block text-sm font-semibold text-slate-800">
          Keterangan
        </label>
        <textarea
          id="tf-tambah-keterangan"
          value={keterangan}
          onChange={(e) => setKeterangan(e.target.value)}
          rows={2}
          placeholder="misalnya: Setoran modal dari Owner"
          className="mt-1.5 w-full whitespace-pre-line rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 motion-safe:transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700"
        />
      </div>
      <button
        type="button"
        onClick={simpan}
        disabled={sedangSimpan}
        className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm motion-safe:transition active:scale-[0.98] disabled:opacity-60"
      >
        {sedangSimpan ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="h-4 w-4" aria-hidden="true" />
        )}
        Tambah Dana
      </button>
      <p className="mt-2 text-[11px] text-slate-400">Saldo saat ini: {formatRupiah(saldo)}</p>
    </section>
  );
}

function CatatTransaksiKeluarKartu({ saldo }: { saldo: number }) {
  const { user, profil } = useAuth();
  const { showToast } = useToast();
  const [kategori, setKategori] = useState<KategoriKeluar>("Gaji Karyawan");
  const [subKategoriOperasional, setSubKategoriOperasional] = useState<(typeof SUB_KATEGORI_OPERASIONAL)[number]>(
    SUB_KATEGORI_OPERASIONAL[0],
  );
  const [namaKaryawan, setNamaKaryawan] = useState("");
  const [nominal, setNominal] = useState(0);
  const [keterangan, setKeterangan] = useState("");
  const [sedangSimpan, setSedangSimpan] = useState(false);

  async function simpan() {
    if (!user || !profil) return;
    if (nominal <= 0) {
      showToast("error", "Nominal harus lebih dari 0.");
      return;
    }
    if (nominal > saldo) {
      showToast("error", `Saldo Deposito Finance tidak cukup — sisa saldo ${formatRupiah(saldo)}.`);
      return;
    }
    if (kategori === "Gaji Karyawan" && namaKaryawan.trim() === "") {
      showToast("error", "Isi nama karyawan terlebih dahulu.");
      return;
    }

    const subKategori = kategori === "Biaya Operasional" ? subKategoriOperasional : kategori === "Gaji Karyawan" ? namaKaryawan.trim() : "";

    setSedangSimpan(true);
    try {
      await addDoc(collection(db, "transaksi_finance"), {
        arah: "keluar",
        kategori,
        subKategori,
        nominal,
        keterangan: keterangan.trim(),
        financeUid: user.uid,
        financeNama: profil.nama,
        tanggal: tanggalHariIni(),
        waktu: serverTimestamp(),
      });
      await setDoc(
        doc(db, "saldo_finance", ID_SALDO_FINANCE),
        { saldo: increment(-nominal) },
        { merge: true },
      );
      showToast("success", "Transaksi berhasil dicatat.");
      setNominal(0);
      setKeterangan("");
      setNamaKaryawan("");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mencatat transaksi: ${error.message}` : "Gagal mencatat transaksi.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <section className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <ArrowUpCircle className="h-4 w-4 text-rose-600" aria-hidden="true" />
        Catat Transaksi (Uang Keluar)
      </h2>
      <p className="mt-1 text-xs text-slate-500">Gaji Karyawan, Biaya Operasional, atau lainnya.</p>

      <div className="mt-3">
        <label htmlFor="tf-kategori" className="block text-sm font-semibold text-slate-800">
          Kategori
        </label>
        <select
          id="tf-kategori"
          value={kategori}
          onChange={(e) => setKategori(e.target.value as KategoriKeluar)}
          className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 motion-safe:transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700"
        >
          {KATEGORI_KELUAR.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      {kategori === "Gaji Karyawan" ? (
        <div className="mt-3">
          <label htmlFor="tf-nama-karyawan" className="block text-sm font-semibold text-slate-800">
            Nama Karyawan
          </label>
          <input
            id="tf-nama-karyawan"
            type="text"
            value={namaKaryawan}
            onChange={(e) => setNamaKaryawan(e.target.value)}
            placeholder="misalnya: Budi"
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 motion-safe:transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700"
          />
        </div>
      ) : null}

      {kategori === "Biaya Operasional" ? (
        <div className="mt-3">
          <label htmlFor="tf-sub-operasional" className="block text-sm font-semibold text-slate-800">
            Jenis Biaya
          </label>
          <select
            id="tf-sub-operasional"
            value={subKategoriOperasional}
            onChange={(e) =>
              setSubKategoriOperasional(e.target.value as (typeof SUB_KATEGORI_OPERASIONAL)[number])
            }
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 motion-safe:transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700"
          >
            {SUB_KATEGORI_OPERASIONAL.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="mt-3">
        <NumberField id="tf-keluar-nominal" label="Nominal" value={nominal} onChange={setNominal} prefix="Rp" />
      </div>

      <div className="mt-3">
        <label htmlFor="tf-keluar-keterangan" className="block text-sm font-semibold text-slate-800">
          Keterangan
        </label>
        <textarea
          id="tf-keluar-keterangan"
          value={keterangan}
          onChange={(e) => setKeterangan(e.target.value)}
          rows={2}
          placeholder="Opsional"
          className="mt-1.5 w-full whitespace-pre-line rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 motion-safe:transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700"
        />
      </div>

      <button
        type="button"
        onClick={simpan}
        disabled={sedangSimpan}
        className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white shadow-sm motion-safe:transition active:scale-[0.98] disabled:opacity-60"
      >
        {sedangSimpan ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="h-4 w-4" aria-hidden="true" />
        )}
        Catat Transaksi
      </button>
      <p className="mt-2 text-[11px] text-slate-400">Saldo saat ini: {formatRupiah(saldo)}</p>
    </section>
  );
}
