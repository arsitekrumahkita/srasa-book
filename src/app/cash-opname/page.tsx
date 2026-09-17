"use client";

// ============================================================
// Halaman: Cash Opname Akhir Hari (permintaan pemilik cafe: checkpoint
// laporan setiap dana berpindah/oper shift & setor ke Finance). Peran:
// Owner & Finance (isManagerOutlet) — merangkum SEMUA shift Kasir,
// belanja Purchasing, dan aliran Saldo Finance pada SATU tanggal
// outlet ini, supaya sebelum uang disetor/dipindah ada satu laporan
// yang membuktikan semuanya balance (atau kalau tidak, kelihatan jelas
// di mana selisihnya dan kenapa).
//
// BEDA dengan Cash Opname per-shift (lihat Riwayat -> tombol Cetak
// Slip Cash Opname per shift, kalau nanti dibuat): itu level SATU
// shift/SATU kasir; halaman ini level SATU OUTLET/SATU HARI,
// menggabungkan semua shift + Purchasing + Finance hari itu.
//
// Formula (dikonfirmasi Owner):
//   - Petty Cash Rp500.000/shift TETAP tinggal di laci sebagai modal
//     shift besok -> DIKELUARKAN dari uang yang harus disetor.
//   - Kas Tunai Seharusnya Disetor = Omset Tunai - Total Kas Keluar
//     (semua shift terkunci) - Total Belanja Purchasing (sumber Kas
//     Resto SAJA -- yang sumber Saldo Finance sudah otomatis kepotong
//     dari Finance saat Purchasing mulai belanja, BUKAN dari kas
//     tunai outlet, jadi tidak dihitung ulang di sini supaya tidak
//     dobel potong).
//   - Kas Tunai Fisik Untuk Disetor = Total kasFisik semua shift
//     terkunci - (Rp500.000 x jumlah shift).
//   - Selisih Setoran = Kas Tunai Fisik Untuk Disetor - Kas Tunai
//     Seharusnya Disetor (harus 0 kalau semua shift & belanja sudah
//     benar; kalau tidak 0, itu jejak insiden/kesalahan yang belum
//     tertangkap di Tanggungan Kasir per shift -- Owner/Finance bisa
//     cek Form Banding Purchasing atau tanya langsung).
//   - Non-Tunai (QRIS dst) murni informasional -- tidak ada fisik
//     untuk dicocokkan di sini, provider pembayaran yang settle ke
//     rekening secara terpisah.
//
// Top-level components, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileText, Loader2, XCircle } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { useOutletId } from "@/shared/lib/outlet-context";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { useDetailPerusahaan } from "@/shared/lib/perusahaan";
import { eksporExcel, eksporPdf, type OpsiLaporan, type TabelTambahan } from "@/shared/lib/ekspor";
import { rentangPeriodeLaporan, formatTanggalPanjangId, type PeriodeLaporan } from "@/shared/lib/periode-laporan";
import { PeriodePicker } from "@/shared/components/periode-picker";
import { ambilResepMenu } from "@/shared/lib/resep";

/** Sinkron dengan MODAL_KAS_AWAL_HARIAN di src/app/shift/page.tsx —
 *  petty cash flat per shift, atas persetujuan Owner TETAP tinggal di
 *  laci (tidak ikut disetor). */
const MODAL_KAS_AWAL_HARIAN = 500000;
const ID_SALDO_FINANCE = "utama";

function tanggalHariIni(): string {
  const sekarang = new Date();
  return `${sekarang.getFullYear()}-${String(sekarang.getMonth() + 1).padStart(2, "0")}-${String(
    sekarang.getDate(),
  ).padStart(2, "0")}`;
}

interface ShiftHari {
  id: string;
  kasirNama: string;
  status: "buka" | "tutup" | "terkunci";
  omsetTunai: number;
  omsetNonTunai: number;
  totalKasKeluar: number;
  kasFisik: number;
  selisihKas: number;
}

interface KasKeluarBaris {
  kategori: string;
  jumlahEntri: number;
  total: number;
}

interface BelanjaHari {
  id: string;
  purchasingNama: string;
  sumberDana: "kas_resto" | "saldo_finance";
  totalBelanja: number;
  status: string;
}

interface TanggunganHari {
  id: string;
  kasirNama: string;
  nominal: number;
  keterangan: string;
  status: "belum_lunas" | "lunas";
}

type JenisBanding = "revisi_nota" | "transaksi_belum_tercatat" | "insiden_lainnya";

interface BandingPurchasing {
  id: string;
  tanggal: string;
  purchasingNama: string;
  jenis: JenisBanding;
  nominal: number;
  keterangan: string;
}

interface BahanMenipis {
  id: string;
  nama: string;
  stokSaatIni: number;
  satuan: string;
  batasMinimalStok: number;
}

/** Satu baris Rincian Pemakaian Bahan — dihitung OTOMATIS dari
 *  penjualan hari itu (lihat komentar panjang di dekat pemuatan
 *  data), BUKAN diinput manual. */
interface PemakaianBahan {
  bahanId: string;
  bahanNama: string;
  satuan: string;
  totalTakaran: number;
}

const LABEL_JENIS_BANDING: Record<JenisBanding, string> = {
  revisi_nota: "Revisi Nota",
  transaksi_belum_tercatat: "Transaksi Belum Tercatat",
  insiden_lainnya: "Insiden Lainnya",
};

export default function CashOpnamePage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]}>
      <AppShell>
        <CashOpnameIsi />
      </AppShell>
    </RequireAuth>
  );
}

function CashOpnameIsi() {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const { detail: perusahaan } = useDetailPerusahaan();
  const [tanggal, setTanggal] = useState(tanggalHariIni());
  const [memuat, setMemuat] = useState(true);
  const [sedangEkspor, setSedangEkspor] = useState<"excel" | "pdf" | null>(null);
  const [sedangUbahBanding, setSedangUbahBanding] = useState<string | null>(null);

  const [shiftHari, setShiftHari] = useState<ShiftHari[]>([]);
  const [kasKeluarBaris, setKasKeluarBaris] = useState<KasKeluarBaris[]>([]);
  const [belanjaHari, setBelanjaHari] = useState<BelanjaHari[]>([]);
  const [tanggunganHari, setTanggunganHari] = useState<TanggunganHari[]>([]);
  const [bandingMenunggu, setBandingMenunggu] = useState<BandingPurchasing[]>([]);
  const [bahanMenipis, setBahanMenipis] = useState<BahanMenipis[]>([]);
  const [saldoFinanceSaatIni, setSaldoFinanceSaatIni] = useState(0);
  const [transaksiFinanceMasuk, setTransaksiFinanceMasuk] = useState(0);
  const [transaksiFinanceKeluar, setTransaksiFinanceKeluar] = useState(0);
  const [pemakaianBahan, setPemakaianBahan] = useState<PemakaianBahan[]>([]);

  useEffect(() => {
    let dibatalkan = false;
    async function muat() {
      setMemuat(true);
      const [shiftSnap, belanjaSnap, tanggunganSnap, bandingSnap, bahanSnap, saldoSnap, tfSnap] = await Promise.all([
        getDocs(query(collection(db, "outlets", outletId, "shift"), where("tanggal", "==", tanggal))),
        getDocs(query(collection(db, "outlets", outletId, "kas_belanja"), where("tanggal", "==", tanggal))),
        getDocs(query(collection(db, "outlets", outletId, "tanggungan_kasir"), where("tanggal", "==", tanggal))),
        getDocs(query(collection(db, "outlets", outletId, "banding_purchasing"), where("status", "==", "menunggu"))),
        getDocs(collection(db, "outlets", outletId, "bahan_baku")),
        getDoc(doc(db, "outlets", outletId, "saldo_finance", ID_SALDO_FINANCE)),
        getDocs(query(collection(db, "outlets", outletId, "transaksi_finance"), where("tanggal", "==", tanggal))),
      ]);
      if (dibatalkan) return;

      const daftarShift: ShiftHari[] = shiftSnap.docs.map((d) => ({
        id: d.id,
        kasirNama: d.data().kasirNama ?? "",
        status: (d.data().status ?? "buka") as ShiftHari["status"],
        omsetTunai: d.data().omsetTunai ?? 0,
        omsetNonTunai: d.data().omsetNonTunai ?? 0,
        totalKasKeluar: d.data().totalKasKeluar ?? 0,
        kasFisik: d.data().kasFisik ?? 0,
        selisihKas: d.data().selisihKas ?? 0,
      }));
      setShiftHari(daftarShift);

      // Kas Keluar semua shift TERKUNCI hari ini, dirangkum per
      // kategori — subcollection per shift, jadi dibaca satu-satu
      // (tetap konsisten dengan pola akses per-Outlet lain di app ini,
      // tidak pakai collectionGroup).
      const shiftTerkunci = daftarShift.filter((s) => s.status === "terkunci");
      const kasKeluarSnaps = await Promise.all(
        shiftTerkunci.map((s) => getDocs(collection(db, "outlets", outletId, "shift", s.id, "kas_keluar"))),
      );
      if (dibatalkan) return;
      const kategoriMap = new Map<string, { jumlahEntri: number; total: number }>();
      for (const snap of kasKeluarSnaps) {
        for (const d of snap.docs) {
          const kategori = d.data().kategori ?? "Lainnya";
          const nominal = d.data().nominal ?? 0;
          const existing = kategoriMap.get(kategori) ?? { jumlahEntri: 0, total: 0 };
          existing.jumlahEntri += 1;
          existing.total += nominal;
          kategoriMap.set(kategori, existing);
        }
      }
      setKasKeluarBaris(Array.from(kategoriMap.entries()).map(([kategori, v]) => ({ kategori, ...v })));

      // Rincian Pemakaian Bahan — dihitung OTOMATIS dari penjualan hari
      // itu (permintaan pemilik cafe), BUKAN input manual. Untuk setiap
      // baris penjualan (semua shift TERKUNCI hari ini):
      //   unit yang MEMAKAI bahan = qty + qtyBonus + qtyRefund. Ketiganya
      //   ikut dihitung karena SEMUA sudah memotong stok bahan saat
      //   pertama kali dijual (lihat ubahQtyReguler/ubahQtyBonus di
      //   src/app/shift/page.tsx) — qtyRefund TIDAK mengembalikan bahan
      //   ke stok (produknya sudah terlanjur dibuat), jadi harus tetap
      //   dihitung terpakai di sini, bukan cuma omset (qty) saja.
      //   - Item REGULER (menuId): dikalikan takaran dari resep menu
      //     tersebut (Kalkulator HPP) — bahan MAUPUN kemasan (cup,
      //     sedotan, dst ikut resep sebagai jenis "kemasan").
      //   - Item MANUAL ("Item Lain" dari Kasir): pakai bahanDipakai yang
      //     sudah tersimpan di dokumen penjualannya sendiri (bukan resep
      //     menu, karena item ini tidak terdaftar di Kelola Produk).
      const penjualanSnaps = await Promise.all(
        shiftTerkunci.map((s) => getDocs(collection(db, "outlets", outletId, "shift", s.id, "penjualan"))),
      );
      if (dibatalkan) return;
      const pemakaianMap = new Map<string, PemakaianBahan>();
      const menuIdPerlu = new Set<string>();
      type BarisPenjualanUntukBahan = { menuId: string; unit: number };
      const barisMenu: BarisPenjualanUntukBahan[] = [];
      for (const snap of penjualanSnaps) {
        for (const d of snap.docs) {
          const data = d.data();
          const unit = (data.qty ?? 0) + (data.qtyBonus ?? 0) + (data.qtyRefund ?? 0);
          if (unit <= 0) continue;
          if (data.manual && Array.isArray(data.bahanDipakai)) {
            for (const b of data.bahanDipakai as { bahanId: string; bahanNama: string; takaran: number; satuan: string }[]) {
              if (!b.bahanId || !(b.takaran > 0)) continue;
              const existing = pemakaianMap.get(b.bahanId) ?? {
                bahanId: b.bahanId,
                bahanNama: b.bahanNama,
                satuan: b.satuan,
                totalTakaran: 0,
              };
              existing.totalTakaran += b.takaran * unit;
              pemakaianMap.set(b.bahanId, existing);
            }
          } else if (data.menuId) {
            menuIdPerlu.add(data.menuId);
            barisMenu.push({ menuId: data.menuId, unit });
          }
        }
      }
      const resepPerMenu = new Map<string, Awaited<ReturnType<typeof ambilResepMenu>>>();
      await Promise.all(
        Array.from(menuIdPerlu).map(async (menuId) => {
          resepPerMenu.set(menuId, await ambilResepMenu(outletId, menuId));
        }),
      );
      if (dibatalkan) return;
      for (const { menuId, unit } of barisMenu) {
        for (const r of resepPerMenu.get(menuId) ?? []) {
          if (!r.bahanId || r.takaran <= 0) continue;
          const existing = pemakaianMap.get(r.bahanId) ?? {
            bahanId: r.bahanId,
            bahanNama: r.bahanNama,
            satuan: r.satuan,
            totalTakaran: 0,
          };
          existing.totalTakaran += r.takaran * unit;
          pemakaianMap.set(r.bahanId, existing);
        }
      }
      setPemakaianBahan(
        Array.from(pemakaianMap.values()).sort((a, b) => b.totalTakaran - a.totalTakaran),
      );

      setBelanjaHari(
        belanjaSnap.docs.map((d) => ({
          id: d.id,
          purchasingNama: d.data().purchasingNama ?? "",
          sumberDana: (d.data().sumberDana ?? "kas_resto") as BelanjaHari["sumberDana"],
          totalBelanja: d.data().totalBelanja ?? 0,
          status: d.data().status ?? "terbuka",
        })),
      );
      setTanggunganHari(
        tanggunganSnap.docs.map((d) => ({
          id: d.id,
          kasirNama: d.data().kasirNama ?? "",
          nominal: d.data().nominal ?? 0,
          keterangan: d.data().keterangan ?? "",
          status: (d.data().status ?? "belum_lunas") as TanggunganHari["status"],
        })),
      );
      setBandingMenunggu(
        bandingSnap.docs.map((d) => ({
          id: d.id,
          tanggal: d.data().tanggal ?? "",
          purchasingNama: d.data().purchasingNama ?? "",
          jenis: (d.data().jenis ?? "insiden_lainnya") as JenisBanding,
          nominal: d.data().nominal ?? 0,
          keterangan: d.data().keterangan ?? "",
        })),
      );
      setBahanMenipis(
        bahanSnap.docs
          .map((d) => ({
            id: d.id,
            nama: d.data().nama ?? "",
            stokSaatIni: d.data().stokSaatIni ?? 0,
            satuan: d.data().satuan ?? "pcs",
            batasMinimalStok: d.data().batasMinimalStok ?? 0,
          }))
          .filter((b) => b.stokSaatIni < 0 || (b.batasMinimalStok > 0 && b.stokSaatIni <= b.batasMinimalStok)),
      );
      setSaldoFinanceSaatIni(saldoSnap.exists() ? (saldoSnap.data().saldo ?? 0) : 0);
      let masuk = 0;
      let keluar = 0;
      for (const d of tfSnap.docs) {
        if ((d.data().arah ?? "keluar") === "masuk") masuk += d.data().nominal ?? 0;
        else keluar += d.data().nominal ?? 0;
      }
      setTransaksiFinanceMasuk(masuk);
      setTransaksiFinanceKeluar(keluar);
      setMemuat(false);
    }
    muat().catch(() => setMemuat(false));
    return () => {
      dibatalkan = true;
    };
  }, [outletId, tanggal]);

  async function tinjauBanding(id: string, disetujui: boolean) {
    setSedangUbahBanding(id);
    try {
      await updateDoc(doc(db, "outlets", outletId, "banding_purchasing", id), {
        status: disetujui ? "disetujui" : "ditolak",
      });
      showToast("success", `Banding ${disetujui ? "disetujui" : "ditolak"}.`);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal meninjau banding: ${error.message}` : "Gagal meninjau banding.",
      );
    } finally {
      setSedangUbahBanding(null);
    }
  }

  const shiftTerkunci = shiftHari.filter((s) => s.status === "terkunci");
  const shiftBelumTutup = shiftHari.filter((s) => s.status !== "terkunci");
  const jumlahShift = shiftTerkunci.length;
  const omsetTunai = shiftTerkunci.reduce((t, s) => t + s.omsetTunai, 0);
  const omsetNonTunai = shiftTerkunci.reduce((t, s) => t + s.omsetNonTunai, 0);
  const totalKasKeluarShift = shiftTerkunci.reduce((t, s) => t + s.totalKasKeluar, 0);
  const totalKasFisik = shiftTerkunci.reduce((t, s) => t + s.kasFisik, 0);
  const pettyCashTotal = MODAL_KAS_AWAL_HARIAN * jumlahShift;
  const totalBelanjaKasResto = belanjaHari
    .filter((b) => b.sumberDana === "kas_resto")
    .reduce((t, b) => t + b.totalBelanja, 0);
  const totalBelanjaSaldoFinance = belanjaHari
    .filter((b) => b.sumberDana === "saldo_finance")
    .reduce((t, b) => t + b.totalBelanja, 0);
  const kasTunaiSeharusnyaDisetor = omsetTunai - totalKasKeluarShift - totalBelanjaKasResto;
  const kasTunaiUntukDisetor = totalKasFisik - pettyCashTotal;
  const selisihSetoran = kasTunaiUntukDisetor - kasTunaiSeharusnyaDisetor;

  function susunOpsi(): OpsiLaporan<KasKeluarBaris> {
    return {
      judul: "CASH OPNAME AKHIR HARI",
      periode: formatTanggalPanjangId(tanggal),
      perusahaan,
      namaBerkas: `Cash-Opname_${tanggal}`,
      kolom: [
        { judul: "Kategori Kas Keluar", ambil: (b) => b.kategori, lebar: 22 },
        { judul: "Jumlah Entri", ambil: (b) => b.jumlahEntri, angka: true, lebar: 14 },
        { judul: "Total", ambil: (b) => b.total, angka: true, lebar: 16 },
      ],
      baris: kasKeluarBaris,
      tabelTambahan: [
        {
          judul: "Rincian Pemakaian Bahan (Otomatis dari Penjualan)",
          kolom: [
            { judul: "Bahan", ambil: (b) => (b as PemakaianBahan).bahanNama, lebar: 24 },
            { judul: "Terpakai", ambil: (b) => (b as PemakaianBahan).totalTakaran, angka: true, lebar: 14 },
            { judul: "Satuan", ambil: (b) => (b as PemakaianBahan).satuan, lebar: 10 },
          ],
          baris: pemakaianBahan,
        } satisfies TabelTambahan,
      ],
      ringkasan: [
        { label: "Jumlah Shift Ditutup", nilai: String(jumlahShift) },
        { label: "Petty Cash (tinggal di laci)", nilai: `${formatRupiah(pettyCashTotal)} (${jumlahShift} x ${formatRupiah(MODAL_KAS_AWAL_HARIAN)})` },
        { label: "— TUNAI —", nilai: "" },
        { label: "Omset Tunai", nilai: formatRupiah(omsetTunai) },
        { label: "Total Kas Keluar (semua shift)", nilai: formatRupiah(totalKasKeluarShift) },
        { label: "Belanja Purchasing (sumber Kas Resto)", nilai: formatRupiah(totalBelanjaKasResto) },
        { label: "Kas Tunai Seharusnya Disetor", nilai: formatRupiah(kasTunaiSeharusnyaDisetor) },
        { label: "Total Kas Fisik (semua shift)", nilai: formatRupiah(totalKasFisik) },
        { label: "Kas Tunai Untuk Disetor (fisik - petty cash)", nilai: formatRupiah(kasTunaiUntukDisetor) },
        { label: "SELISIH SETORAN", nilai: formatRupiah(selisihSetoran) },
        { label: "— NON-TUNAI (QRIS dll, informasional) —", nilai: "" },
        { label: "Omset Non-Tunai", nilai: formatRupiah(omsetNonTunai) },
        { label: "— BELANJA PURCHASING —", nilai: "" },
        { label: "Belanja sumber Saldo Finance", nilai: formatRupiah(totalBelanjaSaldoFinance) },
        { label: "Belanja sumber Kas Resto", nilai: formatRupiah(totalBelanjaKasResto) },
        { label: "— SALDO FINANCE —", nilai: "" },
        { label: "Saldo Finance Saat Ini", nilai: formatRupiah(saldoFinanceSaatIni) },
        { label: "Uang Masuk Saldo Finance Hari Ini", nilai: formatRupiah(transaksiFinanceMasuk) },
        { label: "Uang Keluar Saldo Finance Hari Ini", nilai: formatRupiah(transaksiFinanceKeluar) },
        { label: "— KONDISI BAHAN BAKU —", nilai: "" },
        {
          label: "Bahan Menipis/Minus",
          nilai:
            bahanMenipis.length === 0
              ? "Aman, tidak ada yang menipis/minus"
              : bahanMenipis.map((b) => `${b.nama} (${b.stokSaatIni} ${b.satuan})`).join(", "),
        },
        { label: "— SHIFT BELUM DITUTUP —", nilai: shiftBelumTutup.length === 0 ? "Semua shift sudah ditutup" : shiftBelumTutup.map((s) => s.kasirNama).join(", ") },
      ],
    };
  }

  async function handleEkspor(jenis: "excel" | "pdf") {
    setSedangEkspor(jenis);
    try {
      const opsi = susunOpsi();
      if (jenis === "excel") await eksporExcel(opsi);
      else await eksporPdf(opsi);
      showToast("success", `Laporan ${jenis === "excel" ? "Excel" : "PDF"} berhasil diunduh.`);
    } catch (error) {
      showToast("error", error instanceof Error ? `Gagal mengekspor: ${error.message}` : "Gagal mengekspor.");
    } finally {
      setSedangEkspor(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <KickerOutlet />
        <h1 className="text-2xl font-bold text-slate-900">Cash Opname Akhir Hari</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Checkpoint rekap dana sebelum setor/oper ke Finance — gabungan semua shift Kasir, belanja Purchasing, dan Saldo Finance pada satu tanggal.
        </p>
      </header>

      <div className="mb-4">
        <label htmlFor="tanggal-opname" className="block text-sm font-semibold text-slate-800">
          Tanggal
        </label>
        <input
          id="tanggal-opname"
          type="date"
          value={tanggal}
          onChange={(event) => setTanggal(event.target.value)}
          className="mt-1.5 w-full max-w-[200px] rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
        />
      </div>

      {memuat ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {shiftBelumTutup.length > 0 ? (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="flex items-start gap-1.5 font-semibold">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Belum semua shift ditutup hari ini
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Belum masuk hitungan Cash Opname: {shiftBelumTutup.map((s) => s.kasirNama).join(", ")}. Tutup dulu shift-nya (atau Tutup Paksa dari Riwayat) supaya rekap ini akurat.
              </p>
            </div>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Rekonsiliasi Tunai</h2>
            <dl className="mt-3 divide-y divide-slate-100 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between py-1">
                <dt className="text-slate-600">Omset Tunai</dt>
                <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(omsetTunai)}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt className="text-slate-600">Total Kas Keluar (semua shift)</dt>
                <dd className="font-medium tabular-nums text-slate-900">− {formatRupiah(totalKasKeluarShift)}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt className="text-slate-600">Belanja Purchasing (sumber Kas Resto)</dt>
                <dd className="font-medium tabular-nums text-slate-900">− {formatRupiah(totalBelanjaKasResto)}</dd>
              </div>
              <div className="flex justify-between py-1.5">
                <dt className="font-semibold text-slate-800">Kas Tunai Seharusnya Disetor</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatRupiah(kasTunaiSeharusnyaDisetor)}</dd>
              </div>
              <div className="flex justify-between py-1 pt-2">
                <dt className="text-slate-600">Total Kas Fisik ({jumlahShift} shift)</dt>
                <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(totalKasFisik)}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt className="text-slate-600">Petty Cash (tinggal di laci)</dt>
                <dd className="font-medium tabular-nums text-slate-900">− {formatRupiah(pettyCashTotal)}</dd>
              </div>
              <div className="flex justify-between py-1.5">
                <dt className="font-semibold text-slate-800">Kas Tunai Untuk Disetor</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatRupiah(kasTunaiUntukDisetor)}</dd>
              </div>
            </dl>
            <div
              className={`mt-3 rounded-lg p-3 text-center ${
                selisihSetoran === 0 ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
              }`}
            >
              <p className="text-xs font-medium uppercase tracking-wide">Selisih Setoran</p>
              <p className="text-xl font-bold tabular-nums">{formatRupiah(selisihSetoran)}</p>
              <p className="mt-1 text-xs">
                {selisihSetoran === 0
                  ? "Balance — sesuai perhitungan, tidak ada insiden."
                  : "Tidak balance — cek Tanggungan Kasir & Form Banding Purchasing di bawah untuk penyebabnya."}
              </p>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Non-Tunai (QRIS dll, informasional): {formatRupiah(omsetNonTunai)} — tidak ada fisik untuk dicocokkan, settle otomatis ke rekening lewat penyedia pembayaran.
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Uang Keluar Hari Ini — Dipakai Untuk Apa</h2>
            {kasKeluarBaris.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Tidak ada kas keluar tercatat.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {kasKeluarBaris.map((b) => (
                  <li key={b.kategori} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-slate-700">
                      {b.kategori} <span className="text-xs text-slate-400">({b.jumlahEntri}x)</span>
                    </span>
                    <span className="font-medium tabular-nums text-slate-900">{formatRupiah(b.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Rincian Pemakaian Bahan</h2>
            <p className="mt-1 text-xs text-slate-500">
              Dihitung otomatis dari resep menu × jumlah terjual hari ini (semua shift terkunci) — termasuk bahan baku maupun kemasan (cup, sedotan, dst).
            </p>
            {pemakaianBahan.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Belum ada pemakaian bahan tercatat.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {pemakaianBahan.map((b) => (
                  <li key={b.bahanId} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-slate-700">{b.bahanNama}</span>
                    <span className="font-medium tabular-nums text-slate-900">
                      {b.totalTakaran.toLocaleString("id-ID")} {b.satuan}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Belanja Purchasing Hari Ini</h2>
            {belanjaHari.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Tidak ada sesi belanja hari ini.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {belanjaHari.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-slate-700">
                      {b.purchasingNama} <span className="text-xs text-slate-400">({b.sumberDana === "saldo_finance" ? "Saldo Finance" : "Kas Resto"})</span>
                    </span>
                    <span className="font-medium tabular-nums text-slate-900">{formatRupiah(b.totalBelanja)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Tracking Aliran Saldo Finance</h2>
            <dl className="mt-3 divide-y divide-slate-100 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between py-1">
                <dt className="text-slate-600">Saldo Finance Saat Ini</dt>
                <dd className={`font-semibold tabular-nums ${saldoFinanceSaatIni < 0 ? "text-rose-700" : "text-slate-900"}`}>
                  {formatRupiah(saldoFinanceSaatIni)}
                </dd>
              </div>
              <div className="flex justify-between py-1">
                <dt className="text-slate-600">Uang Masuk Hari Ini</dt>
                <dd className="font-medium tabular-nums text-emerald-700">+ {formatRupiah(transaksiFinanceMasuk)}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt className="text-slate-600">Uang Keluar Hari Ini</dt>
                <dd className="font-medium tabular-nums text-rose-700">− {formatRupiah(transaksiFinanceKeluar)}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt className="text-slate-600">Belanja Purchasing (sumber Saldo Finance)</dt>
                <dd className="font-medium tabular-nums text-rose-700">− {formatRupiah(totalBelanjaSaldoFinance)}</dd>
              </div>
            </dl>
          </section>

          {tanggunganHari.length > 0 ? (
            <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
              <h2 className="text-base font-semibold text-rose-900">Tanggungan Kasir (Ganti Rugi) Hari Ini</h2>
              <ul className="mt-3 flex flex-col divide-y divide-rose-100">
                {tanggunganHari.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-rose-900">{t.kasirNama}</p>
                      <p className="text-xs text-rose-700">{t.keterangan || "—"}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums text-rose-900">{formatRupiah(t.nominal)}</p>
                      <p className="text-xs text-rose-600">{t.status === "lunas" ? "Lunas" : "Belum Lunas"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Form Banding/Revisi Purchasing — Menunggu Ditinjau</h2>
            <p className="mt-1 text-xs text-slate-500">
              Diajukan Purchasing dari menu Belanja & Nota — untuk nota salah catat, transaksi belanja belum tercatat, atau insiden lain.
            </p>
            {bandingMenunggu.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Tidak ada pengajuan yang menunggu.</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-slate-100">
                {bandingMenunggu.map((b) => (
                  <li key={b.id} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-slate-900">
                        {b.purchasingNama} · {LABEL_JENIS_BANDING[b.jenis]} · {b.tanggal}
                      </p>
                      <p className="text-xs text-slate-500">{b.keterangan || "—"}</p>
                      <p className="text-xs font-semibold tabular-nums text-slate-700">{formatRupiah(b.nominal)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => tinjauBanding(b.id, true)}
                        disabled={sedangUbahBanding === b.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Setujui
                      </button>
                      <button
                        type="button"
                        onClick={() => tinjauBanding(b.id, false)}
                        disabled={sedangUbahBanding === b.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-600 px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        Tolak
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Kondisi Bahan Baku Sebelum Setor/Oper</h2>
            {bahanMenipis.length === 0 ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Aman — tidak ada bahan yang menipis atau minus.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-slate-100">
                {bahanMenipis.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-slate-700">{b.nama}</span>
                    <span className={`font-semibold tabular-nums ${b.stokSaatIni < 0 ? "text-rose-700" : "text-amber-700"}`}>
                      {b.stokSaatIni} {b.satuan}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Download className="h-4 w-4 text-emerald-700" aria-hidden="true" />
              Ekspor Cash Opname (Excel / PDF A4)
            </h2>
            {!perusahaan.nama ? (
              <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                Detail Perusahaan belum diisi — kop surat akan tercetak kosong. Isi dulu lewat Profil Akun → Detail Perusahaan.
              </p>
            ) : null}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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

          <EksporRekapCashOpnameKartu />
        </div>
      )}
    </main>
  );
}

// ============================================================
// Ekspor Rekap Cash Opname PERIODE (Harian/Mingguan/Bulanan/Tahunan) —
// permintaan pemilik cafe: laporan Cash Opname di atas cuma bisa lihat
// SATU tanggal sekaligus, sedangkan laporan lain di app ini (Laporan
// Pembelian, Laporan Shift) sudah bisa difilter per periode. Kartu ini
// TIDAK menggantikan ekspor detail satu-hari di atas (yang masih perlu
// untuk drill-down lengkap: rincian kas keluar, pemakaian bahan, dst)
// — ini menambah satu tabel REKAP ringkas, satu baris per tanggal,
// supaya Owner/Finance bisa lihat tren balance/tidaknya sepekan atau
// sebulan sekaligus tanpa buka satu-satu.
//
// Query pakai rentang tanggal (>=, <=) pada koleksi shift & kas_belanja
// langsung (BUKAN loop getDoc per-hari) — sama pola dengan
// EksporLaporanPembelianKartu di belanja-nota/page.tsx.
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

interface BarisRekapHarian {
  tanggal: string;
  jumlahShift: number;
  omsetTunai: number;
  pengeluaran: number;
  seharusnyaDisetor: number;
  untukDisetor: number;
  selisih: number;
}

function EksporRekapCashOpnameKartu() {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const { detail: perusahaan } = useDetailPerusahaan();
  const [dariTanggal, setDariTanggal] = useState(() => rentangPeriodeLaporan("mingguan").mulai);
  const [sampaiTanggal, setSampaiTanggal] = useState(() => rentangPeriodeLaporan("mingguan").selesai);
  const [sedangEkspor, setSedangEkspor] = useState<"excel" | "pdf" | null>(null);

  const periodeAktif =
    (["harian", "mingguan", "bulanan", "tahunan"] as PeriodeLaporan[]).find((p) => {
      const r = rentangPeriodeLaporan(p);
      return r.mulai === dariTanggal && r.selesai === sampaiTanggal;
    }) ?? null;

  async function ambilRekap(): Promise<BarisRekapHarian[]> {
    const [shiftSnap, belanjaSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, "outlets", outletId, "shift"),
          where("tanggal", ">=", dariTanggal),
          where("tanggal", "<=", sampaiTanggal),
        ),
      ),
      getDocs(
        query(
          collection(db, "outlets", outletId, "kas_belanja"),
          where("tanggal", ">=", dariTanggal),
          where("tanggal", "<=", sampaiTanggal),
        ),
      ),
    ]);

    const perTanggal = new Map<
      string,
      { jumlahShift: number; omsetTunai: number; totalKasKeluar: number; totalKasFisik: number; belanjaKasResto: number }
    >();
    function ambilBaris(tanggal: string) {
      const existing = perTanggal.get(tanggal) ?? {
        jumlahShift: 0,
        omsetTunai: 0,
        totalKasKeluar: 0,
        totalKasFisik: 0,
        belanjaKasResto: 0,
      };
      perTanggal.set(tanggal, existing);
      return existing;
    }

    for (const d of shiftSnap.docs) {
      const data = d.data();
      // Sama seperti rekonsiliasi satu-hari di atas: shift yang belum
      // "terkunci" (belum ditutup Kasir) TIDAK ikut dihitung — datanya
      // belum final.
      if ((data.status ?? "buka") !== "terkunci") continue;
      const baris = ambilBaris(data.tanggal ?? "");
      baris.jumlahShift += 1;
      baris.omsetTunai += data.omsetTunai ?? 0;
      baris.totalKasKeluar += data.totalKasKeluar ?? 0;
      baris.totalKasFisik += data.kasFisik ?? 0;
    }
    for (const d of belanjaSnap.docs) {
      const data = d.data();
      if ((data.sumberDana ?? "kas_resto") !== "kas_resto") continue;
      const baris = ambilBaris(data.tanggal ?? "");
      baris.belanjaKasResto += data.totalBelanja ?? 0;
    }

    return Array.from(perTanggal.entries())
      .filter(([tanggal]) => tanggal)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tanggal, v]) => {
        const pettyCash = MODAL_KAS_AWAL_HARIAN * v.jumlahShift;
        const pengeluaran = v.totalKasKeluar + v.belanjaKasResto;
        const seharusnyaDisetor = v.omsetTunai - pengeluaran;
        const untukDisetor = v.totalKasFisik - pettyCash;
        return {
          tanggal,
          jumlahShift: v.jumlahShift,
          omsetTunai: v.omsetTunai,
          pengeluaran,
          seharusnyaDisetor,
          untukDisetor,
          selisih: untukDisetor - seharusnyaDisetor,
        };
      });
  }

  async function handleEkspor(jenis: "excel" | "pdf") {
    setSedangEkspor(jenis);
    try {
      const baris = await ambilRekap();
      if (baris.length === 0) {
        showToast("error", "Tidak ada shift terkunci pada rentang tanggal itu.");
        return;
      }
      const totalOmsetTunai = baris.reduce((t, b) => t + b.omsetTunai, 0);
      const totalPengeluaran = baris.reduce((t, b) => t + b.pengeluaran, 0);
      const totalSeharusnya = baris.reduce((t, b) => t + b.seharusnyaDisetor, 0);
      const totalUntukDisetor = baris.reduce((t, b) => t + b.untukDisetor, 0);
      const totalSelisih = baris.reduce((t, b) => t + b.selisih, 0);
      const opsi: OpsiLaporan<BarisRekapHarian> = {
        judul: "REKAP CASH OPNAME PERIODE",
        periode: `${formatTanggalPanjangId(dariTanggal)} s/d ${formatTanggalPanjangId(sampaiTanggal)}`,
        perusahaan,
        namaBerkas: `Rekap-Cash-Opname_${dariTanggal}_sd_${sampaiTanggal}`,
        kolom: [
          { judul: "Tanggal", ambil: (b) => b.tanggal, lebar: 14 },
          { judul: "Shift", ambil: (b) => b.jumlahShift, angka: true, lebar: 8 },
          { judul: "Omset Tunai", ambil: (b) => b.omsetTunai, angka: true, lebar: 16 },
          { judul: "Pengeluaran", ambil: (b) => b.pengeluaran, angka: true, lebar: 16 },
          { judul: "Seharusnya Disetor", ambil: (b) => b.seharusnyaDisetor, angka: true, lebar: 18 },
          { judul: "Untuk Disetor", ambil: (b) => b.untukDisetor, angka: true, lebar: 16 },
          { judul: "Selisih", ambil: (b) => b.selisih, angka: true, lebar: 14 },
        ],
        baris,
        ringkasan: [
          { label: "Jumlah Hari (ada shift terkunci)", nilai: String(baris.length) },
          { label: "Total Omset Tunai", nilai: formatRupiah(totalOmsetTunai) },
          { label: "Total Pengeluaran (Kas Keluar + Belanja Kas Resto)", nilai: formatRupiah(totalPengeluaran) },
          { label: "Total Kas Seharusnya Disetor", nilai: formatRupiah(totalSeharusnya) },
          { label: "Total Kas Untuk Disetor (fisik − petty cash)", nilai: formatRupiah(totalUntukDisetor) },
          {
            label: "TOTAL SELISIH SETORAN PERIODE",
            nilai:
              totalSelisih === 0
                ? `${formatRupiah(totalSelisih)} — Balance, semua hari sesuai perhitungan`
                : `${formatRupiah(totalSelisih)} — Ada selisih, cek baris tanggal mana yang tidak nol lalu buka Cash Opname hari itu untuk detailnya`,
          },
        ],
      };
      if (jenis === "excel") await eksporExcel(opsi);
      else await eksporPdf(opsi);
      showToast("success", `Rekap ${jenis === "excel" ? "Excel" : "PDF"} berhasil diunduh.`);
    } catch (error) {
      showToast("error", error instanceof Error ? `Gagal mengekspor: ${error.message}` : "Gagal mengekspor.");
    } finally {
      setSedangEkspor(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <Download className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Rekap Cash Opname Periode (Harian / Mingguan / Bulanan)
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Satu baris per tanggal (hanya hari yang shift-nya sudah terkunci) — untuk melihat tren balance/tidaknya
        sepekan atau sebulan sekaligus. Untuk rincian satu hari penuh (kas keluar, pemakaian bahan, dst), pakai
        Ekspor Cash Opname di atas.
      </p>

      <div className="mt-4">
        <PeriodePicker periodeAktif={periodeAktif} onPilih={(r) => { setDariTanggal(r.mulai); setSampaiTanggal(r.selesai); }} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="rekap-co-dari" className="block text-sm font-semibold text-slate-800">
            Dari Tanggal
          </label>
          <input
            id="rekap-co-dari"
            type="date"
            value={dariTanggal}
            onChange={(event) => setDariTanggal(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label htmlFor="rekap-co-sampai" className="block text-sm font-semibold text-slate-800">
            Sampai Tanggal
          </label>
          <input
            id="rekap-co-sampai"
            type="date"
            value={sampaiTanggal}
            onChange={(event) => setSampaiTanggal(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>

      {!perusahaan.nama ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          Detail Perusahaan belum diisi — kop surat akan tercetak kosong. Isi dulu lewat Profil Akun → Detail
          Perusahaan.
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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
