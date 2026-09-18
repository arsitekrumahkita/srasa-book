"use client";

// ============================================================
// Halaman: Kelola Outlet — Multi-Cabang dengan satu Owner terpusat
// (permintaan pemilik cafe: "Setiap Outlet fiturnya sama", SRASA
// BOOK adalah Outlet pertama). CRUD daftar Outlet (nama, alamat,
// aktif) di koleksi TOP-LEVEL `outlets/{outletId}` — satu-satunya
// struktur yang hidup DI ATAS seluruh data per-Outlet lainnya.
//
// KHUSUS OWNER MURNI (bukan "finance", walau finance biasanya
// setara Owner di DALAM satu Outlet) — mengatur Outlet itu sendiri
// adalah keputusan lintas-Outlet, jadi RequireAuth di sini memakai
// `hanyaOwnerMurni`. Juga `lewatiGatingOutlet` — halaman ini harus
// bisa dibuka SEBELUM Owner memilih Outlet mana pun (termasuk untuk
// membuat Outlet pertama kali, sebelum ada satu pun Outlet aktif).
//
// Top-level components, tidak bersarang.
// ============================================================

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { Building2, Loader2, Plus } from "lucide-react";
import { SearchBar, cocokDenganPencarian } from "@/shared/components/search-bar";
import { RequireAuth } from "@/shared/components/require-auth";
import { AppShell } from "@/shared/components/app-shell";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { JUDUL_LENGKAP_BRAND } from "@/shared/lib/brand";

interface OutletDaftar {
  id: string;
  nama: string;
  alamat: string;
  aktif: boolean;
}

export default function KelolaOutletPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin"]} hanyaOwnerMurni lewatiGatingOutlet>
      <AppShell>
        <KelolaOutletIsi />
      </AppShell>
    </RequireAuth>
  );
}

function KelolaOutletIsi() {
  const [memuat, setMemuat] = useState(true);
  const [daftar, setDaftar] = useState<OutletDaftar[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets"), orderBy("nama")),
      (snap) => {
        setDaftar(
          snap.docs.map((d) => ({
            id: d.id,
            nama: d.data().nama ?? "",
            alamat: d.data().alamat ?? "",
            aktif: d.data().aktif ?? true,
          })),
        );
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, []);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        {/* Tanpa `uppercase`: nama brand tampil persis seperti yang
            ditulis pemilik ("Jurnal F A T A"), bukan versi kapital. */}
        <p className="text-xs font-semibold tracking-wide text-emerald-700">
          {JUDUL_LENGKAP_BRAND}
        </p>
        <h1 className="text-2xl font-bold text-slate-900">Kelola Outlet</h1>
        <p className="mt-1 text-sm text-slate-500">
          Setiap Outlet berjalan mandiri dengan fitur yang sama persis
          (data shift, menu, bahan baku, kas, dsb terpisah total per
          Outlet). Akun Finance/Kasir/Purchasing ditautkan ke satu Outlet
          tetap lewat halaman Kelola Akun di dalam Outlet tersebut.
        </p>
      </header>

      {memuat ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Memuat data...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
          <TambahOutletKartu />
          <DaftarOutletKartu daftar={daftar} />
        </div>
      )}
    </main>
  );
}

function TambahOutletKartu() {
  const { showToast } = useToast();
  const [nama, setNama] = useState("");
  const [alamat, setAlamat] = useState("");
  const [sedangSimpan, setSedangSimpan] = useState(false);

  async function tambah() {
    if (!nama.trim()) {
      showToast("error", "Nama Outlet wajib diisi.");
      return;
    }
    setSedangSimpan(true);
    try {
      await addDoc(collection(db, "outlets"), {
        nama: nama.trim(),
        alamat: alamat.trim(),
        aktif: true,
        dibuatPada: serverTimestamp(),
      });
      setNama("");
      setAlamat("");
      showToast(
        "success",
        `Outlet "${nama.trim()}" ditambahkan. Buat akun Finance/Kasir/Purchasing untuk Outlet ini lewat Kelola Akun setelah memilih Outlet tersebut.`,
      );
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menambah Outlet: ${error.message}` : "Gagal menambah Outlet.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <Building2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Tambah Outlet Baru
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="nama-outlet" className="block text-xs font-medium text-slate-600">
            Nama Outlet
          </label>
          <input
            id="nama-outlet"
            type="text"
            value={nama}
            onChange={(event) => setNama(event.target.value)}
            placeholder="mis. SRASA BOOK Cabang Dua"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label htmlFor="alamat-outlet" className="block text-xs font-medium text-slate-600">
            Alamat (opsional)
          </label>
          <input
            id="alamat-outlet"
            type="text"
            value={alamat}
            onChange={(event) => setAlamat(event.target.value)}
            placeholder="mis. Jl. Contoh No. 1"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={tambah}
        disabled={sedangSimpan}
        className={[
          "mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm",
          "motion-safe:transition motion-safe:duration-150",
          sedangSimpan
            ? "cursor-not-allowed bg-emerald-400"
            : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
        ].join(" ")}
      >
        {sedangSimpan ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="h-4 w-4" aria-hidden="true" />
        )}
        {sedangSimpan ? "Menyimpan..." : "Tambah Outlet"}
      </button>
    </section>
  );
}

function DaftarOutletKartu({ daftar }: { daftar: OutletDaftar[] }) {
  const { showToast } = useToast();
  const [sedangProses, setSedangProses] = useState<string | null>(null);
  const [pencarian, setPencarian] = useState("");
  const daftarTersaring = daftar.filter((outlet) => cocokDenganPencarian(pencarian, outlet.nama, outlet.alamat));

  async function ubahAktif(outlet: OutletDaftar) {
    setSedangProses(outlet.id);
    try {
      await updateDoc(doc(db, "outlets", outlet.id), { aktif: !outlet.aktif });
      showToast(
        "success",
        !outlet.aktif
          ? `Outlet "${outlet.nama}" diaktifkan kembali.`
          : `Outlet "${outlet.nama}" dinonaktifkan (tidak muncul lagi di layar Pilih Outlet).`,
      );
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mengubah Outlet: ${error.message}` : "Gagal mengubah Outlet.",
      );
    } finally {
      setSedangProses(null);
    }
  }

  if (daftar.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
        <p className="text-sm text-slate-500">Belum ada Outlet. Tambahkan Outlet pertama di atas.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Daftar Outlet</h2>
      <div className="mt-3">
        <SearchBar
          id="cari-outlet"
          value={pencarian}
          onChange={setPencarian}
          placeholder="Cari nama atau alamat outlet..."
          ariaLabel="Cari outlet"
        />
      </div>
      {daftarTersaring.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Tidak ada outlet yang cocok dengan pencarian &quot;{pencarian}&quot;.</p>
      ) : (
      <ul className="mt-4 flex flex-col divide-y divide-slate-100">
        {daftarTersaring.map((outlet) => (
          <li key={outlet.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{outlet.nama}</p>
              {outlet.alamat ? (
                <p className="truncate text-xs text-slate-500">{outlet.alamat}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => ubahAktif(outlet)}
              disabled={sedangProses === outlet.id}
              className={[
                "inline-flex h-9 shrink-0 items-center rounded-full px-3 text-xs font-semibold motion-safe:transition disabled:opacity-50",
                outlet.aktif
                  ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200",
              ].join(" ")}
            >
              {sedangProses === outlet.id ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : outlet.aktif ? (
                "Aktif"
              ) : (
                "Nonaktif"
              )}
            </button>
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}
