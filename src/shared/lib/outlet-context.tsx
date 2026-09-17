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

export interface Outlet {
  id: string;
  nama: string;
  alamat: string;
  aktif: boolean;
  /** true HANYA untuk Outlet Demo/Beta (dibuat lewat halaman Data
   *  Dummy, khusus Owner) — dipakai untuk menandai badge "DEMO" di
   *  pengalih Outlet & pita peringatan di AppShell, supaya siapa pun
   *  yang sedang bekerja di Outlet ini tidak keliru mengira sedang
   *  melihat data asli. TIDAK memengaruhi firestore.rules (Outlet Demo
   *  tunduk aturan sama seperti Outlet biasa) — murni penanda visual. */
  demo?: boolean;
}

function kunciOutletTerpilih(uid: string): string {
  return `outletId_terpilih:${uid}`;
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
  /** true kalau Outlet yang SEDANG aktif (outletId di atas) adalah
   *  Outlet Demo/Beta — lihat catatan di interface Outlet.demo. */
  outletDemo: boolean;
  pilihOutlet: (id: string) => void;
  /** Kembali ke layar pilih Outlet (dipakai pengalih Outlet Owner). */
  gantiOutlet: () => void;
}

const OutletContext = createContext<OutletContextValue>({
  outletId: null,
  outletNama: "",
  memuat: true,
  daftarOutletAktif: [],
  bisaGantiOutlet: false,
  outletDemo: false,
  pilihOutlet: () => {},
  gantiOutlet: () => {},
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
            demo: d.data().demo ?? false,
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

  function pilihOutlet(id: string) {
    if (!user) return;
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
    if (profil.peran === "superadmin" || profil.peran === "finance") {
      // Pilihan tersimpan HARUS masih ada di daftar Outlet aktif —
      // kalau Outlet itu sudah dinonaktifkan sejak pilihan disimpan,
      // dianggap belum memilih supaya tidak nyasar ke Outlet mati.
      if (!outletDipilihTerpusat) return null;
      const masihAktif = daftarOutletAktif.some((o) => o.id === outletDipilihTerpusat);
      return masihAktif ? outletDipilihTerpusat : null;
    }
    return profil.outletId ?? null;
  }, [profil, outletDipilihTerpusat, daftarOutletAktif]);

  const outletNama = useMemo(
    () => daftarOutletAktif.find((o) => o.id === outletId)?.nama ?? "",
    [daftarOutletAktif, outletId],
  );
  const outletDemo = useMemo(
    () => daftarOutletAktif.find((o) => o.id === outletId)?.demo ?? false,
    [daftarOutletAktif, outletId],
  );

  const memuat = !profil || memuatDaftar;

  const value = useMemo<OutletContextValue>(
    () => ({
      outletId,
      outletNama,
      memuat,
      daftarOutletAktif,
      bisaGantiOutlet: !!bisaGantiOutlet,
      outletDemo,
      pilihOutlet,
      gantiOutlet,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pilihOutlet/gantiOutlet dibuat ulang tiap render tapi hanya membaca `user` (lewat closure) yang sudah termasuk transitif lewat outletId/daftarOutletAktif; menaruhnya di deps hanya bikin value ini berubah tiap render tanpa manfaat.
    [outletId, outletNama, memuat, daftarOutletAktif, bisaGantiOutlet, outletDemo],
  );

  return <OutletContext.Provider value={value}>{children}</OutletContext.Provider>;
}
