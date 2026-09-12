"use client";

// ============================================================
// Halaman: Kalkulator HPP (versi manual + komponen persentase)
// PRD terkait: bagian 8.3.1 (rumus) dan 9.4 (spesifikasi fitur).
// Peran: SUPERADMIN (Owner) saja — ditegakkan oleh <RequireAuth> di
// sisi klien DAN oleh firestore.rules di sisi server (menu_harga
// boleh dibaca Kasir, tapi menu tetap khusus Owner). Simpan menulis
// dua dokumen dengan menuId sama: menu_harga/{menuId} (publik) dan
// menu/{menuId} (privat) — lihat PRD bagian 6.3 & 10.
//
// Prinsip UI dari PRD 11.1: perhitungan terlihat BERJALAN —
// setiap perubahan input langsung memperbarui hasil di bawahnya,
// tanpa tombol "Hitung" terpisah.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { Info, Loader2, Save, TriangleAlert, Trash2 } from "lucide-react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  serverTimestamp,
  setDoc,
  query,
  where,
} from "firebase/firestore";
import { NumberField } from "@/shared/components/number-field";
import { ResultRow } from "@/shared/components/result-row";
import { RequireAuth } from "@/shared/components/require-auth";
import { AppShell } from "@/shared/components/app-shell";
import {
  hitungKalkulatorHpp,
  persenKeFraksi,
  PROFIL_HPP_DEFAULT_AWAL,
} from "@/shared/lib/hpp-calculator";
import { formatPersen, formatRupiah, formatRupiahSatuan } from "@/shared/lib/format";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import type { ProfilHppDefault } from "@/shared/types/hpp";
import type { BahanBaku, SatuanBahan } from "@/shared/types/inventaris";

// ------------------------------------------------------------
// SECTION: Nilai awal (placeholder — nanti dibaca dari Profil
// Cafe di Firestore begitu Sprint 0 lanjutan/autentikasi selesai).
// Diimpor dari hpp-calculator.ts supaya kalkulasi Laba Bersih
// otomatis di Dashboard (src/shared/lib/laba-harian.ts) memakai
// default yang SAMA PERSIS — satu sumber kebenaran.
// ------------------------------------------------------------

const PROFIL_AWAL = PROFIL_HPP_DEFAULT_AWAL;

/** Satu baris Resep yang sedang disusun di form (belum tersimpan). */
interface BarisResep {
  bahanId: string;
  bahanNama: string;
  satuan: SatuanBahan;
  takaran: number;
  hargaSatuanBahan: number;
}

/** Menu yang sudah tersimpan, untuk dropdown "edit menu". */
interface MenuTersimpan {
  id: string;
  nama: string;
  kategori: string;
}

/** Nilai khusus di dropdown menu = sedang membuat menu baru. */
const MENU_BARU = "";

export default function KalkulatorHppPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]}>
      <AppShell>
        <KalkulatorHppForm />
      </AppShell>
    </RequireAuth>
  );
}

// Dipisah dari komponen pembungkus di atas supaya hook-hook di bawah
// hanya jalan setelah RequireAuth memastikan user login & berperan
// superadmin — tetap top-level, tidak bersarang (webrules-hikimori 11).
function KalkulatorHppForm() {
  const { showToast } = useToast();

  // --- Input dasar menu ---
  const [namaMenu, setNamaMenu] = useState("");
  const [kategoriMenu, setKategoriMenu] = useState("");
  const [biayaKemasan, setBiayaKemasan] = useState(0);

  // --- Resep (bahan + takaran) — HPP Bahan TIDAK LAGI diinput
  // manual, melainkan dihitung otomatis dari baris-baris ini
  // (takaran × harga bahan terkini). Lihat src/shared/lib/resep.ts
  // untuk alasan keamanannya (Kasir nanti hanya baca takaran di
  // sini, tidak pernah harga bahan_baku). ---
  const [daftarBahan, setDaftarBahan] = useState<BahanBaku[]>([]);
  const [resepRows, setResepRows] = useState<BarisResep[]>([]);
  const [bahanDipilih, setBahanDipilih] = useState("");
  const [takaranInput, setTakaranInput] = useState(0);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "bahan_baku"), where("aktif", "==", true)),
      (snap) => {
        setDaftarBahan(
          snap.docs.map((d) => ({
            id: d.id,
            nama: d.data().nama ?? "",
            kategori: d.data().kategori ?? "Umum",
            satuan: d.data().satuan === "pcs" ? "pcs" : "gram",
            hargaSatuanTerakhir: d.data().hargaSatuanTerakhir ?? 0,
            stokSaatIni: d.data().stokSaatIni ?? 0,
            aktif: true,
          })),
        );
      },
    );
    return unsub;
  }, []);

  // --- Mode edit menu ---
  //
  // Dulu setiap kali Simpan ditekan, halaman ini SELALU membuat menuId
  // baru. Akibatnya resep sebuah menu tidak pernah bisa diperbaiki:
  // menyimpan ulang hanya melahirkan menu kembar dengan nama sama, dan
  // menu lama (beserta resep lamanya) tetap dipakai Kasir untuk
  // mengurangi stok. Salah takaran sekali = salah selamanya. Sekarang
  // Owner bisa memilih menu yang sudah ada, formnya terisi, lalu
  // disimpan menimpa menu itu juga resepnya.
  const [daftarMenu, setDaftarMenu] = useState<MenuTersimpan[]>([]);
  const [menuDiedit, setMenuDiedit] = useState<string>(MENU_BARU);
  const [memuatMenu, setMemuatMenu] = useState(false);
  // Bahan yang ADA di resep tersimpan saat form dimuat — dipakai untuk
  // tahu baris mana yang dihapus Owner, supaya dokumen resepnya ikut
  // dihapus di Firestore (kalau tidak, bahan yang sudah dibuang tetap
  // mengurangi stok gudang diam-diam).
  const [resepIdTersimpan, setResepIdTersimpan] = useState<string[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "menu_harga"), orderBy("nama")),
      (snap) => {
        setDaftarMenu(
          snap.docs.map((d) => ({
            id: d.id,
            nama: d.data().nama ?? "",
            kategori: d.data().kategori ?? "Umum",
          })),
        );
      },
    );
    return unsub;
  }, []);

  // Harga bahan diambil ulang dari daftarBahan (data live dari
  // Firestore), bukan dari angka yang tersimpan di baris resep. Jadi
  // ketika Purchasing mencatat pembelian dengan harga baru, HPP di
  // layar ini ikut berubah sendiri tanpa resepnya perlu disentuh —
  // dan menu yang dimuat untuk diedit tidak bergantung pada urutan
  // selesainya pemuatan data.
  const hppBahan = useMemo(
    () =>
      resepRows.reduce((total, row) => {
        const bahan = daftarBahan.find((b) => b.id === row.bahanId);
        return total + row.takaran * (bahan?.hargaSatuanTerakhir ?? row.hargaSatuanBahan);
      }, 0),
    [resepRows, daftarBahan],
  );

  function tambahBarisResep() {
    const bahan = daftarBahan.find((b) => b.id === bahanDipilih);
    if (!bahan) {
      showToast("error", "Pilih bahan baku terlebih dahulu.");
      return;
    }
    if (takaranInput <= 0) {
      showToast("error", "Takaran harus lebih besar dari 0.");
      return;
    }
    if (resepRows.some((r) => r.bahanId === bahan.id)) {
      showToast("error", `${bahan.nama} sudah ada di resep ini.`);
      return;
    }
    setResepRows((prev) => [
      ...prev,
      {
        bahanId: bahan.id,
        bahanNama: bahan.nama,
        satuan: bahan.satuan,
        takaran: takaranInput,
        hargaSatuanBahan: bahan.hargaSatuanTerakhir,
      },
    ]);
    setBahanDipilih("");
    setTakaranInput(0);
  }

  function hapusBarisResep(bahanId: string) {
    setResepRows((prev) => prev.filter((r) => r.bahanId !== bahanId));
  }

  // --- Default persentase dari Profil Cafe (bisa diubah di halaman ini
  //     untuk sekarang; nanti pindah ke halaman Profil Cafe tersendiri) ---
  const [persenSusut, setPersenSusut] = useState(PROFIL_AWAL.persenSusut);
  const [persenUtilitas, setPersenUtilitas] = useState(PROFIL_AWAL.persenUtilitas);
  const [persenTenagaKerja, setPersenTenagaKerja] = useState(
    PROFIL_AWAL.persenTenagaKerja,
  );
  const [persenOverheadLain, setPersenOverheadLain] = useState(
    PROFIL_AWAL.persenOverheadLain,
  );
  const [targetFoodCost, setTargetFoodCost] = useState(PROFIL_AWAL.targetFoodCost);

  // --- Override khusus menu ini (opsional) ---
  const [pakaiOverrideSusut, setPakaiOverrideSusut] = useState(false);
  const [overrideSusut, setOverrideSusut] = useState(PROFIL_AWAL.persenSusut);

  // --- Target harga & harga jual aktual ---
  const [persenMarginDiinginkan, setPersenMarginDiinginkan] = useState(30);
  const [persenMarkupDiinginkan, setPersenMarkupDiinginkan] = useState(30);
  const [hargaJual, setHargaJual] = useState(0);

  const [sedangMenyimpan, setSedangMenyimpan] = useState(false);

  // ------------------------------------------------------------
  // SECTION: Kalkulasi live (dijalankan ulang setiap render —
  // cukup ringan untuk satu menu, tidak perlu useMemo yang rumit)
  // ------------------------------------------------------------

  const defaults: ProfilHppDefault = useMemo(
    () => ({
      persenSusut: persenKeFraksi(persenSusut),
      persenUtilitas: persenKeFraksi(persenUtilitas),
      persenTenagaKerja: persenKeFraksi(persenTenagaKerja),
      persenOverheadLain: persenKeFraksi(persenOverheadLain),
      targetFoodCost: persenKeFraksi(targetFoodCost),
      metodeHargaDefault: "margin",
    }),
    [persenSusut, persenUtilitas, persenTenagaKerja, persenOverheadLain, targetFoodCost],
  );

  const hasil = useMemo(() => {
    return hitungKalkulatorHpp(
      {
        hppBahan,
        biayaKemasan,
        overridePersenSusut: pakaiOverrideSusut ? persenKeFraksi(overrideSusut) : null,
      },
      defaults,
      {
        hargaJual: hargaJual > 0 ? hargaJual : undefined,
        persenMarginDiinginkan: persenKeFraksi(persenMarginDiinginkan),
        persenMarkupDiinginkan: persenKeFraksi(persenMarkupDiinginkan),
      },
    );
  }, [
    hppBahan,
    biayaKemasan,
    pakaiOverrideSusut,
    overrideSusut,
    defaults,
    hargaJual,
    persenMarginDiinginkan,
    persenMarkupDiinginkan,
  ]);

  // ------------------------------------------------------------
  // SECTION: Handler
  // ------------------------------------------------------------

  function kosongkanForm() {
    setNamaMenu("");
    setKategoriMenu("");
    setResepRows([]);
    setResepIdTersimpan([]);
    setBiayaKemasan(0);
    setHargaJual(0);
    setPakaiOverrideSusut(false);
    setOverrideSusut(PROFIL_AWAL.persenSusut);
  }

  /** Muat menu tersimpan ke dalam form untuk diedit (resep, biaya
   *  kemasan, harga jual, dan override susutnya). */
  async function pilihMenu(menuId: string) {
    setMenuDiedit(menuId);
    if (menuId === MENU_BARU) {
      kosongkanForm();
      return;
    }

    const ringkas = daftarMenu.find((m) => m.id === menuId);
    setMemuatMenu(true);
    try {
      const [hargaSnap, rahasiaSnap, resepSnap] = await Promise.all([
        getDoc(doc(db, "menu_harga", menuId)),
        getDoc(doc(db, "menu", menuId)),
        getDocs(collection(db, "menu", menuId, "resep")),
      ]);

      setNamaMenu(hargaSnap.data()?.nama ?? ringkas?.nama ?? "");
      setKategoriMenu(hargaSnap.data()?.kategori ?? ringkas?.kategori ?? "");
      setHargaJual(hargaSnap.data()?.hargaJual ?? 0);

      const rahasia = rahasiaSnap.data();
      setBiayaKemasan(rahasia?.biayaKemasanManual ?? 0);
      const overrideTersimpan = rahasia?.overridePersenSusut ?? null;
      setPakaiOverrideSusut(overrideTersimpan !== null);
      setOverrideSusut(
        overrideTersimpan !== null ? overrideTersimpan * 100 : PROFIL_AWAL.persenSusut,
      );

      const baris: BarisResep[] = resepSnap.docs.map((d) => {
        const data = d.data();
        const bahanId: string = data.bahanId ?? d.id;
        const bahan = daftarBahan.find((b) => b.id === bahanId);
        return {
          bahanId,
          bahanNama: bahan?.nama ?? data.bahanNama ?? "",
          satuan: (data.satuan === "pcs" ? "pcs" : "gram") as SatuanBahan,
          takaran: data.takaran ?? 0,
          hargaSatuanBahan: bahan?.hargaSatuanTerakhir ?? 0,
        };
      });
      setResepRows(baris);
      setResepIdTersimpan(resepSnap.docs.map((d) => d.id));
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal memuat menu: ${error.message}` : "Gagal memuat menu.",
      );
      setMenuDiedit(MENU_BARU);
      kosongkanForm();
    } finally {
      setMemuatMenu(false);
    }
  }

  async function handleSimpan() {
    if (!namaMenu.trim()) {
      showToast("error", "Nama menu wajib diisi sebelum HPP bisa disimpan.");
      return;
    }
    if (resepRows.length === 0) {
      showToast("error", "Tambahkan minimal satu bahan di Resep sebelum HPP bisa disimpan.");
      return;
    }

    setSedangMenyimpan(true);
    try {
      // Skema PRD bagian 10, dipecah demi Security Rules (bagian 6.3):
      // dua dokumen dengan menuId SAMA, di dua koleksi terpisah.
      //   - menu_harga/{menuId}: nama, kategori, hargaJual, aktif —
      //     boleh dibaca Kasir.
      //   - menu/{menuId}: HPP, breakdown biaya, override persentase —
      //     khusus Owner (Security Rules menolak peran lain).
      //   - menu/{menuId}/resep/{bahanId}: bahan + takaran SAJA (tanpa
      //     harga) — boleh dibaca Kasir juga, dipakai untuk mengurangi
      //     stok gudang otomatis saat penjualan tercatat (lihat
      //     src/shared/lib/resep.ts).
      // Menu yang sedang diedit ditimpa memakai ID-nya sendiri; kalau
      // tidak ada yang diedit, barulah ID baru dibuat.
      const menuId = menuDiedit !== MENU_BARU ? menuDiedit : doc(collection(db, "menu_harga")).id;
      const hargaJualUntukDisimpan =
        hargaJual > 0
          ? hargaJual
          : (hasil.rekomendasi.hargaJualIdealMargin ?? 0);

      await setDoc(doc(db, "menu_harga", menuId), {
        nama: namaMenu.trim(),
        kategori: kategoriMenu.trim() || "Umum",
        punyaVarian: false,
        hargaJual: hargaJualUntukDisimpan,
        aktif: true,
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, "menu", menuId), {
        hppCache: hasil.breakdown.hppTotal,
        foodCostPersen: hasil.evaluasi?.foodCostPersen ?? null,
        hppBahanOtomatis: hppBahan,
        biayaKemasanManual: biayaKemasan,
        overridePersenSusut: pakaiOverrideSusut ? persenKeFraksi(overrideSusut) : null,
        overridePersenUtilitas: null,
        overridePersenTenagaKerja: null,
        overridePersenOverheadLain: null,
        updatedAt: serverTimestamp(),
      });

      await Promise.all(
        resepRows.map((row) =>
          setDoc(doc(db, "menu", menuId, "resep", row.bahanId), {
            bahanId: row.bahanId,
            bahanNama: row.bahanNama,
            takaran: row.takaran,
            satuan: row.satuan,
          }),
        ),
      );

      // Bahan yang dibuang Owner dari resep HARUS ikut dihapus di
      // Firestore. Kalau hanya hilang dari layar, dokumennya tetap ada
      // dan Kasir akan terus mengurangi stok bahan itu setiap menu ini
      // terjual — stok menyusut tanpa sebab yang terlihat.
      const idDipakai = new Set(resepRows.map((row) => row.bahanId));
      const idDihapus = resepIdTersimpan.filter((id) => !idDipakai.has(id));
      await Promise.all(
        idDihapus.map((id) => deleteDoc(doc(db, "menu", menuId, "resep", id))),
      );

      showToast(
        "success",
        menuDiedit !== MENU_BARU
          ? `"${namaMenu}" diperbarui: HPP ${formatRupiah(hasil.breakdown.hppTotal)} per porsi.`
          : `HPP untuk "${namaMenu}" tersimpan: ${formatRupiah(hasil.breakdown.hppTotal)} per porsi.`,
      );
      setMenuDiedit(MENU_BARU);
      kosongkanForm();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? `Gagal menyimpan HPP: ${error.message}`
          : "Gagal menyimpan HPP karena kesalahan tidak dikenal.",
      );
    } finally {
      setSedangMenyimpan(false);
    }
  }

  // ------------------------------------------------------------
  // SECTION: Render
  // ------------------------------------------------------------

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          SRASA BOOK
        </p>
        <h1 className="text-2xl font-bold text-slate-900">Kalkulator HPP</h1>
        <p className="mt-1 text-sm text-slate-600">
          Versi manual dengan komponen persentase (Sprint 1) — isi HPP bahan per
          porsi, sisanya dihitung otomatis.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {/* --- Kartu: Data Menu --- */}
        <section
          aria-labelledby="bagian-menu"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 id="bagian-menu" className="text-base font-semibold text-slate-900">
            Data Menu
          </h2>
          <div className="mt-4 flex flex-col gap-4">
            <div>
              <label
                htmlFor="pilih-menu"
                className="block text-sm font-semibold text-slate-800"
              >
                Buat Baru atau Ubah Menu yang Ada
              </label>
              <select
                id="pilih-menu"
                value={menuDiedit}
                onChange={(event) => pilihMenu(event.target.value)}
                disabled={memuatMenu}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
              >
                <option value={MENU_BARU}>+ Menu Baru</option>
                {daftarMenu.map((m) => (
                  <option key={m.id} value={m.id}>
                    Ubah: {m.nama} ({m.kategori})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {memuatMenu
                  ? "Memuat data menu..."
                  : menuDiedit !== MENU_BARU
                    ? "Menyimpan akan MENIMPA menu ini beserta resepnya — harga jual lama ikut diperbarui."
                    : "Pilih menu yang sudah ada bila ingin memperbaiki resep atau harganya."}
              </p>
            </div>

            <div>
              <label
                htmlFor="nama-menu"
                className="block text-sm font-semibold text-slate-800"
              >
                Nama Menu
              </label>
              <input
                id="nama-menu"
                type="text"
                value={namaMenu}
                onChange={(event) => setNamaMenu(event.target.value)}
                placeholder="misalnya: Kopi Susu"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </div>

            <div>
              <label
                htmlFor="kategori-menu"
                className="block text-sm font-semibold text-slate-800"
              >
                Kategori
              </label>
              <input
                id="kategori-menu"
                type="text"
                value={kategoriMenu}
                onChange={(event) => setKategoriMenu(event.target.value)}
                placeholder="misalnya: Minuman Kopi (boleh dikosongkan)"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberField
                id="biaya-kemasan"
                label="Biaya Kemasan per Porsi"
                value={biayaKemasan}
                onChange={setBiayaKemasan}
                prefix="Rp"
                hint="Cup, sedotan, kotak, dll. Boleh dikosongkan (0)."
              />
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
              <input
                id="pakai-override-susut"
                type="checkbox"
                checked={pakaiOverrideSusut}
                onChange={(event) => setPakaiOverrideSusut(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-400 text-emerald-600 focus:ring-emerald-500"
              />
              <div className="flex-1">
                <label
                  htmlFor="pakai-override-susut"
                  className="text-sm font-medium text-slate-800"
                >
                  Menu ini punya persentase susut/waste khusus
                </label>
                <p className="mt-0.5 text-xs text-slate-500">
                  Contoh: minuman dingin dengan susut es batu lebih tinggi dari
                  rata-rata menu lain.
                </p>
                {pakaiOverrideSusut ? (
                  <div className="mt-3 max-w-[200px]">
                    <NumberField
                      id="override-susut"
                      label="Persentase Susut Khusus"
                      value={overrideSusut}
                      onChange={setOverrideSusut}
                      suffix="%"
                      step={0.5}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* --- Kartu: Resep (Bahan + Takaran) --- */}
        <section
          aria-labelledby="bagian-resep"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 id="bagian-resep" className="text-base font-semibold text-slate-900">
            Resep (Bahan + Takaran)
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            HPP Bahan per porsi DIHITUNG OTOMATIS dari sini — takaran ×
            harga bahan terkini. Resep ini juga yang dipakai untuk
            mengurangi stok gudang otomatis saat Kasir mencatat penjualan.
          </p>

          {resepRows.length > 0 ? (
            <ul className="mt-4 divide-y divide-slate-100 rounded-lg bg-slate-50 p-3">
              {resepRows.map((row) => (
                <li key={row.bahanId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-slate-700">
                    {row.bahanNama} · {row.takaran} {row.satuan}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="font-medium tabular-nums text-slate-900">
                      {formatRupiah(
                        row.takaran *
                          (daftarBahan.find((b) => b.id === row.bahanId)?.hargaSatuanTerakhir ??
                            row.hargaSatuanBahan),
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => hapusBarisResep(row.bahanId)}
                      aria-label={`Hapus ${row.bahanNama} dari resep`}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              Belum ada bahan di resep menu ini.
            </p>
          )}

          {daftarBahan.length === 0 ? (
            <p className="mt-4 text-sm text-amber-700">
              Belum ada Bahan Baku. Tambahkan dulu lewat Belanja & Nota
              (Purchasing) sebelum menyusun resep di sini.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto]">
              <div>
                <label htmlFor="bahan-resep" className="block text-sm font-semibold text-slate-800">
                  Bahan
                </label>
                <select
                  id="bahan-resep"
                  value={bahanDipilih}
                  onChange={(event) => setBahanDipilih(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="">Pilih bahan...</option>
                  {daftarBahan
                    .filter((b) => !resepRows.some((r) => r.bahanId === b.id))
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nama} ({formatRupiahSatuan(b.hargaSatuanTerakhir)}/{b.satuan})
                      </option>
                    ))}
                </select>
              </div>
              <NumberField
                id="takaran-resep"
                label={`Takaran (${daftarBahan.find((b) => b.id === bahanDipilih)?.satuan ?? "gram/pcs"})`}
                value={takaranInput}
                onChange={setTakaranInput}
              />
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={tambahBarisResep}
                  className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-emerald-700 active:scale-[0.98] sm:w-auto"
                >
                  Tambah
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-between rounded-lg bg-emerald-50 px-3 py-2.5 text-sm">
            <span className="font-medium text-emerald-900">HPP Bahan per Porsi (otomatis)</span>
            <span className="font-bold tabular-nums text-emerald-900">{formatRupiah(hppBahan)}</span>
          </div>
        </section>

        {/* --- Kartu: Default Profil Cafe --- */}
        <section
          aria-labelledby="bagian-profil"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 id="bagian-profil" className="text-base font-semibold text-slate-900">
            Persentase Default Profil Cafe
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Diatur sekali, dipakai sebagai bawaan untuk semua menu (bisa ditimpa
            per menu di atas).
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <NumberField
              id="persen-susut"
              label="Susut / Waste"
              value={persenSusut}
              onChange={setPersenSusut}
              suffix="%"
              step={0.5}
            />
            <NumberField
              id="persen-utilitas"
              label="Utilitas"
              value={persenUtilitas}
              onChange={setPersenUtilitas}
              suffix="%"
              step={0.5}
            />
            <NumberField
              id="persen-tenaga-kerja"
              label="Tenaga Kerja"
              value={persenTenagaKerja}
              onChange={setPersenTenagaKerja}
              suffix="%"
              step={0.5}
              hint="Opsional, isi 0 bila tidak dihitung."
            />
            <NumberField
              id="persen-overhead"
              label="Overhead Lain"
              value={persenOverheadLain}
              onChange={setPersenOverheadLain}
              suffix="%"
              step={0.5}
            />
          </div>
          <div className="mt-4 max-w-[220px]">
            <NumberField
              id="target-food-cost"
              label="Target Food Cost"
              value={targetFoodCost}
              onChange={setTargetFoodCost}
              suffix="%"
              step={1}
              hint="Dipakai untuk peringatan margin tipis."
            />
          </div>
        </section>

        {/* --- Kartu: Rincian HPP (hasil live) --- */}
        <section
          aria-labelledby="bagian-rincian"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 id="bagian-rincian" className="text-base font-semibold text-slate-900">
            Rincian HPP Total
          </h2>
          <div className="mt-3 divide-y divide-slate-100">
            <ResultRow label="HPP Bahan" value={formatRupiah(hasil.breakdown.hppBahan)} />
            <ResultRow
              label="Biaya Kemasan"
              value={formatRupiah(hasil.breakdown.biayaKemasan)}
            />
            <ResultRow
              label={`Susut / Waste (${formatPersen(pakaiOverrideSusut ? overrideSusut : persenSusut, 1)})`}
              value={formatRupiah(hasil.breakdown.biayaSusut)}
            />
            <ResultRow
              label={`Utilitas (${formatPersen(persenUtilitas, 1)})`}
              value={formatRupiah(hasil.breakdown.biayaUtilitas)}
            />
            <ResultRow
              label={`Tenaga Kerja (${formatPersen(persenTenagaKerja, 1)})`}
              value={formatRupiah(hasil.breakdown.biayaTenagaKerja)}
            />
            <ResultRow
              label={`Overhead Lain (${formatPersen(persenOverheadLain, 1)})`}
              value={formatRupiah(hasil.breakdown.biayaOverheadLain)}
            />
            <ResultRow
              label="HPP Total per Porsi"
              value={formatRupiah(hasil.breakdown.hppTotal)}
              emphasis
            />
          </div>
        </section>

        {/* --- Kartu: Rekomendasi Harga --- */}
        <section
          aria-labelledby="bagian-rekomendasi"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2
            id="bagian-rekomendasi"
            className="text-base font-semibold text-slate-900"
          >
            Rekomendasi Harga Jual
          </h2>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Margin dihitung dari harga jual, Markup dihitung dari HPP — keduanya
            sengaja ditampilkan berdampingan karena hasilnya berbeda meski
            persennya sama.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-4">
              <NumberField
                id="persen-margin"
                label="Target Margin"
                value={persenMarginDiinginkan}
                onChange={setPersenMarginDiinginkan}
                suffix="%"
                step={1}
              />
              <p className="mt-3 text-xs text-slate-500">Harga Jual Ideal</p>
              <p className="text-xl font-bold tabular-nums text-emerald-700">
                {hasil.rekomendasi.hargaJualIdealMargin !== null
                  ? formatRupiah(hasil.rekomendasi.hargaJualIdealMargin)
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <NumberField
                id="persen-markup"
                label="Target Markup"
                value={persenMarkupDiinginkan}
                onChange={setPersenMarkupDiinginkan}
                suffix="%"
                step={1}
              />
              <p className="mt-3 text-xs text-slate-500">Harga Jual Ideal</p>
              <p className="text-xl font-bold tabular-nums text-emerald-700">
                {hasil.rekomendasi.hargaJualIdealMarkup !== null
                  ? formatRupiah(hasil.rekomendasi.hargaJualIdealMarkup)
                  : "—"}
              </p>
            </div>
          </div>
        </section>

        {/* --- Kartu: Evaluasi Harga Jual Aktual --- */}
        <section
          aria-labelledby="bagian-evaluasi"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 id="bagian-evaluasi" className="text-base font-semibold text-slate-900">
            Evaluasi Harga Jual
          </h2>
          <div className="mt-4 max-w-[220px]">
            <NumberField
              id="harga-jual"
              label="Harga Jual Saat Ini"
              value={hargaJual}
              onChange={setHargaJual}
              prefix="Rp"
              hint="Isi untuk melihat margin & food cost aktual."
            />
          </div>

          {hasil.evaluasi ? (
            <div className="mt-4">
              <div className="divide-y divide-slate-100">
                <ResultRow
                  label="Margin per Porsi"
                  value={formatRupiah(hasil.evaluasi.marginRupiah)}
                />
                <ResultRow
                  label="Margin %"
                  value={formatPersen(hasil.evaluasi.marginPersen)}
                />
                <ResultRow
                  label="Food Cost %"
                  value={formatPersen(hasil.evaluasi.foodCostPersen)}
                  emphasis
                />
              </div>

              {hasil.evaluasi.marginTipis ? (
                <div
                  role="alert"
                  className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  <TriangleAlert
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <p>
                    Margin Tipis: food cost {formatPersen(hasil.evaluasi.foodCostPersen)}{" "}
                    melebihi target {formatPersen(targetFoodCost, 0)}. Pertimbangkan
                    menaikkan harga jual atau meninjau ulang komponen biaya.
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              Isi harga jual di atas untuk melihat evaluasi margin.
            </p>
          )}
        </section>

        {/* --- Tombol Simpan --- */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSimpan}
            disabled={sedangMenyimpan}
            aria-busy={sedangMenyimpan}
            className={[
              "inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm",
              "motion-safe:transition motion-safe:duration-150",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
              sedangMenyimpan
                ? "cursor-not-allowed bg-emerald-400"
                : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
            ].join(" ")}
          >
            {sedangMenyimpan ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            {sedangMenyimpan
              ? "Menyimpan..."
              : menuDiedit !== MENU_BARU
                ? "Perbarui Menu Ini"
                : "Simpan HPP Menu"}
          </button>
        </div>
      </div>
    </main>
  );
}
