"use client";

// ============================================================
// Halaman: Belanja & Nota (PRD bagian 9.3). Peran UI: Purchasing
// SAJA — Owner tidak input belanja operasional ini (pemisahan
// tugas), Owner memantau lewat Dashboard/notifikasi kenaikan
// harga. firestore.rules tetap memberi Owner (superadmin) akses
// baca/tulis penuh di backend sebagai admin override, tapi
// halaman ini sengaja tidak ditampilkan/diizinkan untuk
// superadmin.
//
// Cakupan P0 pada versi ini: catat kas belanja harian, tambah item
// belanja (bahan lama dipilih dari daftar, bahan baru diketik dan
// otomatis dibuat), unggah foto nota ke Cloudinary, dan tutup
// belanja hari itu. Kenaikan harga >10% otomatis membuat notifikasi
// untuk Owner serta tercatat di riwayat_harga (sesuai PRD 9.3).
//
// BELUM ADA di versi ini (P1 lanjutan): deteksi nota duplikat
// (nominal+tanggal identik) dan halaman kelola daftar bahan baku
// tersendiri (bahan baru untuk sekarang dibuat langsung lewat form
// ini, dengan satuan default yang bisa Owner rapikan kemudian).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Save,
  ShoppingBasket,
} from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { NumberField } from "@/shared/components/number-field";
import { PeriodePicker } from "@/shared/components/periode-picker";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutletId } from "@/shared/lib/outlet-context";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { formatRupiah, formatRupiahSatuan } from "@/shared/lib/format";
import { uploadNotaImage } from "@/shared/lib/cloudinary";
import { setMirrorStokKasir } from "@/shared/lib/resep";
import { ambilDrafAsync, hapusDraf, useDrafOtomatis } from "@/shared/lib/draf";
import { useDetailPerusahaan } from "@/shared/lib/perusahaan";
import { eksporExcel, eksporPdf, type OpsiLaporan } from "@/shared/lib/ekspor";
import { rentangPeriodeLaporan, formatTanggalPanjangId, type PeriodeLaporan } from "@/shared/lib/periode-laporan";
import type { SatuanBahan } from "@/shared/types/inventaris";

/** Isi draf otomatis untuk form Tambah Item (lihat TambahItemKartu). */
interface IsiDrafItemBelanja {
  namaBahan: string;
  qty: number;
  totalHarga: number;
  satuanBahanBaru: SatuanBahan;
}

interface BahanBaku {
  id: string;
  nama: string;
  kategori: string;
  satuan: SatuanBahan;
  hargaSatuanTerakhir: number;
  stokSaatIni: number;
  batasMinimalStok: number;
  aktif: boolean;
}

interface ItemBelanja {
  id: string;
  bahanNama: string;
  qty: number;
  satuan: string;
  hargaSatuan: number;
  subtotal: number;
}

interface NotaItem {
  id: string;
  cloudinaryUrl: string;
  nominalTertera: number;
}

interface BelanjaAktif {
  id: string;
  modalDiberikan: number;
  sumberDana: "kas_resto" | "saldo_finance";
  status: "terbuka" | "selesai" | "terkunci";
  nomorShift: number;
}

/** Sesi belanja TERAKHIR yang sudah "selesai" hari ini milik Purchasing
 *  yang login — dipakai untuk (a) menampilkan Slip Cash Opname sesi itu
 *  (mandiri, "Purchasing Lapor Sendiri") dan (b) menyambung modal shift
 *  berikutnya dari sisaKas sesi ini, BUKAN input manual baru — atas
 *  permintaan pemilik cafe: "tujuannya adalah memisah tracking
 *  pembelian yang terjadi di setiap shift" sambil saldo-nya tetap
 *  nyambung (beda dari Kasir yang modalnya flat reset tiap shift). */
interface SesiSelesai {
  id: string;
  nomorShift: number;
  sumberDana: "kas_resto" | "saldo_finance";
  modalDiberikan: number;
  totalBelanja: number;
  sisaKas: number;
}

/** ID dokumen tunggal Saldo Deposito Finance — sama dengan
 *  src/app/transaksi-finance/page.tsx (ID_SALDO_FINANCE). */
const ID_SALDO_FINANCE = "utama";

const AMBANG_KENAIKAN_HARGA = 0.1; // 10%, sesuai PRD 9.3

function tanggalHariIni(): string {
  const sekarang = new Date();
  return `${sekarang.getFullYear()}-${String(sekarang.getMonth() + 1).padStart(2, "0")}-${String(
    sekarang.getDate(),
  ).padStart(2, "0")}`;
}

export default function BelanjaNotaPage() {
  return (
    <RequireAuth peranDiizinkan={["purchasing"]}>
      <AppShell>
        <BelanjaNotaIsi />
      </AppShell>
    </RequireAuth>
  );
}

function BelanjaNotaIsi() {
  const { user, profil } = useAuth();
  const outletId = useOutletId();
  const { showToast } = useToast();

  const [memuat, setMemuat] = useState(true);
  const [belanjaAktif, setBelanjaAktif] = useState<BelanjaAktif | null>(null);
  const [modalDiberikan, setModalDiberikan] = useState(0);
  const [sumberDana, setSumberDana] = useState<"kas_resto" | "saldo_finance">("kas_resto");
  const [sedangMulai, setSedangMulai] = useState(false);
  const [sesiSelesaiTerakhir, setSesiSelesaiTerakhir] = useState<SesiSelesai | null>(null);
  const [sedangEksporSlip, setSedangEksporSlip] = useState(false);
  const { detail: perusahaan } = useDetailPerusahaan();

  // Saldo Deposito Finance TERKINI — dibaca di sini supaya Purchasing
  // tahu sisa saldo SEBELUM memilih "Saldo Finance" sebagai sumber dana
  // (lihat firestore.rules bagian saldo_finance: Purchasing sengaja
  // diberi baca, bukan Kasir, khusus untuk kebutuhan ini).
  const [saldoFinance, setSaldoFinance] = useState(0);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "outlets", outletId, "saldo_finance", ID_SALDO_FINANCE), (snap) => {
      setSaldoFinance(snap.exists() ? (snap.data().saldo ?? 0) : 0);
    });
    return unsub;
  }, [outletId]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "outlets", outletId, "kas_belanja"),
      where("purchasingUid", "==", user.uid),
      where("tanggal", "==", tanggalHariIni()),
      where("status", "==", "terbuka"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setBelanjaAktif(null);
        } else {
          const d = snap.docs[0];
          setBelanjaAktif({
            id: d.id,
            modalDiberikan: d.data().modalDiberikan ?? 0,
            sumberDana: (d.data().sumberDana ?? "kas_resto") as "kas_resto" | "saldo_finance",
            status: "terbuka",
            nomorShift: d.data().nomorShift ?? 1,
          });
        }
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, [user, outletId]);

  // Sesi SELESAI terakhir hari ini (kalau ada) — dipakai untuk
  // menyambung modal shift berikutnya dari sisaKas-nya (BUKAN input
  // manual baru) dan untuk menampilkan Slip Cash Opname sesi itu.
  // Diurutkan by nomorShift, bukan onSnapshot (cukup dimuat ulang
  // begitu belanjaAktif berubah jadi null lagi) — konsisten dengan
  // pola getDocs sekali-muat lain di halaman ini.
  useEffect(() => {
    if (!user || belanjaAktif) return;
    let dibatalkan = false;
    getDocs(
      query(
        collection(db, "outlets", outletId, "kas_belanja"),
        where("purchasingUid", "==", user.uid),
        where("tanggal", "==", tanggalHariIni()),
        where("status", "==", "selesai"),
        orderBy("nomorShift", "desc"),
        limit(1),
      ),
    )
      .then((snap) => {
        if (dibatalkan) return;
        if (snap.empty) {
          setSesiSelesaiTerakhir(null);
          return;
        }
        const d = snap.docs[0];
        setSesiSelesaiTerakhir({
          id: d.id,
          nomorShift: d.data().nomorShift ?? 1,
          sumberDana: (d.data().sumberDana ?? "kas_resto") as "kas_resto" | "saldo_finance",
          modalDiberikan: d.data().modalDiberikan ?? 0,
          totalBelanja: d.data().totalBelanja ?? 0,
          sisaKas: d.data().sisaKas ?? 0,
        });
      })
      .catch((error) => {
        if (dibatalkan) return;
        setSesiSelesaiTerakhir(null);
        // JANGAN gagal diam-diam: kalau query ini gagal (mis. index
        // komposit "purchasingUid + tanggal + status, orderBy nomorShift"
        // belum dibuat di Firebase Console), Purchasing akan tetap
        // melihat layar "Mulai Belanja" manual seolah tidak ada sesi
        // sebelumnya — padahal sebenarnya query-nya error, bukan memang
        // kosong. Tanpa toast ini, kegagalan itu tidak akan pernah
        // ketahuan dari UI.
        showToast(
          "error",
          error instanceof Error
            ? `Gagal memeriksa sesi shift sebelumnya: ${error.message}`
            : "Gagal memeriksa sesi shift sebelumnya.",
        );
      });
    return () => {
      dibatalkan = true;
    };
  }, [user, outletId, belanjaAktif, showToast]);

  async function handleMulaiBelanja() {
    if (!user || !profil) return;
    // Saldo Finance SENGAJA diizinkan minus (prinsip akuntansi: saldo
    // wajib mencerminkan kondisi nyata walau negatif) — jadi di sini
    // HANYA memberi peringatan, tidak lagi memblokir Purchasing memulai
    // belanja. firestore.rules juga sudah tidak lagi mewajibkan saldo
    // >= 0 untuk Finance/Purchasing (lihat komentar di firestore.rules
    // bagian saldo_finance).
    if (sumberDana === "saldo_finance" && modalDiberikan > saldoFinance) {
      showToast(
        "warning",
        `Saldo Finance akan menjadi minus (${formatRupiah(saldoFinance - modalDiberikan)}) setelah belanja ini dimulai.`,
      );
    }

    setSedangMulai(true);
    try {
      // PERBAIKAN BUG: dulu ini 2 tulisan terpisah (addDoc lalu setDoc) —
      // kalau tulisan kedua (potong Saldo Finance) gagal (mis.
      // firestore.rules di Firebase Console belum di-deploy ke versi
      // terbaru), sesi belanja SUDAH terlanjur terbuat tapi Saldo Finance
      // tidak berkurang sama sekali ("Saldo Finance tidak berkurang saat
      // Purchasing belanja" — bug dilaporkan user). Sekarang keduanya
      // digabung jadi satu writeBatch ATOMIK: kalau salah satu gagal
      // (mis. saldo tidak cukup / rules menolak), TIDAK ADA yang tertulis
      // sama sekali, jadi sesi belanja tidak akan pernah "nyangkut" tanpa
      // saldo ikut terpotong.
      const batch = writeBatch(db);
      const belanjaRef = doc(collection(db, "outlets", outletId, "kas_belanja"));
      batch.set(belanjaRef, {
        tanggal: tanggalHariIni(),
        purchasingUid: user.uid,
        purchasingNama: profil.nama,
        modalDiberikan,
        sumberDana,
        totalBelanja: 0,
        sisaKas: modalDiberikan,
        status: "terbuka",
        // Shift PERTAMA hari ini untuk Purchasing ini — shift berikutnya
        // (kalau ada) menyambung dari sisaKas shift ini lewat
        // handleLanjutkanShift(), bukan mengulang dari sini lagi.
        nomorShift: 1,
      });

      if (sumberDana === "saldo_finance") {
        batch.set(
          doc(db, "outlets", outletId, "saldo_finance", ID_SALDO_FINANCE),
          { saldo: increment(-modalDiberikan) },
          { merge: true },
        );
      }

      await batch.commit();

      showToast(
        "success",
        `Belanja hari ini dimulai dengan kas ${formatRupiah(modalDiberikan)} (${
          sumberDana === "saldo_finance" ? "Saldo Finance" : "Kas Resto/Outlet"
        }).`,
      );
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal memulai belanja: ${error.message}` : "Gagal memulai belanja.",
      );
    } finally {
      setSedangMulai(false);
    }
  }

  // "Lanjut Shift" — permintaan pemilik cafe: setiap transisi shift,
  // Purchasing memulai shift berikutnya PERSIS dari sisa saldo yang
  // masih dia pegang di akhir shift sebelumnya (BUKAN input kas baru),
  // supaya pembelian tiap shift tetap terpisah pelacakannya tapi
  // saldonya tetap menyambung (beda dari Kasir yang modalnya flat
  // Rp500.000 reset tiap shift). TIDAK memotong saldo_finance lagi —
  // uangnya sama, cuma dibawa lanjut, bukan suntikan baru.
  async function handleLanjutkanShift() {
    if (!user || !profil || !sesiSelesaiTerakhir) return;
    setSedangMulai(true);
    try {
      await addDoc(collection(db, "outlets", outletId, "kas_belanja"), {
        tanggal: tanggalHariIni(),
        purchasingUid: user.uid,
        purchasingNama: profil.nama,
        modalDiberikan: sesiSelesaiTerakhir.sisaKas,
        sumberDana: sesiSelesaiTerakhir.sumberDana,
        totalBelanja: 0,
        sisaKas: sesiSelesaiTerakhir.sisaKas,
        status: "terbuka",
        nomorShift: sesiSelesaiTerakhir.nomorShift + 1,
        lanjutanDariShift: sesiSelesaiTerakhir.nomorShift,
      });
      showToast(
        "success",
        `Shift ${sesiSelesaiTerakhir.nomorShift + 1} dimulai, menyambung sisa kas ${formatRupiah(sesiSelesaiTerakhir.sisaKas)}.`,
      );
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal melanjutkan shift: ${error.message}` : "Gagal melanjutkan shift.",
      );
    } finally {
      setSedangMulai(false);
    }
  }

  async function handleEksporSlipCashOpname(jenis: "excel" | "pdf") {
    if (!sesiSelesaiTerakhir) return;
    setSedangEksporSlip(true);
    try {
      const opsi: OpsiLaporan<{ label: string; nilai: string }> = {
        judul: `Slip Cash Opname Purchasing — Shift ${sesiSelesaiTerakhir.nomorShift}`,
        periode: formatTanggalPanjangId(tanggalHariIni()),
        perusahaan,
        namaBerkas: `slip-cash-opname-purchasing-shift-${sesiSelesaiTerakhir.nomorShift}-${tanggalHariIni()}`,
        kolom: [
          { judul: "Keterangan", ambil: (b) => b.label },
          { judul: "Nilai", ambil: (b) => b.nilai },
        ],
        baris: [
          { label: "Purchasing", nilai: profil?.nama ?? "-" },
          { label: "Shift", nilai: `${sesiSelesaiTerakhir.nomorShift}` },
          { label: "Sumber Dana", nilai: sesiSelesaiTerakhir.sumberDana === "kas_resto" ? "Kas Resto/Outlet" : "Saldo Finance" },
          { label: "Modal Diterima", nilai: formatRupiah(sesiSelesaiTerakhir.modalDiberikan) },
          { label: "Total Belanja", nilai: formatRupiah(sesiSelesaiTerakhir.totalBelanja) },
          { label: "Sisa Kas", nilai: formatRupiah(sesiSelesaiTerakhir.sisaKas) },
        ],
        ringkasan: [
          {
            label: "Shift Berikutnya",
            nilai: `Mulai dari sisa kas ${formatRupiah(sesiSelesaiTerakhir.sisaKas)} (bukan modal baru) — pembelian tiap shift tetap terpisah agar mudah dilacak`,
          },
        ],
      };
      if (jenis === "excel") await eksporExcel(opsi);
      else await eksporPdf(opsi);
    } catch (error) {
      showToast("error", error instanceof Error ? `Gagal ekspor: ${error.message}` : "Gagal ekspor.");
    } finally {
      setSedangEksporSlip(false);
    }
  }

  if (memuat) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        <span className="sr-only">Memeriksa status belanja...</span>
      </main>
    );
  }

  if (!belanjaAktif) {
    if (sesiSelesaiTerakhir) {
      const shiftBerikutnya = sesiSelesaiTerakhir.nomorShift + 1;
      return (
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" />
              <h1 className="text-base font-bold text-emerald-900">
                Slip Cash Opname — Shift {sesiSelesaiTerakhir.nomorShift} Selesai
              </h1>
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-emerald-800">Modal Diterima</dt>
                <dd className="font-semibold text-emerald-900">
                  {formatRupiah(sesiSelesaiTerakhir.modalDiberikan)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-emerald-800">Total Belanja</dt>
                <dd className="font-semibold text-emerald-900">
                  {formatRupiah(sesiSelesaiTerakhir.totalBelanja)}
                </dd>
              </div>
              <div className="flex items-center justify-between border-t border-emerald-200 pt-1.5">
                <dt className="text-emerald-800">Sisa Kas</dt>
                <dd className="font-bold text-emerald-900">{formatRupiah(sesiSelesaiTerakhir.sisaKas)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-emerald-800">Sumber Dana</dt>
                <dd className="font-medium text-emerald-900">
                  {sesiSelesaiTerakhir.sumberDana === "kas_resto" ? "Kas Resto / Outlet" : "Saldo Finance"}
                </dd>
              </div>
            </dl>
            <p className="mt-3 rounded-lg bg-white/70 p-2.5 text-xs text-emerald-800">
              Sisa kas di atas akan dibawa lanjut sebagai modal awal Shift {shiftBerikutnya}, supaya
              pembelian tiap shift tetap terpisah tapi saldo tetap tersambung (tidak seperti Petty Cash
              Kasir yang selalu direset).
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleEksporSlipCashOpname("excel")}
                disabled={sedangEksporSlip}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-800 motion-safe:transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                Excel
              </button>
              <button
                type="button"
                onClick={() => handleEksporSlipCashOpname("pdf")}
                disabled={sedangEksporSlip}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-800 motion-safe:transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                PDF
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <ShoppingBasket className="h-5 w-5 text-emerald-700" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-900">Lanjutkan ke Shift {shiftBerikutnya}</h2>
            </div>
            <p className="text-sm text-slate-600">
              Modal awal Shift {shiftBerikutnya} otomatis meneruskan sisa kas Shift{" "}
              {sesiSelesaiTerakhir.nomorShift}:
            </p>
            <p className="mt-1 text-lg font-bold text-emerald-700">
              {formatRupiah(sesiSelesaiTerakhir.sisaKas)}
            </p>
            <button
              type="button"
              onClick={handleLanjutkanShift}
              disabled={sedangMulai}
              aria-busy={sedangMulai}
              className={[
                "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm",
                "motion-safe:transition motion-safe:duration-150",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
                sedangMulai
                  ? "cursor-not-allowed bg-emerald-400"
                  : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
              ].join(" ")}
            >
              {sedangMulai ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShoppingBasket className="h-4 w-4" aria-hidden="true" />
              )}
              {sedangMulai ? "Memulai..." : `Mulai Shift ${shiftBerikutnya}`}
            </button>
          </div>

          <div className="mt-6 flex flex-col gap-6">
            <EksporLaporanPembelianKartu />
            <BandingPurchasingKartu />
          </div>
        </main>
      );
    }

    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ShoppingBasket className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            <h1 className="text-lg font-bold text-slate-900">Mulai Belanja Hari Ini</h1>
          </div>
          <NumberField
            id="modal-diberikan"
            label="Kas Belanja Diterima"
            value={modalDiberikan}
            onChange={setModalDiberikan}
            prefix="Rp"
          />

          <div className="mt-4">
            <span className="block text-sm font-semibold text-slate-800">Sumber Dana</span>
            <div className="mt-1.5 grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => setSumberDana("kas_resto")}
                className={`min-h-11 rounded-lg border px-3 text-left text-sm font-medium motion-safe:transition active:scale-[0.99] ${
                  sumberDana === "kas_resto"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                Kas Resto / Outlet
              </button>
              <button
                type="button"
                onClick={() => setSumberDana("saldo_finance")}
                className={`min-h-11 rounded-lg border px-3 text-left text-sm font-medium motion-safe:transition active:scale-[0.99] ${
                  sumberDana === "saldo_finance"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                Saldo Finance <span className="font-normal text-slate-500">(sisa {formatRupiah(saldoFinance)})</span>
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Saldo Finance adalah dana khusus dari Owner di luar Omset penjualan — dikelola Finance lewat
              menu Transaksi Finance.
            </p>
          </div>

          <button
            type="button"
            onClick={handleMulaiBelanja}
            disabled={sedangMulai}
            aria-busy={sedangMulai}
            className={[
              "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm",
              "motion-safe:transition motion-safe:duration-150",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
              sedangMulai
                ? "cursor-not-allowed bg-emerald-400"
                : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
            ].join(" ")}
          >
            {sedangMulai ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShoppingBasket className="h-4 w-4" aria-hidden="true" />
            )}
            {sedangMulai ? "Memulai..." : "Mulai Belanja"}
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-6">
          <EksporLaporanPembelianKartu />
          <BandingPurchasingKartu />
        </div>
      </main>
    );
  }

  return (
    <BelanjaBerjalan
      belanjaId={belanjaAktif.id}
      modalDiberikan={belanjaAktif.modalDiberikan}
      sumberDana={belanjaAktif.sumberDana}
      nomorShift={belanjaAktif.nomorShift}
    />
  );
}

function BelanjaBerjalan({
  belanjaId,
  modalDiberikan,
  sumberDana,
  nomorShift,
}: {
  belanjaId: string;
  modalDiberikan: number;
  sumberDana: "kas_resto" | "saldo_finance";
  nomorShift: number;
}) {
  const outletId = useOutletId();
  const [daftarBahan, setDaftarBahan] = useState<BahanBaku[]>([]);
  const [itemBelanja, setItemBelanja] = useState<ItemBelanja[]>([]);
  const [notaList, setNotaList] = useState<NotaItem[]>([]);
  const [sedangSelesai, setSedangSelesai] = useState(false);

  useEffect(() => {
    const unsubBahan = onSnapshot(collection(db, "outlets", outletId, "bahan_baku"), (snap) => {
      setDaftarBahan(
        snap.docs.map((d) => ({
          id: d.id,
          nama: d.data().nama ?? "",
          kategori: d.data().kategori ?? "Umum",
          satuan: d.data().satuan === "pcs" ? "pcs" : "gram",
          hargaSatuanTerakhir: d.data().hargaSatuanTerakhir ?? 0,
          stokSaatIni: d.data().stokSaatIni ?? 0,
          batasMinimalStok: d.data().batasMinimalStok ?? 0,
          aktif: d.data().aktif ?? true,
        })),
      );
    });
    const unsubItem = onSnapshot(collection(db, "outlets", outletId, "kas_belanja", belanjaId, "item"), (snap) => {
      setItemBelanja(
        snap.docs.map((d) => ({
          id: d.id,
          bahanNama: d.data().bahanNama ?? "",
          qty: d.data().qty ?? 0,
          satuan: d.data().satuan ?? "pcs",
          hargaSatuan: d.data().hargaSatuan ?? 0,
          subtotal: d.data().subtotal ?? 0,
        })),
      );
    });
    const unsubNota = onSnapshot(collection(db, "outlets", outletId, "kas_belanja", belanjaId, "nota"), (snap) => {
      setNotaList(
        snap.docs.map((d) => ({
          id: d.id,
          cloudinaryUrl: d.data().cloudinaryUrl ?? "",
          nominalTertera: d.data().nominalTertera ?? 0,
        })),
      );
    });
    return () => {
      unsubBahan();
      unsubItem();
      unsubNota();
    };
  }, [belanjaId, outletId]);

  const totalBelanja = useMemo(
    () => itemBelanja.reduce((total, item) => total + item.subtotal, 0),
    [itemBelanja],
  );
  const sisaKas = modalDiberikan - totalBelanja;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <KickerOutlet />
          <h1 className="text-2xl font-bold text-slate-900">
            Belanja & Nota
            {nomorShift > 1 && (
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 align-middle">
                Shift {nomorShift} (lanjutan Shift {nomorShift - 1})
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Sumber dana: {sumberDana === "saldo_finance" ? "Saldo Finance" : "Kas Resto/Outlet"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Sisa Kas</p>
          <p
            className={`text-xl font-bold tabular-nums ${sisaKas < 0 ? "text-rose-700" : "text-emerald-700"}`}
          >
            {formatRupiah(sisaKas)}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-6">
        <TambahItemKartu
          belanjaId={belanjaId}
          daftarBahan={daftarBahan}
          itemBelanja={itemBelanja}
          totalBelanja={totalBelanja}
        />

        {/* Dua panel utilitas kecil ini berdampingan di layar lebar —
            sama-sama pengaturan sampingan, bukan alur utama belanja. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
          <PenyesuaianStokKartu daftarBahan={daftarBahan} />
          <BatasMinimalStokKartu daftarBahan={daftarBahan} />
        </div>

        <NotaKartu belanjaId={belanjaId} notaList={notaList} />

        <SelesaikanBelanjaKartu
          belanjaId={belanjaId}
          modalDiberikan={modalDiberikan}
          totalBelanja={totalBelanja}
          sisaKas={sisaKas}
          sedangSelesai={sedangSelesai}
          setSedangSelesai={setSedangSelesai}
        />

        <EksporLaporanPembelianKartu />
        <BandingPurchasingKartu />
      </div>
    </main>
  );
}

function TambahItemKartu({
  belanjaId,
  daftarBahan,
  itemBelanja,
  totalBelanja,
}: {
  belanjaId: string;
  daftarBahan: BahanBaku[];
  itemBelanja: ItemBelanja[];
  totalBelanja: number;
}) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const outletId = useOutletId();
  const [namaBahan, setNamaBahan] = useState("");
  const [qty, setQty] = useState(1);
  const [satuanBahanBaru, setSatuanBahanBaru] = useState<SatuanBahan>("gram");
  const [totalHarga, setTotalHarga] = useState(0);
  const [sedangSimpan, setSedangSimpan] = useState(false);

  // --- Auto Draft ---
  // Item yang sedang diketik (nama bahan + jumlah + total harga)
  // biasanya sedang disalin dari struk belanja di tangan. Kalau hilang
  // karena auto logout, Purchasing harus mencari & membaca struknya
  // lagi. Dikunci per dokumen belanja harian.
  const kunciDraf = `item-belanja:${belanjaId}`;
  const isiDraf = useMemo<IsiDrafItemBelanja>(
    () => ({ namaBahan, qty, totalHarga, satuanBahanBaru }),
    [namaBahan, qty, totalHarga, satuanBahanBaru],
  );
  useDrafOtomatis(user?.uid, kunciDraf, isiDraf, namaBahan.trim().length > 0);

  useEffect(() => {
    if (!user) return;
    let dibatalkan = false;
    ambilDrafAsync<IsiDrafItemBelanja>(user.uid, kunciDraf).then((tersimpan) => {
      if (dibatalkan || !tersimpan?.data?.namaBahan) return;
      setNamaBahan(tersimpan.data.namaBahan);
      setQty(tersimpan.data.qty ?? 1);
      setTotalHarga(tersimpan.data.totalHarga ?? 0);
      setSatuanBahanBaru(tersimpan.data.satuanBahanBaru === "pcs" ? "pcs" : "gram");
    });
    return () => {
      dibatalkan = true;
    };
  }, [user, kunciDraf]);

  const bahanCocokPreview = daftarBahan.find(
    (b) => b.nama.trim().toLowerCase() === namaBahan.trim().toLowerCase(),
  );
  const satuanEfektif: SatuanBahan = bahanCocokPreview?.satuan ?? satuanBahanBaru;
  // Harga per satuan (gram/pcs) DIHITUNG OTOMATIS dari total harga yang
  // dibayar dibagi jumlah dibeli — Purchasing TIDAK perlu menghitung
  // sendiri (misal: "1kg kopi Rp100.000" -> otomatis Rp100/gram).
  //
  // SENGAJA TIDAK DIBULATKAN (dulu pakai Math.round dan itu bug): bahan
  // murah bervolume besar harganya pecahan di bawah Rp1 per satuan —
  // contoh air galon isi ulang Rp6.000 untuk 19.000 ml = Rp0,32/ml.
  // Dibulatkan, nilainya jadi 0 dan bahan itu dihitung GRATIS selamanya
  // di HPP. Nilai pecahan disimpan apa adanya; pembulatan hanya dilakukan
  // di tampilan (formatRupiahSatuan) dan di total akhir HPP.
  const hargaPerSatuanOtomatis = qty > 0 ? totalHarga / qty : 0;

  async function handleTambahItem() {
    if (!namaBahan.trim()) {
      showToast("error", "Nama bahan wajib diisi.");
      return;
    }
    if (qty <= 0 || totalHarga <= 0) {
      showToast("error", "Jumlah dan total harga harus lebih besar dari 0.");
      return;
    }

    setSedangSimpan(true);
    try {
      const bahanCocok = bahanCocokPreview;
      const satuan = satuanEfektif;
      const hargaSatuan = hargaPerSatuanOtomatis;
      const subtotal = totalHarga;

      await addDoc(collection(db, "outlets", outletId, "kas_belanja", belanjaId, "item"), {
        bahanId: bahanCocok?.id ?? null,
        bahanNama: namaBahan.trim(),
        qty,
        satuan,
        hargaSatuan,
        subtotal,
      });
      await updateDoc(doc(db, "outlets", outletId, "kas_belanja", belanjaId), { totalBelanja: increment(subtotal) });

      if (bahanCocok) {
        // Bahan sudah ada -> cek kenaikan harga & catat riwayat, LALU
        // tambahkan stok gudang otomatis (qty yang baru dibeli).
        const hargaLama = bahanCocok.hargaSatuanTerakhir;
        if (hargaLama > 0 && hargaSatuan !== hargaLama) {
          const selisihPersen = (hargaSatuan - hargaLama) / hargaLama;
          await addDoc(collection(db, "outlets", outletId, "bahan_baku", bahanCocok.id, "riwayat_harga"), {
            harga: hargaSatuan,
            tanggal: tanggalHariIni(),
            selisihPersen,
          });
          if (selisihPersen > AMBANG_KENAIKAN_HARGA) {
            await addDoc(collection(db, "outlets", outletId, "notifikasi"), {
              untukPeran: "superadmin",
              tipe: "kenaikan_harga_bahan",
              prioritas: "sedang",
              judul: "Kenaikan Harga Bahan",
              pesan: `Harga "${namaBahan.trim()}" naik ${(selisihPersen * 100).toFixed(0)}% menjadi ${formatRupiahSatuan(hargaSatuan)}/${satuan}.`,
              dibaca: false,
              waktu: serverTimestamp(),
            });
          }
        }
        await updateDoc(doc(db, "outlets", outletId, "bahan_baku", bahanCocok.id), {
          hargaSatuanTerakhir: hargaSatuan,
          stokSaatIni: increment(qty),
          updatedAt: serverTimestamp(),
        });
        // Cermin stok_kasir ikut diperbarui (TANPA hargaSatuanTerakhir)
        // supaya Dashboard Kasir menampilkan stok yang benar — lihat
        // komentar keamanan di src/shared/lib/resep.ts.
        // Pakai increment(qty) di sini (BUKAN bahanCocok.stokSaatIni + qty)
        // supaya cermin ini tidak pernah meleset akibat state `bahanCocok`
        // yang basi (mis. dua kali tambah stok bahan yang sama berturut-
        // turut sebelum layar sempat disegarkan) — lihat catatan perbaikan
        // di src/shared/lib/resep.ts.
        await setMirrorStokKasir(outletId, bahanCocok.id, {
          nama: bahanCocok.nama,
          kategori: bahanCocok.kategori,
          satuan,
          stokSaatIni: increment(qty),
          batasMinimalStok: bahanCocok.batasMinimalStok,
          aktif: true,
        });
      } else {
        // Bahan baru -> buat dokumen inventaris, stok awal = qty yang
        // baru saja dibeli (bukan 0 seperti sebelumnya).
        const bahanBaruRef = doc(collection(db, "outlets", outletId, "bahan_baku"));
        await setDoc(bahanBaruRef, {
          nama: namaBahan.trim(),
          kategori: "Umum",
          satuan,
          hargaSatuanTerakhir: hargaSatuan,
          stokSaatIni: qty,
          batasMinimalStok: 0,
          aktif: true,
          updatedAt: serverTimestamp(),
        });
        await setMirrorStokKasir(outletId, bahanBaruRef.id, {
          nama: namaBahan.trim(),
          kategori: "Umum",
          satuan,
          stokSaatIni: qty,
          batasMinimalStok: 0,
          aktif: true,
        });
      }

      showToast(
        "success",
        `${namaBahan.trim()} ditambahkan: ${formatRupiah(subtotal)} (${formatRupiahSatuan(hargaSatuan)}/${satuan}).`,
      );
      setNamaBahan("");
      setQty(1);
      setTotalHarga(0);
      // Item sudah tersimpan ke Firestore — drafnya tidak perlu lagi.
      if (user) hapusDraf(user.uid, kunciDraf);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menambah item: ${error.message}` : "Gagal menambah item.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-item"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h2 id="bagian-item" className="text-base font-semibold text-slate-900">
          Item Belanja
        </h2>
        <p className="text-sm font-semibold tabular-nums text-slate-900">
          {formatRupiah(totalBelanja)}
        </p>
      </div>

      {itemBelanja.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {itemBelanja.map((item) => (
            <li key={item.id} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-slate-700">
                {item.bahanNama} · {item.qty} {item.satuan} × {formatRupiahSatuan(item.hargaSatuan)}
              </span>
              <span className="font-medium tabular-nums text-slate-900">
                {formatRupiah(item.subtotal)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Belum ada item dicatat.</p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor="nama-bahan" className="block text-sm font-semibold text-slate-800">
            Nama Bahan
          </label>
          <input
            id="nama-bahan"
            type="text"
            list="daftar-bahan"
            value={namaBahan}
            onChange={(event) => setNamaBahan(event.target.value)}
            placeholder="pilih atau ketik bahan baru"
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
          <datalist id="daftar-bahan">
            {daftarBahan.map((b) => (
              <option key={b.id} value={b.nama} />
            ))}
          </datalist>
        </div>
        <NumberField id="qty-item" label="Jumlah Dibeli" value={qty} onChange={setQty} suffix={satuanEfektif} step={1} />
        <NumberField
          id="total-harga"
          label="Total Harga Dibayar"
          value={totalHarga}
          onChange={setTotalHarga}
          prefix="Rp"
          hint={qty > 0 && totalHarga > 0 ? `= ${formatRupiahSatuan(hargaPerSatuanOtomatis)} per ${satuanEfektif}` : undefined}
        />
      </div>
      <div className="mt-3 flex items-end gap-3">
        <div className="max-w-[140px] flex-1">
          <label htmlFor="satuan-item" className="block text-xs text-slate-500">
            Satuan
          </label>
          {bahanCocokPreview ? (
            <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {bahanCocokPreview.satuan} (ikut bahan)
            </p>
          ) : (
            <select
              id="satuan-item"
              value={satuanBahanBaru}
              onChange={(event) => setSatuanBahanBaru(event.target.value as SatuanBahan)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            >
              <option value="gram">gram</option>
              <option value="pcs">pcs</option>
            </select>
          )}
        </div>
        <button
          type="button"
          onClick={handleTambahItem}
          disabled={sedangSimpan}
          aria-busy={sedangSimpan}
          className={[
            "inline-flex h-[42px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm",
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
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          Tambah
        </button>
      </div>
    </section>
  );
}

const ALASAN_PENYESUAIAN = [
  { value: "rusak", label: "Rusak" },
  { value: "kedaluwarsa", label: "Kedaluwarsa" },
  { value: "lainnya", label: "Lainnya" },
] as const;

/**
 * Penyesuaian Stok manual TANPA approval — untuk bahan rusak/
 * kedaluwarsa yang harus dikeluarkan dari inventaris tanpa ada
 * penjualan sama sekali. Wajib foto sebagai bukti (atas permintaan
 * pemilik cafe), tapi TIDAK perlu persetujuan Owner — begitu foto
 * terunggah, stok langsung berkurang. Jejaknya permanen (lihat
 * firestore.rules bagian bahan_baku/{id}/penyesuaian_stok).
 */
/**
 * Stok gudang boleh minus secara teknis (pengurangan lewat Resep ditulis
 * dengan increment() tanpa membaca stok lebih dulu — pola "tulis tanpa
 * baca" yang wajib dipakai supaya Kasir tidak perlu izin baca harga
 * bahan). Tapi stok minus SELALU berarti ada yang tidak beres: takaran
 * resep kebesaran, pembelian lupa dicatat, atau bahan terpakai tanpa
 * penjualan. Daripada dibiarkan diam-diam, kita tampilkan terang-terangan
 * ke Purchasing/Owner di sini supaya bisa segera dikoreksi.
 */
function PeringatanStokMinus({ daftarBahan }: { daftarBahan: BahanBaku[] }) {
  const minus = daftarBahan.filter((b) => b.stokSaatIni < 0);
  if (minus.length === 0) return null;
  return (
    <div
      role="alert"
      className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"
    >
      <p className="flex items-start gap-1.5 font-semibold">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Stok minus terdeteksi — perlu dikoreksi
      </p>
      <p className="mt-1 text-xs text-rose-800">
        Artinya bahan terpakai melebihi yang tercatat masuk. Cek takaran
        resepnya di Kalkulator HPP, atau ada pembelian yang belum dicatat.
      </p>
      <ul className="mt-2 flex flex-col gap-0.5 text-xs">
        {minus.map((b) => (
          <li key={b.id} className="flex justify-between gap-3">
            <span>{b.nama}</span>
            <span className="font-semibold tabular-nums">
              {b.stokSaatIni} {b.satuan}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PenyesuaianStokKartu({ daftarBahan }: { daftarBahan: BahanBaku[] }) {
  const { user, profil } = useAuth();
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [bahanId, setBahanId] = useState("");
  const [jumlah, setJumlah] = useState(0);
  const [alasan, setAlasan] = useState<(typeof ALASAN_PENYESUAIAN)[number]["value"]>("rusak");
  const [keterangan, setKeterangan] = useState("");
  const [sedangSimpan, setSedangSimpan] = useState(false);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const bahan = daftarBahan.find((b) => b.id === bahanId);
    if (!bahan) {
      showToast("error", "Pilih bahan terlebih dahulu.");
      return;
    }
    if (jumlah <= 0) {
      showToast("error", "Jumlah yang dikeluarkan harus lebih besar dari 0.");
      return;
    }
    if (!user || !profil) return;

    setSedangSimpan(true);
    try {
      const hasilFoto = await uploadNotaImage(file, "penyesuaian-stok");
      await addDoc(collection(db, "outlets", outletId, "bahan_baku", bahan.id, "penyesuaian_stok"), {
        bahanId: bahan.id,
        bahanNama: bahan.nama,
        jumlah,
        satuan: bahan.satuan,
        alasan,
        keterangan: keterangan.trim(),
        fotoUrl: hasilFoto.url,
        dicatatOlehUid: user.uid,
        dicatatOlehNama: profil.nama,
        waktu: serverTimestamp(),
      });
      // Langsung kurangi stok — TANPA approval, sesuai permintaan.
      await updateDoc(doc(db, "outlets", outletId, "bahan_baku", bahan.id), {
        stokSaatIni: increment(-jumlah),
        updatedAt: serverTimestamp(),
      });
      // increment(-jumlah), bukan bahan.stokSaatIni - jumlah — lihat
      // catatan perbaikan drift cermin stok di src/shared/lib/resep.ts.
      await setMirrorStokKasir(outletId, bahan.id, {
        nama: bahan.nama,
        kategori: bahan.kategori,
        satuan: bahan.satuan,
        stokSaatIni: increment(-jumlah),
        batasMinimalStok: bahan.batasMinimalStok,
        aktif: bahan.aktif,
      });
      showToast(
        "success",
        `${jumlah} ${bahan.satuan} ${bahan.nama} dikeluarkan dari stok (${alasan}).`,
      );
      setBahanId("");
      setJumlah(0);
      setKeterangan("");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error
          ? `Gagal mencatat penyesuaian stok: ${error.message}`
          : "Gagal mencatat penyesuaian stok.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-penyesuaian"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      data-bagian="penyesuaian-stok"
    >
      <h2 id="bagian-penyesuaian" className="text-base font-semibold text-slate-900">
        Stok Rusak / Kedaluwarsa
      </h2>
      <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Keluarkan bahan dari stok TANPA penjualan (rusak/kedaluwarsa).
        Wajib lampirkan foto sebagai bukti — tidak perlu persetujuan Owner.
      </p>

      <PeringatanStokMinus daftarBahan={daftarBahan} />

      {daftarBahan.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Belum ada Bahan Baku.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="bahan-penyesuaian" className="block text-sm font-semibold text-slate-800">
              Bahan
            </label>
            <select
              id="bahan-penyesuaian"
              value={bahanId}
              onChange={(event) => setBahanId(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            >
              <option value="">Pilih bahan...</option>
              {daftarBahan.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nama} (stok: {b.stokSaatIni} {b.satuan})
                </option>
              ))}
            </select>
          </div>
          <NumberField
            id="jumlah-penyesuaian"
            label="Jumlah"
            value={jumlah}
            onChange={setJumlah}
            suffix={daftarBahan.find((b) => b.id === bahanId)?.satuan}
          />
          <div>
            <label htmlFor="alasan-penyesuaian" className="block text-sm font-semibold text-slate-800">
              Alasan
            </label>
            <select
              id="alasan-penyesuaian"
              value={alasan}
              onChange={(event) =>
                setAlasan(event.target.value as (typeof ALASAN_PENYESUAIAN)[number]["value"])
              }
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            >
              {ALASAN_PENYESUAIAN.map((opsi) => (
                <option key={opsi.value} value={opsi.value}>
                  {opsi.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="mt-3">
        <label htmlFor="keterangan-penyesuaian" className="block text-xs text-slate-500">
          Keterangan (opsional)
        </label>
        <input
          id="keterangan-penyesuaian"
          type="text"
          value={keterangan}
          onChange={(event) => setKeterangan(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
        />
      </div>

      <label
        className={[
          "mt-4 inline-flex h-[42px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-rose-600 px-4 text-sm font-semibold text-rose-700 shadow-sm",
          "motion-safe:transition motion-safe:duration-150 hover:bg-rose-50",
          sedangSimpan || daftarBahan.length === 0 ? "pointer-events-none opacity-60" : "",
        ].join(" ")}
      >
        {sedangSimpan ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Camera className="h-4 w-4" aria-hidden="true" />
        )}
        {sedangSimpan ? "Menyimpan..." : "Foto Bukti & Keluarkan Stok"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFile}
          disabled={sedangSimpan || daftarBahan.length === 0}
        />
      </label>
    </section>
  );
}

/**
 * Batas Minimal Stok — kriteria "hampir habis" DITENTUKAN MANUAL per
 * bahan (mis. Ayam = 1 kg), atas permintaan pemilik cafe. Begitu
 * stokSaatIni turun sampai atau di bawah angka ini, banner peringatan
 * otomatis muncul di Dashboard (Owner/Finance melihat lewat bahan_baku
 * langsung; Purchasing & Kasir lewat cermin stok_kasir yang ditulis di
 * sini juga). 0 = belum diatur, tidak ada peringatan untuk bahan itu.
 */
function BatasMinimalStokKartu({ daftarBahan }: { daftarBahan: BahanBaku[] }) {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [sedangSimpan, setSedangSimpan] = useState<string | null>(null);
  const [draf, setDraf] = useState<Record<string, number>>({});

  async function simpan(bahan: BahanBaku) {
    const nilai = draf[bahan.id] ?? bahan.batasMinimalStok;
    if (nilai === bahan.batasMinimalStok) return;
    setSedangSimpan(bahan.id);
    try {
      await updateDoc(doc(db, "outlets", outletId, "bahan_baku", bahan.id), {
        batasMinimalStok: nilai,
        updatedAt: serverTimestamp(),
      });
      // stokSaatIni SENGAJA tidak disertakan — kartu ini tidak pernah
      // mengubah stok, jadi tidak boleh ikut menimpa cermin stok dengan
      // nilai `bahan.stokSaatIni` yang mungkin sudah basi (lihat catatan
      // di src/shared/lib/resep.ts).
      await setMirrorStokKasir(outletId, bahan.id, {
        nama: bahan.nama,
        kategori: bahan.kategori,
        satuan: bahan.satuan,
        batasMinimalStok: nilai,
        aktif: bahan.aktif,
      });
      showToast("success", `Batas warning "${bahan.nama}" disimpan: ${nilai} ${bahan.satuan}.`);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menyimpan: ${error.message}` : "Gagal menyimpan.",
      );
    } finally {
      setSedangSimpan(null);
    }
  }

  if (daftarBahan.length === 0) return null;

  return (
    <section
      aria-labelledby="bagian-batas-stok"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="bagian-batas-stok" className="text-base font-semibold text-slate-900">
        Batas Minimal Stok (Peringatan Stok Menipis)
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Atur batas warning per bahan (mis. Ayam = 1 kg). Begitu stok turun
        sampai atau di bawah angka ini, banner peringatan otomatis muncul di
        Dashboard. Kosongkan/0 bila belum ingin diatur.
      </p>
      <ul className="mt-4 flex flex-col divide-y divide-slate-100">
        {daftarBahan.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div>
              <p className="font-medium text-slate-900">{b.nama}</p>
              <p className="text-xs text-slate-500">
                Stok saat ini: {b.stokSaatIni} {b.satuan}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                aria-label={`Batas minimal stok ${b.nama}`}
                value={draf[b.id] ?? b.batasMinimalStok}
                onChange={(event) =>
                  setDraf((prev) => ({ ...prev, [b.id]: Number(event.target.value) || 0 }))
                }
                onBlur={() => simpan(b)}
                className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
              <span className="w-8 text-xs text-slate-500">{b.satuan}</span>
              {sedangSimpan === b.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden="true" />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NotaKartu({ belanjaId, notaList }: { belanjaId: string; notaList: NotaItem[] }) {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [nominalTertera, setNominalTertera] = useState(0);
  const [sedangUnggah, setSedangUnggah] = useState(false);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (nominalTertera <= 0) {
      showToast("error", "Isi nominal yang tertera di nota sebelum mengunggah foto.");
      return;
    }

    setSedangUnggah(true);
    try {
      const hasil = await uploadNotaImage(file);
      await addDoc(collection(db, "outlets", outletId, "kas_belanja", belanjaId, "nota"), {
        cloudinaryUrl: hasil.url,
        publicId: hasil.publicId,
        nominalTertera,
        diunggahPada: serverTimestamp(),
      });
      showToast("success", "Foto nota berhasil diunggah.");
      setNominalTertera(0);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mengunggah nota: ${error.message}` : "Gagal mengunggah nota.",
      );
    } finally {
      setSedangUnggah(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-nota"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="bagian-nota" className="text-base font-semibold text-slate-900">
        Foto Nota
      </h2>

      {notaList.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {notaList.map((nota) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={nota.id}
              src={nota.cloudinaryUrl}
              alt={`Nota ${formatRupiah(nota.nominalTertera)}`}
              className="aspect-square rounded-lg border border-slate-200 object-cover"
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Belum ada foto nota diunggah.</p>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="max-w-[200px] flex-1">
          <NumberField
            id="nominal-nota"
            label="Nominal di Nota"
            value={nominalTertera}
            onChange={setNominalTertera}
            prefix="Rp"
          />
        </div>
        <label
          className={[
            "inline-flex h-[42px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-emerald-600 px-4 text-sm font-semibold text-emerald-700 shadow-sm",
            "motion-safe:transition motion-safe:duration-150 hover:bg-emerald-50",
            sedangUnggah ? "pointer-events-none opacity-60" : "",
          ].join(" ")}
        >
          {sedangUnggah ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Camera className="h-4 w-4" aria-hidden="true" />
          )}
          {sedangUnggah ? "Mengunggah..." : "Ambil / Pilih Foto"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFile}
            disabled={sedangUnggah}
          />
        </label>
      </div>
    </section>
  );
}

function SelesaikanBelanjaKartu({
  belanjaId,
  modalDiberikan,
  totalBelanja,
  sisaKas,
  sedangSelesai,
  setSedangSelesai,
}: {
  belanjaId: string;
  modalDiberikan: number;
  totalBelanja: number;
  sisaKas: number;
  sedangSelesai: boolean;
  setSedangSelesai: (v: boolean) => void;
}) {
  const outletId = useOutletId();
  const { showToast } = useToast();

  async function handleSelesai() {
    setSedangSelesai(true);
    try {
      await updateDoc(doc(db, "outlets", outletId, "kas_belanja", belanjaId), {
        totalBelanja,
        sisaKas,
        status: "selesai",
      });
      await setDoc(
        doc(db, "outlets", outletId, "summary_harian", tanggalHariIni()),
        { totalBelanja: increment(totalBelanja) },
        { merge: true },
      );
      showToast("success", "Belanja hari ini ditandai selesai.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menyelesaikan belanja: ${error.message}` : "Gagal menyelesaikan belanja.",
      );
    } finally {
      setSedangSelesai(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-selesai"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="bagian-selesai" className="text-base font-semibold text-slate-900">
        Selesaikan Belanja Hari Ini
      </h2>
      <dl className="mt-3 divide-y divide-slate-100 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between py-1">
          <dt className="text-slate-600">Modal Diberikan</dt>
          <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(modalDiberikan)}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-slate-600">Total Belanja</dt>
          <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(totalBelanja)}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-slate-600">Sisa Kas</dt>
          <dd className="font-semibold tabular-nums text-emerald-700">{formatRupiah(sisaKas)}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={handleSelesai}
        disabled={sedangSelesai}
        aria-busy={sedangSelesai}
        className={[
          "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm",
          "motion-safe:transition motion-safe:duration-150",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
          sedangSelesai
            ? "cursor-not-allowed bg-emerald-400"
            : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
        ].join(" ")}
      >
        {sedangSelesai ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        )}
        {sedangSelesai ? "Menyimpan..." : "Tandai Selesai"}
      </button>
    </section>
  );
}

// ============================================================
// Laporan Pembelian — Ekspor Excel/PDF A4 dengan filter periode
// (Harian/Mingguan/Bulanan/Tahunan + tanggal manual), atas permintaan
// pemilik cafe (poin 7 & 9: laporan pembelian di semua jabatan,
// bisa difilter Harian/Mingguan/Bulanan/Tahunan). Query dijalankan
// SENDIRI lewat getDocs (bukan bergantung ke state `belanjaAktif`
// yang cuma menampung sesi belanja HARI INI) supaya bisa merangkum
// riwayat kas_belanja pada rentang tanggal manapun.
//
// SENGAJA difilter purchasingUid == uid Purchasing yang sedang login
// — firestore.rules kas_belanja hanya mengizinkan Purchasing membaca
// dokumen miliknya sendiri (lihat isManagerOutlet() vs isPurchasingOutlet()
// di firestore.rules); Owner/Finance melihat rekap belanja SEMUA
// Purchasing lewat Dashboard/laporan lain yang punya akses isManagerOutlet().
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

interface BarisLaporanPembelian {
  tanggal: string;
  purchasingNama: string;
  sumberDana: "kas_resto" | "saldo_finance";
  modalDiberikan: number;
  totalBelanja: number;
  sisaKas: number;
  status: "terbuka" | "selesai" | "terkunci";
  /** Posisi sesi ini dalam rantai shift Purchasing hari itu (1 = shift
   *  pertama/modal ASLI; >1 = lanjutan yang modalnya cuma sisa kas
   *  dibawa terus, BUKAN suntikan dana baru — lihat handleLanjutkanShift
   *  di BelanjaNotaIsi). Dipakai supaya ringkasan Total Modal Diberikan
   *  & Total Sisa Kas di bawah tidak menjumlah uang yang sama dua kali
   *  saat satu hari punya beberapa shift berantai. */
  nomorShift: number;
}

function labelStatusBelanja(status: BarisLaporanPembelian["status"]): string {
  if (status === "selesai") return "Selesai";
  if (status === "terkunci") return "Terkunci";
  return "Terbuka";
}

function EksporLaporanPembelianKartu() {
  const { user } = useAuth();
  const outletId = useOutletId();
  const { showToast } = useToast();
  const { detail: perusahaan } = useDetailPerusahaan();
  const [dariTanggal, setDariTanggal] = useState(() => rentangPeriodeLaporan("bulanan").mulai);
  const [sampaiTanggal, setSampaiTanggal] = useState(() => rentangPeriodeLaporan("bulanan").selesai);
  const [sedangEkspor, setSedangEkspor] = useState<"excel" | "pdf" | null>(null);

  const periodeAktif =
    (["harian", "mingguan", "bulanan", "tahunan"] as PeriodeLaporan[]).find((p) => {
      const r = rentangPeriodeLaporan(p);
      return r.mulai === dariTanggal && r.selesai === sampaiTanggal;
    }) ?? null;

  async function ambilBaris(): Promise<BarisLaporanPembelian[]> {
    if (!user) return [];
    const snap = await getDocs(
      query(
        collection(db, "outlets", outletId, "kas_belanja"),
        where("purchasingUid", "==", user.uid),
        where("tanggal", ">=", dariTanggal),
        where("tanggal", "<=", sampaiTanggal),
        orderBy("tanggal"),
      ),
    );
    return snap.docs.map((d) => ({
      tanggal: d.data().tanggal ?? "",
      purchasingNama: d.data().purchasingNama ?? "",
      sumberDana: (d.data().sumberDana ?? "kas_resto") as "kas_resto" | "saldo_finance",
      modalDiberikan: d.data().modalDiberikan ?? 0,
      totalBelanja: d.data().totalBelanja ?? 0,
      sisaKas: d.data().sisaKas ?? 0,
      status: (d.data().status ?? "terbuka") as BarisLaporanPembelian["status"],
      nomorShift: d.data().nomorShift ?? 1,
    }));
  }

  // PERBAIKAN BUG (audit): "Total Modal Diberikan" & "Total Sisa Kas"
  // dulu dijumlah polos dari SEMUA baris di rentang tanggal — kalau
  // dalam satu hari Purchasing sempat "Lanjutkan Shift" 2-3 kali, modal
  // shift lanjutan (yang cuma sisa kas dibawa terus, BUKAN dana baru)
  // ikut kehitung lagi sebagai modal baru, jadi kedua total itu jadi
  // lebih besar dari uang yang sebenarnya pernah masuk/tersisa nyata.
  // Perbaikannya: kelompokkan per tanggal, lalu ambil HANYA modal shift
  // PERTAMA (nomorShift terkecil = dana asli) dan sisa kas shift
  // TERAKHIR (nomorShift terbesar = kondisi akhir hari itu) tiap
  // kelompok — jumlah kedua nilai itu tiap tanggal, baru dijumlah lagi
  // jadi total periode. "Total Belanja" TIDAK terdampak (tetap dijumlah
  // polos dari semua baris) karena belanja tiap shift memang uang nyata
  // yang keluar, bukan modal yang dibawa-bawa.
  function hitungTotalModalDanSisaKas(baris: BarisLaporanPembelian[]): {
    totalModal: number;
    totalSisaKas: number;
  } {
    const perTanggal = new Map<string, BarisLaporanPembelian[]>();
    for (const b of baris) {
      const grup = perTanggal.get(b.tanggal) ?? [];
      grup.push(b);
      perTanggal.set(b.tanggal, grup);
    }
    let totalModal = 0;
    let totalSisaKas = 0;
    for (const grup of perTanggal.values()) {
      const terurut = [...grup].sort((a, b) => a.nomorShift - b.nomorShift);
      totalModal += terurut[0].modalDiberikan;
      totalSisaKas += terurut[terurut.length - 1].sisaKas;
    }
    return { totalModal, totalSisaKas };
  }

  async function handleEkspor(jenis: "excel" | "pdf") {
    setSedangEkspor(jenis);
    try {
      const baris = await ambilBaris();
      if (baris.length === 0) {
        showToast("error", "Tidak ada belanja pada rentang tanggal itu.");
        return;
      }
      const { totalModal, totalSisaKas } = hitungTotalModalDanSisaKas(baris);
      const totalBelanja = baris.reduce((t, b) => t + b.totalBelanja, 0);
      const opsi: OpsiLaporan<BarisLaporanPembelian> = {
        judul: "LAPORAN BELANJA & PEMBELIAN",
        periode: `${formatTanggalPanjangId(dariTanggal)} s/d ${formatTanggalPanjangId(sampaiTanggal)}`,
        perusahaan,
        namaBerkas: `Laporan-Pembelian_${dariTanggal}_sd_${sampaiTanggal}`,
        kolom: [
          { judul: "Tanggal", ambil: (b) => b.tanggal, lebar: 14 },
          { judul: "Purchasing", ambil: (b) => b.purchasingNama, lebar: 18 },
          { judul: "Shift", ambil: (b) => b.nomorShift, angka: true, lebar: 8 },
          { judul: "Sumber Dana", ambil: (b) => (b.sumberDana === "saldo_finance" ? "Saldo Finance" : "Kas Resto/Outlet"), lebar: 18 },
          { judul: "Modal Diberikan", ambil: (b) => b.modalDiberikan, angka: true, lebar: 16 },
          { judul: "Total Belanja", ambil: (b) => b.totalBelanja, angka: true, lebar: 16 },
          { judul: "Sisa Kas", ambil: (b) => b.sisaKas, angka: true, lebar: 14 },
          { judul: "Status", ambil: (b) => labelStatusBelanja(b.status), lebar: 12 },
        ],
        baris,
        ringkasan: [
          { label: "Jumlah Sesi Belanja", nilai: String(baris.length) },
          {
            label: "Total Modal Diberikan",
            nilai: `${formatRupiah(totalModal)} (hanya modal shift pertama tiap hari — shift lanjutan tidak dihitung dobel)`,
          },
          { label: "Total Belanja", nilai: formatRupiah(totalBelanja) },
          {
            label: "Total Sisa Kas",
            nilai: `${formatRupiah(totalSisaKas)} (hanya sisa kas shift terakhir tiap hari)`,
          },
        ],
      };
      if (jenis === "excel") await eksporExcel(opsi);
      else await eksporPdf(opsi);
      showToast("success", `Laporan ${jenis === "excel" ? "Excel" : "PDF"} berhasil diunduh.`);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mengekspor: ${error.message}` : "Gagal mengekspor.",
      );
    } finally {
      setSedangEkspor(null);
    }
  }

  return (
    <section
      aria-labelledby="bagian-ekspor-pembelian"
      className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="bagian-ekspor-pembelian"
        className="flex items-center gap-2 text-base font-semibold text-slate-900"
      >
        <Download className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Laporan Belanja & Pembelian (Excel / PDF A4)
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Rekap sesi belanja milik Anda sendiri pada rentang tanggal terpilih.
      </p>

      {!perusahaan.nama ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          Detail Perusahaan belum diisi — kop surat akan tercetak kosong.
          Isi dulu lewat Profil Akun → Detail Perusahaan.
        </p>
      ) : null}

      <div className="mt-4">
        <PeriodePicker periodeAktif={periodeAktif} onPilih={(r) => { setDariTanggal(r.mulai); setSampaiTanggal(r.selesai); }} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="bp-ekspor-dari" className="block text-sm font-semibold text-slate-800">
            Dari Tanggal
          </label>
          <input
            id="bp-ekspor-dari"
            type="date"
            value={dariTanggal}
            onChange={(event) => setDariTanggal(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label htmlFor="bp-ekspor-sampai" className="block text-sm font-semibold text-slate-800">
            Sampai Tanggal
          </label>
          <input
            id="bp-ekspor-sampai"
            type="date"
            value={sampaiTanggal}
            onChange={(event) => setSampaiTanggal(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => handleEkspor("excel")}
          disabled={sedangEkspor !== null}
          aria-busy={sedangEkspor === "excel"}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-emerald-400"
        >
          {sedangEkspor === "excel" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          )}
          {sedangEkspor === "excel" ? "Menyiapkan..." : "Ekspor Excel"}
        </button>
        <button
          type="button"
          onClick={() => handleEkspor("pdf")}
          disabled={sedangEkspor !== null}
          aria-busy={sedangEkspor === "pdf"}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-emerald-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sedangEkspor === "pdf" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <FileText className="h-4 w-4" aria-hidden="true" />
          )}
          {sedangEkspor === "pdf" ? "Menyiapkan..." : "Ekspor PDF (A4)"}
        </button>
      </div>
    </section>
  );
}

// ============================================================
// Form Banding/Revisi Purchasing — permintaan pemilik cafe: "Form
// Banding Revisi Purchasing atau Banding transaksi belum tercatat,
// atau insiden". Analog Tanggungan Kasir (ganti rugi Kasir di
// src/app/shift/page.tsx), tapi arahnya kebalik: di sini Purchasing
// yang MENGAJUKAN koreksi/pembelaan (nota salah catat, ada belanja
// yang belum sempat diinput, atau insiden lain yang bikin Cash Opname
// Akhir Hari tidak balance), Owner/Finance yang MENINJAU (Setuju/
// Tolak) dari halaman Cash Opname (/cash-opname).
//
// SENGAJA tidak bisa diedit/dihapus sendiri oleh Purchasing setelah
// dikirim (firestore.rules: update/delete cuma Owner/Finance) — kalau
// salah ketik, ajukan baru saja, supaya jejak pengajuan tetap utuh
// untuk audit.
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

type JenisBandingPurchasing = "revisi_nota" | "transaksi_belum_tercatat" | "insiden_lainnya";

const JENIS_BANDING_OPSI: { value: JenisBandingPurchasing; label: string }[] = [
  { value: "revisi_nota", label: "Revisi Nota (salah catat)" },
  { value: "transaksi_belum_tercatat", label: "Transaksi Belum Tercatat" },
  { value: "insiden_lainnya", label: "Insiden Lainnya" },
];

const LABEL_STATUS_BANDING: Record<"menunggu" | "disetujui" | "ditolak", string> = {
  menunggu: "Menunggu Ditinjau",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
};

interface RiwayatBandingPurchasing {
  id: string;
  tanggal: string;
  jenis: JenisBandingPurchasing;
  nominal: number;
  keterangan: string;
  status: "menunggu" | "disetujui" | "ditolak";
}

function BandingPurchasingKartu() {
  const { user, profil } = useAuth();
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [tanggalBanding, setTanggalBanding] = useState(tanggalHariIni());
  const [jenis, setJenis] = useState<JenisBandingPurchasing>("revisi_nota");
  const [nominal, setNominal] = useState(0);
  const [keterangan, setKeterangan] = useState("");
  const [sedangSimpan, setSedangSimpan] = useState(false);
  const [riwayat, setRiwayat] = useState<RiwayatBandingPurchasing[]>([]);
  const [terbuka, setTerbuka] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      query(
        collection(db, "outlets", outletId, "banding_purchasing"),
        where("purchasingUid", "==", user.uid),
        orderBy("waktu", "desc"),
        limit(20),
      ),
      (snap) => {
        setRiwayat(
          snap.docs.map((d) => ({
            id: d.id,
            tanggal: d.data().tanggal ?? "",
            jenis: (d.data().jenis ?? "insiden_lainnya") as JenisBandingPurchasing,
            nominal: d.data().nominal ?? 0,
            keterangan: d.data().keterangan ?? "",
            status: (d.data().status ?? "menunggu") as RiwayatBandingPurchasing["status"],
          })),
        );
      },
    );
    return unsub;
  }, [user, outletId]);

  async function ajukanBanding() {
    if (!user || !profil) return;
    if (!keterangan.trim()) {
      showToast("error", "Keterangan wajib diisi — jelaskan nota/transaksi/insiden yang dimaksud.");
      return;
    }
    setSedangSimpan(true);
    try {
      await addDoc(collection(db, "outlets", outletId, "banding_purchasing"), {
        tanggal: tanggalBanding,
        purchasingUid: user.uid,
        purchasingNama: profil.nama,
        jenis,
        nominal,
        keterangan: keterangan.trim(),
        status: "menunggu",
        waktu: serverTimestamp(),
      });
      showToast("success", "Banding diajukan — menunggu ditinjau Owner/Finance.");
      setNominal(0);
      setKeterangan("");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mengajukan banding: ${error.message}` : "Gagal mengajukan banding.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <button
        type="button"
        onClick={() => setTerbuka((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
          Form Banding / Revisi Purchasing
        </span>
        <span className="text-xs text-slate-400">{terbuka ? "Tutup" : "Buka"}</span>
      </button>

      {terbuka ? (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-xs text-slate-500">
            Ajukan kalau ada nota yang salah catat, belanja yang belum sempat diinput, atau insiden lain yang
            membuat rekap Cash Opname tidak balance. Owner/Finance akan meninjau dari halaman Cash Opname.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="tanggal-banding" className="block text-sm font-semibold text-slate-800">
                Tanggal Terkait
              </label>
              <input
                id="tanggal-banding"
                type="date"
                value={tanggalBanding}
                onChange={(event) => setTanggalBanding(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <div>
              <label htmlFor="jenis-banding" className="block text-sm font-semibold text-slate-800">
                Jenis
              </label>
              <select
                id="jenis-banding"
                value={jenis}
                onChange={(event) => setJenis(event.target.value as JenisBandingPurchasing)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              >
                {JENIS_BANDING_OPSI.map((opsi) => (
                  <option key={opsi.value} value={opsi.value}>
                    {opsi.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <NumberField id="nominal-banding" label="Nominal Terkait (kalau ada)" value={nominal} onChange={setNominal} prefix="Rp" />

          <div>
            <label htmlFor="keterangan-banding" className="block text-sm font-semibold text-slate-800">
              Keterangan
            </label>
            <textarea
              id="keterangan-banding"
              value={keterangan}
              onChange={(event) => setKeterangan(event.target.value)}
              rows={3}
              placeholder="Jelaskan nota/transaksi/insiden yang dimaksud..."
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <button
            type="button"
            onClick={ajukanBanding}
            disabled={sedangSimpan}
            aria-busy={sedangSimpan}
            className={[
              "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm",
              "motion-safe:transition motion-safe:duration-150",
              sedangSimpan ? "cursor-not-allowed bg-emerald-400" : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
            ].join(" ")}
          >
            {sedangSimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {sedangSimpan ? "Mengajukan..." : "Ajukan Banding"}
          </button>

          {riwayat.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-slate-600">Riwayat Pengajuan Saya</p>
              <ul className="mt-2 flex flex-col divide-y divide-slate-100 rounded-lg bg-slate-50 p-2">
                {riwayat.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-2 py-2 text-xs">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">
                        {r.tanggal} · {JENIS_BANDING_OPSI.find((o) => o.value === r.jenis)?.label ?? r.jenis}
                      </p>
                      <p className="truncate text-slate-500">{r.keterangan}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${
                        r.status === "disetujui"
                          ? "bg-emerald-100 text-emerald-800"
                          : r.status === "ditolak"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {LABEL_STATUS_BANDING[r.status]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
