"use client";

// ============================================================
// Halaman: Kelola Akun (PRD bagian 9.7). Peran UI: Owner
// (superadmin) dan Finance — staff tidak bisa mendaftar sendiri,
// sesuai firestore.rules (users: create/update/delete khusus
// isOwnerLevel(), yaitu superadmin ATAU finance — akses Finance
// dibuat setara Owner atas permintaan, lihat helper isOwnerLevel()
// di firestore.rules).
//
// CATATAN TEKNIS PENTING: `createUserWithEmailAndPassword` pada
// Firebase Auth client SDK otomatis membuat sesi baru itu AKTIF di
// instance `auth` yang dipakai — kalau kita panggil lewat `auth`
// utama, Owner yang sedang login akan ikut ter-log-out dan
// tergantikan sesi staff baru. Untuk menghindarinya, pembuatan akun
// staff di sini memakai APLIKASI FIREBASE KEDUA yang sementara
// (dibuat & dibuang setiap kali submit), sehingga sesi Owner di
// aplikasi utama sama sekali tidak tersentuh.
// ============================================================

import { useEffect, useState } from "react";
import { deleteApp, initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { Loader2, ShieldCheck, ShieldOff, UserPlus } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { AppShell } from "@/shared/components/app-shell";
import { useToast } from "@/shared/components/toast";
import { db, firebaseConfig } from "@/shared/lib/firebase";
import type { PeranPengguna } from "@/shared/lib/auth-context";

interface AkunStaff {
  uid: string;
  nama: string;
  email: string;
  username: string;
  peran: PeranPengguna;
  aktif: boolean;
}

/** username hanya huruf kecil/angka/titik/underscore, TANPA spasi —
 *  jadi enak diketik di form Login (lihat src/app/login/page.tsx)
 *  dan aman dipakai sebagai document ID koleksi `usernames`. */
function bersihkanUsername(nilai: string): string {
  return nilai
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._]/g, "");
}

const LABEL_PERAN: Record<PeranPengguna, string> = {
  superadmin: "Owner (Superadmin)",
  finance: "Finance",
  kasir: "Kasir",
  purchasing: "Purchasing",
};

export default function KelolaAkunPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]}>
      <AppShell>
        <KelolaAkunIsi />
      </AppShell>
    </RequireAuth>
  );
}

function KelolaAkunIsi() {
  const [daftarAkun, setDaftarAkun] = useState<AkunStaff[]>([]);
  const [memuat, setMemuat] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "users"), orderBy("nama")),
      (snap) => {
        setDaftarAkun(
          snap.docs.map((d) => ({
            uid: d.id,
            nama: d.data().nama ?? "",
            email: d.data().email ?? "",
            username: d.data().username ?? "",
            peran: d.data().peran,
            aktif: d.data().aktif === true,
          })),
        );
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          SRASA BOOK
        </p>
        <h1 className="text-2xl font-bold text-slate-900">Kelola Akun</h1>
        <p className="mt-1 text-sm text-slate-600">
          Buat akun staff baru dan aktifkan/nonaktifkan akun yang sudah ada.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <BuatAkunKartu />

        <section
          aria-labelledby="bagian-daftar-akun"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 id="bagian-daftar-akun" className="text-base font-semibold text-slate-900">
            Daftar Akun
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Kata sandi TIDAK ditampilkan di sini demi keamanan (tersimpan
            terenkripsi, tidak bisa dibaca ulang oleh siapa pun termasuk
            Owner) — kalau staff lupa kata sandi, gunakan tombol &quot;Lupa
            Kata Sandi&quot; di halaman Login.
          </p>

          {memuat ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          ) : daftarAkun.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Belum ada akun staff dibuat.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {daftarAkun.map((akun) => (
                <BarisAkun key={akun.uid} akun={akun} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function BuatAkunKartu() {
  const { showToast } = useToast();
  const [nama, setNama] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [nomorHp, setNomorHp] = useState("");
  const [password, setPassword] = useState("");
  const [peran, setPeran] = useState<PeranPengguna>("kasir");
  const [sedangMembuat, setSedangMembuat] = useState(false);

  async function handleBuatAkun() {
    const usernameBersih = bersihkanUsername(username);
    if (!nama.trim() || !usernameBersih || !email.trim() || password.length < 6) {
      showToast(
        "error",
        "Nama, username, dan email wajib diisi, kata sandi minimal 6 karakter.",
      );
      return;
    }

    setSedangMembuat(true);
    const namaAppSementara = `staff-creation-${Date.now()}`;
    const appSementara = initializeApp(firebaseConfig, namaAppSementara);
    try {
      // Cek username belum dipakai SEBELUM membuat akun Auth — supaya
      // tidak ada akun Auth "yatim" kalau ternyata usernamenya bentrok.
      const usernameSnap = await getDoc(doc(db, "usernames", usernameBersih));
      if (usernameSnap.exists()) {
        showToast("error", `Username "${usernameBersih}" sudah dipakai akun lain.`);
        return;
      }

      const authSementara = getAuth(appSementara);
      const kredensial = await createUserWithEmailAndPassword(
        authSementara,
        email.trim(),
        password,
      );

      await setDoc(doc(db, "users", kredensial.user.uid), {
        nama: nama.trim(),
        email: email.trim(),
        username: usernameBersih,
        nomorHp: nomorHp.trim() || null,
        peran,
        aktif: true,
        dibuatPada: new Date().toISOString(),
      });

      // Dokumen publik "username -> email", dipakai halaman Login
      // (src/app/login/page.tsx) untuk menerjemahkan username sebelum
      // signInWithEmailAndPassword — lihat firestore.rules.
      await setDoc(doc(db, "usernames", usernameBersih), {
        uid: kredensial.user.uid,
        email: email.trim(),
      });

      showToast(
        "success",
        `Akun ${nama.trim()} (${LABEL_PERAN[peran]}) berhasil dibuat — username: ${usernameBersih}.`,
      );
      setNama("");
      setUsername("");
      setEmail("");
      setNomorHp("");
      setPassword("");
    } catch (error) {
      showToast("error", pesanErrorBuatAkun(error));
    } finally {
      // Aplikasi sementara tidak diperlukan lagi setelah user dibuat —
      // sesi Owner di aplikasi UTAMA tidak pernah tersentuh sama sekali.
      await deleteApp(appSementara).catch(() => undefined);
      setSedangMembuat(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-buat-akun"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-4 flex items-center gap-2">
        <UserPlus className="h-5 w-5 text-emerald-700" aria-hidden="true" />
        <h2 id="bagian-buat-akun" className="text-base font-semibold text-slate-900">
          Buat Akun Staff
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="nama-staff" className="block text-sm font-semibold text-slate-800">
            Nama
          </label>
          <input
            id="nama-staff"
            type="text"
            value={nama}
            onChange={(event) => setNama(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label htmlFor="peran-staff" className="block text-sm font-semibold text-slate-800">
            Peran
          </label>
          <select
            id="peran-staff"
            value={peran}
            onChange={(event) => setPeran(event.target.value as PeranPengguna)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          >
            <option value="kasir">Kasir</option>
            <option value="purchasing">Purchasing</option>
            <option value="finance">Finance</option>
          </select>
        </div>
        <div>
          <label htmlFor="username-staff" className="block text-sm font-semibold text-slate-800">
            Username
          </label>
          <input
            id="username-staff"
            type="text"
            autoComplete="off"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="huruf kecil, tanpa spasi"
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
          <p className="mt-1 text-xs text-slate-500">Dipakai untuk masuk selain Email.</p>
        </div>
        <div>
          <label htmlFor="email-staff" className="block text-sm font-semibold text-slate-800">
            Email
          </label>
          <input
            id="email-staff"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label htmlFor="nomor-hp-staff" className="block text-sm font-semibold text-slate-800">
            Nomor HP
            <span className="ml-1 font-normal text-slate-400">(opsional)</span>
          </label>
          <input
            id="nomor-hp-staff"
            type="tel"
            autoComplete="off"
            value={nomorHp}
            onChange={(event) => setNomorHp(event.target.value)}
            placeholder="boleh diisi menyusul"
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label htmlFor="password-staff" className="block text-sm font-semibold text-slate-800">
            Kata Sandi Awal
          </label>
          <input
            id="password-staff"
            type="text"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="minimal 6 karakter"
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleBuatAkun}
        disabled={sedangMembuat}
        aria-busy={sedangMembuat}
        className={[
          "mt-4 inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm",
          "motion-safe:transition motion-safe:duration-150",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
          sedangMembuat
            ? "cursor-not-allowed bg-emerald-400"
            : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
        ].join(" ")}
      >
        {sedangMembuat ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <UserPlus className="h-4 w-4" aria-hidden="true" />
        )}
        {sedangMembuat ? "Membuat Akun..." : "Buat Akun"}
      </button>

      <p className="mt-3 text-xs text-slate-500">
        Beri tahu kata sandi awal ini ke staff secara langsung. Fitur ganti
        kata sandi mandiri menyusul (belum ada di versi ini).
      </p>
    </section>
  );
}

function BarisAkun({ akun }: { akun: AkunStaff }) {
  const { showToast } = useToast();
  const [sedangUbah, setSedangUbah] = useState(false);

  async function handleToggleAktif() {
    setSedangUbah(true);
    try {
      await updateDoc(doc(db, "users", akun.uid), { aktif: !akun.aktif });
      showToast(
        "success",
        !akun.aktif ? `${akun.nama} diaktifkan kembali.` : `${akun.nama} dinonaktifkan.`,
      );
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mengubah status akun: ${error.message}` : "Gagal mengubah status akun.",
      );
    } finally {
      setSedangUbah(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-900">{akun.nama}</p>
          <span
            className={[
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
              akun.aktif ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600",
            ].join(" ")}
          >
            {akun.aktif ? "Aktif" : "Nonaktif"}
          </span>
        </div>

        {/* Setiap keterangan diberi label eksplisit (Email/Username/
            Peran) — jangan digabung dengan "·" saja supaya jelas
            fieldnya apa, terutama buat pengguna yang belum akrab
            istilah teknis (permintaan pemilik cafe). */}
        <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-3">
          <div className="flex gap-1.5">
            <dt className="font-medium text-slate-400">Email:</dt>
            <dd className="truncate">{akun.email}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-medium text-slate-400">Username:</dt>
            <dd className="truncate">{akun.username ? `@${akun.username}` : "—"}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-medium text-slate-400">Peran:</dt>
            <dd>{LABEL_PERAN[akun.peran] ?? akun.peran}</dd>
          </div>
        </dl>
      </div>
      {akun.peran === "superadmin" ? (
        <span className="shrink-0 text-xs text-slate-400">Akun Owner</span>
      ) : (
        <button
          type="button"
          onClick={handleToggleAktif}
          disabled={sedangUbah}
          aria-busy={sedangUbah}
          className={[
            "inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm",
            "motion-safe:transition motion-safe:duration-150",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
            akun.aktif
              ? "bg-rose-50 text-rose-700 hover:bg-rose-100 focus-visible:outline-rose-600"
              : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 focus-visible:outline-emerald-700",
          ].join(" ")}
        >
          {sedangUbah ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : akun.aktif ? (
            <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {akun.aktif ? "Nonaktifkan" : "Aktifkan"}
        </button>
      )}
    </li>
  );
}

function pesanErrorBuatAkun(error: unknown): string {
  const kode = (error as { code?: string })?.code ?? "";
  switch (kode) {
    case "auth/email-already-in-use":
      return "Email sudah dipakai akun lain.";
    case "auth/invalid-email":
      return "Format email tidak valid.";
    case "auth/weak-password":
      return "Kata sandi terlalu lemah (minimal 6 karakter).";
    default:
      return "Gagal membuat akun. Periksa koneksi internet dan coba lagi.";
  }
}
