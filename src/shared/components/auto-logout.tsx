"use client";

// ============================================================
// Auto Logout karena TIDAK ADA AKTIVITAS (60 menit), atas permintaan
// pemilik cafe.
//
// Tiga syarat lain yang diminta — tab browser ditutup, aplikasi
// browser ditutup, perangkat dimatikan — TIDAK ditangani di sini
// melainkan oleh persistensi sesi di src/shared/lib/firebase.ts
// (browserSessionPersistence). Itu penanganan yang benar untuk
// ketiganya: tidak ada kode JavaScript yang bisa diandalkan berjalan
// saat perangkat dimatikan paksa atau browser dibunuh dari task
// manager, jadi menggantungkannya pada event `beforeunload` akan
// bocor. Dengan sesi disimpan di sessionStorage, ketiga kejadian itu
// menghapus sesinya tanpa perlu kode kita ikut campur sama sekali.
//
// Yang tersisa untuk komponen ini hanyalah kasus yang MEMANG butuh
// timer: pengguna meninggalkan aplikasi terbuka tanpa disentuh.
//
// Pekerjaan yang belum tersimpan tidak hilang saat ini terjadi:
// form-form panjang menulis draf ke localStorage terus-menerus
// (lihat src/shared/lib/draf.ts), dan draf itu ditawarkan kembali
// saat pengguna login lagi.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { TriangleAlert } from "lucide-react";
import { auth } from "@/shared/lib/firebase";
import { useAuth } from "@/shared/lib/auth-context";

/** Batas tanpa aktivitas sebelum sesi diakhiri. */
const BATAS_IDLE_MENIT = 60;
/** Peringatan muncul selama menit-menit terakhir sebelum keluar. */
const PERINGATAN_MENIT = 2;

const BATAS_IDLE_MS = BATAS_IDLE_MENIT * 60_000;
const PERINGATAN_MS = PERINGATAN_MENIT * 60_000;

/** Alasan logout dititipkan lewat sessionStorage supaya halaman Login
 *  bisa menjelaskan kenapa pengguna tiba-tiba ada di sana. Dipakai
 *  sessionStorage (bukan query string) supaya pesannya tidak ikut
 *  ter-bookmark atau muncul lagi saat URL dibuka ulang. */
export const KUNCI_ALASAN_LOGOUT = "srasa-alasan-logout";

// --- Alasan logout sebagai "external store" mungil ---
//
// Halaman Login perlu MEMBACA nilai ini saat render. Membaca
// sessionStorage langsung di badan komponen itu tidak murni (dan
// meledak saat render di server), sementara membacanya lewat
// useEffect + setState memicu render berantai yang dilarang aturan
// lint proyek ini. Jawaban React untuk kasus persis ini adalah
// useSyncExternalStore, dan itu butuh tiga hal di bawah: snapshot
// yang STABIL (karena itu di-cache di memori, bukan dibaca ulang dari
// sessionStorage tiap render), cara berlangganan, dan cara menulis.
let alasanTersimpan: string | null = null;
let sudahDibacaDariStorage = false;
const pendengarAlasan = new Set<() => void>();

function tulisAlasanLogout(pesan: string): void {
  alasanTersimpan = pesan;
  sudahDibacaDariStorage = true;
  try {
    window.sessionStorage.setItem(KUNCI_ALASAN_LOGOUT, pesan);
  } catch {
    // Penyimpanan diblokir — pesan tetap hidup di memori selama
    // navigasi ini, yang sudah cukup untuk kasus umum.
  }
  for (const dengar of pendengarAlasan) dengar();
}

export function langgananAlasanLogout(dengar: () => void): () => void {
  pendengarAlasan.add(dengar);
  return () => {
    pendengarAlasan.delete(dengar);
  };
}

/** Snapshot untuk klien. Dibaca sekali dari sessionStorage lalu
 *  di-cache + dibersihkan, supaya nilainya stabil antar-render dan
 *  tidak muncul lagi kalau halaman Login di-refresh manual. */
export function bacaAlasanLogout(): string | null {
  if (!sudahDibacaDariStorage) {
    sudahDibacaDariStorage = true;
    try {
      alasanTersimpan = window.sessionStorage.getItem(KUNCI_ALASAN_LOGOUT);
      if (alasanTersimpan) window.sessionStorage.removeItem(KUNCI_ALASAN_LOGOUT);
    } catch {
      alasanTersimpan = null;
    }
  }
  return alasanTersimpan;
}

/** Snapshot untuk render di server — tidak ada sessionStorage di sana. */
export function bacaAlasanLogoutServer(): string | null {
  return null;
}

/**
 * Aktivitas yang dihitung "pengguna masih di sini". Sengaja TIDAK
 * memasukkan `mousemove` mentah tanpa saringan waktu: kursor yang
 * tersenggol getaran meja bisa memperpanjang sesi selamanya, yang
 * justru membatalkan tujuan fitur ini. Semua event di bawah tetap
 * disaring lewat throttle 30 detik di bawah.
 */
const EVENT_AKTIVITAS = [
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
  "pointerdown",
] as const;

export function AutoLogout() {
  const { user } = useAuth();
  const router = useRouter();
  const [sisaDetik, setSisaDetik] = useState<number | null>(null);

  // Waktu aktivitas terakhir disimpan di ref, bukan state: ia berubah
  // sangat sering dan tidak boleh memicu render ulang seluruh aplikasi.
  // Nilainya diisi di dalam effect (bukan sebagai nilai awal useRef),
  // karena memanggil Date.now() selagi render itu tidak murni.
  const terakhirAktifRef = useRef(0);
  const sedangKeluarRef = useRef(false);

  const keluarOtomatis = useCallback(async () => {
    if (sedangKeluarRef.current) return;
    sedangKeluarRef.current = true;
    tulisAlasanLogout(
      `Anda otomatis keluar karena tidak ada aktivitas selama ${BATAS_IDLE_MENIT} menit. Pekerjaan yang belum sempat disimpan tersimpan sebagai draf.`,
    );
    try {
      await signOut(auth);
    } finally {
      router.replace("/login");
    }
  }, [router]);

  const catatAktivitas = useCallback(() => {
    const sekarang = Date.now();
    // Throttle: cukup perbarui sekali per 30 detik. Tanpa ini, scroll
    // panjang bisa memanggil handler ratusan kali per detik.
    if (sekarang - terakhirAktifRef.current < 30_000) return;
    terakhirAktifRef.current = sekarang;
  }, []);

  useEffect(() => {
    // Belum login: tidak ada sesi untuk dijaga. Tidak perlu mereset
    // sisaDetik lewat setState di sini — render di bawah sudah
    // mengembalikan null selama `user` kosong.
    if (!user) {
      sedangKeluarRef.current = false;
      return;
    }

    terakhirAktifRef.current = Date.now();

    for (const nama of EVENT_AKTIVITAS) {
      window.addEventListener(nama, catatAktivitas, { passive: true });
    }

    // Kembali ke tab ini setelah lama ditinggal juga dihitung aktivitas
    // — tapi HANYA saat tab kembali terlihat, bukan saat ditinggalkan.
    function saatVisibilitasBerubah() {
      if (document.visibilityState === "visible") {
        terakhirAktifRef.current = Date.now();
      }
    }
    document.addEventListener("visibilitychange", saatVisibilitasBerubah);

    // Satu timer 5 detik untuk semuanya, bukan setTimeout yang
    // dijadwalkan ulang tiap aktivitas: lebih sederhana, dan tetap
    // akurat karena yang dibandingkan adalah selisih waktu nyata
    // (jadi tidur/hibernasi perangkat tetap terhitung sebagai idle).
    const interval = window.setInterval(() => {
      const menganggur = Date.now() - terakhirAktifRef.current;
      if (menganggur >= BATAS_IDLE_MS) {
        keluarOtomatis();
        return;
      }
      const sisaMs = BATAS_IDLE_MS - menganggur;
      setSisaDetik(sisaMs <= PERINGATAN_MS ? Math.ceil(sisaMs / 1000) : null);
    }, 5_000);

    return () => {
      for (const nama of EVENT_AKTIVITAS) {
        window.removeEventListener(nama, catatAktivitas);
      }
      document.removeEventListener("visibilitychange", saatVisibilitasBerubah);
      window.clearInterval(interval);
    };
  }, [user, catatAktivitas, keluarOtomatis]);

  if (!user || sisaDetik === null) return null;

  const menit = Math.floor(sisaDetik / 60);
  const detik = sisaDetik % 60;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Peringatan sesi akan berakhir"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-4"
    >
      <div className="flex w-full max-w-md items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-lg">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-900">
            Sesi akan berakhir dalam {menit}:{String(detik).padStart(2, "0")}
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            Anda akan otomatis keluar karena tidak ada aktivitas. Pekerjaan
            yang belum disimpan akan tersimpan sebagai draf.
          </p>
          <button
            type="button"
            onClick={() => {
              terakhirAktifRef.current = Date.now();
              setSisaDetik(null);
            }}
            className="mt-2 inline-flex items-center rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm motion-safe:transition hover:bg-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            Saya masih di sini
          </button>
        </div>
      </div>
    </div>
  );
}
