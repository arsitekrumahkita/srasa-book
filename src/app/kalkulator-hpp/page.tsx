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
import { Info, Loader2, Plus, Save, TriangleAlert, Trash2 } from "lucide-react";
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
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import {
  hitungKalkulatorHpp,
  persenKeFraksi,
  PROFIL_HPP_DEFAULT_AWAL,
} from "@/shared/lib/hpp-calculator";
import { formatPersen, formatRupiah, formatRupiahSatuan } from "@/shared/lib/format";
import { setMirrorStokKasir } from "@/shared/lib/resep";
import {
  ambilDrafAsync,
  hapusDraf,
  useDrafOtomatis,
  usiaDraf,
  type DrafTersimpan,
} from "@/shared/lib/draf";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutletId } from "@/shared/lib/outlet-context";
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

/** Menu yang sudah tersimpan, untuk daftar produk & dropdown "edit menu". */
interface MenuTersimpan {
  id: string;
  nama: string;
  kategori: string;
  hargaJual: number;
  aktif: boolean;
}

/** Nilai khusus di dropdown menu = sedang membuat menu baru. */
const MENU_BARU = "";

/** Kunci draf otomatis untuk form ini (lihat src/shared/lib/draf.ts). */
const KUNCI_DRAF_MENU = "kelola-produk";

/** Bentuk draf form Kelola Produk. Sengaja menyimpan SELURUH isi form,
 *  termasuk menuDiedit & resepIdTersimpan, supaya draf yang dipulihkan
 *  tetap tahu bahwa ia sedang MENGUBAH menu tertentu (bukan membuat
 *  menu kembar baru) dan tetap tahu baris resep mana yang perlu
 *  dihapus di Firestore bila Owner sempat membuangnya sebelum logout. */
interface IsiDrafMenu {
  menuDiedit: string;
  namaMenu: string;
  kategoriMenu: string;
  hargaJual: number;
  resepRows: BarisResep[];
  kemasanRows: BarisResep[];
  resepIdTersimpan: string[];
  pakaiOverrideSusut: boolean;
  overrideSusut: number;
}

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
  const outletId = useOutletId();
  const { showToast } = useToast();

  // --- Input dasar menu ---
  const [namaMenu, setNamaMenu] = useState("");
  const [kategoriMenu, setKategoriMenu] = useState("");

  // --- Resep (bahan + takaran) — HPP Bahan TIDAK LAGI diinput
  // manual, melainkan dihitung otomatis dari baris-baris ini
  // (takaran × harga bahan terkini). Lihat src/shared/lib/resep.ts
  // untuk alasan keamanannya (Kasir nanti hanya baca takaran di
  // sini, tidak pernah harga bahan_baku). ---
  const [daftarBahan, setDaftarBahan] = useState<BahanBaku[]>([]);
  const [resepRows, setResepRows] = useState<BarisResep[]>([]);
  const [bahanDipilih, setBahanDipilih] = useState("");
  const [takaranInput, setTakaranInput] = useState(0);

  // --- Packaging Cost (cup, sedotan, sumpit, dll.) — SAMA PERSIS
  // arsitekturnya dengan Resep di atas: dipilih dari Bahan Baku
  // (satuannya pcs, dibeli per pack/ball lalu otomatis dibagi jadi
  // harga per pcs di Belanja & Nota), ditakar per porsi, dan ikut
  // tersimpan ke subkoleksi menu/{menuId}/resep supaya stoknya JUGA
  // otomatis berkurang saat menu ini terjual — bukan cuma angka Rupiah
  // statis seperti dulu. Baris-baris ini berbeda dari Resep (Bahan
  // Baku) hanya lewat tag `jenis: "kemasan"`, dipisah supaya menu yang
  // hanya pakai gelas tanpa sedotan (atau sebaliknya) bisa diatur bebas
  // per menu — cukup jangan tambahkan barisnya. ---
  const [kemasanRows, setKemasanRows] = useState<BarisResep[]>([]);
  const [kemasanDipilih, setKemasanDipilih] = useState("");
  const [takaranKemasanInput, setTakaranKemasanInput] = useState(1);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "bahan_baku"), where("aktif", "==", true)),
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
  }, [outletId]);

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

  // --- Tampilan: daftar produk (default) vs form Kalkulator HPP ---
  // Atas permintaan pemilik cafe: halaman ini dibuka dulu sebagai daftar
  // produk per kategori (seperti katalog), form hanya muncul saat "+
  // Tambah Menu Baru" ditekan atau saat memilih produk yang sudah ada
  // untuk diedit.
  const [tampilan, setTampilan] = useState<"daftar" | "form">("daftar");

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "menu_harga"), orderBy("nama")),
      (snap) => {
        setDaftarMenu(
          snap.docs.map((d) => ({
            id: d.id,
            nama: d.data().nama ?? "",
            kategori: d.data().kategori ?? "Umum",
            hargaJual: d.data().hargaJual ?? 0,
            aktif: d.data().aktif ?? true,
          })),
        );
      },
    );
    return unsub;
  }, [outletId]);

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

  // Packaging Cost per porsi — DIHITUNG OTOMATIS sama seperti HPP
  // Bahan, dari harga bahan_baku terkini × takaran per porsi.
  const biayaKemasanOtomatis = useMemo(
    () =>
      kemasanRows.reduce((total, row) => {
        const bahan = daftarBahan.find((b) => b.id === row.bahanId);
        return total + row.takaran * (bahan?.hargaSatuanTerakhir ?? row.hargaSatuanBahan);
      }, 0),
    [kemasanRows, daftarBahan],
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
    if (resepRows.some((r) => r.bahanId === bahan.id) || kemasanRows.some((r) => r.bahanId === bahan.id)) {
      showToast("error", `${bahan.nama} sudah ada di daftar menu ini.`);
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

  /** Tambah satu baris Packaging Cost (cup, sedotan, sumpit, dll.) —
   *  cek ganda terhadap resepRows JUGA, supaya satu bahan tidak
   *  ke-input dobel sebagai bahan baku sekaligus kemasan. */
  function tambahBarisKemasan() {
    const bahan = daftarBahan.find((b) => b.id === kemasanDipilih);
    if (!bahan) {
      showToast("error", "Pilih item packaging terlebih dahulu.");
      return;
    }
    if (takaranKemasanInput <= 0) {
      showToast("error", "Jumlah harus lebih besar dari 0.");
      return;
    }
    if (kemasanRows.some((r) => r.bahanId === bahan.id) || resepRows.some((r) => r.bahanId === bahan.id)) {
      showToast("error", `${bahan.nama} sudah ada di daftar menu ini.`);
      return;
    }
    setKemasanRows((prev) => [
      ...prev,
      {
        bahanId: bahan.id,
        bahanNama: bahan.nama,
        satuan: bahan.satuan,
        takaran: takaranKemasanInput,
        hargaSatuanBahan: bahan.hargaSatuanTerakhir,
      },
    ]);
    setKemasanDipilih("");
    setTakaranKemasanInput(1);
  }

  function hapusBarisKemasan(bahanId: string) {
    setKemasanRows((prev) => prev.filter((r) => r.bahanId !== bahanId));
  }

  // --- Tambah Bahan/Item Baru TANPA menunggu stok ada — atas permintaan
  // pemilik cafe: Owner bisa menyusun resep menu duluan (mis. bahan
  // musiman yang belum dibeli Purchasing), sebelum ada pembelian sama
  // sekali. Dibuat dengan harga & stok 0 — tetap TERSAMBUNG ke
  // inventaris yang sama (bahan_baku + cermin stok_kasir), jadi begitu
  // Purchasing membeli lewat Belanja & Nota (dicocokkan dari NAMA,
  // sama seperti alur normal), harga & stoknya otomatis terisi normal.
  // Selama belum dibeli, bahan ini akan selalu tampil "hampir habis"
  // di Dashboard bila Batas Minimal Stok diisi > 0 — sengaja begitu,
  // supaya jadi pengingat bagi Purchasing untuk segera membelinya. ---
  const [tampilkanTambahBahan, setTampilkanTambahBahan] = useState(false);
  const [namaBahanBaru, setNamaBahanBaru] = useState("");
  const [satuanBahanBaru, setSatuanBahanBaru] = useState<SatuanBahan>("gram");
  const [batasBahanBaru, setBatasBahanBaru] = useState(0);
  const [sedangTambahBahan, setSedangTambahBahan] = useState(false);

  async function tambahBahanBaru() {
    const nama = namaBahanBaru.trim();
    if (!nama) {
      showToast("error", "Nama bahan/item wajib diisi.");
      return;
    }
    if (daftarBahan.some((b) => b.nama.trim().toLowerCase() === nama.toLowerCase())) {
      showToast("error", `"${nama}" sudah ada di Bahan Baku.`);
      return;
    }
    setSedangTambahBahan(true);
    try {
      const ref = doc(collection(db, "outlets", outletId, "bahan_baku"));
      const data = {
        nama,
        kategori: "Umum",
        satuan: satuanBahanBaru,
        hargaSatuanTerakhir: 0,
        stokSaatIni: 0,
        batasMinimalStok: batasBahanBaru,
        aktif: true,
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, data);
      await setMirrorStokKasir(outletId, ref.id, {
        nama,
        kategori: "Umum",
        satuan: satuanBahanBaru,
        stokSaatIni: 0,
        batasMinimalStok: batasBahanBaru,
        aktif: true,
      });
      showToast(
        "success",
        `"${nama}" ditambahkan ke Bahan Baku (stok 0 — belum dibeli Purchasing). Sekarang bisa dipilih di Resep/Packaging Cost.`,
      );
      setNamaBahanBaru("");
      setSatuanBahanBaru("gram");
      setBatasBahanBaru(0);
      setTampilkanTambahBahan(false);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menambah bahan: ${error.message}` : "Gagal menambah bahan.",
      );
    } finally {
      setSedangTambahBahan(false);
    }
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
        biayaKemasan: biayaKemasanOtomatis,
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
    biayaKemasanOtomatis,
    pakaiOverrideSusut,
    overrideSusut,
    defaults,
    hargaJual,
    persenMarginDiinginkan,
    persenMarkupDiinginkan,
  ]);

  // ------------------------------------------------------------
  // SECTION: Auto Draft
  //
  // Form ini yang paling panjang di seluruh aplikasi (nama, kategori,
  // sederet baris resep, sederet baris packaging, harga jual) dan
  // paling menyakitkan kalau hilang gara-gara auto logout 60 menit
  // atau tab tidak sengaja tertutup. Isinya terus dicerminkan ke
  // localStorage; saat dibuka lagi, draf ditawarkan untuk dipulihkan.
  // ------------------------------------------------------------

  const { user } = useAuth();
  const isiForm = useMemo<IsiDrafMenu>(
    () => ({
      menuDiedit,
      namaMenu,
      kategoriMenu,
      hargaJual,
      resepRows,
      kemasanRows,
      resepIdTersimpan,
      pakaiOverrideSusut,
      overrideSusut,
    }),
    [
      menuDiedit,
      namaMenu,
      kategoriMenu,
      hargaJual,
      resepRows,
      kemasanRows,
      resepIdTersimpan,
      pakaiOverrideSusut,
      overrideSusut,
    ],
  );

  // Form dianggap "sedang dikerjakan" hanya bila sudah ada isinya —
  // form kosong tidak boleh menulis draf, karena nanti memunculkan
  // tawaran "pulihkan draf" yang isinya tidak ada apa-apa.
  const adaIsi =
    namaMenu.trim().length > 0 || resepRows.length > 0 || kemasanRows.length > 0;
  useDrafOtomatis(user?.uid, KUNCI_DRAF_MENU, isiForm, tampilan === "form" && adaIsi);

  const [drafTertunda, setDrafTertunda] = useState<DrafTersimpan<IsiDrafMenu> | null>(null);
  useEffect(() => {
    if (!user) return;
    let dibatalkan = false;
    ambilDrafAsync<IsiDrafMenu>(user.uid, KUNCI_DRAF_MENU).then((tersimpan) => {
      if (dibatalkan) return;
      // Tawarkan hanya draf yang benar-benar berisi.
      if (tersimpan?.data && (tersimpan.data.namaMenu || tersimpan.data.resepRows?.length)) {
        setDrafTertunda(tersimpan);
      }
    });
    return () => {
      dibatalkan = true;
    };
  }, [user]);

  function pulihkanDraf() {
    const data = drafTertunda?.data;
    if (!data) return;
    setMenuDiedit(data.menuDiedit ?? MENU_BARU);
    setNamaMenu(data.namaMenu ?? "");
    setKategoriMenu(data.kategoriMenu ?? "");
    setHargaJual(data.hargaJual ?? 0);
    setResepRows(data.resepRows ?? []);
    setKemasanRows(data.kemasanRows ?? []);
    setResepIdTersimpan(data.resepIdTersimpan ?? []);
    setPakaiOverrideSusut(data.pakaiOverrideSusut ?? false);
    setOverrideSusut(data.overrideSusut ?? PROFIL_AWAL.persenSusut);
    setDrafTertunda(null);
    setTampilan("form");
  }

  function buangDraf() {
    if (user) hapusDraf(user.uid, KUNCI_DRAF_MENU);
    setDrafTertunda(null);
  }

  // ------------------------------------------------------------
  // SECTION: Handler
  // ------------------------------------------------------------

  function kosongkanForm() {
    setNamaMenu("");
    setKategoriMenu("");
    setResepRows([]);
    setKemasanRows([]);
    setResepIdTersimpan([]);
    setHargaJual(0);
    setPakaiOverrideSusut(false);
    setOverrideSusut(PROFIL_AWAL.persenSusut);
    // Draf ikut dibuang begitu form dikosongkan (mis. setelah berhasil
    // disimpan) — kalau tidak, tawaran "pulihkan draf" akan terus
    // muncul untuk pekerjaan yang sudah selesai.
    if (user) hapusDraf(user.uid, KUNCI_DRAF_MENU);
  }

  /** Muat menu tersimpan ke dalam form untuk diedit (resep, Packaging
   *  Cost, harga jual, dan override susutnya). */
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
        getDoc(doc(db, "outlets", outletId, "menu_harga", menuId)),
        getDoc(doc(db, "outlets", outletId, "menu", menuId)),
        getDocs(collection(db, "outlets", outletId, "menu", menuId, "resep")),
      ]);

      setNamaMenu(hargaSnap.data()?.nama ?? ringkas?.nama ?? "");
      setKategoriMenu(hargaSnap.data()?.kategori ?? ringkas?.kategori ?? "");
      setHargaJual(hargaSnap.data()?.hargaJual ?? 0);

      const rahasia = rahasiaSnap.data();
      const overrideTersimpan = rahasia?.overridePersenSusut ?? null;
      setPakaiOverrideSusut(overrideTersimpan !== null);
      setOverrideSusut(
        overrideTersimpan !== null ? overrideTersimpan * 100 : PROFIL_AWAL.persenSusut,
      );

      // Satu subkoleksi (menu/{menuId}/resep) dipisah jadi dua daftar di
      // form berdasarkan field `jenis` per baris — data lama yang belum
      // punya field ini otomatis dianggap "bahan" (lihat resep.ts).
      const bahanRows: BarisResep[] = [];
      const kemasanRowsBaru: BarisResep[] = [];
      for (const d of resepSnap.docs) {
        const data = d.data();
        const bahanId: string = data.bahanId ?? d.id;
        const bahan = daftarBahan.find((b) => b.id === bahanId);
        const baris: BarisResep = {
          bahanId,
          bahanNama: bahan?.nama ?? data.bahanNama ?? "",
          satuan: (data.satuan === "pcs" ? "pcs" : "gram") as SatuanBahan,
          takaran: data.takaran ?? 0,
          hargaSatuanBahan: bahan?.hargaSatuanTerakhir ?? 0,
        };
        if (data.jenis === "kemasan") kemasanRowsBaru.push(baris);
        else bahanRows.push(baris);
      }
      setResepRows(bahanRows);
      setKemasanRows(kemasanRowsBaru);
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
      const menuId = menuDiedit !== MENU_BARU ? menuDiedit : doc(collection(db, "outlets", outletId, "menu_harga")).id;
      const hargaJualUntukDisimpan =
        hargaJual > 0
          ? hargaJual
          : (hasil.rekomendasi.hargaJualIdealMargin ?? 0);

      await setDoc(doc(db, "outlets", outletId, "menu_harga", menuId), {
        nama: namaMenu.trim(),
        kategori: kategoriMenu.trim() || "Umum",
        punyaVarian: false,
        hargaJual: hargaJualUntukDisimpan,
        aktif: true,
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, "outlets", outletId, "menu", menuId), {
        hppCache: hasil.breakdown.hppTotal,
        foodCostPersen: hasil.evaluasi?.foodCostPersen ?? null,
        // Kedua field harga di bawah ini murni CACHE untuk ditampilkan
        // lagi saat menu ini dibuka untuk diedit — angka yang benar-benar
        // dipakai untuk Laba Bersih otomatis SELALU dihitung ulang dari
        // subkoleksi resep + harga bahan_baku terkini (lihat laba-harian.ts),
        // bukan dari sini, supaya kenaikan harga bahan/kemasan langsung
        // tercermin tanpa Owner perlu membuka Kalkulator HPP lagi.
        hppBahanOtomatis: hppBahan,
        biayaKemasanOtomatis,
        overridePersenSusut: pakaiOverrideSusut ? persenKeFraksi(overrideSusut) : null,
        overridePersenUtilitas: null,
        overridePersenTenagaKerja: null,
        overridePersenOverheadLain: null,
        updatedAt: serverTimestamp(),
      });

      // Resep (Bahan Baku) dan Packaging Cost ditulis ke subkoleksi YANG
      // SAMA (menu/{menuId}/resep) — hanya dibedakan lewat field `jenis`.
      // Ini supaya pengurangan stok gudang otomatis (resep.ts) berlaku
      // SAMA PERSIS untuk keduanya tanpa kode terpisah: begitu menu ini
      // terjual, cup/sedotan/sumpit ikut berkurang dari inventaris persis
      // seperti bahan baku.
      await Promise.all([
        ...resepRows.map((row) =>
          setDoc(doc(db, "outlets", outletId, "menu", menuId, "resep", row.bahanId), {
            bahanId: row.bahanId,
            bahanNama: row.bahanNama,
            takaran: row.takaran,
            satuan: row.satuan,
            jenis: "bahan",
          }),
        ),
        ...kemasanRows.map((row) =>
          setDoc(doc(db, "outlets", outletId, "menu", menuId, "resep", row.bahanId), {
            bahanId: row.bahanId,
            bahanNama: row.bahanNama,
            takaran: row.takaran,
            satuan: row.satuan,
            jenis: "kemasan",
          }),
        ),
      ]);

      // Bahan/kemasan yang dibuang Owner HARUS ikut dihapus di
      // Firestore. Kalau hanya hilang dari layar, dokumennya tetap ada
      // dan Kasir akan terus mengurangi stok item itu setiap menu ini
      // terjual — stok menyusut tanpa sebab yang terlihat.
      const idDipakai = new Set([
        ...resepRows.map((row) => row.bahanId),
        ...kemasanRows.map((row) => row.bahanId),
      ]);
      const idDihapus = resepIdTersimpan.filter((id) => !idDipakai.has(id));
      await Promise.all(
        idDihapus.map((id) => deleteDoc(doc(db, "outlets", outletId, "menu", menuId, "resep", id))),
      );

      showToast(
        "success",
        menuDiedit !== MENU_BARU
          ? `"${namaMenu}" diperbarui: HPP ${formatRupiah(hasil.breakdown.hppTotal)} per porsi.`
          : `HPP untuk "${namaMenu}" tersimpan: ${formatRupiah(hasil.breakdown.hppTotal)} per porsi.`,
      );
      setMenuDiedit(MENU_BARU);
      kosongkanForm();
      setTampilan("daftar");
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

  // Tampilan daftar produk (default) — atas permintaan pemilik cafe,
  // halaman ini dibuka sebagai katalog produk per kategori dulu, BUKAN
  // langsung form. Form (di bawah) hanya muncul lewat tombol "+ Tambah
  // Menu Baru" atau saat menekan salah satu produk untuk diedit.
  if (tampilan === "daftar") {
    return (
      <DaftarProdukIsi
        daftarMenu={daftarMenu}
        draf={drafTertunda}
        onPulihkanDraf={pulihkanDraf}
        onBuangDraf={buangDraf}
        onTambahBaru={() => {
          setMenuDiedit(MENU_BARU);
          kosongkanForm();
          setTampilan("form");
        }}
        onEditMenu={(id) => {
          pilihMenu(id);
          setTampilan("form");
        }}
      />
    );
  }

  return (
    <main className="animasi-masuk mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <button
          type="button"
          onClick={() => setTampilan("daftar")}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
        >
          ← Kembali ke Daftar Produk
        </button>
        <KickerOutlet akhiran="Kelola Produk" />
        <h1 className="text-2xl font-bold text-slate-900">
          {menuDiedit !== MENU_BARU ? "Ubah Menu" : "Tambah Menu Baru"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Isi Resep dan Packaging Cost — HPP, harga jual, dan pengurangan
          stok gudang dihitung otomatis.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {/* Kolom kiri: input form (Data Menu, Resep, Packaging, Profil
            Cafe). Kolom kanan: hasil hitung LIVE (Rincian HPP,
            Rekomendasi Harga, Evaluasi) — mengikuti sambil scroll di
            layar lebar (xl:sticky) supaya kelihatan terus sambil isi
            form di kiri, daripada harus scroll bolak-balik. */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[3fr_2fr] xl:items-start">
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
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="bagian-resep" className="text-base font-semibold text-slate-900">
                Resep (Bahan + Takaran)
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                HPP Bahan per porsi DIHITUNG OTOMATIS dari sini — takaran ×
                harga bahan terkini. Resep ini juga yang dipakai untuk
                mengurangi stok gudang otomatis saat Kasir mencatat penjualan.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTampilkanTambahBahan((v) => !v)}
              className="shrink-0 whitespace-nowrap text-xs font-semibold text-emerald-700 hover:text-emerald-800"
            >
              {tampilkanTambahBahan ? "Batal" : "+ Bahan/Item Baru"}
            </button>
          </div>

          {tampilkanTambahBahan ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs text-emerald-900">
                Belum dibeli Purchasing? Tidak masalah — buat dulu di sini
                dengan stok 0, susun resepnya sekarang, dan begitu
                Purchasing membelinya lewat Belanja &amp; Nota (nama harus
                sama persis), harga &amp; stoknya otomatis terisi.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <div>
                  <label htmlFor="nama-bahan-baru" className="block text-xs font-semibold text-slate-700">
                    Nama
                  </label>
                  <input
                    id="nama-bahan-baru"
                    type="text"
                    value={namaBahanBaru}
                    onChange={(event) => setNamaBahanBaru(event.target.value)}
                    placeholder="misalnya: Daun Mint"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
                <div>
                  <label htmlFor="satuan-bahan-baru" className="block text-xs font-semibold text-slate-700">
                    Satuan
                  </label>
                  <select
                    id="satuan-bahan-baru"
                    value={satuanBahanBaru}
                    onChange={(event) => setSatuanBahanBaru(event.target.value as SatuanBahan)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="gram">gram</option>
                    <option value="pcs">pcs</option>
                  </select>
                </div>
                <NumberField
                  id="batas-bahan-baru"
                  label="Batas Warning"
                  value={batasBahanBaru}
                  onChange={setBatasBahanBaru}
                  hint="Opsional"
                />
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={tambahBahanBaru}
                    disabled={sedangTambahBahan}
                    aria-busy={sedangTambahBahan}
                    className="inline-flex h-[38px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-emerald-400 sm:w-auto"
                  >
                    {sedangTambahBahan ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      "Tambah"
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

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
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 motion-safe:transition active:scale-90 hover:bg-rose-50 hover:text-rose-600"
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

        {/* --- Kartu: Packaging Cost --- */}
        <section
          aria-labelledby="bagian-kemasan"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 id="bagian-kemasan" className="text-base font-semibold text-slate-900">
            Packaging Cost
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Cup, sedotan, sumpit sekali pakai, tutup, kresek, dan sejenisnya
            — DIHITUNG OTOMATIS sama seperti Resep di atas (takaran × harga
            terkini), dan stoknya JUGA ikut berkurang otomatis dari
            inventaris saat menu ini terjual. Tambahkan hanya item yang
            benar-benar dipakai menu ini — misalnya menu yang cuma pakai
            gelas tanpa sedotan cukup tambahkan gelasnya saja.
          </p>

          {kemasanRows.length > 0 ? (
            <ul className="mt-4 divide-y divide-slate-100 rounded-lg bg-slate-50 p-3">
              {kemasanRows.map((row) => (
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
                      onClick={() => hapusBarisKemasan(row.bahanId)}
                      aria-label={`Hapus ${row.bahanNama} dari Packaging Cost`}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 motion-safe:transition active:scale-90 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              Belum ada item packaging untuk menu ini.
            </p>
          )}

          {daftarBahan.length === 0 ? (
            <p className="mt-4 text-sm text-amber-700">
              Belum ada Bahan Baku. Tambahkan dulu lewat Belanja & Nota
              (Purchasing) — termasuk item packaging seperti cup/sedotan,
              dicatat dengan satuan pcs (harga per pack ÷ isi per pack).
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto]">
              <div>
                <label htmlFor="kemasan-item" className="block text-sm font-semibold text-slate-800">
                  Item Packaging
                </label>
                <select
                  id="kemasan-item"
                  value={kemasanDipilih}
                  onChange={(event) => setKemasanDipilih(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="">Pilih item...</option>
                  {daftarBahan
                    .filter(
                      (b) =>
                        !kemasanRows.some((r) => r.bahanId === b.id) &&
                        !resepRows.some((r) => r.bahanId === b.id),
                    )
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nama} ({formatRupiahSatuan(b.hargaSatuanTerakhir)}/{b.satuan})
                      </option>
                    ))}
                </select>
              </div>
              <NumberField
                id="takaran-kemasan"
                label="Jumlah (pcs)"
                value={takaranKemasanInput}
                onChange={setTakaranKemasanInput}
              />
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={tambahBarisKemasan}
                  className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-emerald-700 active:scale-[0.98] sm:w-auto"
                >
                  + Tambah
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-between rounded-lg bg-emerald-50 px-3 py-2.5 text-sm">
            <span className="font-medium text-emerald-900">Packaging Cost per Porsi (otomatis)</span>
            <span className="font-bold tabular-nums text-emerald-900">
              {formatRupiah(biayaKemasanOtomatis)}
            </span>
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
        </div>

        <div className="flex flex-col gap-6 xl:sticky xl:top-6">
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
              label="Packaging Cost"
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
        </div>
        </div>

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

/**
 * Tampilan Awal Kelola Produk: katalog produk dikelompokkan per
 * kategori (atas permintaan pemilik cafe, mengganti tampilan lama yang
 * langsung membuka form Kalkulator HPP). Menekan sebuah produk membuka
 * form untuk mengedit resep/harganya; tombol "+ Tambah Menu Baru" di
 * kanan atas membuka form kosong.
 */
function DaftarProdukIsi({
  daftarMenu,
  draf,
  onPulihkanDraf,
  onBuangDraf,
  onTambahBaru,
  onEditMenu,
}: {
  daftarMenu: MenuTersimpan[];
  draf: DrafTersimpan<IsiDrafMenu> | null;
  onPulihkanDraf: () => void;
  onBuangDraf: () => void;
  onTambahBaru: () => void;
  onEditMenu: (id: string) => void;
}) {
  const perKategori = useMemo(() => {
    const map = new Map<string, MenuTersimpan[]>();
    for (const m of daftarMenu) {
      const list = map.get(m.kategori) ?? [];
      list.push(m);
      map.set(m.kategori, list);
    }
    return map;
  }, [daftarMenu]);

  return (
    <main className="animasi-masuk mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <KickerOutlet />
          <h1 className="text-2xl font-bold text-slate-900">Kelola Produk</h1>
          <p className="mt-1 text-sm text-slate-600">
            Semua menu, dikelompokkan per kategori. Tekan salah satu untuk
            mengubah resep/harganya.
          </p>
        </div>
        <button
          type="button"
          onClick={onTambahBaru}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-emerald-700 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Tambah Menu Baru
        </button>
      </header>

      {draf ? (
        <div
          role="status"
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-semibold">Ada pekerjaan yang belum sempat disimpan</p>
          <p className="mt-1 text-xs text-amber-800">
            Draf &quot;{draf.data.namaMenu || "Menu tanpa nama"}&quot; tersimpan
            otomatis {usiaDraf(draf.disimpanPada)} (
            {draf.data.resepRows?.length ?? 0} bahan,{" "}
            {draf.data.kemasanRows?.length ?? 0} item packaging).
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onPulihkanDraf}
              className="inline-flex items-center rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm motion-safe:transition hover:bg-amber-700"
            >
              Lanjutkan Draf
            </button>
            <button
              type="button"
              onClick={onBuangDraf}
              className="inline-flex items-center rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm motion-safe:transition hover:bg-amber-100"
            >
              Buang Draf
            </button>
          </div>
        </div>
      ) : null}

      {daftarMenu.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          Belum ada produk. Tekan &quot;Tambah Menu Baru&quot; untuk membuat
          menu pertama.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
          {[...perKategori.entries()].map(([kategori, items]) => (
            <section key={kategori}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {kategori}
              </h2>
              <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
                {items.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => onEditMenu(m.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left motion-safe:transition motion-safe:duration-150 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-700"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        {m.nama}
                        {!m.aktif ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                            Nonaktif
                          </span>
                        ) : null}
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-emerald-700">
                        {formatRupiah(m.hargaJual)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
