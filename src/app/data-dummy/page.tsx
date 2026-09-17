"use client";

// ============================================================
// Halaman: Data Dummy (Beta) — permintaan pemilik cafe: "Buatkan data
// dummy untuk ujicoba, tapi tetap sediakan tombol switch data dummy
// atau data aktual, dan data aktual tidak boleh tersentuh sebelum
// switch."
//
// Pendekatannya SENGAJA tidak membuat sistem "mode" terpisah di dalam
// kode (bendera global, penyimpanan lokal ganda, dsb) — arsitektur
// aplikasi ini SEJAK AWAL sudah memisahkan SEMUA data per-Outlet
// (outlets/{outletId}/...), jadi cara paling aman & konsisten adalah
// menjadikan "Data Dummy" itu sendiri sebagai SATU Outlet biasa,
// ditandai `demo: true`. "Tombol switch"-nya adalah pengalih Outlet
// yang SUDAH ADA di Sidebar (ikon Repeat di sebelah nama Outlet) /
// halaman Pilih Outlet — begitu Outlet Demo dibuat di sini, ia otomatis
// muncul di daftar itu (badge "DEMO"), dan berpindah ke sana TIDAK
// PERNAH menyentuh data Outlet lain karena keduanya hidup di path
// Firestore yang sama sekali berbeda.
//
// Halaman ini KHUSUS Owner murni: firestore.rules cuma mengizinkan
// isOwner() menulis dokumen outlets/{id} itu sendiri (Finance bisa
// mengelola ISI sebuah Outlet tapi tidak membuat/menghapus Outlet).
//
// Top-level components, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useState } from "react";
import { FlaskConical, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { AppShell } from "@/shared/components/app-shell";
import { useToast } from "@/shared/components/toast";
import { useOutlet } from "@/shared/lib/outlet-context";
import { cariOutletDemo, seedDataDummy, hapusDataDummy, NAMA_OUTLET_DEMO } from "@/shared/lib/data-dummy";

export default function DataDummyPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin"]} hanyaOwnerMurni lewatiGatingOutlet>
      <AppShell>
        <DataDummyIsi />
      </AppShell>
    </RequireAuth>
  );
}

function DataDummyIsi() {
  const { showToast } = useToast();
  const { pilihOutlet } = useOutlet();
  const [memuat, setMemuat] = useState(true);
  const [outletDemo, setOutletDemo] = useState<{ id: string; nama: string } | null>(null);
  const [sedangProses, setSedangProses] = useState<"isi" | "hapus" | null>(null);
  const [konfirmasiHapus, setKonfirmasiHapus] = useState(false);

  async function muatStatus() {
    setMemuat(true);
    try {
      setOutletDemo(await cariOutletDemo());
    } catch {
      // Diamkan — tombol "Buat/Isi Ulang" tetap bisa dicoba, akan
      // menampilkan error sendiri kalau memang gagal.
    } finally {
      setMemuat(false);
    }
  }

  useEffect(() => {
    muatStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cuma sekali saat halaman dibuka.
  }, []);

  async function handleIsi() {
    setSedangProses("isi");
    try {
      const hasil = await seedDataDummy();
      showToast(
        "success",
        outletDemo
          ? "Data Dummy diisi ulang dengan versi terbaru."
          : `Outlet Demo dibuat & diisi data contoh (${hasil.jumlahDokumen} dokumen).`,
      );
      await muatStatus();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menyiapkan Data Dummy: ${error.message}` : "Gagal menyiapkan Data Dummy.",
      );
    } finally {
      setSedangProses(null);
    }
  }

  async function handleHapus() {
    setSedangProses("hapus");
    try {
      await hapusDataDummy();
      showToast("success", "Outlet Demo & seluruh Data Dummy-nya sudah dihapus.");
      setKonfirmasiHapus(false);
      await muatStatus();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menghapus Data Dummy: ${error.message}` : "Gagal menghapus Data Dummy.",
      );
    } finally {
      setSedangProses(null);
    }
  }

  function handlePindahKeDemo() {
    if (!outletDemo) return;
    pilihOutlet(outletDemo.id);
    showToast("success", `Berpindah ke ${outletDemo.nama} — Data Dummy sekarang aktif.`);
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
          <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
          Beta
        </span>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Data Dummy</h1>
        <p className="mt-1 text-sm text-slate-500">
          Siapkan Outlet contoh berisi data karangan (bahan baku, menu, shift, belanja, dst) untuk ujicoba
          fitur baru — data asli di Outlet manapun TIDAK PERNAH tersentuh oleh apa pun di halaman ini.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <ShieldCheck className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Data aktual selalu aman</p>
            <p className="mt-1 text-xs text-slate-600">
              Data Dummy hidup di Outlet-nya SENDIRI (terpisah total secara teknis dari Outlet asli mana
              pun) — bukan sekadar "mode tampilan". Mengisi, mengisi ulang, atau menghapus Data Dummy tidak
              pernah membaca maupun menulis satu dokumen pun milik Outlet lain.
            </p>
          </div>
        </div>
      </section>

      {memuat ? (
        <div className="mt-6 flex min-h-[20vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Status Outlet Demo</h2>
            {outletDemo ? (
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-950">
                    Demo
                  </span>
                  <span className="text-sm font-medium text-slate-800">{outletDemo.nama}</span>
                </div>
                <button
                  type="button"
                  onClick={handlePindahKeDemo}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950 shadow-sm hover:bg-amber-600 active:scale-[0.98]"
                >
                  <FlaskConical className="h-4 w-4" aria-hidden="true" />
                  Pindah ke Data Dummy
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Belum ada Outlet Demo. Tekan &quot;Buat Data Dummy&quot; di bawah untuk membuatnya.
              </p>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Untuk kembali ke data asli, gunakan pengalih Outlet (ikon putar) di sebelah nama Outlet pada
              Sidebar, sama seperti berpindah antar-Outlet biasa.
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">
              {outletDemo ? "Isi Ulang Data Dummy" : "Buat Data Dummy"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Menulis contoh: bahan baku & kemasan (termasuk satu yang sengaja di bawah batas minimal stok),
              menu + resep + HPP otomatis, jadwal shift, 2 hari shift Kasir (termasuk satu shift contoh
              MINUS untuk uji Tanggungan Kasir), belanja Purchasing berantai (uji fitur Lanjutkan Shift),
              satu Form Banding menunggu tinjau, serta saldo Deposito Finance. Aman dijalankan berulang —
              dokumen dengan id tetap (bahan, menu, slot) akan ditimpa ke versi terbaru.
            </p>
            <button
              type="button"
              onClick={handleIsi}
              disabled={sedangProses !== null}
              aria-busy={sedangProses === "isi"}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-emerald-400"
            >
              {sedangProses === "isi" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              )}
              {sedangProses === "isi" ? "Menyiapkan..." : outletDemo ? "Isi Ulang Data Dummy" : "Buat Data Dummy"}
            </button>
          </section>

          {outletDemo ? (
            <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
              <h2 className="text-base font-semibold text-rose-900">Hapus Data Dummy</h2>
              <p className="mt-1 text-xs text-rose-700">
                Menghapus Outlet Demo beserta SELURUH isinya secara permanen (tidak bisa dibatalkan). Data
                Outlet lain tidak terpengaruh sama sekali.
              </p>
              {konfirmasiHapus ? (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleHapus}
                    disabled={sedangProses !== null}
                    aria-busy={sedangProses === "hapus"}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-rose-400"
                  >
                    {sedangProses === "hapus" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    {sedangProses === "hapus" ? "Menghapus..." : "Ya, Hapus Permanen"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setKonfirmasiHapus(false)}
                    disabled={sedangProses !== null}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Batal
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setKonfirmasiHapus(true)}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg border border-rose-600 px-4 py-2.5 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-100 active:scale-[0.98]"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Hapus Data Dummy
                </button>
              )}
            </section>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Ujicoba Layar Kasir/Purchasing</h2>
            <p className="mt-1 text-xs text-slate-600">
              Halaman Kasir & Purchasing perlu login sungguhan yang cocok dengan aturan keamanan (bukan
              cuma berpindah Outlet seperti Owner/Finance). Untuk mengujinya: buka <strong>Kelola Akun</strong>,
              buat akun baru dengan peran Kasir/Purchasing, lalu pilih Outlet = <strong>{NAMA_OUTLET_DEMO}</strong>.
              Login dengan akun itu — shift/sesi belanja hari ini akan otomatis tersedia seperti biasa, dan
              semua aktivitasnya masuk ke Outlet Demo, bukan data asli.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
