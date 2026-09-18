"use client";

// ============================================================
// Halaman: Pilih Outlet — Multi-Cabang dengan Owner & Finance terpusat
// (revisi permintaan pemilik cafe: "Finance juga terpusat login pilih
// outlet"). Owner DAN Finance satu akun untuk SEMUA Outlet, jadi setiap
// sesi (atau saat sengaja berpindah lewat pengalih di AppShell) memilih
// dulu Outlet mana yang sedang dikerjakan sebelum masuk Dashboard.
// Kasir/Purchasing TIDAK PERNAH melihat halaman ini — Outlet mereka
// tetap (profil.outletId), lihat require-auth.tsx & outlet-context.tsx.
//
// SENGAJA `lewatiGatingOutlet` di RequireAuth — halaman inilah yang
// MENYELESAIKAN gating itu, kalau ikut digating akan redirect
// berputar ke dirinya sendiri.
//
// AUTO-BUAT OUTLET PERTAMA ("SRASA BOOK"): kalau daftar Outlet masih
// kosong sama sekali (instalasi baru/pertama kali), Owner TIDAK perlu
// lagi dialihkan manual ke /kelola-outlet — halaman ini langsung
// membuatkan dokumen outlets/srasa-book begitu terdeteksi kosong,
// supaya Owner tinggal menekannya begini terisi. Hanya Owner MURNI
// yang bisa memicu ini (firestore.rules: `outlets` cuma bisa ditulis
// isOwner()) — Finance yang kebetulan login duluan tetap melihat
// pesan "hubungi Owner" seperti biasa, sambil pembuatan otomatis
// tetap berjalan di sesi Owner begitu Owner login.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Building2, Loader2, WifiOff } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutlet } from "@/shared/lib/outlet-context";
import { db } from "@/shared/lib/firebase";
import { JUDUL_LENGKAP_BRAND } from "@/shared/lib/brand";

const ID_OUTLET_PERTAMA = "srasa-book";
const NAMA_OUTLET_PERTAMA = "SRASA BOOK";

export default function PilihOutletPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]} lewatiGatingOutlet>
      <PilihOutletIsi />
    </RequireAuth>
  );
}

function PilihOutletIsi() {
  const router = useRouter();
  const { profil } = useAuth();
  const { daftarOutletAktif, memuat, pilihOutlet } = useOutlet();
  const [sedangMembuatPertama, setSedangMembuatPertama] = useState(false);
  // Ditampilkan APA ADANYA kalau pembuatan otomatis gagal — paling
  // sering "Missing or insufficient permissions" kalau firestore.rules
  // yang aktif di Firebase Console belum di-Publish ulang ke versi
  // terbaru (helper isOwner()/isFinance() berubah beberapa kali di
  // riwayat proyek ini). Menampilkan pesan asli jauh lebih membantu
  // ditelusuri daripada teks generik "sebentar lagi muncul".
  const [errorBuatPertama, setErrorBuatPertama] = useState<string | null>(null);
  // true kalau setDoc() TIDAK kunjung selesai (bukan ditolak, bukan
  // berhasil — cuma menggantung) setelah beberapa detik. Ini kasus
  // BERBEDA dari errorBuatPertama: permission-denied dari
  // firestore.rules biasanya ditolak CEPAT (hitungan detik), jadi
  // spinner yang menggantung lama justru lebih mengarah ke koneksi/
  // firewall yang memblokir Firestore, bukan aturan yang salah.
  const [macet, setMacet] = useState(false);
  const [percobaanKe, setPercobaanKe] = useState(0);
  const sudahDicobaRef = useRef(false);

  // Deferred setState via microtask (pola baku proyek ini) — Owner
  // memicu pembuatan Outlet pertama begitu daftar kosong terkonfirmasi.
  useEffect(() => {
    if (memuat || daftarOutletAktif.length > 0) return;
    if (profil?.peran !== "superadmin") return;
    if (sudahDicobaRef.current) return;
    sudahDicobaRef.current = true;

    let dibatalkan = false;
    Promise.resolve().then(() => {
      if (!dibatalkan) {
        setSedangMembuatPertama(true);
        setErrorBuatPertama(null);
        setMacet(false);
      }
    });

    // Kalau setDoc() belum selesai (resolve MAUPUN reject) sesudah 10
    // detik, jangan biarkan spinner menggantung tanpa penjelasan —
    // tampilkan pesan koneksi/firewall. Kalau setDoc() akhirnya
    // resolve/reject belakangan, hasilnya tetap ditangani normal di
    // bawah (timer ini cuma menambah pesan, tidak membatalkan setDoc).
    const timer = window.setTimeout(() => {
      if (!dibatalkan) setMacet(true);
    }, 10000);

    setDoc(doc(db, "outlets", ID_OUTLET_PERTAMA), {
      nama: NAMA_OUTLET_PERTAMA,
      alamat: "",
      aktif: true,
      dibuatPada: serverTimestamp(),
    })
      .catch((error) => {
        if (!dibatalkan) {
          setErrorBuatPertama(
            error instanceof Error ? error.message : "Gagal membuat Outlet pertama.",
          );
        }
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (!dibatalkan) {
          setSedangMembuatPertama(false);
          setMacet(false);
        }
      });
    return () => {
      dibatalkan = true;
      window.clearTimeout(timer);
    };
    // `percobaanKe` SENGAJA masuk deps — satu-satunya cara memicu efek
    // ini lari lagi lewat tombol "Coba Lagi" di bawah tanpa reload
    // seluruh halaman.
  }, [memuat, daftarOutletAktif.length, profil, percobaanKe]);

  function cobaLagi() {
    sudahDicobaRef.current = false;
    setErrorBuatPertama(null);
    setMacet(false);
    setPercobaanKe((n) => n + 1);
  }

  function pilih(id: string) {
    pilihOutlet(id);
    router.replace("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <header className="mb-6 text-center">
        <p className="text-xs font-semibold tracking-wide text-emerald-700">
          {JUDUL_LENGKAP_BRAND}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Pilih Outlet</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pilih Outlet yang ingin Anda kelola sekarang. Anda bisa berpindah
          Outlet kapan saja lewat menu di halaman berikutnya.
        </p>
      </header>

      {sedangMembuatPertama && macet ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-center shadow-sm">
          <WifiOff className="mx-auto h-6 w-6 text-amber-700" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-amber-900">
            Sudah lebih dari 10 detik, belum ada balasan dari server.
          </p>
          <p className="mt-1.5 text-xs text-amber-800">
            Ini BEDA dari sekadar aturan (Rules) salah — kalau Rules yang
            menolak, biasanya muncul pesan error dalam hitungan detik, bukan
            menggantung begini. Kemungkinan besar penyebabnya koneksi
            internet terputus-putus, jaringan kantor/WiFi memblokir Firebase,
            atau ada ekstensi browser (ad-blocker/VPN) yang mengganggu.
            Coba: periksa internet, matikan sementara ekstensi browser yang
            mencurigakan, atau coba jaringan lain (mis. data seluler).
          </p>
          <button
            type="button"
            onClick={cobaLagi}
            className="mt-3 inline-flex items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 active:scale-[0.98]"
          >
            Coba Lagi
          </button>
        </div>
      ) : memuat || sedangMembuatPertama ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {sedangMembuatPertama ? `Menyiapkan Outlet pertama (${NAMA_OUTLET_PERTAMA})...` : "Memuat daftar Outlet..."}
        </div>
      ) : daftarOutletAktif.length === 0 ? (
        <div
          className={[
            "rounded-xl border p-6 text-center shadow-sm",
            errorBuatPertama ? "border-rose-300 bg-rose-50" : "border-amber-300 bg-amber-50",
          ].join(" ")}
        >
          {profil?.peran === "superadmin" ? (
            errorBuatPertama ? (
              <>
                <p className="text-sm font-semibold text-rose-900">Gagal membuat Outlet pertama.</p>
                <p className="mt-1.5 text-xs text-rose-800">
                  Pesan asli: <code className="break-words">{errorBuatPertama}</code>
                </p>
                <p className="mt-2 text-xs text-rose-800">
                  Penyebab paling umum: firestore.rules terbaru belum di-Publish ke
                  Firebase Console (Firestore Database → Rules → tempel isi
                  firestore.rules terbaru → Publish). Setelah dipastikan sudah
                  Publish, tekan tombol di bawah.
                </p>
                <button
                  type="button"
                  onClick={cobaLagi}
                  className="mt-3 inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 active:scale-[0.98]"
                >
                  Coba Lagi
                </button>
              </>
            ) : (
              <p className="text-sm text-amber-900">
                Menyiapkan Outlet pertama, sebentar lagi muncul di sini — kalau tidak
                muncul setelah beberapa detik, periksa koneksi internet lalu muat
                ulang halaman.
              </p>
            )
          ) : (
            <p className="text-sm text-amber-900">
              Belum ada Outlet aktif. Hubungi Owner untuk membukanya sebentar supaya
              Outlet pertama dibuatkan otomatis.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {daftarOutletAktif.map((outlet) => (
            <button
              key={outlet.id}
              type="button"
              onClick={() => pilih(outlet.id)}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm motion-safe:transition motion-safe:duration-150 hover:border-emerald-600 hover:bg-emerald-50 active:scale-[0.98]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Building2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
                  {outlet.nama}
                  {outlet.demo ? (
                    <span className="shrink-0 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-950">
                      Demo
                    </span>
                  ) : null}
                </span>
                {outlet.alamat ? (
                  <span className="block truncate text-xs text-slate-500">{outlet.alamat}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
