"use client";

// ============================================================
// Halaman: Shift — input penjualan, kas keluar, tutup shift
// (PRD bagian 9.2, disesuaikan atas permintaan pemilik cafe).
// Peran UI: Kasir SAJA — Owner tidak boleh input operasional
// harian ini (pemisahan tugas), Owner memantau lewat
// Dashboard/Riwayat. firestore.rules tetap memberi Owner
// (superadmin) akses baca/tulis penuh di backend sebagai admin
// override (audit, koreksi data), tapi halaman ini sengaja tidak
// ditampilkan/diizinkan untuk peran superadmin.
//
// PERUBAHAN PENTING: TIDAK ADA lagi langkah "Buka Shift" manual.
// Modal Kas Awal kini FLAT Rp500.000 setiap hari (MODAL_KAS_AWAL_HARIAN
// di bawah) — begitu Kasir membuka halaman ini dan belum ada shift
// untuk tanggal hari ini, shift langsung dibuat otomatis di belakang
// layar dengan modal itu, TANPA menampilkan form/tombol apa pun ke
// Kasir. Kasir hanya melihat Input Penjualan, Kas Keluar, dan (di
// akhir hari) Tutup Shift. Modal ini "reset" tiap hari secara alami
// karena setiap hari adalah dokumen shift baru dengan modal flat yang
// sama, TIDAK diwariskan dari sisa kas hari sebelumnya.
//
// Kas Keluar (nota air galon/kresek/plastik dkk.) tetap tercatat di
// sub-koleksi shift/{id}/kas_keluar seperti sebelumnya, dan tetap
// mengurangi "Kas Seharusnya" lewat formula yang sama:
//   Kas Seharusnya = Modal Kas Awal (flat) + Omset Tunai − Total Kas Keluar
// Karena modal sekarang konstan (tidak pernah diubah manual), secara
// efektif kas keluar itu SELALU mengurangi bagian omset tunai hari
// itu, bukan modal — persis seperti yang diminta.
//
// CATATAN ARSITEKTUR PENTING (batasan Spark Plan, tanpa Cloud
// Functions): HPP bersifat privat, hanya bisa dibaca Owner
// (koleksi `menu`, lihat firestore.rules). Kasir TIDAK bisa
// membaca HPP, sehingga Kasir juga tidak bisa menuliskan
// `hppSnapshot` yang akurat saat mencatat penjualan — menulis
// nilai yang tidak bisa diverifikasi client sama saja bohong.
// Karena itu, Sprint 1 ini Kasir HANYA mencatat angka uang yang
// memang dia tahu (qty, harga jual dari menu_harga yang publik,
// kas masuk/keluar). Perhitungan HPP terjual & laba (labaKotor,
// labaBersih) SENGAJA belum diisi di sini — akan direkonsiliasi
// dari sisi Owner (Dashboard/Riwayat, P1 lanjutan) yang memang
// satu-satunya peran dengan akses ke uang DAN HPP sekaligus.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  Banknote,
  ChevronDown,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  Gift,
  Loader2,
  Minus,
  Package,
  Plus,
  RotateCcw,
  Save,
  TriangleAlert,
  X,
} from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { NumberField } from "@/shared/components/number-field";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutletId } from "@/shared/lib/outlet-context";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { ambilResepMenu, terapkanPerubahanStok } from "@/shared/lib/resep";
import { ambilDrafAsync, hapusDraf, useDrafOtomatis } from "@/shared/lib/draf";
import { useDetailPerusahaan } from "@/shared/lib/perusahaan";
import { eksporExcel, eksporPdf, type OpsiLaporan } from "@/shared/lib/ekspor";
import { formatTanggalPanjangId } from "@/shared/lib/periode-laporan";
import type { ResepItem, StokKasir } from "@/shared/types/inventaris";

/** Isi draf otomatis untuk form Tutup Shift (lihat TutupShiftKartu).
 *  Omset Non-Tunai TIDAK ADA lagi di sini — sekarang dihitung otomatis
 *  dari input penjualan per item, tidak perlu didraf manual lagi. */
interface IsiDrafTutupShift {
  kasFisik: number;
  keteranganSelisih: string;
}

interface MenuHarga {
  id: string;
  nama: string;
  kategori: string;
  hargaJual: number;
  aktif: boolean;
}

interface PenjualanItem {
  id: string;
  menuId: string;
  menuNama: string;
  kategori: string;
  /** Qty REGULER dibayar TUNAI. qty (total reguler, dipakai HPP/Bonus/
   *  Refund) = qtyTunai + qtyNonTunai — dipisah atas permintaan pemilik
   *  cafe supaya Rekap Metode Bayar di Dashboard akurat per transaksi,
   *  bukan tebakan manual di akhir shift seperti sebelumnya. */
  qtyTunai: number;
  /** Qty REGULER dibayar NON-TUNAI (QRIS/kartu/transfer). */
  qtyNonTunai: number;
  /** Total qty REGULER (bayar penuh) = qtyTunai + qtyNonTunai —
   *  satu-satunya yang menyumbang Omset. Dipertahankan sebagai field
   *  turunan (bukan dihitung ulang di klien tiap saat) supaya kode
   *  Bonus/Refund/HPP yang sudah ada TIDAK PERLU tahu soal pemisahan
   *  metode bayar sama sekali. */
  qty: number;
  /** Subtotal dari qtyTunai saja. subtotal (total) = subtotalTunai +
   *  subtotalNonTunai. */
  subtotalTunai: number;
  /** Subtotal dari qtyNonTunai saja. */
  subtotalNonTunai: number;
  /** Bonus/Gratis (promo bonus pembelian dsb.) — bahan baku tetap
   *  berkurang seperti biasa, tapi TIDAK menyumbang Omset sama sekali
   *  (subtotal-nya selalu 0), supaya Kasir tidak bingung melihat angka
   *  minus di Total Omset akibat "menggratiskan" produk. Tidak terikat
   *  metode bayar (memang tidak ada uang yang dibayar). */
  qtyBonus: number;
  /** Refund (uang sudah dikembalikan ke pembeli) — mengurangi Omset
   *  (dipindah dari salah satu bucket qtyTunai/qtyNonTunai — lihat
   *  ubahQtyRefund), TAPI bahan baku TIDAK dikembalikan ke stok karena
   *  produknya sudah terlanjur dibuat/dipakai. */
  qtyRefund: number;
  /** Dari berapa unit qtyRefund yang sumbernya bucket Non-Tunai (sisanya
   *  dari Tunai) — dipakai supaya "batalkan refund" tahu persis bucket
   *  mana yang harus dikembalikan. Lihat komentar ubahQtyRefund. */
  qtyRefundNonTunai: number;
  hargaJualSnapshot: number;
  subtotal: number;
  /** true khusus untuk "Item Lain" (lihat ItemLainKartu) — penjualan
   *  ad-hoc yang TIDAK terdaftar di Kelola Produk (menu_harga),
   *  langsung dipotong dari stok bahan baku yang dipilih manual saat
   *  itu juga. undefined/false untuk penjualan reguler dari daftar
   *  menu — field ini SENGAJA tidak memengaruhi kalkulasi Omset/HPP
   *  apa pun (qty/subtotal/qtyTunai dst tetap dihitung sama seperti
   *  penjualan biasa), hanya penanda asal-usul baris untuk tampilan. */
  manual?: boolean;
  /** Bahan baku yang dipotong untuk SATU unit "Item Lain" ini — dicatat
   *  di dokumen penjualannya sendiri (bukan resep menu) supaya riwayat
   *  tetap jelas bahan apa saja yang terpakai untuk item ad-hoc ini. */
  bahanDipakai?: { bahanId: string; bahanNama: string; takaran: number; satuan: string }[];
}

interface KasKeluarItem {
  id: string;
  kategori: string;
  nominal: number;
  keterangan: string;
}

interface ShiftAktif {
  id: string;
  modalKasAwal: number;
  status: "buka" | "tutup" | "terkunci";
  // Slot Shift (opsional — permintaan pemilik cafe: "Finance juga yang
  // atur pembagian shift"). undefined kalau shift dibuat sebelum fitur
  // ini ada, atau kalau saat itu tidak ada/cuma satu slot aktif
  // (auto-pilih diam-diam, lihat efek resolusi slot di bawah) — hanya
  // untuk tampilan (mis. "Shift 1 (08.00-17.00)" di header), TIDAK
  // memengaruhi modalKasAwal (tetap flat) atau kalkulasi apa pun.
  slotNama?: string;
  slotJamMulai?: string;
  slotJamSelesai?: string;
}

/** Slot Shift — dikelola Finance/Owner lewat /kelola-jadwal-shift.
 *  Kasir hanya membaca daftar yang aktif untuk memilih sendiri saat
 *  shift belum ada untuk hari ini (self-service, bukan penugasan
 *  manual per tanggal — lihat komentar di /kelola-jadwal-shift). */
interface SlotShift {
  id: string;
  nama: string;
  jamMulai: string;
  jamSelesai: string;
}

interface SerahTerimaKas {
  id: string;
  dariNama: string;
  nominal: number;
  keterangan: string;
  waktuMs: number;
}

// "Wifi"/"Listrik"/"PDAM (Air)" SENGAJA eksplisit (bukan cuma "Utilitas"
// generik) — Biaya Operasional yang diinput Kasir di sini (permintaan
// pemilik cafe), potong dari kas shift berjalan seperti Kas Keluar
// lainnya. Beda dengan Biaya Operasional yang diinput Finance lewat
// /transaksi-finance, yang potong Saldo Deposito Finance, bukan kas
// shift — dua jalur terpisah tapi kategori yang sama, tergantung siapa
// yang input (lihat README).
const KATEGORI_KAS_KELUAR = [
  "Wifi",
  "Listrik",
  "PDAM (Air)",
  "Perlengkapan",
  "Kebersihan",
  "Bahan Baku Darurat",
  "Lainnya",
] as const;

function tanggalHariIni(): string {
  const sekarang = new Date();
  return `${sekarang.getFullYear()}-${String(sekarang.getMonth() + 1).padStart(2, "0")}-${String(
    sekarang.getDate(),
  ).padStart(2, "0")}`;
}

/** Modal Kas Awal FLAT — sama setiap hari, tidak lagi diinput manual
 *  oleh Kasir dan TIDAK mewarisi sisa kas hari sebelumnya (reset
 *  harian). Lihat komentar kepala file untuk alasannya. */
const MODAL_KAS_AWAL_HARIAN = 500_000;

export default function ShiftPage() {
  return (
    <RequireAuth peranDiizinkan={["kasir"]}>
      <AppShell>
        <ShiftIsi />
      </AppShell>
    </RequireAuth>
  );
}

function ShiftIsi() {
  const { user, profil } = useAuth();
  const outletId = useOutletId();
  const { showToast } = useToast();

  const [memuatShiftAktif, setMemuatShiftAktif] = useState(true);
  const [shiftAktif, setShiftAktif] = useState<ShiftAktif | null>(null);
  const [gagalMenyiapkan, setGagalMenyiapkan] = useState(false);
  // Mencegah shift baru dibuat dua kali (mis. React re-render atau
  // listener sempat menembak ulang) selagi penulisan pertama masih
  // berjalan — lihat efek auto-provisioning di bawah.
  const sedangMenyiapkanRef = useRef(false);

  // --- Slot Shift (permintaan pemilik cafe: "Finance juga yang atur
  // pembagian shift") ---
  // Kalau slot aktif 0 atau 1, TIDAK ADA perubahan perilaku sama sekali
  // — auto-pilih diam-diam, persis seperti sebelum fitur ini ada. Kalau
  // slot aktif >= 2, Kasir WAJIB menyentuh satu slot dulu sebelum shift
  // dibuat (lihat layar "pilih slot" di bawah) — supaya jelas Kasir ini
  // masuk sebagai "Shift 1" atau "Shift 2" saat masa transisi (jam-jam
  // yang beririsan, laci kas fisik dipakai bersama).
  const [memuatSlot, setMemuatSlot] = useState(true);
  const [daftarSlotAktif, setDaftarSlotAktif] = useState<SlotShift[]>([]);
  const [slotDipilihManual, setSlotDipilihManual] = useState<SlotShift | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "slot_shift"), where("aktif", "==", true)),
      (snap) => {
        setDaftarSlotAktif(
          snap.docs.map((d) => ({
            id: d.id,
            nama: d.data().nama ?? "",
            jamMulai: d.data().jamMulai ?? "",
            jamSelesai: d.data().jamSelesai ?? "",
          })),
        );
        setMemuatSlot(false);
      },
      () => setMemuatSlot(false),
    );
    return unsub;
  }, [outletId]);

  // Slot efektif yang dipakai untuk membuat shift: kalau cuma ada 0/1
  // slot aktif, dipilih otomatis (tidak perlu Kasir menyentuh apa pun).
  // Kalau >= 2, harus menunggu slotDipilihManual (hasil tap Kasir).
  const perluPilihSlot = daftarSlotAktif.length >= 2 && !slotDipilihManual;
  const slotEfektif: SlotShift | null =
    daftarSlotAktif.length >= 2 ? slotDipilihManual : (daftarSlotAktif[0] ?? null);

  // --- Cari shift milik kasir ini untuk HARI INI, apa pun statusnya ---
  //
  // PENTING: dulu query ini menyaring `status == "buka"`, dan itu bug
  // serius. Begitu Kasir menekan "Tutup & Kunci Shift", status berubah
  // sehingga hasil query jadi kosong — layar tersangkut di spinner
  // selamanya, dan kalau halaman dimuat ulang, efek auto-provisioning di
  // bawah menganggap "belum ada shift hari ini" lalu MEMBUAT SHIFT BARU
  // untuk tanggal yang sama: modal Rp500.000 kedua di hari yang sama,
  // dan summary_harian.jumlahShift ikut terhitung dobel.
  //
  // Karena itu statusnya tidak lagi disaring di query: shift hari ini
  // ditemukan apa pun kondisinya, dan yang menentukan tampilan adalah
  // statusnya (masih buka -> layar input; sudah ditutup -> layar
  // "sudah ditutup", BUKAN membuat shift baru).
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "outlets", outletId, "shift"),
      where("kasirUid", "==", user.uid),
      where("tanggal", "==", tanggalHariIni()),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setShiftAktif(null);
        } else {
          // Kalau (karena data lama) ada lebih dari satu shift hari ini,
          // utamakan yang masih buka supaya Kasir tetap bisa bekerja.
          const dokBuka = snap.docs.find((d) => (d.data().status ?? "buka") === "buka");
          const d = dokBuka ?? snap.docs[0];
          setShiftAktif({
            id: d.id,
            modalKasAwal: d.data().modalKasAwal ?? 0,
            status: (d.data().status ?? "buka") as ShiftAktif["status"],
            slotNama: d.data().slotNama || undefined,
            slotJamMulai: d.data().slotJamMulai || undefined,
            slotJamSelesai: d.data().slotJamSelesai || undefined,
          });
        }
        setMemuatShiftAktif(false);
      },
      () => setMemuatShiftAktif(false),
    );
    return unsub;
  }, [user, outletId]);

  // --- Auto-provisioning: TIDAK ADA lagi tombol "Buka Shift". Begitu
  // dipastikan belum ada shift hari ini (dan slot sudah bisa
  // ditentukan — lihat perluPilihSlot di atas), langsung buat sendiri
  // dengan modal flat. ---
  useEffect(() => {
    if (memuatShiftAktif || shiftAktif || !user || !profil) return;
    if (memuatSlot || perluPilihSlot) return;
    if (sedangMenyiapkanRef.current) return;
    sedangMenyiapkanRef.current = true;

    addDoc(collection(db, "outlets", outletId, "shift"), {
      tanggal: tanggalHariIni(),
      kasirUid: user.uid,
      kasirNama: profil.nama,
      modalKasAwal: MODAL_KAS_AWAL_HARIAN,
      totalOmset: 0,
      omsetTunai: 0,
      omsetNonTunai: 0,
      totalKasKeluar: 0,
      status: "buka",
      waktuBuka: serverTimestamp(),
      ...(slotEfektif
        ? {
            slotNama: slotEfektif.nama,
            slotJamMulai: slotEfektif.jamMulai,
            slotJamSelesai: slotEfektif.jamSelesai,
          }
        : {}),
    }).catch((error) => {
      sedangMenyiapkanRef.current = false;
      setGagalMenyiapkan(true);
      showToast(
        "error",
        error instanceof Error
          ? `Gagal menyiapkan shift hari ini: ${error.message}`
          : "Gagal menyiapkan shift hari ini.",
      );
    });
  }, [
    memuatShiftAktif,
    shiftAktif,
    user,
    profil,
    outletId,
    memuatSlot,
    perluPilihSlot,
    slotEfektif,
    showToast,
  ]);

  // Layar "pilih slot" — HANYA muncul kalau ada >= 2 slot aktif dan
  // Kasir belum menyentuh salah satunya. Kalau 0/1 slot aktif, layar
  // ini tidak pernah muncul (langsung ke spinner lalu shift berjalan,
  // persis seperti sebelum fitur ini ada).
  if (!memuatShiftAktif && !shiftAktif && !memuatSlot && perluPilihSlot) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-base font-semibold text-slate-900">
            Pilih Slot Shift Kamu Hari Ini
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Ada lebih dari satu slot shift aktif. Pilih salah satu supaya
            tercatat jelas kamu masuk shift yang mana.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {daftarSlotAktif.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() => setSlotDipilihManual(slot)}
                className="flex items-center justify-between rounded-lg border border-slate-300 px-4 py-3 text-left text-sm motion-safe:transition hover:border-emerald-600 hover:bg-emerald-50 active:scale-[0.98]"
              >
                <span className="font-medium text-slate-900">{slot.nama}</span>
                <span className="text-xs text-slate-500">
                  {slot.jamMulai} – {slot.jamSelesai}
                </span>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (memuatShiftAktif || memuatSlot || (!shiftAktif && !gagalMenyiapkan)) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        <span className="sr-only">Menyiapkan shift hari ini...</span>
      </main>
    );
  }

  if (!shiftAktif) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16 text-center">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
          <p className="text-sm text-amber-900">
            Gagal menyiapkan shift hari ini. Coba muat ulang halaman ini.
          </p>
        </div>
      </main>
    );
  }

  // Shift hari ini sudah ditutup — JANGAN buat shift baru (itu akan jadi
  // modal Rp500.000 kedua di hari yang sama). Kasir cukup diberi tahu,
  // dan bisa mulai lagi besok karena tanggalnya sudah berganti. Slip
  // Cash Opname shift ini ditampilkan di sini juga (lihat
  // SlipCashOpnameKasir) — "Kasir Lapor Sendiri", mandiri per shift.
  if (shiftAktif.status !== "buka") {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-16">
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-6 text-center shadow-sm">
          <p className="text-base font-semibold text-emerald-900">
            Shift hari ini sudah ditutup
          </p>
          <p className="mt-2 text-sm text-emerald-800">
            Terima kasih. Shift baru akan tersedia otomatis besok — SELALU
            mulai lagi dari Saldo Petty Cash Rp500.000, supaya kalau ada
            selisih minus mudah dilacak terjadi di shift yang mana.
          </p>
        </div>
        <SlipCashOpnameKasir shiftId={shiftAktif.id} />
      </main>
    );
  }

  return (
    <ShiftBerjalan
      shiftId={shiftAktif.id}
      modalKasAwal={shiftAktif.modalKasAwal}
      slotNama={shiftAktif.slotNama}
      slotJamMulai={shiftAktif.slotJamMulai}
      slotJamSelesai={shiftAktif.slotJamSelesai}
    />
  );
}

function ShiftBerjalan({
  shiftId,
  modalKasAwal,
  slotNama,
  slotJamMulai,
  slotJamSelesai,
}: {
  shiftId: string;
  modalKasAwal: number;
  slotNama?: string;
  slotJamMulai?: string;
  slotJamSelesai?: string;
}) {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [menuList, setMenuList] = useState<MenuHarga[]>([]);
  const [penjualan, setPenjualan] = useState<PenjualanItem[]>([]);
  const [kasKeluar, setKasKeluar] = useState<KasKeluarItem[]>([]);
  // Cermin stok bahan baku (TANPA harga) — dipakai KHUSUS oleh
  // ItemLainKartu di bawah, supaya Kasir bisa memilih bahan yang dipakai
  // untuk "Item Lain" manual TANPA pernah membaca bahan_baku langsung
  // (lihat komentar keamanan panjang di src/shared/lib/resep.ts).
  const [stokKasir, setStokKasir] = useState<StokKasir[]>([]);
  // Resep (bahan + takaran) per menu, di-cache begitu daftar menu
  // dimuat — dipakai untuk mengurangi/mengembalikan stok gudang
  // otomatis setiap qty penjualan berubah (lihat ubahQty di bawah).
  // Kasir HANYA membaca takaran di sini, TIDAK PERNAH harga bahan
  // (lihat src/shared/lib/resep.ts).
  const [resepPerMenu, setResepPerMenu] = useState<Map<string, ResepItem[]>>(new Map());
  // Tombol +/- baru boleh aktif setelah resep selesai dimuat. Kalau
  // tidak, Kasir yang cepat menekan "+" begitu halaman terbuka akan
  // mencatat penjualan TANPA stok gudang ikut berkurang (resepnya belum
  // ada di memori) — selisihnya diam-diam dan tidak akan pernah
  // ketahuan. Lebih baik tombolnya nonaktif sepersekian detik.
  const [resepSiap, setResepSiap] = useState(false);
  // Menu mana saja yang panel Bonus/Refund-nya sedang dibuka — SENGAJA
  // per-item (bukan satu toggle global), supaya Kasir bisa mengintip
  // beberapa menu sekaligus tanpa opsi lain tertutup tiba-tiba.
  const [itemDiperluas, setItemDiperluas] = useState<Set<string>>(new Set());
  function toggleDiperluas(menuId: string) {
    setItemDiperluas((prev) => {
      const next = new Set(prev);
      if (next.has(menuId)) next.delete(menuId);
      else next.add(menuId);
      return next;
    });
  }

  useEffect(() => {
    const unsubMenu = onSnapshot(
      query(collection(db, "outlets", outletId, "menu_harga"), where("aktif", "==", true)),
      (snap) => {
        const daftar = snap.docs.map((d) => ({
          id: d.id,
          nama: d.data().nama ?? "",
          kategori: d.data().kategori ?? "Umum",
          hargaJual: d.data().hargaJual ?? 0,
          aktif: true,
        }));
        setMenuList(daftar);

        // Ambil resep tiap menu sekali saat daftar menu berubah
        // (bukan tiap render) — gagal-lunak per menu, satu menu tanpa
        // resep tidak menghentikan menu lain.
        Promise.all(
          daftar.map(async (m) => {
            try {
              return [m.id, await ambilResepMenu(outletId, m.id)] as [string, ResepItem[]];
            } catch {
              return [m.id, [] as ResepItem[]] as [string, ResepItem[]];
            }
          }),
        ).then((hasil) => {
          setResepPerMenu(new Map(hasil));
          setResepSiap(true);
        });
      },
    );

    const unsubPenjualan = onSnapshot(
      query(collection(db, "outlets", outletId, "shift", shiftId, "penjualan"), orderBy("menuNama")),
      (snap) => {
        setPenjualan(
          snap.docs.map((d) => ({
            id: d.id,
            menuId: d.data().menuId,
            menuNama: d.data().menuNama,
            kategori: d.data().kategori ?? "Umum",
            qtyTunai: d.data().qtyTunai ?? 0,
            qtyNonTunai: d.data().qtyNonTunai ?? 0,
            qty: d.data().qty ?? 0,
            subtotalTunai: d.data().subtotalTunai ?? 0,
            subtotalNonTunai: d.data().subtotalNonTunai ?? 0,
            qtyBonus: d.data().qtyBonus ?? 0,
            qtyRefund: d.data().qtyRefund ?? 0,
            qtyRefundNonTunai: d.data().qtyRefundNonTunai ?? 0,
            hargaJualSnapshot: d.data().hargaJualSnapshot ?? 0,
            subtotal: d.data().subtotal ?? 0,
            manual: d.data().manual === true,
            bahanDipakai: Array.isArray(d.data().bahanDipakai) ? d.data().bahanDipakai : undefined,
          })),
        );
      },
    );

    const unsubKasKeluar = onSnapshot(
      collection(db, "outlets", outletId, "shift", shiftId, "kas_keluar"),
      (snap) => {
        setKasKeluar(
          snap.docs.map((d) => ({
            id: d.id,
            kategori: d.data().kategori ?? "Lainnya",
            nominal: d.data().nominal ?? 0,
            keterangan: d.data().keterangan ?? "",
          })),
        );
      },
    );

    const unsubStokKasir = onSnapshot(collection(db, "outlets", outletId, "stok_kasir"), (snap) => {
      setStokKasir(
        snap.docs.map((d) => ({
          id: d.id,
          nama: d.data().nama ?? "",
          kategori: d.data().kategori ?? "Umum",
          satuan: d.data().satuan === "pcs" ? "pcs" : "gram",
          stokSaatIni: d.data().stokSaatIni ?? 0,
          batasMinimalStok: d.data().batasMinimalStok ?? 0,
          aktif: d.data().aktif ?? true,
        })),
      );
    });

    return () => {
      unsubMenu();
      unsubPenjualan();
      unsubKasKeluar();
      unsubStokKasir();
    };
  }, [shiftId, outletId]);

  const totalOmset = useMemo(
    () => penjualan.reduce((total, item) => total + item.subtotal, 0),
    [penjualan],
  );
  const totalOmsetTunai = useMemo(
    () => penjualan.reduce((total, item) => total + item.subtotalTunai, 0),
    [penjualan],
  );
  const totalOmsetNonTunai = useMemo(
    () => penjualan.reduce((total, item) => total + item.subtotalNonTunai, 0),
    [penjualan],
  );
  const totalKasKeluar = useMemo(
    () => kasKeluar.reduce((total, item) => total + item.nominal, 0),
    [kasKeluar],
  );

  /**
   * Input Penjualan reguler — kini WAJIB memilih metode bayar per unit
   * (Tunai atau Non-Tunai/QRIS), atas permintaan pemilik cafe: kalau
   * hari ini Kopi laku 16pcs (10 QRIS + 6 Tunai), keduanya dicatat
   * terpisah supaya Rekap Metode Bayar di Dashboard akurat per
   * transaksi. Rekap Omset & seluruh kalkulasi keuangan lain TETAP
   * GLOBAL/tidak berubah — `qty` & `subtotal` total tetap dijaga sama
   * persis seperti sebelum fitur ini ada (lihat komentar interface
   * PenjualanItem), jadi Bonus/Refund/HPP tidak perlu diubah sama sekali.
   */
  async function ubahQtyReguler(item: MenuHarga, delta: number, metode: "tunai" | "nonTunai") {
    const existing = penjualan.find((p) => p.menuId === item.id);
    try {
      if (!existing) {
        if (delta <= 0) return;
        await setDoc(doc(db, "outlets", outletId, "shift", shiftId, "penjualan", item.id), {
          menuId: item.id,
          menuNama: item.nama,
          kategori: item.kategori,
          qtyTunai: metode === "tunai" ? delta : 0,
          qtyNonTunai: metode === "nonTunai" ? delta : 0,
          qty: delta,
          subtotalTunai: metode === "tunai" ? item.hargaJual * delta : 0,
          subtotalNonTunai: metode === "nonTunai" ? item.hargaJual * delta : 0,
          qtyBonus: 0,
          qtyRefund: 0,
          qtyRefundNonTunai: 0,
          hargaJualSnapshot: item.hargaJual,
          subtotal: item.hargaJual * delta,
        });
      } else {
        const qtyBucketLama = metode === "tunai" ? existing.qtyTunai : existing.qtyNonTunai;
        const bucketBaru = qtyBucketLama + delta;
        const perubahanSubtotal = item.hargaJual * delta;
        if (bucketBaru <= 0) {
          // Turun ke 0 atau kurang -> di-set 0 secara eksplisit (bukan
          // increment), supaya tidak pernah minus akibat klik cepat
          // berulang saat qty sedang di angka kecil.
          if (metode === "tunai") {
            await updateDoc(doc(db, "outlets", outletId, "shift", shiftId, "penjualan", item.id), {
              qtyTunai: 0,
              subtotalTunai: 0,
              qty: increment(-qtyBucketLama),
              subtotal: increment(-qtyBucketLama * item.hargaJual),
            });
          } else {
            await updateDoc(doc(db, "outlets", outletId, "shift", shiftId, "penjualan", item.id), {
              qtyNonTunai: 0,
              subtotalNonTunai: 0,
              qty: increment(-qtyBucketLama),
              subtotal: increment(-qtyBucketLama * item.hargaJual),
            });
          }
        } else if (metode === "tunai") {
          await updateDoc(doc(db, "outlets", outletId, "shift", shiftId, "penjualan", item.id), {
            qtyTunai: increment(delta),
            subtotalTunai: increment(perubahanSubtotal),
            qty: increment(delta),
            subtotal: increment(perubahanSubtotal),
          });
        } else {
          await updateDoc(doc(db, "outlets", outletId, "shift", shiftId, "penjualan", item.id), {
            qtyNonTunai: increment(delta),
            subtotalNonTunai: increment(perubahanSubtotal),
            qty: increment(delta),
            subtotal: increment(perubahanSubtotal),
          });
        }
      }

      // Kurangi (atau kembalikan, bila delta negatif) stok gudang
      // otomatis lewat Resep menu ini — gagal-lunak: kalau menu belum
      // punya resep (Owner belum menyusunnya), stok gudang cukup
      // diabaikan, penjualan tetap tercatat normal. Stok TIDAK peduli
      // metode bayar, jadi logikanya sama persis seperti sebelumnya.
      const resep = resepPerMenu.get(item.id);
      if (resep && resep.length > 0) {
        terapkanPerubahanStok(outletId, resep, delta).catch(() => {
          showToast(
            "error",
            `Penjualan tercatat, tapi stok gudang untuk "${item.nama}" gagal diperbarui otomatis.`,
          );
        });
      }
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? `Gagal mencatat penjualan: ${error.message}`
          : "Gagal mencatat penjualan.",
      );
    }
  }

  /**
   * Bonus/Gratis — produk keluar ke pembeli (mis. bonus promo
   * pembelian) TANPA menyumbang Omset sama sekali, tapi bahan baku
   * tetap berkurang seperti penjualan biasa (produknya sungguh dibuat
   * dan diberikan). `subtotal` SENGAJA tidak pernah disentuh di sini —
   * itulah yang membuat nilainya tidak "Full 100%" masuk ke Omset,
   * jadi Kasir tidak akan pernah melihat Total Omset minus gara-gara
   * mencatat produk gratis.
   */
  async function ubahQtyBonus(item: MenuHarga, delta: number) {
    const existing = penjualan.find((p) => p.menuId === item.id);
    try {
      if (!existing) {
        if (delta <= 0) return;
        await setDoc(doc(db, "outlets", outletId, "shift", shiftId, "penjualan", item.id), {
          menuId: item.id,
          menuNama: item.nama,
          kategori: item.kategori,
          qtyTunai: 0,
          qtyNonTunai: 0,
          qty: 0,
          subtotalTunai: 0,
          subtotalNonTunai: 0,
          qtyBonus: delta,
          qtyRefund: 0,
          qtyRefundNonTunai: 0,
          hargaJualSnapshot: item.hargaJual,
          subtotal: 0,
        });
      } else {
        const bonusBaru = existing.qtyBonus + delta;
        if (bonusBaru <= 0) {
          await updateDoc(doc(db, "outlets", outletId, "shift", shiftId, "penjualan", item.id), { qtyBonus: 0 });
        } else {
          await updateDoc(doc(db, "outlets", outletId, "shift", shiftId, "penjualan", item.id), {
            qtyBonus: increment(delta),
          });
        }
      }

      // Bahan baku tetap berkurang persis seperti penjualan reguler —
      // produk Bonus/Gratis SUNGGUH dibuat & diberikan ke pembeli.
      const resep = resepPerMenu.get(item.id);
      if (resep && resep.length > 0) {
        terapkanPerubahanStok(outletId, resep, delta).catch(() => {
          showToast(
            "error",
            `Bonus tercatat, tapi stok gudang untuk "${item.nama}" gagal diperbarui otomatis.`,
          );
        });
      }
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mencatat bonus: ${error.message}` : "Gagal mencatat bonus.",
      );
    }
  }

  /**
   * Refund — uang untuk 1 unit yang SUDAH tercatat sebagai qty reguler
   * dikembalikan ke pembeli. Memindahkan 1 unit dari salah satu bucket
   * metode bayar (`qtyTunai`/`qtyNonTunai`) ke `qtyRefund` (Omset
   * berkurang senilai harga jual saat itu — pakai hargaJualSnapshot,
   * bukan harga terkini), TAPI SENGAJA TIDAK memanggil
   * terapkanPerubahanStok sama sekali — bahan baku produk itu sudah
   * terlanjur dibuat/dipakai, jadi stok gudang TIDAK dikembalikan.
   * Total unit (qty + qtyBonus + qtyRefund) tetap sama sebelum/sesudah,
   * itulah yang menjaga stok gudang tidak ikut berubah.
   *
   * Kasir tidak diminta memilih metode bayar saat me-refund (refund
   * biasanya terjadi cepat/mendadak) — bucket sumbernya dipilih
   * OTOMATIS: Non-Tunai diutamakan dulu kalau ada, baru Tunai. Urutan
   * yang SAMA dipakai saat membatalkan refund (qtyRefundNonTunai
   * dicek lebih dulu), supaya "ambil lalu kembalikan" selalu konsisten
   * mengembalikan ke bucket yang sama. Rekap Omset TOTAL tetap 100%
   * akurat apa pun urutannya — hanya rincian Tunai/Non-Tunai yang
   * memakai penyederhanaan ini.
   *
   * delta = 1 -> refund 1 unit (hanya boleh kalau qty reguler > 0).
   * delta = -1 -> batalkan refund 1 unit (kembalikan ke qty reguler).
   */
  async function ubahQtyRefund(item: MenuHarga, delta: number) {
    const existing = penjualan.find((p) => p.menuId === item.id);
    if (!existing) return;
    try {
      if (delta > 0) {
        if (existing.qty <= 0) {
          showToast(
            "error",
            `Tidak bisa refund "${item.nama}" — qty reguler yang tercatat sudah 0.`,
          );
          return;
        }
        const dariNonTunai = existing.qtyNonTunai > 0;
        if (dariNonTunai) {
          await updateDoc(doc(db, "outlets", outletId, "shift", shiftId, "penjualan", item.id), {
            qtyNonTunai: increment(-1),
            subtotalNonTunai: increment(-existing.hargaJualSnapshot),
            qtyRefundNonTunai: increment(1),
            qty: increment(-1),
            qtyRefund: increment(1),
            subtotal: increment(-existing.hargaJualSnapshot),
          });
        } else {
          await updateDoc(doc(db, "outlets", outletId, "shift", shiftId, "penjualan", item.id), {
            qtyTunai: increment(-1),
            subtotalTunai: increment(-existing.hargaJualSnapshot),
            qty: increment(-1),
            qtyRefund: increment(1),
            subtotal: increment(-existing.hargaJualSnapshot),
          });
        }
      } else {
        if (existing.qtyRefund <= 0) return;
        const dariNonTunai = existing.qtyRefundNonTunai > 0;
        if (dariNonTunai) {
          await updateDoc(doc(db, "outlets", outletId, "shift", shiftId, "penjualan", item.id), {
            qtyNonTunai: increment(1),
            subtotalNonTunai: increment(existing.hargaJualSnapshot),
            qtyRefundNonTunai: increment(-1),
            qty: increment(1),
            qtyRefund: increment(-1),
            subtotal: increment(existing.hargaJualSnapshot),
          });
        } else {
          await updateDoc(doc(db, "outlets", outletId, "shift", shiftId, "penjualan", item.id), {
            qtyTunai: increment(1),
            subtotalTunai: increment(existing.hargaJualSnapshot),
            qty: increment(1),
            qtyRefund: increment(-1),
            subtotal: increment(existing.hargaJualSnapshot),
          });
        }
      }
      // TIDAK ADA panggilan terapkanPerubahanStok di sini — itu poin
      // utamanya (lihat komentar fungsi).
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mencatat refund: ${error.message}` : "Gagal mencatat refund.",
      );
    }
  }

  const menuPerKategori = useMemo(() => {
    const map = new Map<string, MenuHarga[]>();
    for (const item of menuList) {
      const list = map.get(item.kategori) ?? [];
      list.push(item);
      map.set(item.kategori, list);
    }
    return map;
  }, [menuList]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <KickerOutlet />
          <h1 className="text-2xl font-bold text-slate-900">
            Shift Berjalan{slotNama ? ` — ${slotNama}` : ""}
          </h1>
          {slotNama && slotJamMulai && slotJamSelesai ? (
            <p className="text-xs text-slate-500">
              {slotJamMulai} – {slotJamSelesai}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Total Omset Berjalan</p>
          <p className="text-xl font-bold tabular-nums text-emerald-700">
            {formatRupiah(totalOmset)}
          </p>
          <p className="text-[11px] text-slate-400">
            Tunai {formatRupiah(totalOmsetTunai)} · Non-Tunai {formatRupiah(totalOmsetNonTunai)}
          </p>
        </div>
      </header>

      <div className="mb-6">
        <SerahTerimaKasKartu shiftId={shiftId} />
      </div>

      <div className="flex flex-col gap-6">
        <section
          aria-labelledby="bagian-penjualan"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 id="bagian-penjualan" className="text-base font-semibold text-slate-900">
            Input Penjualan
          </h2>
          {menuList.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Belum ada menu aktif. Tambahkan menu lewat Kalkulator HPP terlebih
              dahulu (Owner).
            </p>
          ) : !resepSiap ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Menyiapkan data resep...
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
              {[...menuPerKategori.entries()].map(([kategori, items]) => (
                <div key={kategori}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {kategori}
                  </p>
                  <div className="flex flex-col divide-y divide-slate-100">
                    {items.map((item) => {
                      const catatan = penjualan.find((p) => p.menuId === item.id);
                      const qty = catatan?.qty ?? 0;
                      const qtyTunai = catatan?.qtyTunai ?? 0;
                      const qtyNonTunai = catatan?.qtyNonTunai ?? 0;
                      const qtyBonus = catatan?.qtyBonus ?? 0;
                      const qtyRefund = catatan?.qtyRefund ?? 0;
                      const diperluas = itemDiperluas.has(item.id);
                      return (
                        <div key={item.id} className="flex flex-col gap-2 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900">{item.nama}</p>
                              <p className="text-xs text-slate-500">{formatRupiah(item.hargaJual)}</p>
                              {qty > 0 || qtyBonus > 0 || qtyRefund > 0 ? (
                                <p className="mt-0.5 text-[11px] text-slate-400">
                                  {qty > 0 ? `Total terjual: ${qty}` : null}
                                  {qty > 0 && (qtyBonus > 0 || qtyRefund > 0) ? " · " : null}
                                  {qtyBonus > 0 ? `Bonus/Gratis: ${qtyBonus}` : null}
                                  {qtyBonus > 0 && qtyRefund > 0 ? " · " : null}
                                  {qtyRefund > 0 ? `Refund: ${qtyRefund}` : null}
                                </p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleDiperluas(item.id)}
                              aria-label={`Opsi Bonus/Refund untuk ${item.nama}`}
                              aria-expanded={diperluas}
                              className={[
                                "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 motion-safe:transition active:scale-90 hover:bg-slate-100 hover:text-slate-600",
                                diperluas ? "bg-slate-100 text-slate-600" : "",
                              ].join(" ")}
                            >
                              <ChevronDown
                                className={`h-4 w-4 motion-safe:transition-transform ${diperluas ? "rotate-180" : ""}`}
                                aria-hidden="true"
                              />
                            </button>
                          </div>

                          {/* Dua stepper metode bayar — INI alur input utama
                              (bukan lagi satu stepper tunggal), atas permintaan
                              pemilik cafe supaya "Kopi 10 QRIS + Kopi 6 Tunai"
                              tercatat terpisah sejak awal, bukan direkap manual
                              belakangan. */}
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50/60 px-2.5 py-1.5">
                              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-800">
                                <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
                                Tunai
                              </span>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => ubahQtyReguler(item, -1, "tunai")}
                                  disabled={qtyTunai <= 0 || !resepSiap}
                                  aria-label={`Kurangi ${item.nama} (Tunai)`}
                                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 motion-safe:transition active:scale-95 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <Minus className="h-4 w-4" aria-hidden="true" />
                                </button>
                                <span className="w-6 text-center text-sm font-semibold tabular-nums text-slate-900">
                                  {qtyTunai}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => ubahQtyReguler(item, 1, "tunai")}
                                  disabled={!resepSiap}
                                  aria-label={`Tambah ${item.nama} (Tunai)`}
                                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-white motion-safe:transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <Plus className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 rounded-lg bg-sky-50/60 px-2.5 py-1.5">
                              <span className="flex items-center gap-1.5 text-xs font-medium text-sky-800">
                                <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                                Non-Tunai
                              </span>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => ubahQtyReguler(item, -1, "nonTunai")}
                                  disabled={qtyNonTunai <= 0 || !resepSiap}
                                  aria-label={`Kurangi ${item.nama} (Non-Tunai)`}
                                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 motion-safe:transition active:scale-95 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <Minus className="h-4 w-4" aria-hidden="true" />
                                </button>
                                <span className="w-6 text-center text-sm font-semibold tabular-nums text-slate-900">
                                  {qtyNonTunai}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => ubahQtyReguler(item, 1, "nonTunai")}
                                  disabled={!resepSiap}
                                  aria-label={`Tambah ${item.nama} (Non-Tunai)`}
                                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-sky-600 text-white motion-safe:transition hover:bg-sky-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <Plus className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                          </div>

                          {diperluas ? (
                            <div className="animasi-masuk-halus flex flex-col gap-3 rounded-xl bg-slate-50 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                                    <Gift className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                                    Bonus / Gratis
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    Promo bonus pembelian — bahan tetap berkurang, TIDAK menambah Omset.
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => ubahQtyBonus(item, -1)}
                                    disabled={qtyBonus <= 0 || !resepSiap}
                                    aria-label={`Kurangi Bonus ${item.nama}`}
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 motion-safe:transition active:scale-95 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                  <span className="w-5 text-center text-sm font-semibold tabular-nums text-slate-900">
                                    {qtyBonus}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => ubahQtyBonus(item, 1)}
                                    disabled={!resepSiap}
                                    aria-label={`Tambah Bonus ${item.nama}`}
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-white motion-safe:transition hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                              </div>

                              <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                                <div className="min-w-0">
                                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                                    <RotateCcw className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                                    Refund
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    Uang dikembalikan ke pembeli — mengurangi Omset, bahan TIDAK dikembalikan ke stok.
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => ubahQtyRefund(item, -1)}
                                    disabled={qtyRefund <= 0}
                                    aria-label={`Batalkan refund ${item.nama}`}
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 motion-safe:transition active:scale-95 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                  <span className="w-5 text-center text-sm font-semibold tabular-nums text-slate-900">
                                    {qtyRefund}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => ubahQtyRefund(item, 1)}
                                    disabled={qty <= 0}
                                    aria-label={`Refund ${item.nama}`}
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-rose-600 text-white motion-safe:transition hover:bg-rose-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <ItemLainKartu
          shiftId={shiftId}
          stokKasir={stokKasir}
          daftarManual={penjualan.filter((p) => p.manual)}
        />

        <KasKeluarKartu shiftId={shiftId} daftar={kasKeluar} total={totalKasKeluar} />

        <TutupShiftKartu
          shiftId={shiftId}
          modalKasAwal={modalKasAwal}
          totalOmset={totalOmset}
          totalOmsetTunai={totalOmsetTunai}
          totalOmsetNonTunai={totalOmsetNonTunai}
          totalKasKeluar={totalKasKeluar}
        />
      </div>
    </main>
  );
}

/**
 * Item Lain (Manual) — permintaan user: aplikasi ini SENGAJA tidak
 * memakai konsep "Stock Item" berupa produk baku yang wajib didaftarkan
 * dulu di Kelola Produk sebelum bisa dijual (Kelola Produk tetap ada,
 * tapi jadi preset opsional, bukan syarat). Prinsip akuntansinya:
 * sepanjang stok BAHAN BAKU di inventaris tersedia, transaksi tetap
 * bisa di-checkout — jadi di sini Kasir bisa ketik nama & harga jual
 * manual untuk item yang belum/tidak terdaftar sebagai menu (mis. jual
 * bahan mentah langsung, paket dadakan, titipan, dll), lalu PILIH
 * SENDIRI bahan baku mana & berapa takaran yang terpakai per unit —
 * stok gudang & cerminnya (stok_kasir) dipotong lewat mekanisme yang
 * SAMA PERSIS dengan Resep menu biasa (terapkanPerubahanStok, lihat
 * src/shared/lib/resep.ts), supaya akuntansi tetap berbasis bahan
 * baku, bukan "produk" yang datanya terpisah dari inventaris.
 *
 * Dicatat ke subkoleksi shift/{id}/penjualan YANG SAMA dengan penjualan
 * reguler (bukan koleksi terpisah) — bertanda `manual: true` — supaya
 * Total Omset, Rekap Metode Bayar, Tutup Shift, dan seluruh Laporan
 * yang SUDAH ADA otomatis ikut menghitungnya tanpa perlu diubah sama
 * sekali (field qty/subtotal/qtyTunai dst bentuknya identik).
 *
 * Checkout DIBLOKIR (beda dari penjualan menu reguler yang boleh
 * membuat stok minus, lihat komentar di belanja-nota/page.tsx) kalau
 * salah satu bahan yang dipilih stoknya tidak cukup — sesuai
 * permintaan eksplisit: "selama stok bahan baku ada baru bisa
 * checkout" berlaku juga sebaliknya: stok tidak cukup -> tidak bisa
 * checkout.
 */
function ItemLainKartu({
  shiftId,
  stokKasir,
  daftarManual,
}: {
  shiftId: string;
  stokKasir: StokKasir[];
  daftarManual: PenjualanItem[];
}) {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [namaItem, setNamaItem] = useState("");
  const [hargaJual, setHargaJual] = useState(0);
  const [qty, setQty] = useState(1);
  const [metodeBayar, setMetodeBayar] = useState<"tunai" | "nonTunai">("tunai");
  const [barisBahan, setBarisBahan] = useState<{ bahanId: string; takaranPerUnit: number }[]>([
    { bahanId: "", takaranPerUnit: 0 },
  ]);
  const [sedangSimpan, setSedangSimpan] = useState(false);

  function ubahBaris(indeks: number, perubahan: Partial<{ bahanId: string; takaranPerUnit: number }>) {
    setBarisBahan((prev) => prev.map((b, i) => (i === indeks ? { ...b, ...perubahan } : b)));
  }
  function tambahBaris() {
    setBarisBahan((prev) => [...prev, { bahanId: "", takaranPerUnit: 0 }]);
  }
  function hapusBaris(indeks: number) {
    setBarisBahan((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== indeks)));
  }

  async function handleSimpan() {
    if (!namaItem.trim()) {
      showToast("error", "Nama item wajib diisi.");
      return;
    }
    if (hargaJual <= 0) {
      showToast("error", "Harga jual harus lebih besar dari 0.");
      return;
    }
    if (qty <= 0) {
      showToast("error", "Jumlah harus lebih besar dari 0.");
      return;
    }
    const barisValid = barisBahan.filter((b) => b.bahanId && b.takaranPerUnit > 0);
    if (barisValid.length === 0) {
      showToast(
        "error",
        "Pilih minimal satu bahan baku yang dipakai — stok gudang tetap harus terhubung ke setiap penjualan.",
      );
      return;
    }

    // Cek stok CUKUP untuk setiap bahan SEBELUM checkout — SENGAJA
    // diblokir kalau tidak cukup, sesuai prinsip di komentar atas.
    for (const baris of barisValid) {
      const bahan = stokKasir.find((b) => b.id === baris.bahanId);
      const dibutuhkan = baris.takaranPerUnit * qty;
      if (!bahan || bahan.stokSaatIni < dibutuhkan) {
        showToast(
          "error",
          `Stok "${bahan?.nama ?? "bahan"}" tidak cukup — tersisa ${bahan?.stokSaatIni ?? 0} ${bahan?.satuan ?? ""}, butuh ${dibutuhkan}.`,
        );
        return;
      }
    }

    setSedangSimpan(true);
    try {
      const subtotal = hargaJual * qty;
      const resepSintetis: ResepItem[] = barisValid.map((b) => {
        const bahan = stokKasir.find((x) => x.id === b.bahanId);
        return {
          id: b.bahanId,
          bahanId: b.bahanId,
          bahanNama: bahan?.nama ?? "",
          takaran: b.takaranPerUnit,
          satuan: bahan?.satuan ?? "gram",
        };
      });

      await addDoc(collection(db, "outlets", outletId, "shift", shiftId, "penjualan"), {
        menuId: null,
        menuNama: namaItem.trim(),
        kategori: "Item Lain",
        qtyTunai: metodeBayar === "tunai" ? qty : 0,
        qtyNonTunai: metodeBayar === "nonTunai" ? qty : 0,
        qty,
        subtotalTunai: metodeBayar === "tunai" ? subtotal : 0,
        subtotalNonTunai: metodeBayar === "nonTunai" ? subtotal : 0,
        qtyBonus: 0,
        qtyRefund: 0,
        qtyRefundNonTunai: 0,
        hargaJualSnapshot: hargaJual,
        subtotal,
        manual: true,
        bahanDipakai: resepSintetis.map((r) => ({
          bahanId: r.bahanId,
          bahanNama: r.bahanNama,
          takaran: r.takaran,
          satuan: r.satuan,
        })),
      });

      // Potong stok gudang & cerminnya — mekanisme SAMA PERSIS dengan
      // Resep menu biasa (gagal-lunak: kalau ini gagal, penjualan tetap
      // tercatat, Kasir diberi tahu lewat toast peringatan terpisah,
      // sama seperti pola ubahQtyReguler() di atas).
      terapkanPerubahanStok(outletId, resepSintetis, qty).catch(() => {
        showToast(
          "warning",
          `"${namaItem.trim()}" tercatat, tapi stok bahan baku gagal diperbarui otomatis — cek manual di Belanja & Nota.`,
        );
      });

      showToast("success", `"${namaItem.trim()}" dicatat: ${formatRupiah(subtotal)}.`);
      setNamaItem("");
      setHargaJual(0);
      setQty(1);
      setBarisBahan([{ bahanId: "", takaranPerUnit: 0 }]);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mencatat item: ${error.message}` : "Gagal mencatat item.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-item-lain"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="bagian-item-lain" className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <Package className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Item Lain (Manual)
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Untuk penjualan yang belum terdaftar di Kelola Produk. Ketik nama & harga sendiri, lalu pilih bahan
        baku yang terpakai — stok gudang tetap otomatis terpotong seperti biasa.
      </p>

      {daftarManual.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {daftarManual.map((item) => (
            <li key={item.id} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-slate-700">
                {item.menuNama} · {item.qty}× {formatRupiah(item.hargaJualSnapshot)}
              </span>
              <span className="font-medium tabular-nums text-slate-900">{formatRupiah(item.subtotal)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {stokKasir.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          Belum ada Bahan Baku terdaftar — tambahkan lewat Belanja & Nota (Purchasing) dulu.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label htmlFor="il-nama" className="block text-sm font-semibold text-slate-800">
                Nama Item
              </label>
              <input
                id="il-nama"
                type="text"
                value={namaItem}
                onChange={(e) => setNamaItem(e.target.value)}
                placeholder="mis. Kopi Sachet Titipan"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <NumberField id="il-harga" label="Harga Jual / Unit" value={hargaJual} onChange={setHargaJual} prefix="Rp" />
            <NumberField id="il-qty" label="Jumlah" value={qty} onChange={setQty} step={1} />
            <div>
              <span className="block text-sm font-semibold text-slate-800">Metode Bayar</span>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setMetodeBayar("tunai")}
                  className={`inline-flex h-[42px] items-center justify-center gap-1.5 rounded-lg border text-sm font-medium motion-safe:transition active:scale-[0.99] ${
                    metodeBayar === "tunai"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
                  Tunai
                </button>
                <button
                  type="button"
                  onClick={() => setMetodeBayar("nonTunai")}
                  className={`inline-flex h-[42px] items-center justify-center gap-1.5 rounded-lg border text-sm font-medium motion-safe:transition active:scale-[0.99] ${
                    metodeBayar === "nonTunai"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                  Non-Tunai
                </button>
              </div>
            </div>
          </div>

          <div>
            <span className="block text-sm font-semibold text-slate-800">Bahan Baku Terpakai (per unit)</span>
            <div className="mt-1.5 flex flex-col gap-2">
              {barisBahan.map((baris, indeks) => {
                const bahanTerpilih = stokKasir.find((b) => b.id === baris.bahanId);
                return (
                  <div key={indeks} className="flex items-center gap-2">
                    <select
                      aria-label={`Bahan baku baris ${indeks + 1}`}
                      value={baris.bahanId}
                      onChange={(e) => ubahBaris(indeks, { bahanId: e.target.value })}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                    >
                      <option value="">Pilih bahan...</option>
                      {stokKasir.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.nama} (stok: {b.stokSaatIni} {b.satuan})
                        </option>
                      ))}
                    </select>
                    <div className="w-28 shrink-0">
                      <NumberField
                        id={`il-takaran-${indeks}`}
                        label="Takaran"
                        value={baris.takaranPerUnit}
                        onChange={(v) => ubahBaris(indeks, { takaranPerUnit: v })}
                        suffix={bahanTerpilih?.satuan}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => hapusBaris(indeks)}
                      disabled={barisBahan.length <= 1}
                      aria-label={`Hapus baris bahan ${indeks + 1}`}
                      className="mt-5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 motion-safe:transition active:scale-90 hover:bg-slate-100 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={tambahBaris}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 motion-safe:transition hover:text-emerald-800"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Tambah bahan lain
            </button>
          </div>

          <button
            type="button"
            onClick={handleSimpan}
            disabled={sedangSimpan}
            aria-busy={sedangSimpan}
            className={[
              "inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm",
              "motion-safe:transition motion-safe:duration-150",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
              sedangSimpan
                ? "cursor-not-allowed bg-emerald-400"
                : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
            ].join(" ")}
          >
            {sedangSimpan ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Package className="h-4 w-4" aria-hidden="true" />
            )}
            {sedangSimpan ? "Menyimpan..." : "Catat Penjualan Item Ini"}
          </button>
        </div>
      )}
    </section>
  );
}

function KasKeluarKartu({
  shiftId,
  daftar,
  total,
}: {
  shiftId: string;
  daftar: KasKeluarItem[];
  total: number;
}) {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [kategori, setKategori] = useState<(typeof KATEGORI_KAS_KELUAR)[number]>(
    KATEGORI_KAS_KELUAR[0],
  );
  const [nominal, setNominal] = useState(0);
  const [keterangan, setKeterangan] = useState("");
  const [sedangSimpan, setSedangSimpan] = useState(false);

  async function handleTambah() {
    if (nominal <= 0) {
      showToast("error", "Nominal kas keluar harus lebih besar dari 0.");
      return;
    }
    setSedangSimpan(true);
    try {
      await addDoc(collection(db, "outlets", outletId, "shift", shiftId, "kas_keluar"), {
        kategori,
        nominal,
        keterangan: keterangan.trim(),
        waktu: serverTimestamp(),
      });
      await updateDoc(doc(db, "outlets", outletId, "shift", shiftId), { totalKasKeluar: increment(nominal) });
      showToast("success", `Kas keluar ${formatRupiah(nominal)} (${kategori}) dicatat.`);
      setNominal(0);
      setKeterangan("");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? `Gagal mencatat kas keluar: ${error.message}`
          : "Gagal mencatat kas keluar.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-kas-keluar"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h2 id="bagian-kas-keluar" className="text-base font-semibold text-slate-900">
          Kas Keluar
        </h2>
        <p className="text-sm font-semibold tabular-nums text-slate-900">
          {formatRupiah(total)}
        </p>
      </div>

      {daftar.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {daftar.map((item) => (
            <li key={item.id} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-slate-700">
                {item.kategori}
                {item.keterangan ? ` — ${item.keterangan}` : ""}
              </span>
              <span className="font-medium tabular-nums text-slate-900">
                {formatRupiah(item.nominal)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label htmlFor="kategori-kas-keluar" className="block text-sm font-semibold text-slate-800">
            Kategori
          </label>
          <select
            id="kategori-kas-keluar"
            value={kategori}
            onChange={(event) =>
              setKategori(event.target.value as (typeof KATEGORI_KAS_KELUAR)[number])
            }
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          >
            {KATEGORI_KAS_KELUAR.map((opsi) => (
              <option key={opsi} value={opsi}>
                {opsi}
              </option>
            ))}
          </select>
        </div>
        <NumberField id="nominal-kas-keluar" label="Nominal" value={nominal} onChange={setNominal} prefix="Rp" />
        <div className="flex items-end">
          <button
            type="button"
            onClick={handleTambah}
            disabled={sedangSimpan}
            aria-busy={sedangSimpan}
            className={[
              "inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm sm:w-auto",
              "motion-safe:transition motion-safe:duration-150",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
              sedangSimpan
                ? "cursor-not-allowed bg-emerald-400"
                : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
            ].join(" ")}
          >
            {sedangSimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Catat"}
          </button>
        </div>
      </div>
      <div className="mt-2">
        <label htmlFor="keterangan-kas-keluar" className="block text-xs text-slate-500">
          Keterangan (opsional)
        </label>
        <input
          id="keterangan-kas-keluar"
          type="text"
          value={keterangan}
          onChange={(event) => setKeterangan(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
        />
      </div>
    </section>
  );
}

/**
 * Serah Terima Kas — jejak audit untuk masa transisi pergantian shift
 * (permintaan pemilik cafe: "Shift 2 sudah bisa buka shift meskipun
 * Shift 1 belum closing shift"). Laci kas fisik dipakai BERSAMA saat
 * jam-jam transisi beririsan (jawaban eksplisit pemilik cafe), jadi
 * saat menyerahkan laci ke rekan shift berikutnya, siapa pun yang
 * SEDANG menyerahkan (dariUid = akun yang login) mencatat nominal &
 * catatan singkat di sini.
 *
 * SENGAJA TIDAK ditargetkan ke satu Kasir penerima tertentu (uid
 * tujuan) — Kasir tidak punya akses `list` ke koleksi users untuk
 * memilih nama rekan dari daftar (lihat firestore.rules), jadi cukup
 * dicatat "dari siapa, jam berapa, berapa", dan SEMUA Kasir aktif hari
 * ini bisa membaca daftar ini (bukan cuma yang membuatnya) supaya
 * siapa pun yang baru mulai shift bisa langsung lihat riwayat serah
 * terima hari ini.
 *
 * MURNI CATATAN AUDIT/INFORMASIONAL — TIDAK memengaruhi Modal Kas Awal
 * (tetap flat Rp500.000, tidak diwariskan dari shift lain) maupun
 * perhitungan Kas Seharusnya/Selisih Kas di TutupShiftKartu. Bisa
 * dicatat kapan saja selama shift berjalan (tidak harus menunggu Tutup
 * Shift), karena serah terima biasanya terjadi DI TENGAH shift, saat
 * jam transisi, bukan di akhir.
 */
function SerahTerimaKasKartu({ shiftId }: { shiftId: string }) {
  const { user, profil } = useAuth();
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [daftar, setDaftar] = useState<SerahTerimaKas[]>([]);
  const [nominal, setNominal] = useState(0);
  const [keterangan, setKeterangan] = useState("");
  const [sedangSimpan, setSedangSimpan] = useState(false);
  const [terbuka, setTerbuka] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "serah_terima_kas"), where("tanggal", "==", tanggalHariIni())),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          dariNama: d.data().dariNama ?? "",
          nominal: d.data().nominal ?? 0,
          keterangan: d.data().keterangan ?? "",
          waktuMs: d.data().waktu?.toMillis?.() ?? 0,
        }));
        list.sort((a, b) => b.waktuMs - a.waktuMs);
        setDaftar(list);
      },
    );
    return unsub;
  }, [outletId]);

  async function catatSerahTerima() {
    if (!user || !profil) return;
    if (nominal <= 0) {
      showToast("error", "Nominal serah terima kas harus lebih dari 0.");
      return;
    }
    setSedangSimpan(true);
    try {
      await addDoc(collection(db, "outlets", outletId, "serah_terima_kas"), {
        tanggal: tanggalHariIni(),
        shiftIdAsal: shiftId,
        dariUid: user.uid,
        dariNama: profil.nama,
        nominal,
        keterangan: keterangan.trim(),
        waktu: serverTimestamp(),
      });
      setNominal(0);
      setKeterangan("");
      showToast("success", "Serah terima kas dicatat.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? `Gagal mencatat serah terima kas: ${error.message}`
          : "Gagal mencatat serah terima kas.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <button
        type="button"
        onClick={() => setTerbuka((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">
          Serah Terima Kas Hari Ini{daftar.length > 0 ? ` (${daftar.length})` : ""}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 motion-safe:transition-transform ${terbuka ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {terbuka ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-slate-500">
            Catat kalau kamu baru saja menyerahkan laci kas ke rekan shift
            berikutnya (masa transisi pergantian shift). Ini catatan audit
            saja — tidak memengaruhi Modal Kas Awal atau Kas Seharusnya.
          </p>

          {daftar.length > 0 ? (
            <ul className="flex flex-col divide-y divide-slate-100 rounded-lg bg-slate-50 p-2">
              {daftar.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{d.dariNama}</p>
                    {d.keterangan ? (
                      <p className="truncate text-slate-500">{d.keterangan}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 font-medium tabular-nums text-slate-700">
                    {formatRupiah(d.nominal)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400">Belum ada serah terima kas hari ini.</p>
          )}

          <div>
            <NumberField
              id="nominal-serah-terima"
              label="Nominal Diserahkan"
              value={nominal}
              onChange={setNominal}
              prefix="Rp"
            />
            <label htmlFor="keterangan-serah-terima" className="mt-2 block text-xs font-medium text-slate-600">
              Keterangan (opsional)
            </label>
            <input
              id="keterangan-serah-terima"
              type="text"
              value={keterangan}
              onChange={(event) => setKeterangan(event.target.value)}
              placeholder="mis. serah terima ke shift 2"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <button
            type="button"
            onClick={catatSerahTerima}
            disabled={sedangSimpan}
            className={[
              "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm",
              "motion-safe:transition motion-safe:duration-150",
              sedangSimpan
                ? "cursor-not-allowed bg-emerald-400"
                : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
            ].join(" ")}
          >
            {sedangSimpan ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            {sedangSimpan ? "Menyimpan..." : "Catat Serah Terima Kas"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function TutupShiftKartu({
  shiftId,
  modalKasAwal,
  totalOmset,
  totalOmsetTunai,
  totalOmsetNonTunai,
  totalKasKeluar,
}: {
  shiftId: string;
  modalKasAwal: number;
  totalOmset: number;
  totalOmsetTunai: number;
  totalOmsetNonTunai: number;
  totalKasKeluar: number;
}) {
  const { showToast } = useToast();
  const { user, profil } = useAuth();
  const outletId = useOutletId();
  const [kasFisik, setKasFisik] = useState(0);
  const [keteranganSelisih, setKeteranganSelisih] = useState("");
  const [sedangTutup, setSedangTutup] = useState(false);

  // --- Auto Draft ---
  // Kas Fisik hasil MENGHITUNG UANG TUNAI di laci. Kalau hilang karena
  // auto logout atau tab tertutup, Kasir harus menghitung ulang seluruh
  // laci dari nol — kerugian waktu yang nyata. Drafnya dikunci per
  // shiftId supaya draf shift kemarin tidak pernah bocor ke shift hari
  // ini. Omset Tunai/Non-Tunai TIDAK PERLU didraf lagi — sekarang
  // dihitung OTOMATIS dari metode bayar yang dipilih Kasir per item saat
  // Input Penjualan (lihat totalOmsetTunai/totalOmsetNonTunai di
  // ShiftBerjalan), bukan lagi tebakan manual di akhir shift.
  const kunciDraf = `tutup-shift:${shiftId}`;
  const isiDraf = useMemo<IsiDrafTutupShift>(() => ({ kasFisik, keteranganSelisih }), [
    kasFisik,
    keteranganSelisih,
  ]);
  useDrafOtomatis(user?.uid, kunciDraf, isiDraf, kasFisik > 0 || keteranganSelisih.trim().length > 0);

  useEffect(() => {
    if (!user) return;
    let dibatalkan = false;
    ambilDrafAsync<IsiDrafTutupShift>(user.uid, kunciDraf).then((tersimpan) => {
      if (dibatalkan || !tersimpan?.data) return;
      setKasFisik(tersimpan.data.kasFisik ?? 0);
      setKeteranganSelisih(tersimpan.data.keteranganSelisih ?? "");
      showToast("success", "Hitungan kas yang belum sempat disimpan dipulihkan dari draf.");
    });
    return () => {
      dibatalkan = true;
    };
  }, [user, kunciDraf, showToast]);

  const omsetTunai = totalOmsetTunai;
  const omsetNonTunai = totalOmsetNonTunai;
  const kasSeharusnya = modalKasAwal + omsetTunai - totalKasKeluar;
  const selisihKas = kasFisik - kasSeharusnya;

  async function handleTutupShift() {
    if (!user || !profil) return;
    // Selisih Kas BOLEH minus (Kasir tetap bisa menutup shift), tapi
    // WAJIB diberi keterangan — atas permintaan pemilik cafe, ini jadi
    // dasar tuntutan ganti rugi bila kekurangan (lihat tanggungan_kasir
    // di bawah).
    if (selisihKas !== 0 && !keteranganSelisih.trim()) {
      showToast("error", "Ada selisih kas — wajib isi keterangan sebelum menutup shift.");
      return;
    }

    setSedangTutup(true);
    try {
      await updateDoc(doc(db, "outlets", outletId, "shift", shiftId), {
        totalOmset,
        omsetTunai,
        omsetNonTunai,
        totalKasKeluar,
        kasSeharusnya,
        kasFisik,
        selisihKas,
        keteranganSelisih: keteranganSelisih.trim(),
        // "terkunci", bukan "tutup": firestore.rules menolak update dari
        // Kasir pada shift berstatus 'terkunci', jadi shift yang sudah
        // ditutup benar-benar tidak bisa diubah/ditutup ulang oleh Kasir
        // (kalau bisa, summary_harian akan terhitung dobel). Owner tetap
        // bisa mengoreksi lewat backend sebagai admin override.
        status: "terkunci",
        waktuTutup: serverTimestamp(),
      });

      // Pola "tulis tanpa baca" (lihat firestore.rules bagian
      // summary_harian) — Kasir boleh menulis increment tanpa perlu
      // izin baca dokumen ringkasan. HPP/laba SENGAJA tidak
      // diikutsertakan di sini — dihitung otomatis di sisi Owner
      // (lihat src/shared/lib/laba-harian.ts & Dashboard).
      const tanggal = tanggalHariIni();
      await setDoc(
        doc(db, "outlets", outletId, "summary_harian", tanggal),
        {
          totalOmset: increment(totalOmset),
          omsetTunai: increment(omsetTunai),
          omsetNonTunai: increment(omsetNonTunai),
          totalKasKeluar: increment(totalKasKeluar),
          selisihKas: increment(selisihKas),
          jumlahShift: increment(1),
        },
        { merge: true },
      );

      // Selisih Kas negatif (kekurangan) -> catat sebagai tanggungan
      // Kasir, supaya Owner/Finance punya jejak untuk tuntutan ganti
      // rugi (di luar aplikasi). Owner menandai lunas dari Riwayat.
      if (selisihKas < 0) {
        await addDoc(collection(db, "outlets", outletId, "tanggungan_kasir"), {
          shiftId,
          tanggal,
          kasirUid: user.uid,
          kasirNama: profil.nama,
          nominal: Math.abs(selisihKas),
          keterangan: keteranganSelisih.trim(),
          status: "belum_lunas",
          waktu: serverTimestamp(),
        });
      }

      // Shift sudah tersimpan — draf hitungan kasnya tidak diperlukan lagi.
      if (user) hapusDraf(user.uid, kunciDraf);
      showToast("success", "Shift ditutup dan terkunci. Terima kasih!");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menutup shift: ${error.message}` : "Gagal menutup shift.",
      );
    } finally {
      setSedangTutup(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-tutup"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="bagian-tutup" className="text-base font-semibold text-slate-900">
        Tutup Shift Hari Ini
      </h2>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
        <p className="text-slate-600">Omset Tunai / Non-Tunai (otomatis dari Input Penjualan)</p>
        <p className="mt-0.5 font-medium tabular-nums text-slate-900">
          {formatRupiah(omsetTunai)} · {formatRupiah(omsetNonTunai)}
        </p>
      </div>

      <div className="mt-4">
        <NumberField
          id="kas-fisik"
          label="Kas Fisik Dihitung"
          value={kasFisik}
          onChange={setKasFisik}
          prefix="Rp"
          hint="Hitung uang TUNAI di laci saat ini, lalu masukkan di sini."
        />
      </div>

      <dl className="mt-4 divide-y divide-slate-100 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between py-1">
          <dt className="text-slate-600">Modal Kas Awal (flat, tidak diinput manual)</dt>
          <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(modalKasAwal)}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-slate-600">Kas Seharusnya</dt>
          <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(kasSeharusnya)}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-slate-600">Selisih Kas</dt>
          <dd
            className={`font-semibold tabular-nums ${selisihKas === 0 ? "text-emerald-700" : "text-amber-700"}`}
          >
            {formatRupiah(selisihKas)}
          </dd>
        </div>
      </dl>

      {selisihKas !== 0 ? (
        <div
          role="alert"
          className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Ada selisih kas. Periksa kembali sebelum menutup shift bila memungkinkan.
              {selisihKas < 0
                ? " Kekurangan ini akan tercatat sebagai tanggungan yang perlu diganti."
                : ""}
            </p>
          </div>
          <div>
            <label htmlFor="keterangan-selisih" className="block text-xs font-semibold text-amber-900">
              Keterangan Selisih (wajib)
            </label>
            <input
              id="keterangan-selisih"
              type="text"
              value={keteranganSelisih}
              onChange={(event) => setKeteranganSelisih(event.target.value)}
              placeholder="misalnya: kembalian kurang teliti, uang jatuh, dll."
              className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
            />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleTutupShift}
        disabled={sedangTutup}
        aria-busy={sedangTutup}
        className={[
          "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm",
          "motion-safe:transition motion-safe:duration-150",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
          sedangTutup
            ? "cursor-not-allowed bg-emerald-400"
            : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
        ].join(" ")}
      >
        {sedangTutup ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="h-4 w-4" aria-hidden="true" />
        )}
        {sedangTutup ? "Menutup Shift..." : "Tutup & Kunci Shift"}
      </button>
    </section>
  );
}

// ============================================================
// Slip Cash Opname Kasir — "Kasir Lapor Sendiri", MANDIRI per shift
// (permintaan pemilik cafe: "Slip Cash Opname Konsepnya Mandiri").
// Ditampilkan begitu shift ditutup (baik ditutup Kasir sendiri, atau
// Tutup Paksa oleh Owner/Finance dari Riwayat — datanya sama-sama
// sudah tersimpan lengkap di dokumen shift). Kasir bisa mengunduh
// Excel/PDF-nya sebagai bukti serah terima (oper shift) ke rekan
// shift berikutnya, ATAU sebagai laporan final kalau ini shift
// terakhir hari itu sebelum outlet tutup.
//
// SENGAJA membaca ULANG dari Firestore (bukan menerima props dari
// TutupShiftKartu) — supaya slip ini tetap muncul & akurat walau
// halaman dimuat ulang setelah shift ditutup, tidak hilang begitu
// state lokal TutupShiftKartu ter-unmount saat status berubah jadi
// "terkunci".
//
// Petty Cash Rp500.000 SELALU flat per shift (tidak diwariskan) —
// itulah sebabnya kalau ada selisih minus, gampang dilacak persis di
// shift/kasir mana kejadiannya (nama & tanggal tertera jelas di slip
// ini), tanpa tercampur dengan shift lain.
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

interface DataSlipShift {
  tanggal: string;
  kasirNama: string;
  modalKasAwal: number;
  omsetTunai: number;
  omsetNonTunai: number;
  totalKasKeluar: number;
  kasSeharusnya: number;
  kasFisik: number;
  selisihKas: number;
  keteranganSelisih: string;
}

function SlipCashOpnameKasir({ shiftId }: { shiftId: string }) {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const { detail: perusahaan } = useDetailPerusahaan();
  const [data, setData] = useState<DataSlipShift | null>(null);
  const [kasKeluarBaris, setKasKeluarBaris] = useState<{ kategori: string; nominal: number; keterangan: string }[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [sedangEkspor, setSedangEkspor] = useState<"excel" | "pdf" | null>(null);

  useEffect(() => {
    let dibatalkan = false;
    async function muat() {
      setMemuat(true);
      const [shiftDoc, kasKeluarSnap] = await Promise.all([
        getDoc(doc(db, "outlets", outletId, "shift", shiftId)),
        getDocs(collection(db, "outlets", outletId, "shift", shiftId, "kas_keluar")),
      ]);
      if (dibatalkan) return;
      if (shiftDoc.exists()) {
        const d = shiftDoc.data();
        setData({
          tanggal: d.tanggal ?? "",
          kasirNama: d.kasirNama ?? "",
          modalKasAwal: d.modalKasAwal ?? 0,
          omsetTunai: d.omsetTunai ?? 0,
          omsetNonTunai: d.omsetNonTunai ?? 0,
          totalKasKeluar: d.totalKasKeluar ?? 0,
          kasSeharusnya: d.kasSeharusnya ?? 0,
          kasFisik: d.kasFisik ?? 0,
          selisihKas: d.selisihKas ?? 0,
          keteranganSelisih: d.keteranganSelisih ?? "",
        });
      }
      setKasKeluarBaris(
        kasKeluarSnap.docs.map((d) => ({
          kategori: d.data().kategori ?? "Lainnya",
          nominal: d.data().nominal ?? 0,
          keterangan: d.data().keterangan ?? "",
        })),
      );
      setMemuat(false);
    }
    muat().catch(() => setMemuat(false));
    return () => {
      dibatalkan = true;
    };
  }, [outletId, shiftId]);

  async function handleEkspor(jenis: "excel" | "pdf") {
    if (!data) return;
    setSedangEkspor(jenis);
    try {
      const opsi: OpsiLaporan<{ kategori: string; nominal: number; keterangan: string }> = {
        judul: "SLIP CASH OPNAME SHIFT",
        periode: formatTanggalPanjangId(data.tanggal),
        perusahaan,
        namaBerkas: `Cash-Opname-Shift_${data.tanggal}_${data.kasirNama}`,
        kolom: [
          { judul: "Kategori Kas Keluar", ambil: (b) => b.kategori, lebar: 20 },
          { judul: "Nominal", ambil: (b) => b.nominal, angka: true, lebar: 14 },
          { judul: "Keterangan", ambil: (b) => b.keterangan || "—", lebar: 24 },
        ],
        baris: kasKeluarBaris,
        ringkasan: [
          { label: "Kasir", nilai: data.kasirNama },
          { label: "Modal Kas Awal (Petty Cash)", nilai: formatRupiah(data.modalKasAwal) },
          { label: "Omset Tunai", nilai: formatRupiah(data.omsetTunai) },
          { label: "Omset Non-Tunai", nilai: formatRupiah(data.omsetNonTunai) },
          { label: "Total Kas Keluar", nilai: formatRupiah(data.totalKasKeluar) },
          { label: "Kas Seharusnya", nilai: formatRupiah(data.kasSeharusnya) },
          { label: "Kas Fisik", nilai: formatRupiah(data.kasFisik) },
          { label: "Selisih Kas", nilai: formatRupiah(data.selisihKas) },
          { label: "Keterangan Selisih", nilai: data.keteranganSelisih || "—" },
          {
            label: "Shift Berikutnya",
            nilai: "Mulai dari Saldo Petty Cash Rp500.000 lagi (tidak diwariskan dari shift ini)",
          },
        ],
      };
      if (jenis === "excel") await eksporExcel(opsi);
      else await eksporPdf(opsi);
      showToast("success", `Slip ${jenis === "excel" ? "Excel" : "PDF"} berhasil diunduh.`);
    } catch (error) {
      showToast("error", error instanceof Error ? `Gagal mengekspor: ${error.message}` : "Gagal mengekspor.");
    } finally {
      setSedangEkspor(null);
    }
  }

  if (memuat) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <Download className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Slip Cash Opname Shift Ini
      </h2>
      <dl className="mt-3 divide-y divide-slate-100 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between py-1">
          <dt className="text-slate-600">Modal Kas Awal (Petty Cash)</dt>
          <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(data.modalKasAwal)}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-slate-600">Omset Tunai</dt>
          <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(data.omsetTunai)}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-slate-600">Total Kas Keluar</dt>
          <dd className="font-medium tabular-nums text-slate-900">− {formatRupiah(data.totalKasKeluar)}</dd>
        </div>
        <div className="flex justify-between py-1.5">
          <dt className="font-semibold text-slate-800">Kas Seharusnya</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{formatRupiah(data.kasSeharusnya)}</dd>
        </div>
        <div className="flex justify-between py-1 pt-2">
          <dt className="text-slate-600">Kas Fisik</dt>
          <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(data.kasFisik)}</dd>
        </div>
      </dl>
      <div
        className={`mt-3 rounded-lg p-3 text-center ${
          data.selisihKas === 0 ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
        }`}
      >
        <p className="text-xs font-medium uppercase tracking-wide">Selisih Kas</p>
        <p className="text-lg font-bold tabular-nums">{formatRupiah(data.selisihKas)}</p>
        {data.keteranganSelisih ? <p className="mt-1 text-xs">{data.keteranganSelisih}</p> : null}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => handleEkspor("excel")}
          disabled={sedangEkspor !== null}
          aria-busy={sedangEkspor === "excel"}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-emerald-400"
        >
          {sedangEkspor === "excel" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}
          {sedangEkspor === "excel" ? "Menyiapkan..." : "Ekspor Excel"}
        </button>
        <button
          type="button"
          onClick={() => handleEkspor("pdf")}
          disabled={sedangEkspor !== null}
          aria-busy={sedangEkspor === "pdf"}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sedangEkspor === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
          {sedangEkspor === "pdf" ? "Menyiapkan..." : "Ekspor PDF (A4)"}
        </button>
      </div>
    </section>
  );
}
