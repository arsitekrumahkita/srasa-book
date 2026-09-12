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
import { Camera, CheckCircle2, Loader2, Plus, ShoppingBasket } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { AppShell } from "@/shared/components/app-shell";
import { NumberField } from "@/shared/components/number-field";
import { useAuth } from "@/shared/lib/auth-context";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { uploadNotaImage } from "@/shared/lib/cloudinary";

interface BahanBaku {
  id: string;
  nama: string;
  satuanBeli: string;
  hargaSatuanTerakhir: number;
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
  status: "terbuka" | "selesai" | "terkunci";
}

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
  const { showToast } = useToast();

  const [memuat, setMemuat] = useState(true);
  const [belanjaAktif, setBelanjaAktif] = useState<BelanjaAktif | null>(null);
  const [modalDiberikan, setModalDiberikan] = useState(0);
  const [sedangMulai, setSedangMulai] = useState(false);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "kas_belanja"),
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
            status: "terbuka",
          });
        }
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, [user]);

  async function handleMulaiBelanja() {
    if (!user || !profil) return;
    setSedangMulai(true);
    try {
      await addDoc(collection(db, "kas_belanja"), {
        tanggal: tanggalHariIni(),
        purchasingUid: user.uid,
        purchasingNama: profil.nama,
        modalDiberikan,
        totalBelanja: 0,
        sisaKas: modalDiberikan,
        status: "terbuka",
      });
      showToast("success", `Belanja hari ini dimulai dengan kas ${formatRupiah(modalDiberikan)}.`);
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

  return <BelanjaBerjalan belanjaId={belanjaAktif.id} modalDiberikan={belanjaAktif.modalDiberikan} />;
}

function BelanjaBerjalan({ belanjaId, modalDiberikan }: { belanjaId: string; modalDiberikan: number }) {
  const [daftarBahan, setDaftarBahan] = useState<BahanBaku[]>([]);
  const [itemBelanja, setItemBelanja] = useState<ItemBelanja[]>([]);
  const [notaList, setNotaList] = useState<NotaItem[]>([]);
  const [sedangSelesai, setSedangSelesai] = useState(false);

  useEffect(() => {
    const unsubBahan = onSnapshot(collection(db, "bahan_baku"), (snap) => {
      setDaftarBahan(
        snap.docs.map((d) => ({
          id: d.id,
          nama: d.data().nama ?? "",
          satuanBeli: d.data().satuanBeli ?? "pcs",
          hargaSatuanTerakhir: d.data().hargaSatuanTerakhir ?? 0,
        })),
      );
    });
    const unsubItem = onSnapshot(collection(db, "kas_belanja", belanjaId, "item"), (snap) => {
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
    const unsubNota = onSnapshot(collection(db, "kas_belanja", belanjaId, "nota"), (snap) => {
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
  }, [belanjaId]);

  const totalBelanja = useMemo(
    () => itemBelanja.reduce((total, item) => total + item.subtotal, 0),
    [itemBelanja],
  );
  const sisaKas = modalDiberikan - totalBelanja;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            SRASA BOOK
          </p>
          <h1 className="text-2xl font-bold text-slate-900">Belanja & Nota</h1>
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
  const [namaBahan, setNamaBahan] = useState("");
  const [qty, setQty] = useState(1);
  const [satuan, setSatuan] = useState("pcs");
  const [hargaSatuan, setHargaSatuan] = useState(0);
  const [sedangSimpan, setSedangSimpan] = useState(false);

  async function handleTambahItem() {
    if (!namaBahan.trim()) {
      showToast("error", "Nama bahan wajib diisi.");
      return;
    }
    if (qty <= 0 || hargaSatuan <= 0) {
      showToast("error", "Jumlah dan harga satuan harus lebih besar dari 0.");
      return;
    }

    setSedangSimpan(true);
    try {
      const subtotal = qty * hargaSatuan;
      const bahanCocok = daftarBahan.find(
        (b) => b.nama.trim().toLowerCase() === namaBahan.trim().toLowerCase(),
      );

      await addDoc(collection(db, "kas_belanja", belanjaId, "item"), {
        bahanId: bahanCocok?.id ?? null,
        bahanNama: namaBahan.trim(),
        qty,
        satuan,
        hargaSatuan,
        subtotal,
      });
      await updateDoc(doc(db, "kas_belanja", belanjaId), { totalBelanja: increment(subtotal) });

      if (bahanCocok) {
        // Bahan sudah ada -> cek kenaikan harga & catat riwayat.
        const hargaLama = bahanCocok.hargaSatuanTerakhir;
        if (hargaLama > 0 && hargaSatuan !== hargaLama) {
          const selisihPersen = (hargaSatuan - hargaLama) / hargaLama;
          await addDoc(collection(db, "bahan_baku", bahanCocok.id, "riwayat_harga"), {
            harga: hargaSatuan,
            tanggal: tanggalHariIni(),
            selisihPersen,
          });
          if (selisihPersen > AMBANG_KENAIKAN_HARGA) {
            await addDoc(collection(db, "notifikasi"), {
              untukPeran: "superadmin",
              tipe: "kenaikan_harga_bahan",
              prioritas: "sedang",
              judul: "Kenaikan Harga Bahan",
              pesan: `Harga "${namaBahan.trim()}" naik ${(selisihPersen * 100).toFixed(0)}% menjadi ${formatRupiah(hargaSatuan)}.`,
              dibaca: false,
              waktu: serverTimestamp(),
            });
          }
        }
        await updateDoc(doc(db, "bahan_baku", bahanCocok.id), {
          hargaSatuanTerakhir: hargaSatuan,
          updatedAt: serverTimestamp(),
        });
      } else {
        // Bahan baru -> buat dokumen inventaris dasar (Owner bisa
        // merapikan kategori/konversi satuan kemudian).
        await setDoc(doc(collection(db, "bahan_baku")), {
          nama: namaBahan.trim(),
          kategori: "Umum",
          satuanBeli: satuan,
          satuanPakai: satuan,
          faktorKonversi: 1,
          hargaSatuanTerakhir: hargaSatuan,
          stokSaatIni: 0,
          aktif: true,
          updatedAt: serverTimestamp(),
        });
      }

      showToast("success", `${namaBahan.trim()} ditambahkan: ${formatRupiah(subtotal)}.`);
      setNamaBahan("");
      setQty(1);
      setHargaSatuan(0);
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
                {item.bahanNama} · {item.qty} {item.satuan} × {formatRupiah(item.hargaSatuan)}
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
        <NumberField id="qty-item" label="Jumlah" value={qty} onChange={setQty} suffix={satuan} step={1} />
        <NumberField id="harga-satuan" label="Harga Satuan" value={hargaSatuan} onChange={setHargaSatuan} prefix="Rp" />
      </div>
      <div className="mt-3 flex items-end gap-3">
        <div className="max-w-[140px] flex-1">
          <label htmlFor="satuan-item" className="block text-xs text-slate-500">
            Satuan
          </label>
          <input
            id="satuan-item"
            type="text"
            value={satuan}
            onChange={(event) => setSatuan(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
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

function NotaKartu({ belanjaId, notaList }: { belanjaId: string; notaList: NotaItem[] }) {
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
      await addDoc(collection(db, "kas_belanja", belanjaId, "nota"), {
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
  const { showToast } = useToast();

  async function handleSelesai() {
    setSedangSelesai(true);
    try {
      await updateDoc(doc(db, "kas_belanja", belanjaId), {
        totalBelanja,
        sisaKas,
        status: "selesai",
      });
      await setDoc(
        doc(db, "summary_harian", tanggalHariIni()),
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
