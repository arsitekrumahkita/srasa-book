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
  Gift,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Save,
  TriangleAlert,
} from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { AppShell } from "@/shared/components/app-shell";
import { NumberField } from "@/shared/components/number-field";
import { useAuth } from "@/shared/lib/auth-context";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { ambilResepMenu, terapkanPerubahanStok } from "@/shared/lib/resep";
import { ambilDrafAsync, hapusDraf, useDrafOtomatis } from "@/shared/lib/draf";
import type { ResepItem } from "@/shared/types/inventaris";

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
  const { showToast } = useToast();

  const [memuatShiftAktif, setMemuatShiftAktif] = useState(true);
  const [shiftAktif, setShiftAktif] = useState<ShiftAktif | null>(null);
  const [gagalMenyiapkan, setGagalMenyiapkan] = useState(false);
  // Mencegah shift baru dibuat dua kali (mis. React re-render atau
  // listener sempat menembak ulang) selagi penulisan pertama masih
  // berjalan — lihat efek auto-provisioning di bawah.
  const sedangMenyiapkanRef = useRef(false);

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
      collection(db, "shift"),
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
          });
        }
        setMemuatShiftAktif(false);
      },
      () => setMemuatShiftAktif(false),
    );
    return unsub;
  }, [user]);

  // --- Auto-provisioning: TIDAK ADA lagi tombol "Buka Shift". Begitu
  // dipastikan belum ada shift hari ini, langsung buat sendiri dengan
  // modal flat, tanpa keterlibatan Kasir sama sekali. ---
  useEffect(() => {
    if (memuatShiftAktif || shiftAktif || !user || !profil) return;
    if (sedangMenyiapkanRef.current) return;
    sedangMenyiapkanRef.current = true;

    addDoc(collection(db, "shift"), {
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
  }, [memuatShiftAktif, shiftAktif, user, profil, showToast]);

  if (memuatShiftAktif || (!shiftAktif && !gagalMenyiapkan)) {
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
  // dan bisa mulai lagi besok karena tanggalnya sudah berganti.
  if (shiftAktif.status !== "buka") {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16 text-center">
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-6 shadow-sm">
          <p className="text-base font-semibold text-emerald-900">
            Shift hari ini sudah ditutup
          </p>
          <p className="mt-2 text-sm text-emerald-800">
            Terima kasih. Shift baru akan tersedia otomatis besok dengan
            modal kas Rp500.000 lagi. Kalau ada yang perlu dikoreksi hari
            ini, hubungi Owner.
          </p>
        </div>
      </main>
    );
  }

  return <ShiftBerjalan shiftId={shiftAktif.id} modalKasAwal={shiftAktif.modalKasAwal} />;
}

function ShiftBerjalan({ shiftId, modalKasAwal }: { shiftId: string; modalKasAwal: number }) {
  const { showToast } = useToast();
  const [menuList, setMenuList] = useState<MenuHarga[]>([]);
  const [penjualan, setPenjualan] = useState<PenjualanItem[]>([]);
  const [kasKeluar, setKasKeluar] = useState<KasKeluarItem[]>([]);
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
      query(collection(db, "menu_harga"), where("aktif", "==", true)),
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
              return [m.id, await ambilResepMenu(m.id)] as [string, ResepItem[]];
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
      query(collection(db, "shift", shiftId, "penjualan"), orderBy("menuNama")),
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
          })),
        );
      },
    );

    const unsubKasKeluar = onSnapshot(
      collection(db, "shift", shiftId, "kas_keluar"),
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

    return () => {
      unsubMenu();
      unsubPenjualan();
      unsubKasKeluar();
    };
  }, [shiftId]);

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
        await setDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
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
            await updateDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
              qtyTunai: 0,
              subtotalTunai: 0,
              qty: increment(-qtyBucketLama),
              subtotal: increment(-qtyBucketLama * item.hargaJual),
            });
          } else {
            await updateDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
              qtyNonTunai: 0,
              subtotalNonTunai: 0,
              qty: increment(-qtyBucketLama),
              subtotal: increment(-qtyBucketLama * item.hargaJual),
            });
          }
        } else if (metode === "tunai") {
          await updateDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
            qtyTunai: increment(delta),
            subtotalTunai: increment(perubahanSubtotal),
            qty: increment(delta),
            subtotal: increment(perubahanSubtotal),
          });
        } else {
          await updateDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
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
        terapkanPerubahanStok(resep, delta).catch(() => {
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
        await setDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
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
          await updateDoc(doc(db, "shift", shiftId, "penjualan", item.id), { qtyBonus: 0 });
        } else {
          await updateDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
            qtyBonus: increment(delta),
          });
        }
      }

      // Bahan baku tetap berkurang persis seperti penjualan reguler —
      // produk Bonus/Gratis SUNGGUH dibuat & diberikan ke pembeli.
      const resep = resepPerMenu.get(item.id);
      if (resep && resep.length > 0) {
        terapkanPerubahanStok(resep, delta).catch(() => {
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
          await updateDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
            qtyNonTunai: increment(-1),
            subtotalNonTunai: increment(-existing.hargaJualSnapshot),
            qtyRefundNonTunai: increment(1),
            qty: increment(-1),
            qtyRefund: increment(1),
            subtotal: increment(-existing.hargaJualSnapshot),
          });
        } else {
          await updateDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
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
          await updateDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
            qtyNonTunai: increment(1),
            subtotalNonTunai: increment(existing.hargaJualSnapshot),
            qtyRefundNonTunai: increment(-1),
            qty: increment(1),
            qtyRefund: increment(-1),
            subtotal: increment(existing.hargaJualSnapshot),
          });
        } else {
          await updateDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
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
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            SRASA BOOK
          </p>
          <h1 className="text-2xl font-bold text-slate-900">Shift Berjalan</h1>
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
            <div className="mt-4 flex flex-col gap-5">
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

function KasKeluarKartu({
  shiftId,
  daftar,
  total,
}: {
  shiftId: string;
  daftar: KasKeluarItem[];
  total: number;
}) {
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
      await addDoc(collection(db, "shift", shiftId, "kas_keluar"), {
        kategori,
        nominal,
        keterangan: keterangan.trim(),
        waktu: serverTimestamp(),
      });
      await updateDoc(doc(db, "shift", shiftId), { totalKasKeluar: increment(nominal) });
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
      await updateDoc(doc(db, "shift", shiftId), {
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
        doc(db, "summary_harian", tanggal),
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
        await addDoc(collection(db, "tanggungan_kasir"), {
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
