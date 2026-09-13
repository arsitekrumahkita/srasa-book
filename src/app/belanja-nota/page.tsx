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
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { AlertTriangle, Camera, CheckCircle2, Loader2, Plus, ShoppingBasket } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { NumberField } from "@/shared/components/number-field";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutletId } from "@/shared/lib/outlet-context";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { formatRupiah, formatRupiahSatuan } from "@/shared/lib/format";
import { uploadNotaImage } from "@/shared/lib/cloudinary";
import { setMirrorStokKasir } from "@/shared/lib/resep";
import { ambilDrafAsync, hapusDraf, useDrafOtomatis } from "@/shared/lib/draf";
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
          });
        }
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, [user, outletId]);

  async function handleMulaiBelanja() {
    if (!user || !profil) return;
    // Sumber dana "Saldo Finance" (deposito di luar Omset — permintaan
    // pemilik cafe) WAJIB cukup SEBELUM belanja dimulai, supaya saldo
    // tidak pernah minus. firestore.rules menegakkan ini juga di level
    // database (saldo_finance.saldo >= 0), pengecekan di sini murni
    // supaya Purchasing dapat pesan error yang jelas lebih dulu.
    if (sumberDana === "saldo_finance" && modalDiberikan > saldoFinance) {
      showToast(
        "error",
        `Saldo Finance tidak cukup — sisa saldo ${formatRupiah(saldoFinance)}, kurang dari ${formatRupiah(modalDiberikan)} yang diminta.`,
      );
      return;
    }

    setSedangMulai(true);
    try {
      await addDoc(collection(db, "outlets", outletId, "kas_belanja"), {
        tanggal: tanggalHariIni(),
        purchasingUid: user.uid,
        purchasingNama: profil.nama,
        modalDiberikan,
        sumberDana,
        totalBelanja: 0,
        sisaKas: modalDiberikan,
        status: "terbuka",
      });

      if (sumberDana === "saldo_finance") {
        await setDoc(
          doc(db, "outlets", outletId, "saldo_finance", ID_SALDO_FINANCE),
          { saldo: increment(-modalDiberikan) },
          { merge: true },
        );
      }

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

  if (memuat) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        <span className="sr-only">Memeriksa status belanja...</span>
      </main>
    );
  }

  if (!belanjaAktif) {
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
      </main>
    );
  }

  return (
    <BelanjaBerjalan
      belanjaId={belanjaAktif.id}
      modalDiberikan={belanjaAktif.modalDiberikan}
      sumberDana={belanjaAktif.sumberDana}
    />
  );
}

function BelanjaBerjalan({
  belanjaId,
  modalDiberikan,
  sumberDana,
}: {
  belanjaId: string;
  modalDiberikan: number;
  sumberDana: "kas_resto" | "saldo_finance";
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
          <h1 className="text-2xl font-bold text-slate-900">Belanja & Nota</h1>
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
        await setMirrorStokKasir(outletId, bahanCocok.id, {
          nama: bahanCocok.nama,
          kategori: bahanCocok.kategori,
          satuan,
          stokSaatIni: bahanCocok.stokSaatIni + qty,
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
      await setMirrorStokKasir(outletId, bahan.id, {
        nama: bahan.nama,
        kategori: bahan.kategori,
        satuan: bahan.satuan,
        stokSaatIni: bahan.stokSaatIni - jumlah,
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
      await setMirrorStokKasir(outletId, bahan.id, {
        nama: bahan.nama,
        kategori: bahan.kategori,
        satuan: bahan.satuan,
        stokSaatIni: bahan.stokSaatIni,
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
