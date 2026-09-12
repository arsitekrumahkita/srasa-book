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
import { getAuth } from "firebase/auth";
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
