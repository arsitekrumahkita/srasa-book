"use client";

// ============================================================
// Auth context — dipakai LINTAS HALAMAN (setiap halaman selain
// /login butuh tahu siapa yang login & apa perannya), jadi sesuai
// Rule of Two ini tinggal di src/shared, bukan di satu folder
// halaman saja.
//
// Sumber kebenaran peran (SUPERADMIN/Kasir/Purchasing) BUKAN
// custom claims Firebase Auth (itu perlu Cloud Functions, tidak
// ada di Spark Plan) — melainkan dokumen users/{uid} di Firestore,
// persis seperti yang dibaca firestore.rules lewat get(). Context
// ini melakukan hal yang sama di sisi klien.
//
// PENTING (webrules-hikimori poin 11): AuthProvider dan useAuth
// didefinisikan top-level, tidak bersarang di komponen lain.
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";

export type PeranPengguna = "superadmin" | "kasir" | "purchasing";

export interface ProfilPengguna {
  nama: string;
  email: string;
  peran: PeranPengguna;
  aktif: boolean;
}

interface AuthContextValue {
  user: User | null;
  profil: ProfilPengguna | null;
  /** true selagi status login ATAU dokumen profil masih dimuat. */
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profil: null,
  loading: true,
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/** Profil terikat ke uid pemiliknya, supaya "sudah termuat untuk
 *  user INI" bisa diturunkan dari perbandingan uid saja — tanpa
 *  perlu setState terpisah untuk mereset status loading di dalam
 *  effect (react-hooks/set-state-in-effect). */
interface ProfilTerikatUid {
  uid: string;
  profil: ProfilPengguna | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [profilState, setProfilState] = useState<ProfilTerikatUid | null>(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthResolved(true);
    });
    return unsubscribeAuth;
  }, []);

  useEffect(() => {
    if (!user) return;

    const ref = doc(db, "users", user.uid);
    const unsubscribeProfil = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data();
        setProfilState({
          uid: user.uid,
          // Akun Auth ada tapi dokumen users/{uid} belum dibuat ->
          // profil null adalah kondisi setup awal (lihat README),
          // bukan bug.
          profil: data
            ? {
                nama: data.nama ?? "",
                email: data.email ?? user.email ?? "",
                peran: data.peran,
                aktif: data.aktif === true,
              }
            : null,
        });
      },
      () => setProfilState({ uid: user.uid, profil: null }),
    );
    return unsubscribeProfil;
  }, [user]);

  // profilState hanya dianggap valid kalau uid-nya cocok dengan user
  // SAAT INI — begitu user berganti (login akun lain), profilState
  // lama otomatis dianggap belum termuat sampai listener baru di atas
  // selesai, tanpa perlu reset manual lewat setState di dalam effect.
  const profil = profilState && profilState.uid === user?.uid ? profilState.profil : null;
  const profilSudahTermuat = profilState?.uid === user?.uid;

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profil,
      loading: !authResolved || (!!user && !profilSudahTermuat),
    }),
    [user, profil, authResolved, profilSudahTermuat],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
