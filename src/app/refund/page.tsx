"use client";

// ============================================================
// Halaman: Refund (Nota Refund) — untuk transaksi dari shift yang
// SUDAH DITUTUP/TERKUNCI, termasuk hari-hari sebelumnya. Berbeda
// dengan stepper "Refund" cepat di halaman Shift (src/app/shift/page.tsx)
// yang HANYA berlaku selagi shift hari ini masih berjalan (belum
// dikunci) — begitu shift ditutup, Firestore Rules melarang Kasir
// menulis ke subkoleksi penjualan shift itu lagi (lihat
// firestore.rules bagian shift/penjualan: "status != 'terkunci'").
//
// Karena app ini TIDAK mencatat nota per-transaksi customer (hanya
// akumulasi qty per menu per shift — lihat shift/{id}/penjualan),
// "cari nota asal" di sini artinya: pilih TANGGAL transaksi asal,
// lalu pilih SHIFT (kasir & jam berapa), lalu pilih MENU yang mau
// direfund dari shift itu. Kasir hanya bisa mencari shift MILIKNYA
// SENDIRI (lihat firestore.rules) — refund untuk shift kasir lain
// ditangani manual oleh Owner lewat Riwayat.
//
// Dokumen hasilnya disimpan di koleksi TERPISAH `nota_refund`
// (BUKAN menulis ulang ke shift/{id}/penjualan yang sudah terkunci)
// — murni catatan finansial + jejak audit yang merujuk ke shift/menu
// asal. Bahan baku SAMA SEKALI TIDAK disentuh di sini: sudah
// terpakai di hari transaksi asli dan tidak dikembalikan ke stok,
// persis seperti qtyRefund cepat di halaman Shift.
//
// Efeknya ke Laba Bersih (lihat src/shared/lib/laba-harian.ts),
// dipisah menurut metode pengembalian dana:
// - Tunai: dicatat sebagai Kas Keluar (kategori "Refund Tunai") di
//   SHIFT AKTIF KASIR HARI INI. Ini otomatis mengurangi Kas
//   Seharusnya hari ini (karena uang tunai memang keluar dari laci
//   HARI INI) sekaligus mengurangi Laba Bersih lewat totalKasKeluar
//   yang sudah ada — tidak perlu logika baru di hitungLabaHarian.
// - Non-tunai: tidak ada uang fisik yang keluar dari laci, jadi
//   dicatat sebagai pengurang Omset pada TANGGAL REFUND (bukan
//   tanggal transaksi asli, supaya laporan hari lama yang sudah
//   final tidak diutak-atik) — lihat query nota_refund di
//   hitungLabaHarian().
//
// Kasir HANYA melihat qty & Rupiah yang memang dia tahu (harga jual,
// bukan HPP/margin) — sama seperti seluruh halaman Shift.
//
// Top-level components, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { RequireAuth } from "@/shared/components/require-auth";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { NumberField } from "@/shared/components/number-field";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutletId } from "@/shared/lib/outlet-context";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";

const DAFTAR_ALASAN = [
  "Rasa/kualitas tidak sesuai",
  "Salah pesan dari kasir",
  "Pesanan dibatalkan",
  "Lainnya",
] as const;

function tanggalHariIni(): string {
  const sekarang = new Date();
  return `${sekarang.getFullYear()}-${String(sekarang.getMonth() + 1).padStart(2, "0")}-${String(
    sekarang.getDate(),
  ).padStart(2, "0")}`;
}

interface ShiftLampau {
  id: string;
  tanggal: string;
  status: string;
  waktuBuka: string;
}

interface ItemRefundable {
  menuId: string;
  menuNama: string;
  qtyAsli: number;
  hargaSatuan: number;
  sudahDirefund: number;
}

export default function RefundPage() {
  return (
    <RequireAuth peranDiizinkan={["kasir"]}>
      <AppShell>
        <RefundIsi />
      </AppShell>
    </RequireAuth>
  );
}

function RefundIsi() {
  const { user, profil } = useAuth();
  const outletId = useOutletId();
  const { showToast } = useToast();

  const [tanggal, setTanggal] = useState(tanggalHariIni());
  const [memuatShift, setMemuatShift] = useState(false);
  const [daftarShift, setDaftarShift] = useState<ShiftLampau[]>([]);
  const [shiftDipilih, setShiftDipilih] = useState<ShiftLampau | null>(null);

  const [memuatItem, setMemuatItem] = useState(false);
  const [daftarItem, setDaftarItem] = useState<ItemRefundable[]>([]);
  const [itemDipilih, setItemDipilih] = useState<ItemRefundable | null>(null);

  const [jumlah, setJumlah] = useState(1);
  const [alasan, setAlasan] = useState<(typeof DAFTAR_ALASAN)[number]>(DAFTAR_ALASAN[0]);
  const [alasanLainnya, setAlasanLainnya] = useState("");
  const [metode, setMetode] = useState<"tunai" | "non_tunai">("tunai");
  const [sedangSimpan, setSedangSimpan] = useState(false);

  // --- Langkah 1: cari shift MILIK KASIR INI pada tanggal yang dipilih ---
  useEffect(() => {
    if (!user) return;
    let dibatalkan = false;
    Promise.resolve().then(() => {
      if (dibatalkan) return;
      setShiftDipilih(null);
      setItemDipilih(null);
      setDaftarItem([]);
      setMemuatShift(true);
    });
    getDocs(
      query(collection(db, "outlets", outletId, "shift"), where("kasirUid", "==", user.uid), where("tanggal", "==", tanggal)),
    )
      .then((snap) => {
        setDaftarShift(
          snap.docs
            .map((d) => ({
              id: d.id,
              tanggal: d.data().tanggal ?? "",
              status: d.data().status ?? "buka",
              waktuBuka: d.data().waktuBuka?.toDate?.()?.toLocaleTimeString("id-ID") ?? "",
            }))
            // Shift yang masih berjalan HARI INI dilayani stepper Refund
            // cepat di halaman Shift, bukan di sini — supaya tidak ada dua
            // jalur yang saling tumpang tindih untuk kasus yang sama.
            .filter((s) => s.status !== "buka"),
        );
      })
      .catch(() => {
        showToast("error", "Gagal memuat daftar shift pada tanggal itu.");
      })
      .finally(() => setMemuatShift(false));
    return () => {
      dibatalkan = true;
    };
  }, [user, tanggal, outletId, showToast]);

  // --- Langkah 2: ambil item yang terjual di shift itu + berapa yang
  // sudah pernah direfund sebelumnya (supaya tidak bisa direfund dobel
  // melebihi qty yang sungguh dibayar) ---
  useEffect(() => {
    if (!shiftDipilih) return;
    let dibatalkan = false;
    Promise.resolve().then(() => {
      if (dibatalkan) return;
      setItemDipilih(null);
      setMemuatItem(true);
    });

    Promise.all([
      getDocs(collection(db, "outlets", outletId, "shift", shiftDipilih.id, "penjualan")),
      getDocs(query(collection(db, "outlets", outletId, "nota_refund"), where("shiftId", "==", shiftDipilih.id))),
    ])
      .then(([penjualanSnap, refundSnap]) => {
        const sudahDirefundPerMenu = new Map<string, number>();
        for (const r of refundSnap.docs) {
          const rd = r.data();
          const menuId = rd.menuId as string | undefined;
          if (!menuId) continue;
          sudahDirefundPerMenu.set(menuId, (sudahDirefundPerMenu.get(menuId) ?? 0) + (rd.qty ?? 0));
        }

        const item: ItemRefundable[] = [];
        for (const p of penjualanSnap.docs) {
          const pd = p.data();
          const qtyAsli: number = pd.qty ?? 0;
          if (qtyAsli <= 0) continue; // Bonus/Gratis tidak pernah dibayar, tidak ada yang bisa direfund.
          const sudahDirefund = sudahDirefundPerMenu.get(p.id) ?? 0;
          if (sudahDirefund >= qtyAsli) continue; // Sudah habis direfund semua.
          item.push({
            menuId: p.id,
            menuNama: pd.menuNama ?? "",
            qtyAsli,
            hargaSatuan: pd.hargaJualSnapshot ?? 0,
            sudahDirefund,
          });
        }
        setDaftarItem(item);
      })
      .catch(() => {
        showToast("error", "Gagal memuat daftar menu yang terjual di shift itu.");
      })
      .finally(() => setMemuatItem(false));
    return () => {
      dibatalkan = true;
    };
  }, [shiftDipilih, outletId, showToast]);

  function pilihItem(item: ItemRefundable) {
    setItemDipilih(item);
    setJumlah(1);
    setAlasan(DAFTAR_ALASAN[0]);
    setAlasanLainnya("");
    setMetode("tunai");
  }

  async function simpanRefund() {
    if (!user || !profil || !shiftDipilih || !itemDipilih) return;
    const sisa = itemDipilih.qtyAsli - itemDipilih.sudahDirefund;
    if (jumlah < 1 || jumlah > sisa) {
      showToast("error", `Jumlah refund harus antara 1 dan ${sisa} (sisa yang bisa direfund).`);
      return;
    }
    if (alasan === "Lainnya" && alasanLainnya.trim() === "") {
      showToast("error", "Isi keterangan alasan refund terlebih dahulu.");
      return;
    }

    setSedangSimpan(true);
    try {
      const totalRefund = jumlah * itemDipilih.hargaSatuan;
      const tanggalRefund = tanggalHariIni();

      // Perbaikan bug: validasi "jumlah <= sisa" di atas HANYA memakai
      // `sudahDirefund` dari state (hasil getDocs sesaat sebelumnya) —
      // kalau ADA refund lain untuk menu & shift yang SAMA tersimpan
      // tepat di antara pembacaan itu dan addDoc di sini (mis. dua tab
      // terbuka, atau dua Kasir berbeda kebetulan memproses refund untuk
      // shift yang sama), qty yang direfund bisa melebihi qty yang
      // sungguh dibayar tanpa terdeteksi — karena addDoc lama TIDAK
      // PERNAH membaca ulang total refund sebelum menyimpan.
      //
      // Diperbaiki dengan runTransaction() ke SATU dokumen counter yang
      // diketahui sebelumnya (nota_refund_counter/{shiftId}__{menuId}) —
      // BUKAN meng-query ulang koleksi nota_refund (Firestore transaction
      // tidak bisa membaca hasil query, hanya dokumen yang refnya sudah
      // diketahui). Counter ini dibaca DAN ditulis di transaksi yang
      // sama dengan pembuatan nota_refund-nya, jadi dua penyimpanan yang
      // beririsan waktu dijamin Firestore tidak akan saling menimpa —
      // salah satu akan otomatis diulang oleh SDK, atau gagal dengan
      // pesan jelas di bawah kalau total sudah kepenuhan.
      //
      // Migrasi data lama: dokumen counter belum tentu ada untuk shift
      // yang sudah punya riwayat Nota Refund dari SEBELUM perbaikan ini
      // — kalau belum ada, dasarnya diambil dari `itemDipilih.sudahDirefund`
      // (hasil getDocs saat memuat daftar menu) alih-alih dianggap 0,
      // supaya refund lama tidak "hilang" dari hitungan sekali saja saat
      // migrasi. Setelah itu counter menjadi satu-satunya sumber
      // kebenaran yang otoritatif.
      const counterRef = doc(
        db,
        "outlets",
        outletId,
        "nota_refund_counter",
        `${shiftDipilih.id}__${itemDipilih.menuId}`,
      );
      const notaRefundRef = doc(collection(db, "outlets", outletId, "nota_refund"));

      await runTransaction(db, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        const sudahDirefundTerkini = counterSnap.exists()
          ? (counterSnap.data().qtyDirefund ?? 0)
          : itemDipilih.sudahDirefund;
        const totalBaru = sudahDirefundTerkini + jumlah;
        if (totalBaru > itemDipilih.qtyAsli) {
          throw new Error(
            `Refund melebihi batas — saat ini sudah ${sudahDirefundTerkini} dari ${itemDipilih.qtyAsli} "${itemDipilih.menuNama}" direfund (kemungkinan ada refund lain yang baru saja tersimpan). Muat ulang halaman untuk melihat sisa terkini.`,
          );
        }
        tx.set(
          counterRef,
          { shiftId: shiftDipilih.id, menuId: itemDipilih.menuId, qtyDirefund: totalBaru },
          { merge: true },
        );
        tx.set(notaRefundRef, {
          shiftId: shiftDipilih.id,
          tanggalTransaksiAsal: shiftDipilih.tanggal,
          menuId: itemDipilih.menuId,
          menuNama: itemDipilih.menuNama,
          qty: jumlah,
          hargaSatuanSaatTransaksi: itemDipilih.hargaSatuan,
          totalRefund,
          alasan: alasan === "Lainnya" ? alasanLainnya.trim() : alasan,
          metode,
          kasirUid: user.uid,
          kasirNama: profil.nama,
          tanggalRefund,
          waktuDibuat: serverTimestamp(),
        });
      });

      if (metode === "tunai") {
        // Uang tunai keluar dari laci HARI INI -> harus tercatat sebagai
        // Kas Keluar di shift aktif kasir hari ini, supaya Kas Seharusnya
        // saat Tutup Shift nanti tetap cocok dengan uang fisik di laci.
        const shiftHariIniSnap = await getDocs(
          query(
            collection(db, "outlets", outletId, "shift"),
            where("kasirUid", "==", user.uid),
            where("tanggal", "==", tanggalRefund),
          ),
        );
        const shiftHariIni = shiftHariIniSnap.docs.find((d) => (d.data().status ?? "buka") === "buka");

        if (!shiftHariIni) {
          showToast(
            "error",
            "Nota Refund tersimpan, TAPI shift hari ini belum dibuka — buka halaman Shift dulu, lalu catat manual Kas Keluar kategori \"Refund Tunai\" sebesar " +
              formatRupiah(totalRefund) +
              " supaya kas fisik tetap cocok.",
          );
        } else {
          await addDoc(collection(db, "outlets", outletId, "shift", shiftHariIni.id, "kas_keluar"), {
            kategori: "Refund Tunai",
            nominal: totalRefund,
            keterangan: `Refund "${itemDipilih.menuNama}" x${jumlah} dari transaksi ${shiftDipilih.tanggal}`,
            waktu: serverTimestamp(),
          });
          await updateDoc(doc(db, "outlets", outletId, "shift", shiftHariIni.id), {
            totalKasKeluar: increment(totalRefund),
          });
        }
      }

      showToast("success", "Nota Refund berhasil disimpan.");
      // Perbarui daftar item supaya sisa yang bisa direfund langsung akurat.
      setDaftarItem((sebelumnya) =>
        sebelumnya
          .map((it) =>
            it.menuId === itemDipilih.menuId
              ? { ...it, sudahDirefund: it.sudahDirefund + jumlah }
              : it,
          )
          .filter((it) => it.sudahDirefund < it.qtyAsli),
      );
      setItemDipilih(null);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menyimpan Nota Refund: ${error.message}` : "Gagal menyimpan Nota Refund.",
      );
    } finally {
      setSedangSimpan(false);
    }
  }

  return (
    <main className="animasi-masuk mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <KickerOutlet />
        <h1 className="text-2xl font-bold text-slate-900">Refund</h1>
        <p className="mt-1 text-sm text-slate-600">
          Untuk transaksi dari shift yang sudah ditutup (hari ini atau hari sebelumnya). Kalau
          transaksinya masih di shift yang sedang berjalan hari ini, pakai tombol panah Bonus/Refund
          langsung di halaman Shift.
        </p>
      </header>

      {/* Alur 3 langkah (pilih shift -> pilih menu -> isi refund)
          ditampilkan berdampingan di layar lebar sebagai 3 kolom,
          bukan ditumpuk vertikal — kelihatan seluruh progres sekaligus
          tanpa scroll. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 xl:items-start">
        <section className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <label htmlFor="rf-tanggal" className="block text-sm font-semibold text-slate-800">
            Tanggal transaksi asal
          </label>
          <input
            id="rf-tanggal"
            type="date"
            value={tanggal}
            max={tanggalHariIni()}
            onChange={(e) => setTanggal(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 motion-safe:transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700"
          />

          <div className="mt-4">
            {memuatShift ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
              </div>
            ) : daftarShift.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                Tidak ada shift Anda yang sudah ditutup pada tanggal ini.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {daftarShift.map((s) => {
                  const aktif = shiftDipilih?.id === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setShiftDipilih(s)}
                        className={`flex min-h-11 w-full items-center justify-between rounded-lg border px-4 py-2 text-left text-sm motion-safe:transition active:scale-[0.99] ${
                          aktif
                            ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                            : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                        }`}
                      >
                        <span>Shift {s.tanggal}{s.waktuBuka ? ` · buka ${s.waktuBuka}` : ""}</span>
                        <span className="text-xs uppercase tracking-wide text-slate-500">{s.status}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {shiftDipilih ? (
          <section className="kartu-interaktif animasi-masuk-halus rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800">Pilih menu yang direfund</h2>
            <div className="mt-3">
              {memuatItem ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
                </div>
              ) : daftarItem.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                  Tidak ada menu yang masih bisa direfund dari shift ini (semua sudah pernah direfund, atau
                  belum ada penjualan reguler).
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {daftarItem.map((it) => {
                    const sisa = it.qtyAsli - it.sudahDirefund;
                    const aktif = itemDipilih?.menuId === it.menuId;
                    return (
                      <li key={it.menuId}>
                        <button
                          type="button"
                          onClick={() => pilihItem(it)}
                          className={`flex min-h-11 w-full items-center justify-between rounded-lg border px-4 py-2 text-left text-sm motion-safe:transition active:scale-[0.99] ${
                            aktif
                              ? "border-rose-500 bg-rose-50 text-rose-900"
                              : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                          }`}
                        >
                          <span>
                            {it.menuNama}
                            <span className="ml-2 text-xs text-slate-500">
                              terjual {it.qtyAsli}
                              {it.sudahDirefund > 0 ? ` · sudah direfund ${it.sudahDirefund}` : ""} · sisa{" "}
                              {sisa}
                            </span>
                          </span>
                          <span className="font-medium tabular-nums">{formatRupiah(it.hargaSatuan)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        ) : null}

        {itemDipilih ? (
          <section className="kartu-interaktif animasi-masuk-halus rounded-xl border border-rose-200 bg-rose-50/60 p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-rose-900">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Refund &ldquo;{itemDipilih.menuNama}&rdquo;
            </h2>

            <div className="mt-4">
              <NumberField
                id="rf-jumlah"
                label={`Jumlah (maks. ${itemDipilih.qtyAsli - itemDipilih.sudahDirefund})`}
                value={jumlah}
                onChange={setJumlah}
                min={1}
                step={1}
              />
            </div>

            <div className="mt-4">
              <label htmlFor="rf-alasan" className="block text-sm font-semibold text-slate-800">
                Alasan refund
              </label>
              <select
                id="rf-alasan"
                value={alasan}
                onChange={(e) => setAlasan(e.target.value as (typeof DAFTAR_ALASAN)[number])}
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 motion-safe:transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700"
              >
                {DAFTAR_ALASAN.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              {alasan === "Lainnya" ? (
                <textarea
                  value={alasanLainnya}
                  onChange={(e) => setAlasanLainnya(e.target.value)}
                  rows={2}
                  placeholder="Tulis alasannya di sini..."
                  className="mt-2 w-full whitespace-pre-line rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 motion-safe:transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700"
                />
              ) : null}
            </div>

            <div className="mt-4">
              <span className="block text-sm font-semibold text-slate-800">Metode pengembalian dana</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(
                  [
                    { nilai: "tunai" as const, label: "Tunai" },
                    { nilai: "non_tunai" as const, label: "Non-tunai" },
                  ]
                ).map((opsi) => (
                  <button
                    key={opsi.nilai}
                    type="button"
                    onClick={() => setMetode(opsi.nilai)}
                    className={`min-h-11 rounded-lg border px-3 text-sm font-medium motion-safe:transition active:scale-[0.97] ${
                      metode === opsi.nilai
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {opsi.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {metode === "tunai"
                  ? "Akan otomatis tercatat sebagai Kas Keluar di shift Anda hari ini, supaya kas fisik tetap cocok."
                  : "Tidak ada uang tunai yang keluar dari laci — Omset hari ini otomatis dikurangi sejumlah refund ini."}
              </p>
            </div>

            <div className="mt-4 rounded-lg bg-white/70 px-3 py-2 text-sm text-slate-700">
              Total dikembalikan:{" "}
              <span className="font-semibold tabular-nums text-slate-900">
                {formatRupiah(jumlah * itemDipilih.hargaSatuan)}
              </span>
            </div>

            <button
              type="button"
              onClick={simpanRefund}
              disabled={sedangSimpan}
              className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white shadow-sm motion-safe:transition active:scale-[0.98] disabled:opacity-60"
            >
              {sedangSimpan ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              Simpan Nota Refund
            </button>
          </section>
        ) : null}
      </div>
    </main>
  );
}
