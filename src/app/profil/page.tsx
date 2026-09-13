"use client";

// ============================================================
// Halaman: Profil Akun — dibuka SEMUA peran.
//
// Isinya tiga bagian, sesuai permintaan pemilik cafe:
//   1. Biodata Diri (nama bisa diubah sendiri; username/email/peran
//      hanya ditampilkan, bukan diubah sendiri)
//   2. Ganti Kata Sandi
//   3. KHUSUS Owner/Finance: Detail Perusahaan, DI BAWAH biodata —
//      dipakai sebagai KOP SURAT semua ekspor Excel/PDF.
//
// Catatan keamanan soal bagian 1: firestore.rules sengaja hanya
// mengizinkan pengguna mengubah field `nama` pada dokumennya SENDIRI.
// `peran` dan `aktif` TIDAK boleh ikut diubah — kalau boleh, Kasir
// bisa menaikkan dirinya jadi superadmin hanya lewat devtools, dan
// seluruh matriks hak akses aplikasi ini runtuh. Itulah kenapa
// aturannya memakai hasOnly(['nama']), bukan sekadar "boleh update
// dokumen sendiri".
//
// Catatan soal bagian 2: Firebase mewajibkan REAUTENTIKASI sebelum
// updatePassword bila sesi sudah lama. Daripada menunggu error
// "requires-recent-login" muncul di depan pengguna, form ini memang
// selalu meminta kata sandi lama lalu reauth dulu — sekalian menjadi
// verifikasi bahwa yang mengganti sandi memang pemilik akun, bukan
// orang yang menemukan perangkat dalam keadaan masih login.
// ============================================================

import { useEffect, useState } from "react";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { Building2, KeyRound, Loader2, Save, UserRound } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { AppShell } from "@/shared/components/app-shell";
import { useAuth, type PeranPengguna } from "@/shared/lib/auth-context";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { simpanDetailPerusahaan, useDetailPerusahaan } from "@/shared/lib/perusahaan";
import type { DetailPerusahaan } from "@/shared/types/perusahaan";

const LABEL_PERAN: Record<PeranPengguna, string> = {
  superadmin: "Owner",
  finance: "Finance",
  kasir: "Kasir",
  purchasing: "Purchasing",
};

export default function ProfilPage() {
  return (
    <RequireAuth>
      <AppShell>
        <ProfilIsi />
      </AppShell>
    </RequireAuth>
  );
}

function ProfilIsi() {
  const { profil } = useAuth();
  const bolehAturPerusahaan = profil?.peran === "superadmin" || profil?.peran === "finance";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          SRASA BOOK
        </p>
        <h1 className="text-2xl font-bold text-slate-900">Profil Akun</h1>
        <p className="mt-1 text-sm text-slate-600">
          Data diri dan keamanan akun Anda.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <BiodataKartu />
        <GantiSandiKartu />
        {bolehAturPerusahaan ? <DetailPerusahaanKartu /> : null}
      </div>
    </main>
  );
}

// ------------------------------------------------------------
// 1. Biodata Diri
// ------------------------------------------------------------

function BiodataKartu() {
  const { user, profil } = useAuth();
  const { showToast } = useToast();
  // Nama yang ditampilkan DITURUNKAN, bukan disalin lewat effect:
  // selama Owner belum mengetik apa pun, `namaDiedit` null dan yang
  // tampil adalah nama dari profil (yang bisa datang belakangan saat
  // dokumen selesai dimuat, atau berubah dari perangkat lain). Begitu
  // pengguna mengetik, ketikannya yang menang. Pola ini menghindari
  // setState di dalam effect yang menimbulkan render berantai.
  const [namaDiedit, setNamaDiedit] = useState<string | null>(null);
  const nama = namaDiedit ?? profil?.nama ?? "";

  const [username, setUsername] = useState("");
  const [sedangSimpan, setSedangSimpan] = useState(false);

  useEffect(() => {
    if (!user) return;
    let dibatalkan = false;
    getDoc(doc(db, "users", user.uid))
      .then((snap) => {
        if (!dibatalkan) setUsername((snap.data()?.username as string) ?? "");
      })
      .catch(() => {
        // Username hanya tampilan; gagal baca tidak perlu diributkan.
      });
    return () => {
      dibatalkan = true;
    };
  }, [user]);

  async function handleSimpan() {
    if (!user) return;
    if (!nama.trim()) {
      showToast("error", "Nama tidak boleh kosong.");
      return;
    }
    setSedangSimpan(true);
    try {
      // HANYA field `nama` yang dikirim — firestore.rules menolak kalau
      // ada field lain ikut berubah (lihat komentar kepala berkas).
      await updateDoc(doc(db, "users", user.uid), { nama: nama.trim() });
      // Kembalikan ke mode "ikut profil": nilai dari Firestore yang
      // baru saja ditulis akan mengalir sendiri lewat AuthContext.
      setNamaDiedit(null);
      showToast("success", "Nama berhasil diperbarui.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menyimpan: ${error.message}` : "Gagal menyimpan.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-biodata"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="bagian-biodata"
        className="flex items-center gap-2 text-base font-semibold text-slate-900"
      >
        <UserRound className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Biodata Diri
      </h2>

      <div className="mt-4 flex flex-col gap-4">
        <div>
          <label htmlFor="profil-nama" className="block text-sm font-semibold text-slate-800">
            Nama Lengkap
          </label>
          <input
            id="profil-nama"
            type="text"
            value={nama}
            onChange={(event) => setNamaDiedit(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <BarisInfo label="Username" nilai={username || "—"} />
          <BarisInfo label="Email" nilai={profil?.email ?? "—"} />
          <BarisInfo
            label="Peran"
            nilai={profil ? LABEL_PERAN[profil.peran] : "—"}
          />
        </div>
        <p className="text-xs text-slate-500">
          Username, email, dan peran hanya bisa diubah oleh Owner lewat
          halaman Kelola Akun — demi keamanan, peran tidak bisa diubah
          sendiri.
        </p>

        <div>
          <button
            type="button"
            onClick={handleSimpan}
            disabled={sedangSimpan}
            aria-busy={sedangSimpan}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-emerald-400"
          >
            {sedangSimpan ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            {sedangSimpan ? "Menyimpan..." : "Simpan Biodata"}
          </button>
        </div>
      </div>
    </section>
  );
}

function BarisInfo({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="truncate text-sm font-medium text-slate-900" title={nilai}>
        {nilai}
      </p>
    </div>
  );
}

// ------------------------------------------------------------
// 2. Ganti Kata Sandi
// ------------------------------------------------------------

function GantiSandiKartu() {
  const { user, profil } = useAuth();
  const { showToast } = useToast();
  const [sandiLama, setSandiLama] = useState("");
  const [sandiBaru, setSandiBaru] = useState("");
  const [konfirmasi, setKonfirmasi] = useState("");
  const [sedangGanti, setSedangGanti] = useState(false);

  // Akun yang masuk lewat Google tidak punya kata sandi untuk diganti —
  // tawarannya akan selalu gagal, jadi lebih jujur menjelaskannya.
  const punyaSandi = user?.providerData.some((p) => p.providerId === "password") ?? false;

  async function handleGanti() {
    if (!user || !profil) return;
    if (sandiBaru.length < 6) {
      showToast("error", "Kata sandi baru minimal 6 karakter.");
      return;
    }
    if (sandiBaru !== konfirmasi) {
      showToast("error", "Konfirmasi kata sandi tidak cocok.");
      return;
    }

    setSedangGanti(true);
    try {
      const email = user.email ?? profil.email;
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, sandiLama));
      await updatePassword(user, sandiBaru);
      showToast("success", "Kata sandi berhasil diganti.");
      setSandiLama("");
      setSandiBaru("");
      setKonfirmasi("");
    } catch (error) {
      const kode = (error as { code?: string })?.code ?? "";
      if (kode === "auth/wrong-password" || kode === "auth/invalid-credential") {
        showToast("error", "Kata sandi lama salah.");
      } else if (kode === "auth/weak-password") {
        showToast("error", "Kata sandi baru terlalu lemah, gunakan minimal 6 karakter.");
      } else if (kode === "auth/too-many-requests") {
        showToast("error", "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.");
      } else {
        showToast("error", "Gagal mengganti kata sandi. Coba lagi.");
      }
    } finally {
      setSedangGanti(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-sandi"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="bagian-sandi"
        className="flex items-center gap-2 text-base font-semibold text-slate-900"
      >
        <KeyRound className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Ganti Kata Sandi
      </h2>

      {!punyaSandi ? (
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          Akun ini masuk lewat Google, jadi tidak punya kata sandi aplikasi.
          Ganti kata sandi dilakukan di akun Google Anda.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label htmlFor="sandi-lama" className="block text-sm font-semibold text-slate-800">
              Kata Sandi Lama
            </label>
            <input
              id="sandi-lama"
              type="password"
              autoComplete="current-password"
              value={sandiLama}
              onChange={(event) => setSandiLama(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="sandi-baru" className="block text-sm font-semibold text-slate-800">
                Kata Sandi Baru
              </label>
              <input
                id="sandi-baru"
                type="password"
                autoComplete="new-password"
                value={sandiBaru}
                onChange={(event) => setSandiBaru(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
              <p className="mt-1 text-xs text-slate-500">Minimal 6 karakter.</p>
            </div>
            <div>
              <label htmlFor="sandi-konfirmasi" className="block text-sm font-semibold text-slate-800">
                Ulangi Kata Sandi Baru
              </label>
              <input
                id="sandi-konfirmasi"
                type="password"
                autoComplete="new-password"
                value={konfirmasi}
                onChange={(event) => setKonfirmasi(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
          </div>
          <div>
            <button
              type="button"
              onClick={handleGanti}
              disabled={sedangGanti}
              aria-busy={sedangGanti}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-emerald-400"
            >
              {sedangGanti ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              )}
              {sedangGanti ? "Mengganti..." : "Ganti Kata Sandi"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------
// 3. Detail Perusahaan (Owner/Finance saja)
// ------------------------------------------------------------

function DetailPerusahaanKartu() {
  const { showToast } = useToast();
  const { detail, memuat, setDetail } = useDetailPerusahaan();
  const [sedangSimpan, setSedangSimpan] = useState(false);

  function ubah(field: keyof DetailPerusahaan, nilai: string) {
    setDetail({ ...detail, [field]: nilai });
  }

  async function handleSimpan() {
    if (!detail.nama.trim()) {
      showToast("error", "Nama perusahaan wajib diisi — ini yang dicetak di kop surat.");
      return;
    }
    setSedangSimpan(true);
    try {
      await simpanDetailPerusahaan(detail);
      showToast("success", "Detail perusahaan tersimpan dan langsung dipakai di kop ekspor.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menyimpan: ${error.message}` : "Gagal menyimpan.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-perusahaan"
      className="rounded-xl border border-emerald-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="bagian-perusahaan"
        className="flex items-center gap-2 text-base font-semibold text-slate-900"
      >
        <Building2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Detail Perusahaan
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Khusus Owner/Finance. Data ini dicetak sebagai KOP SURAT di setiap
        ekspor Excel dan PDF — isi selengkap mungkin agar laporan terlihat
        resmi.
      </p>

      {memuat ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label htmlFor="pt-nama" className="block text-sm font-semibold text-slate-800">
              Nama Perusahaan
            </label>
            <p className="mt-0.5 text-xs text-slate-500">
              Boleh 2-3 baris (tekan Enter) — mis. nama besar di baris
              pertama, anak kalimat di baris berikutnya. Setiap baris
              dicetak apa adanya di kop surat Excel/PDF.
            </p>
            <textarea
              id="pt-nama"
              rows={2}
              value={detail.nama}
              onChange={(event) => ubah("nama", event.target.value)}
              placeholder={"misalnya:\nSRASA COFFEE\nCabang Sudirman"}
              className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 whitespace-pre-line outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <BidangTeks
            id="pt-bidang"
            label="Bidang Usaha"
            nilai={detail.bidangUsaha}
            onChange={(v) => ubah("bidangUsaha", v)}
            placeholder="misalnya: Coffee & Eatery"
          />

          <div>
            <label htmlFor="pt-alamat" className="block text-sm font-semibold text-slate-800">
              Alamat Lengkap
            </label>
            <textarea
              id="pt-alamat"
              rows={2}
              value={detail.alamat}
              onChange={(event) => ubah("alamat", event.target.value)}
              placeholder="Jalan, nomor, kelurahan, kota, kode pos"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <BidangTeks
              id="pt-telepon"
              label="Telepon"
              nilai={detail.telepon}
              onChange={(v) => ubah("telepon", v)}
              placeholder="0812xxxxxxx"
            />
            <BidangTeks
              id="pt-email"
              label="Email"
              nilai={detail.email}
              onChange={(v) => ubah("email", v)}
              placeholder="halo@srasa.id"
            />
            <BidangTeks
              id="pt-website"
              label="Website"
              nilai={detail.website}
              onChange={(v) => ubah("website", v)}
              placeholder="srasa.id"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <BidangTeks
              id="pt-npwp"
              label="NPWP"
              nilai={detail.npwp}
              onChange={(v) => ubah("npwp", v)}
              placeholder="Opsional"
            />
            <BidangTeks
              id="pt-catatan"
              label="Catatan Kaki Laporan"
              nilai={detail.catatanKaki}
              onChange={(v) => ubah("catatanKaki", v)}
              placeholder="misalnya: Dokumen internal — bukan bukti pajak"
            />
          </div>

          <div>
            <button
              type="button"
              onClick={handleSimpan}
              disabled={sedangSimpan}
              aria-busy={sedangSimpan}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-emerald-400"
            >
              {sedangSimpan ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {sedangSimpan ? "Menyimpan..." : "Simpan Detail Perusahaan"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function BidangTeks({
  id,
  label,
  nilai,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  nilai: string;
  onChange: (nilai: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-800">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={nilai}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
      />
    </div>
  );
}
