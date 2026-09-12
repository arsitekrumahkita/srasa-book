// ============================================================
// Inisialisasi Firebase (Auth + Firestore), dibaca dari env vars
// NEXT_PUBLIC_FIREBASE_* (lihat .env.local.example).
//
// PENTING soal keamanan: konfigurasi ini (termasuk "apiKey") AMAN
// untuk ada di kode sisi klien / ter-bundle ke browser. Firebase
// apiKey bukan rahasia seperti API key pada umumnya — ia hanya
// mengidentifikasi proyek Firebase mana yang dipakai. Keamanan
// data yang sesungguhnya ditegakkan oleh Firestore Security Rules
// (PRD bagian 6.3) dan Firebase Authentication, BUKAN dengan
// menyembunyikan nilai-nilai di bawah ini.
//
// `firebaseConfig` diekspor (bukan hanya dipakai lokal di file ini)
// karena Kelola Akun (PRD 9.7) butuh menginisialisasi APLIKASI
// FIREBASE KEDUA saat Owner membuat akun staff — createUserWithEmail
// AndPassword otomatis mengganti sesi aktif ke user yang baru dibuat
// kalau dipanggil lewat `auth` utama, yang berarti Owner akan
// ter-log-out dari akunnya sendiri. Aplikasi kedua yang sementara ini
// menghindari efek samping tersebut (lihat src/app/kelola-akun).
// ============================================================

import { getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { browserSessionPersistence, getAuth, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function pastikanKonfigLengkap() {
  const kosong = Object.entries(firebaseConfig).filter(([, v]) => !v);
  if (kosong.length > 0 && process.env.NODE_ENV !== "production") {
    // Peringatan di konsol dev saja — tidak melempar error supaya
    // `npm run dev`/`npm run build` tetap jalan sebelum .env.local diisi.
    console.warn(
      `[firebase] Env var berikut belum diisi di .env.local: ${kosong
        .map(([k]) => k)
        .join(", ")}. Fitur yang butuh Firebase belum akan berfungsi.`,
    );
  }
}

pastikanKonfigLengkap();

// Hindari re-initialize saat hot reload di Next.js dev mode.
export const firebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

// ============================================================
// PERSISTENSI SESI — atas permintaan pemilik cafe, sesi login WAJIB
// berakhir saat: tab browser ditutup, aplikasi browser ditutup, dan
// perangkat dimatikan.
//
// Ketiganya ditangani oleh SATU pengaturan ini: browserSessionPersistence
// menyimpan sesi di sessionStorage, yang umurnya terikat pada TAB
// browser itu sendiri. Tab ditutup -> hilang. Browser ditutup ->
// semua tab hilang, jadi sesi hilang. Perangkat dimatikan -> browser
// ikut tertutup, sesi hilang. Tidak ada yang tertinggal di disk,
// jadi tidak ada sesi yang bisa "hidup lagi" setelah perangkat menyala.
//
// Bawaan Firebase adalah browserLocalPersistence (localStorage) yang
// justru BERTAHAN melewati ketiga kejadian itu — kebalikan dari yang
// diminta. Kalau suatu saat ingin "tetap login di perangkat ini",
// ganti baris ini ke browserLocalPersistence, TAPI ketiga syarat di
// atas otomatis tidak berlaku lagi.
//
// Batas idle 60 menit TIDAK ditangani di sini (Firebase tidak punya
// konsep itu) — lihat src/shared/components/auto-logout.tsx.
//
// setPersistence() asinkron, jadi janjinya diekspor supaya halaman
// Login bisa MENUNGGUNYA sebelum memanggil signIn — kalau tidak,
// ada celah balapan kecil di mana sesi pertama masih memakai
// persistensi bawaan (localStorage) dan akhirnya malah bertahan
// setelah tab ditutup.
// ============================================================

export const persistensiSiap: Promise<void> = setPersistence(
  auth,
  browserSessionPersistence,
).catch((error) => {
  // Mode privat/penyimpanan diblokir: Firebase otomatis jatuh ke
  // penyimpanan memori, yang justru LEBIH ketat (hilang saat reload).
  // Jadi kegagalan di sini tidak pernah membuat sesi jadi lebih awet
  // dari yang diminta — cukup dicatat, bukan dilempar.
  if (process.env.NODE_ENV !== "production") {
    console.warn("[firebase] Gagal menetapkan persistensi sesi:", error);
  }
});
