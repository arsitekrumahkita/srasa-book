"use client";

// ============================================================
// Halaman: Pusat Notifikasi (PRD bagian 9.9) — "Prioritas: P0
// (daftar tiket sederhana)". Semua peran aktif punya akses (lihat
// firestore.rules bagian notifikasi).
//
// Query gabungan (untukUid + untukPeran) ada di
// src/shared/lib/notifikasi.ts — dipakai juga oleh kartu
// "Aktivitas Terbaru" Dashboard (Rule of Two).
//
// BELUM ADA di versi ini (P1 lanjutan): badge jumlah belum dibaca
// di ikon lonceng pada sidebar (src/shared/components/app-shell.tsx).
// Notifikasi berbasis peran (untukPeran) tidak bisa ditandai
// dibaca oleh siapa pun sesuai firestore.rules saat ini (rules
// hanya mengizinkan pemilik untukUid mengubah statusnya) — SENGAJA
// begitu karena notifikasi berbasis peran berarti "untuk siapa
// saja yang berperan itu", bukan milik satu orang.
// ============================================================

import { doc, updateDoc } from "firebase/firestore";
import { Bell, Check, Loader2 } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { AppShell } from "@/shared/components/app-shell";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { useNotifikasiGabungan } from "@/shared/lib/notifikasi";

export default function NotifikasiPage() {
  return (
    <RequireAuth>
      <AppShell>
        <NotifikasiIsi />
      </AppShell>
    </RequireAuth>
  );
}

function NotifikasiIsi() {
  const { showToast } = useToast();
  const { daftar: gabungan, memuat } = useNotifikasiGabungan();

  async function tandaiDibaca(id: string) {
    try {
      await updateDoc(doc(db, "notifikasi", id), { dibaca: true });
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menandai dibaca: ${error.message}` : "Gagal menandai dibaca.",
      );
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center gap-2">
        <Bell className="h-5 w-5 text-emerald-700" aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            SRASA BOOK
          </p>
          <h1 className="text-2xl font-bold text-slate-900">Notifikasi</h1>
        </div>
      </header>

      {memuat ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      ) : gabungan.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
          Tidak ada notifikasi.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {gabungan.map((notif) => (
            <li
              key={notif.id}
              className={[
                "flex items-start justify-between gap-3 rounded-xl border p-4 shadow-sm",
                notif.dibaca ? "border-slate-200 bg-white" : "border-emerald-200 bg-emerald-50/50",
              ].join(" ")}
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">{notif.judul}</p>
                <p className="mt-0.5 text-sm whitespace-pre-line text-slate-600">{notif.pesan}</p>
              </div>
              {!notif.dibaca && notif.untukUid ? (
                <button
                  type="button"
                  onClick={() => tandaiDibaca(notif.id)}
                  aria-label="Tandai sudah dibaca"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 motion-safe:transition hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Dibaca
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
