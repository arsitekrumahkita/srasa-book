"use client";

// ============================================================
// Auto Draft — menyelamatkan pekerjaan yang BELUM disimpan ketika
// sesi berakhir mendadak (auto logout 60 menit, tab/browser ditutup,
// perangkat mati), atas permintaan pemilik cafe.
//
// KENAPA localStorage, bukan Firestore:
// justru karena kejadian yang mau diselamatkan adalah kejadian di
// mana kita KEHILANGAN izin menulis ke Firestore (sesi sudah habis)
// atau kehilangan koneksi sama sekali (perangkat mati). Draf harus
// tetap ada TANPA server, dan harus bisa ditulis sampai milidetik
// terakhir sebelum logout. localStorage memenuhi keduanya.
//
// Perhatikan bedanya dengan sesi login: sesi login sengaja disimpan
// di sessionStorage supaya IKUT HILANG saat tab ditutup (lihat
// firebase.ts). Draf sebaliknya, disimpan di localStorage supaya
// BERTAHAN — itu memang gunanya. Draf tidak berisi apa pun yang
// rahasia dalam arti kredensial, dan selalu dikunci per-uid supaya
// dua orang yang memakai perangkat yang sama tidak saling melihat
// draf satu sama lain.
//
// Semua akses dibungkus try/catch: localStorage bisa melempar error
// di mode privat, saat kuota penuh, atau saat penyimpanan situs
// diblokir. Draf adalah fitur kenyamanan — kegagalannya TIDAK BOLEH
// pernah menjatuhkan halaman yang sedang dipakai bekerja.
// ============================================================

import { useEffect, useRef } from "react";

const PREFIX = "srasa-draf";

/** Kunci draf per pengguna — dua akun di satu perangkat (mis. Kasir
 *  pagi & Kasir sore memakai tablet yang sama) tidak boleh saling
 *  menimpa atau melihat draf satu sama lain. */
function kunciPenuh(uid: string, kunci: string): string {
  return `${PREFIX}:${uid}:${kunci}`;
}

export interface DrafTersimpan<T> {
  data: T;
  /** Epoch ms saat draf terakhir ditulis — dipakai untuk menampilkan
   *  "disimpan 5 menit lalu" dan untuk membuang draf yang basi. */
  disimpanPada: number;
}

export function simpanDraf<T>(uid: string, kunci: string, data: T): void {
  try {
    const isi: DrafTersimpan<T> = { data, disimpanPada: Date.now() };
    window.localStorage.setItem(kunciPenuh(uid, kunci), JSON.stringify(isi));
  } catch {
    // Penyimpanan penuh/diblokir — abaikan, jangan ganggu pengguna.
  }
}

/** Ambil draf. Draf yang lebih tua dari `maksimalUmurJam` dianggap
 *  basi dan langsung dibuang — menawarkan pemulihan draf minggu lalu
 *  lebih membingungkan daripada membantu. */
export function ambilDraf<T>(
  uid: string,
  kunci: string,
  maksimalUmurJam = 48,
): DrafTersimpan<T> | null {
  try {
    const mentah = window.localStorage.getItem(kunciPenuh(uid, kunci));
    if (!mentah) return null;
    const isi = JSON.parse(mentah) as DrafTersimpan<T>;
    if (typeof isi?.disimpanPada !== "number") return null;
    if (Date.now() - isi.disimpanPada > maksimalUmurJam * 3_600_000) {
      hapusDraf(uid, kunci);
      return null;
    }
    return isi;
  } catch {
    return null;
  }
}

export function hapusDraf(uid: string, kunci: string): void {
  try {
    window.localStorage.removeItem(kunciPenuh(uid, kunci));
  } catch {
    // Abaikan.
  }
}

/**
 * Versi asinkron dari ambilDraf, untuk dipanggil dari useEffect.
 *
 * Kenapa asinkron padahal localStorage sinkron: membaca penyimpanan
 * adalah akses ke sistem di LUAR React, dan menaruh hasilnya ke state
 * secara sinkron di dalam effect memicu render berantai (aturan
 * react-hooks/set-state-in-effect). Dibungkus Promise, pembacaannya
 * menjadi callback — yang justru pola yang dianjurkan React untuk
 * sumber data eksternal. Bonusnya, kalau suatu saat draf dipindah ke
 * IndexedDB (yang memang wajib asinkron), bentuk panggilannya tidak
 * perlu berubah sama sekali.
 */
export function ambilDrafAsync<T>(
  uid: string,
  kunci: string,
  maksimalUmurJam = 48,
): Promise<DrafTersimpan<T> | null> {
  return Promise.resolve(ambilDraf<T>(uid, kunci, maksimalUmurJam));
}

/**
 * Simpan `nilai` ke draf setiap kali berubah, selama `aktif` true.
 *
 * `aktif` penting: form yang masih kosong TIDAK boleh menulis draf,
 * karena draf kosong akan memunculkan tawaran "pulihkan draf" yang
 * isinya tidak ada apa-apa. Pemanggil yang menentukan kapan sebuah
 * form dianggap "sedang dikerjakan" (mis. nama menu sudah diisi, atau
 * sudah ada baris resep).
 *
 * Penulisan sengaja ditunda ~600ms (debounce) supaya mengetik di
 * form panjang tidak menulis ke localStorage tiap ketukan huruf —
 * TAPI saat komponen dilepas atau `aktif` berubah jadi false, isi
 * terakhir langsung ditulis tanpa menunggu, supaya tidak ada ketikan
 * terakhir yang hilang tepat saat logout terjadi.
 */
export function useDrafOtomatis<T>(
  uid: string | null | undefined,
  kunci: string,
  nilai: T,
  aktif: boolean,
): void {
  // Ref menyimpan nilai TERAKHIR supaya effect pembersih di bawah bisa
  // menulis isi paling mutakhir tanpa perlu ikut sebagai dependensi.
  // Penulisan ref dilakukan DI DALAM effect, bukan saat render —
  // menyentuh ref selagi render melanggar aturan kemurnian React.
  const nilaiRef = useRef<T>(nilai);
  const aktifRef = useRef(aktif);

  useEffect(() => {
    nilaiRef.current = nilai;
    aktifRef.current = aktif;
  }, [nilai, aktif]);

  useEffect(() => {
    if (!uid || !aktif) return;
    const timer = window.setTimeout(() => {
      simpanDraf(uid, kunci, nilai);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [uid, kunci, nilai, aktif]);

  // Simpan sekali lagi saat komponen dilepas (pindah halaman, logout,
  // tab ditutup) — inilah yang menangkap ketikan paling akhir yang
  // debounce di atas belum sempat tulis.
  useEffect(() => {
    if (!uid) return;
    return () => {
      if (aktifRef.current) simpanDraf(uid, kunci, nilaiRef.current);
    };
  }, [uid, kunci]);
}

/** Berapa lama lalu draf disimpan, dalam bahasa manusia. */
export function usiaDraf(disimpanPada: number): string {
  const detik = Math.max(0, Math.round((Date.now() - disimpanPada) / 1000));
  if (detik < 60) return "beberapa detik lalu";
  const menit = Math.round(detik / 60);
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.round(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.round(jam / 24)} hari lalu`;
}
