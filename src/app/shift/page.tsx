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
import { Loader2, Minus, Plus, Save, TriangleAlert } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { AppShell } from "@/shared/components/app-shell";
import { NumberField } from "@/shared/components/number-field";
import { useAuth } from "@/shared/lib/auth-context";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { ambilResepMenu, terapkanPerubahanStok } from "@/shared/lib/resep";
import type { ResepItem } from "@/shared/types/inventaris";

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
  qty: number;
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

const KATEGORI_KAS_KELUAR = [
  "Perlengkapan",
  "Kebersihan",
  "Utilitas",
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
            qty: d.data().qty ?? 0,
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
  const totalKasKeluar = useMemo(
    () => kasKeluar.reduce((total, item) => total + item.nominal, 0),
    [kasKeluar],
  );

  async function ubahQty(item: MenuHarga, delta: number) {
    const existing = penjualan.find((p) => p.menuId === item.id);
    try {
      if (!existing) {
        if (delta <= 0) return;
        await setDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
          menuId: item.id,
          menuNama: item.nama,
          kategori: item.kategori,
          qty: delta,
          hargaJualSnapshot: item.hargaJual,
          subtotal: item.hargaJual * delta,
        });
      } else {
        const qtyBaru = existing.qty + delta;
        if (qtyBaru <= 0) {
          await setDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
            menuId: item.id,
            menuNama: item.nama,
            kategori: item.kategori,
            qty: 0,
            hargaJualSnapshot: item.hargaJual,
            subtotal: 0,
          });
        } else {
          await updateDoc(doc(db, "shift", shiftId, "penjualan", item.id), {
            qty: increment(delta),
            subtotal: increment(item.hargaJual * delta),
          });
        }
      }

      // Kurangi (atau kembalikan, bila delta negatif) stok gudang
      // otomatis lewat Resep menu ini — gagal-lunak: kalau menu belum
      // punya resep (Owner belum menyusunnya), stok gudang cukup
      // diabaikan, penjualan tetap tercatat normal.
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
                      const qty = penjualan.find((p) => p.menuId === item.id)?.qty ?? 0;
                      return (
                        <div key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{item.nama}</p>
                            <p className="text-xs text-slate-500">{formatRupiah(item.hargaJual)}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => ubahQty(item, -1)}
                              disabled={qty <= 0 || !resepSiap}
                              aria-label={`Kurangi ${item.nama}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 motion-safe:transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Minus className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <span className="w-6 text-center text-sm font-semibold tabular-nums text-slate-900">
                              {qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => ubahQty(item, 1)}
                              disabled={!resepSiap}
                              aria-label={`Tambah ${item.nama}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white motion-safe:transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Plus className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
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
  totalKasKeluar,
}: {
  shiftId: string;
  modalKasAwal: number;
  totalOmset: number;
  totalKasKeluar: number;
}) {
  const { showToast } = useToast();
  const { user, profil } = useAuth();
  const [omsetNonTunai, setOmsetNonTunai] = useState(0);
  const [kasFisik, setKasFisik] = useState(0);
  const [keteranganSelisih, setKeteranganSelisih] = useState("");
  const [sedangTutup, setSedangTutup] = useState(false);

  const omsetTunai = Math.max(totalOmset - omsetNonTunai, 0);
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
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <NumberField
          id="omset-non-tunai"
          label="Omset Non-Tunai"
          value={omsetNonTunai}
          onChange={setOmsetNonTunai}
          prefix="Rp"
          hint="Total QRIS/kartu/transfer selama shift ini."
        />
        <NumberField
          id="kas-fisik"
          label="Kas Fisik Dihitung"
          value={kasFisik}
          onChange={setKasFisik}
          prefix="Rp"
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
