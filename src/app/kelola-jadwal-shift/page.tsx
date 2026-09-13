"use client";

// ============================================================
// Halaman: Jadwal Shift — Finance/Owner mengatur daftar SLOT SHIFT
// (permintaan pemilik cafe: "Finance juga yang atur pembagian shift").
//
// BENTUK YANG DIPILIH (jawaban eksplisit pemilik cafe atas 3
// pertanyaan klarifikasi): daftar Slot Shift SAJA — bukan roster
// penugasan per tanggal/per Kasir. Kasir sendiri yang memilih slot
// mana saat halaman /shift membuat shift otomatis (self-service, lihat
// src/app/shift/page.tsx). Kalau slot aktif cuma satu (atau nol),
// Kasir tidak perlu memilih apa-apa — perilaku persis seperti sebelum
// fitur ini ada.
//
// TRANSISI PERGANTIAN SHIFT (mis. Shift 1: 08.00-17.00, Shift 2:
// 15.00-24.00 — ada 2 jam semua shift bertemu): laci kas fisiknya
// SAMA/dipakai bersama (jawaban eksplisit pemilik cafe), jadi Shift 2
// BISA membuka shift sendiri (dokumen shift terpisah, kasirUid
// berbeda) meski Shift 1 belum menutup shift-nya — skema `shift`
// (kasirUid+tanggal) sudah otomatis mendukung ini tanpa perubahan.
// Yang ditambahkan supaya transisi ini rapi adalah jejak "Serah Terima
// Kas" (lihat SerahTerimaKasKartu & banner di src/app/shift/page.tsx),
// murni catatan audit — TIDAK memengaruhi Modal Kas Awal (tetap FLAT
// Rp500.000 untuk semua slot, jawaban eksplisit pemilik cafe) maupun
// perhitungan keuangan lain.
//
// Akses: peran superadmin & finance SAMA RATA (bukan domain uang
// masuk/keluar seperti Saldo Deposito Finance, jadi tidak memakai
// nuansa "Owner tidak bisa" — lihat firestore.rules bagian slot_shift).
//
// Top-level components, tidak bersarang.
// ============================================================

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { CalendarClock, Loader2, Plus, Trash2 } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { useToast } from "@/shared/components/toast";
import { useOutletId } from "@/shared/lib/outlet-context";
import { db } from "@/shared/lib/firebase";

interface SlotShift {
  id: string;
  nama: string;
  jamMulai: string;
  jamSelesai: string;
  aktif: boolean;
}

export default function KelolaJadwalShiftPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]}>
      <AppShell>
        <KelolaJadwalShiftIsi />
      </AppShell>
    </RequireAuth>
  );
}

function KelolaJadwalShiftIsi() {
  const outletId = useOutletId();
  const [memuat, setMemuat] = useState(true);
  const [daftarSlot, setDaftarSlot] = useState<SlotShift[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "slot_shift"), orderBy("jamMulai")),
      (snap) => {
        setDaftarSlot(
          snap.docs.map((d) => ({
            id: d.id,
            nama: d.data().nama ?? "",
            jamMulai: d.data().jamMulai ?? "",
            jamSelesai: d.data().jamSelesai ?? "",
            aktif: d.data().aktif ?? true,
          })),
        );
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, [outletId]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <KickerOutlet />
        <h1 className="text-2xl font-bold text-slate-900">Jadwal Shift</h1>
        <p className="mt-1 text-sm text-slate-500">
          Atur daftar Slot Shift (nama + jam mulai/selesai). Kasir akan
          memilih salah satu slot ini sendiri saat membuka shift di halaman
          Shift — kalau cuma ada satu slot aktif (atau belum ada sama
          sekali), Kasir tidak perlu memilih apa-apa.
        </p>
      </header>

      {memuat ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Memuat data...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
          <TambahSlotKartu />
          <DaftarSlotKartu daftarSlot={daftarSlot} />
        </div>
      )}
    </main>
  );
}

function TambahSlotKartu() {
  const { showToast } = useToast();
  const outletId = useOutletId();
  const [nama, setNama] = useState("");
  const [jamMulai, setJamMulai] = useState("");
  const [jamSelesai, setJamSelesai] = useState("");
  const [sedangSimpan, setSedangSimpan] = useState(false);

  async function tambahSlot() {
    if (!nama.trim() || !jamMulai || !jamSelesai) {
      showToast("error", "Nama, jam mulai, dan jam selesai wajib diisi.");
      return;
    }
    setSedangSimpan(true);
    try {
      await addDoc(collection(db, "outlets", outletId, "slot_shift"), {
        nama: nama.trim(),
        jamMulai,
        jamSelesai,
        aktif: true,
        dibuatPada: serverTimestamp(),
      });
      setNama("");
      setJamMulai("");
      setJamSelesai("");
      showToast("success", `Slot "${nama.trim()}" ditambahkan.`);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menambah slot: ${error.message}` : "Gagal menambah slot.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <CalendarClock className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Tambah Slot Shift
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label htmlFor="nama-slot" className="block text-xs font-medium text-slate-600">
            Nama Slot
          </label>
          <input
            id="nama-slot"
            type="text"
            value={nama}
            onChange={(event) => setNama(event.target.value)}
            placeholder="mis. Shift 1"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label htmlFor="jam-mulai" className="block text-xs font-medium text-slate-600">
            Jam Mulai
          </label>
          <input
            id="jam-mulai"
            type="time"
            value={jamMulai}
            onChange={(event) => setJamMulai(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label htmlFor="jam-selesai" className="block text-xs font-medium text-slate-600">
            Jam Selesai
          </label>
          <input
            id="jam-selesai"
            type="time"
            value={jamSelesai}
            onChange={(event) => setJamSelesai(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Jam selesai boleh lebih kecil dari jam mulai untuk slot yang
        melewati tengah malam (mis. 15.00–24.00 ditulis 15:00–00:00).
        Kalau ada 2 slot yang jam-nya beririsan (transisi pergantian
        shift), itu memang wajar — laci kas fisik dipakai bersama, dan
        Kasir bisa mencatat Serah Terima Kas di halaman Shift.
      </p>
      <button
        type="button"
        onClick={tambahSlot}
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
        {sedangSimpan ? "Menyimpan..." : "Tambah Slot"}
      </button>
    </section>
  );
}

function DaftarSlotKartu({ daftarSlot }: { daftarSlot: SlotShift[] }) {
  const { showToast } = useToast();
  const outletId = useOutletId();
  const [sedangProses, setSedangProses] = useState<string | null>(null);

  async function ubahAktif(slot: SlotShift) {
    setSedangProses(slot.id);
    try {
      await updateDoc(doc(db, "outlets", outletId, "slot_shift", slot.id), { aktif: !slot.aktif });
      showToast(
        "success",
        !slot.aktif
          ? `Slot "${slot.nama}" diaktifkan kembali.`
          : `Slot "${slot.nama}" dinonaktifkan (tidak muncul lagi untuk Kasir).`,
      );
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mengubah slot: ${error.message}` : "Gagal mengubah slot.",
      );
    } finally {
      setSedangProses(null);
    }
  }

  async function hapusSlot(slot: SlotShift) {
    setSedangProses(slot.id);
    try {
      await deleteDoc(doc(db, "outlets", outletId, "slot_shift", slot.id));
      showToast("success", `Slot "${slot.nama}" dihapus.`);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menghapus slot: ${error.message}` : "Gagal menghapus slot.",
      );
    } finally {
      setSedangProses(null);
    }
  }

  if (daftarSlot.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
        <p className="text-sm text-slate-500">
          Belum ada Slot Shift. Kasir akan membuka shift tanpa perlu memilih
          slot apa pun sampai ada slot ditambahkan.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Daftar Slot Shift</h2>
      <ul className="mt-4 flex flex-col divide-y divide-slate-100">
        {daftarSlot.map((slot) => (
          <li key={slot.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{slot.nama}</p>
              <p className="text-xs text-slate-500">
                {slot.jamMulai} – {slot.jamSelesai}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => ubahAktif(slot)}
                disabled={sedangProses === slot.id}
                className={[
                  "inline-flex h-9 items-center rounded-full px-3 text-xs font-semibold motion-safe:transition disabled:opacity-50",
                  slot.aktif
                    ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                ].join(" ")}
              >
                {slot.aktif ? "Aktif" : "Nonaktif"}
              </button>
              <button
                type="button"
                onClick={() => hapusSlot(slot)}
                disabled={sedangProses === slot.id}
                aria-label={`Hapus slot ${slot.nama}`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-rose-600 motion-safe:transition hover:bg-rose-50 disabled:opacity-50"
              >
                {sedangProses === slot.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
