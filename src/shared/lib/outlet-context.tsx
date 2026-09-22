"use client";

// ============================================================
// Outlet context — Multi-Cabang dengan satu Owner terpusat
// (permintaan pemilik cafe). Struktur data: SEMUA data operasional
// (shift, bahan_baku, menu, kas_belanja, saldo_finance, dst — lihat
// firestore.rules) sekarang hidup di bawah `outlets/{outletId}/...`,
// bukan lagi koleksi top-level lintas-outlet.
//
// Dua cara outletId ditentukan, tergantung peran (dibaca dari
// useAuth().profil, BUKAN diketik ulang di sini):
//
// - Owner (superadmin) DAN Finance — KEDUANYA "terpusat": satu akun
//   mengakses SEMUA Outlet (permintaan revisi pemilik cafe: "Finance
//   juga terpusat login pilih outlet"). Tidak ada outletId tetap di
//   profilnya — dipilih tiap sesi lewat layar /pilih-outlet, disimpan
//   di localStorage per-uid supaya tidak perlu memilih ulang setiap
//   buka aplikasi (tapi bisa ganti kapan saja lewat pengalih Outlet
//   di AppShell). Kalau localStorage kosong atau menunjuk Outlet yang
//   sudah tidak aktif, dianggap BELUM memilih (outletId null) ->
//   RequireAuth mengarahkan ke /pilih-outlet (lihat require-auth.tsx).
// - Kasir/Purchasing SAJA: outletId TETAP, diambil langsung dari
//   profil.outletId (ditentukan Owner/Finance saat akun dibuat di
//   Kelola Akun, tidak bisa diubah sendiri). TIDAK PERNAH melihat
//   layar pilih Outlet — otomatis, sama seperti pola auto-pilih Slot
//   Shift kalau cuma ada satu pilihan (jawaban eksplisit pemilik
//   cafe: staff satu Outlet tidak direpotkan layar pilihan).
//
// MODE RIIL / MODE DEMO (permintaan pemilik cafe): setiap akun bisa
// berpindah antara Mode Riil (data asli Outlet) dan Mode Demo (Outlet
// percobaan berisi data dummy, bebas diotak-atik & di-reset — lihat
// src/shared/lib/mode-demo.ts). Mode Demo cukup MENGGANTI outletId
// aktif ke ID_OUTLET_DEMO, jadi semua halaman otomatis bekerja di
// Outlet Demo tanpa diubah satu per satu, dan data asli tidak mungkin
// tersentuh. Pilihan mode disimpan per-uid di localStorage — setiap
// tab/perangkat membawa mode-nya sendiri, jadi Riil & Demo bisa
// berjalan bersamaan (mis. tab kasir asli tetap Riil sementara Owner
// mencoba fitur di tab lain dalam Mode Demo).
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { useAuth } from "./auth-context";
import { ID_OUTLET_DEMO, NAMA_OUTLET_DEMO } from "./mode-demo";

export type ModeAplikasi = "riil" | "demo";

export interface Outlet {
  id: string;
  nama: string;
  alamat: string;
  aktif: boolean;
}

function kunciOutletTerpilih(uid: string): string {
  return `outletId_terpilih:${uid}`;
}

function kunciModeAplikasi(uid: string): string {
  return `mode_aplikasi:${uid}`;
}

interface OutletContextValue {
  /** null = belum ditentukan (Owner belum pilih, ATAU masih memuat). */
  outletId: string | null;
  /** Nama Outlet aktif, untuk tampilan (header, ekspor, dsb). */
  outletNama: string;
  /** true selagi status Outlet (daftar Outlet / pilihan tersimpan)
   *  masih dimuat — dipakai RequireAuth supaya tidak keliru
   *  menganggap "belum pilih" padahal baru saja belum selesai baca
   *  localStorage/daftar Outlet. */
  memuat: boolean;
  /** Semua Outlet aktif — untuk Owner (layar pilih & pengalih di
   *  AppShell). Peran lain tidak butuh ini (Outlet mereka tetap). */
  daftarOutletAktif: Outlet[];
  /** true kalau akun ini bisa berpindah Outlet (Owner ATAU Finance —
   *  keduanya "terpusat", lihat komentar kepala berkas). */
  bisaGantiOutlet: boolean;
  pilihOutlet: (id: string) => void;
  /** Kembali ke layar pilih Outlet (dipakai pengalih Outlet Owner). */
  gantiOutlet: () => void;
  /** "riil" = data asli Outlet, "demo" = Outlet percobaan (data dummy). */
  mode: ModeAplikasi;
  /** Ganti Mode Riil/Demo untuk akun ini (disimpan per-uid). */
  gantiMode: (mode: ModeAplikasi) => void;
}

const OutletContext = createContext<OutletContextValue>({
  outletId: null,
  outletNama: "",
  memuat: true,
  daftarOutletAktif: [],
  bisaGantiOutlet: false,
  pilihOutlet: () => {},
  gantiOutlet: () => {},
  mode: "riil",
  gantiMode: () => {},
});

export function useOutlet(): OutletContextValue {
  return useContext(OutletContext);
}

/** Sama seperti useOutlet().outletId, tapi TIPE-nya `string` (bukan
 *  `string | null`) — dipakai di HAMPIR SEMUA halaman/komponen yang
 *  membaca/menulis data per-Outlet, yang sudah pasti dibungkus
 *  RequireAuth TANPA `lewatiGatingOutlet` (lihat require-auth.tsx) —
 *  itu artinya halaman tersebut dijamin baru dirender SETELAH
 *  outletId terisi (Owner sudah memilih Outlet, atau staff yang
 *  outletnya tetap). Non-null assertion di SATU tempat ini menghindari
 *  pengulangan `outletId!`/pengecekan null di puluhan pemanggilan
 *  collection(db, "outlets", outletId, ...) di seluruh halaman.
 *
 *  JANGAN dipakai di /pilih-outlet (di situ outletId MEMANG boleh
 *  null — itulah tujuan halamannya) atau di komponen yang perlu tahu
 *  status "belum pilih" itu sendiri (mis. pengalih Outlet di
 *  AppShell) — pakai useOutlet() biasa di sana. */
export function useOutletId(): string {
  const { outletId } = useOutlet();
  return outletId as string;
}

export function OutletProvider({ children }: { children: ReactNode }) {
  const { user, profil } = useAuth();
  const [daftarOutletAktif, setDaftarOutletAktif] = useState<Outlet[]>([]);
  const [memuatDaftar, setMemuatDaftar] = useState(true);
  // outletId pilihan Owner untuk sesi ini — null berarti "belum pilih".
  const [outletDipilihTerpusat, setOutletDipilihTerpusat] = useState<string | null>(null);
  // Mode tersimpan DIKAITKAN ke uid pemiliknya — selama mode milik uid
  // yang sedang login belum terbaca dari localStorage, outletId sengaja
  // null (memuat). Ini PENTING: kalau sempat jatuh ke default "riil"
  // sesaat, halaman seperti Shift bisa keburu membuat shift hari ini di
  // Outlet ASLI padahal akun ini sedang di Mode Demo.
  const [modeTersimpan, setModeTersimpan] = useState<{ uid: string; mode: ModeAplikasi } | null>(null);
  const memuatMode = !!user && modeTersimpan?.uid !== user.uid;
  const mode: ModeAplikasi = user && modeTersimpan?.uid === user.uid ? modeTersimpan.mode : "riil";

  // "Terpusat" = Owner ATAU Finance, keduanya mengakses semua Outlet
  // dan memilih Outlet aktifnya sendiri per sesi (lihat komentar kepala
  // berkas). Kasir/Purchasing TIDAK termasuk — outlet mereka tetap.
  const bisaGantiOutlet = profil?.peran === "superadmin" || profil?.peran === "finance";

  // Daftar Outlet aktif — dibaca untuk SEMUA peran (staff juga perlu
  // ini untuk menampilkan NAMA outletnya sendiri di header/ekspor),
  // tapi hanya Owner yang benar-benar memilih dari daftar ini.
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      query(collection(db, "outlets"), where("aktif", "==", true)),
      (snap) => {
        setDaftarOutletAktif(
          snap.docs.map((d) => ({
            id: d.id,
            nama: d.data().nama ?? "",
            alamat: d.data().alamat ?? "",
            aktif: d.data().aktif ?? true,
          })),
        );
        setMemuatDaftar(false);
      },
      () => setMemuatDaftar(false),
    );
    return unsub;
  }, [user]);

  // Baca pilihan Outlet Owner yang tersimpan dari sesi sebelumnya —
  // deferred setState via microtask, pola baku proyek ini untuk
  // menghindari react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!user || !bisaGantiOutlet) return;
    let dibatalkan = false;
    Promise.resolve().then(() => {
      if (dibatalkan) return;
      try {
        setOutletDipilihTerpusat(window.localStorage.getItem(kunciOutletTerpilih(user.uid)));
      } catch {
        setOutletDipilihTerpusat(null);
      }
    });
    return () => {
      dibatalkan = true;
    };
  }, [user, bisaGantiOutlet]);

  // Baca Mode Riil/Demo tersimpan — pola microtask yang sama.
  useEffect(() => {
    if (!user) return;
    let dibatalkan = false;
    Promise.resolve().then(() => {
      if (dibatalkan) return;
      let tersimpan: ModeAplikasi = "riil";
      try {
        tersimpan = window.localStorage.getItem(kunciModeAplikasi(user.uid)) === "demo" ? "demo" : "riil";
      } catch {
        tersimpan = "riil";
      }
      setModeTersimpan({ uid: user.uid, mode: tersimpan });
    });
    return () => {
      dibatalkan = true;
    };
  }, [user]);

  function gantiMode(modeBaru: ModeAplikasi) {
    if (!user) return;
    try {
      window.localStorage.setItem(kunciModeAplikasi(user.uid), modeBaru);
    } catch {
      // Tidak tersimpan lintas sesi, tetap berlaku untuk sesi ini.
    }
    setModeTersimpan({ uid: user.uid, mode: modeBaru });
  }

  function pilihOutlet(id: string) {
    if (!user) return;
    // Memilih Outlet asli dari layar Pilih Outlet = kembali ke Mode Riil.
    if (mode === "demo") gantiMode("riil");
    try {
      window.localStorage.setItem(kunciOutletTerpilih(user.uid), id);
    } catch {
      // localStorage tidak tersedia (mode privat dsb) — pilihan tetap
      // berlaku untuk sesi berjalan ini lewat state, hanya tidak
      // tersimpan lintas sesi.
    }
    setOutletDipilihTerpusat(id);
  }

  function gantiOutlet() {
    if (!user) return;
    try {
      window.localStorage.removeItem(kunciOutletTerpilih(user.uid));
    } catch {
      // Diamkan — lihat catatan di pilihOutlet.
    }
    setOutletDipilihTerpusat(null);
  }

  const outletId = useMemo(() => {
    if (!profil) return null;
    if (memuatMode) return null;
    if (mode === "demo") return ID_OUTLET_DEMO;
    if (profil.peran === "superadmin" || profil.peran === "finance") {
      // Pilihan tersimpan HARUS masih ada di daftar Outlet aktif —
      // kalau Outlet itu sudah dinonaktifkan sejak pilihan disimpan,
      // dianggap belum memilih supaya tidak nyasar ke Outlet mati.
      if (!outletDipilihTerpusat) return null;
      const masihAktif = daftarOutletAktif.some((o) => o.id === outletDipilihTerpusat);
      return masihAktif ? outletDipilihTerpusat : null;
    }
    return profil.outletId ?? null;
  }, [profil, outletDipilihTerpusat, daftarOutletAktif, memuatMode, mode]);

  const outletNama = useMemo(
    () =>
      outletId === ID_OUTLET_DEMO
        ? NAMA_OUTLET_DEMO
        : (daftarOutletAktif.find((o) => o.id === outletId)?.nama ?? ""),
    [daftarOutletAktif, outletId],
  );

  const memuat = !profil || memuatDaftar || memuatMode;

  const value = useMemo<OutletContextValue>(
    () => ({
      outletId,
      outletNama,
      memuat,
      daftarOutletAktif,
      bisaGantiOutlet: !!bisaGantiOutlet,
      pilihOutlet,
      gantiOutlet,
      mode,
      gantiMode,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pilihOutlet/gantiOutlet dibuat ulang tiap render tapi hanya membaca `user` (lewat closure) yang sudah termasuk transitif lewat outletId/daftarOutletAktif; menaruhnya di deps hanya bikin value ini berubah tiap render tanpa manfaat.
    [outletId, outletNama, memuat, daftarOutletAktif, bisaGantiOutlet, mode],
  );

  return <OutletContext.Provider value={value}>{children}</OutletContext.Provider>;
}
