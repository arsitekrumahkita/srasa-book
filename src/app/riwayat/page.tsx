"use client";

// ============================================================
// Halaman: Riwayat (PRD bagian 9.6) — "Prioritas: P0 (riwayat
// dasar)". Peran: SUPERADMIN saja untuk versi ini (Owner melihat
// semua shift lintas Kasir, lihat firestore.rules bagian shift:
// hanya Owner yang boleh `list` seluruh koleksi).
//
// BELUM ADA di versi ini (P1 lanjutan): filter rentang tanggal,
// laporan bulanan/tahunan dengan perbandingan periode, dan tombol
// Export Excel/PDF (PRD menyebut SheetJS & jsPDF, sisi klien murni
// — akan ditambah sebagai modul terpisah, bukan bagian riwayat
// dasar ini).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
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
  AlertTriangle,
  Calculator,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Lock,
  TrendingDown,
} from "lucide-react";
import { SearchBar, cocokDenganPencarian } from "@/shared/components/search-bar";
import { PeriodePicker } from "@/shared/components/periode-picker";
import { rentangPeriodeLaporan } from "@/shared/lib/periode-laporan";
import { RequireAuth } from "@/shared/components/require-auth";
import { useOutletId } from "@/shared/lib/outlet-context";
import { useAuth } from "@/shared/lib/auth-context";
import { KickerOutlet } from "@/shared/components/kicker-outlet";
import { AppShell } from "@/shared/components/app-shell";
import { useToast } from "@/shared/components/toast";
import { db } from "@/shared/lib/firebase";
import { formatRupiah } from "@/shared/lib/format";
import { hitungLabaHarian } from "@/shared/lib/laba-harian";
import { daftarTanggalAntara } from "@/shared/lib/tren-tanggal";
import { eksporExcel, eksporPdf, type OpsiLaporan } from "@/shared/lib/ekspor";
import { useDetailPerusahaan } from "@/shared/lib/perusahaan";
import { NumberField } from "@/shared/components/number-field";
import type { TanggunganKasir } from "@/shared/types/inventaris";

interface RiwayatShift {
  id: string;
  tanggal: string;
  kasirUid: string;
  kasirNama: string;
  modalKasAwal: number;
  totalOmset: number;
  totalKasKeluar: number;
  selisihKas: number;
  status: "buka" | "tutup" | "terkunci";
}

export default function RiwayatPage() {
  return (
    <RequireAuth peranDiizinkan={["superadmin", "finance"]}>
      <AppShell>
        <RiwayatIsi />
      </AppShell>
    </RequireAuth>
  );
}

function RiwayatIsi() {
  const outletId = useOutletId();
  const [daftarShift, setDaftarShift] = useState<RiwayatShift[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [dibuka, setDibuka] = useState<string | null>(null);
  const [pencarian, setPencarian] = useState("");
  const daftarShiftTersaring = daftarShift.filter((shift) =>
    cocokDenganPencarian(pencarian, shift.kasirNama, shift.tanggal, shift.status),
  );

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "shift"), orderBy("tanggal", "desc")),
      (snap) => {
        setDaftarShift(
          snap.docs.map((d) => ({
            id: d.id,
            tanggal: d.data().tanggal ?? "",
            kasirUid: d.data().kasirUid ?? "",
            kasirNama: d.data().kasirNama ?? "",
            modalKasAwal: d.data().modalKasAwal ?? 0,
            totalOmset: d.data().totalOmset ?? 0,
            totalKasKeluar: d.data().totalKasKeluar ?? 0,
            selisihKas: d.data().selisihKas ?? 0,
            status: d.data().status ?? "buka",
          })),
        );
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, [outletId]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <KickerOutlet />
        <h1 className="text-2xl font-bold text-slate-900">Riwayat Shift</h1>
        <p className="mt-1 text-sm text-slate-600">
          Daftar seluruh shift, terbaru di atas.
        </p>
      </header>

      <div className="mb-6 flex flex-col gap-6">
        <TanggunganKasirKartu />
        <RiwayatRefundKartu />
        {/* Ekspor Laporan & Hitung Ulang sama-sama panel aksi ringkas —
            berdampingan di layar lebar supaya tidak ada ruang kosong,
            otomatis turun jadi 1 kolom di layar sempit. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <EksporLaporanKartu daftarShift={daftarShift} />
          <HitungUlangLabaKartu />
        </div>

        <EksporLabaRugiKartu />
      </div>

      {daftarShift.length > 0 ? (
        <div className="mb-4 max-w-sm">
          <SearchBar
            id="cari-shift"
            value={pencarian}
            onChange={setPencarian}
            placeholder="Cari nama kasir, tanggal, atau status..."
            ariaLabel="Cari riwayat shift"
          />
        </div>
      ) : null}

      {memuat ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      ) : daftarShift.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
          Belum ada riwayat shift.
        </p>
      ) : daftarShiftTersaring.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
          Tidak ada shift yang cocok dengan pencarian &quot;{pencarian}&quot;.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
          {daftarShiftTersaring.map((shift) => {
            const terbuka = dibuka === shift.id;
            return (
              <li key={shift.id}>
                <button
                  type="button"
                  onClick={() => setDibuka(terbuka ? null : shift.id)}
                  aria-expanded={terbuka}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left motion-safe:transition motion-safe:duration-150 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-700"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{shift.tanggal}</p>
                    <p className="text-xs text-slate-500">
                      {shift.kasirNama} ·{" "}
                      <StatusBadge status={shift.status} />
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatRupiah(shift.totalOmset)}
                    </p>
                    {terbuka ? (
                      <ChevronUp className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    )}
                  </div>
                </button>
                {terbuka ? (
                  <dl className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-slate-500">Total Omset</dt>
                      <dd className="font-medium tabular-nums text-slate-900">
                        {formatRupiah(shift.totalOmset)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Total Kas Keluar</dt>
                      <dd className="font-medium tabular-nums text-slate-900">
                        {formatRupiah(shift.totalKasKeluar)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Selisih Kas</dt>
                      <dd
                        className={`font-medium tabular-nums ${shift.selisihKas === 0 ? "text-emerald-700" : "text-amber-700"}`}
                      >
                        {formatRupiah(shift.selisihKas)}
                      </dd>
                    </div>
                  </dl>
                ) : null}
                {terbuka && shift.status === "buka" ? <TutupPaksaShiftKartu shift={shift} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

/**
 * Tutup Paksa Shift — fitur "Force Close" (permintaan pemilik cafe,
 * dobel sebagai perbaikan bug: shift yang tersangkut berstatus "buka"
 * selamanya, mis. Kasir lupa menutupnya atau akunnya keburu
 * dinonaktifkan sebelum sempat Tutup Shift). Dulu shift seperti ini
 * TIDAK ADA jalan keluarnya sama sekali dari sisi aplikasi — sekarang
 * Owner/Finance bisa menutupnya dari Riwayat, memakai pola tulis yang
 * SAMA PERSIS dengan Tutup Shift oleh Kasir sendiri (lihat
 * TutupShiftKartu di src/app/shift/page.tsx: update shift ke
 * "terkunci" + increment summary_harian + catat tanggungan_kasir bila
 * kurang) — supaya ringkasan harian & tanggungan tetap konsisten,
 * hanya field ditutupPaksaOlehUid/Nama yang menandai ini penutupan
 * admin, bukan penutupan normal oleh Kasir yang bersangkutan.
 *
 * Firestore Rules (lihat firestore.rules bagian shift & tanggungan_kasir):
 * Owner/Finance (isManagerOutlet) sudah punya izin admin override untuk
 * MENGUBAH shift kapan pun (tidak dibatasi status seperti Kasir), dan
 * SEKARANG juga diberi izin MEMBUAT tanggungan_kasir (sebelumnya hanya
 * Kasir sendiri boleh) supaya jalur ini bisa mencatat tanggungan atas
 * nama Kasir asli shift tsb.
 */
function TutupPaksaShiftKartu({ shift }: { shift: RiwayatShift }) {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const { user, profil } = useAuth();
  const [memuatTotal, setMemuatTotal] = useState(true);
  const [totalOmsetTunai, setTotalOmsetTunai] = useState(0);
  const [totalOmsetNonTunai, setTotalOmsetNonTunai] = useState(0);
  const [totalKasKeluarDihitung, setTotalKasKeluarDihitung] = useState(0);
  const [kasFisik, setKasFisik] = useState(0);
  const [keterangan, setKeterangan] = useState("");
  const [sedangTutup, setSedangTutup] = useState(false);

  useEffect(() => {
    let dibatalkan = false;
    async function muat() {
      setMemuatTotal(true);
      const [penjualanSnap, kasKeluarSnap] = await Promise.all([
        getDocs(collection(db, "outlets", outletId, "shift", shift.id, "penjualan")),
        getDocs(collection(db, "outlets", outletId, "shift", shift.id, "kas_keluar")),
      ]);
      if (dibatalkan) return;
      let tunai = 0;
      let nonTunai = 0;
      for (const item of penjualanSnap.docs) {
        const d = item.data();
        if (d.subtotalTunai !== undefined || d.subtotalNonTunai !== undefined) {
          tunai += d.subtotalTunai ?? 0;
          nonTunai += d.subtotalNonTunai ?? 0;
        } else {
          // Item lama dari sebelum rincian metode bayar per-item ada —
          // shift ini tidak pernah ditutup jadi tidak ada tebakan manual
          // omsetNonTunai untuk dijadikan fallback (beda dari
          // hitungLabaHarian). Diasumsikan tunai semua supaya Kas
          // Seharusnya di bawah tetap masuk akal untuk dicocokkan Owner
          // dengan laci fisik, BUKAN diam-diam hilang dari perhitungan.
          tunai += d.subtotal ?? 0;
        }
      }
      let kasKeluar = 0;
      for (const k of kasKeluarSnap.docs) kasKeluar += k.data().nominal ?? 0;
      setTotalOmsetTunai(tunai);
      setTotalOmsetNonTunai(nonTunai);
      setTotalKasKeluarDihitung(kasKeluar);
      setMemuatTotal(false);
    }
    muat();
    return () => {
      dibatalkan = true;
    };
  }, [outletId, shift.id]);

  const totalOmset = totalOmsetTunai + totalOmsetNonTunai;
  const kasSeharusnya = shift.modalKasAwal + totalOmsetTunai - totalKasKeluarDihitung;
  const selisihKas = kasFisik - kasSeharusnya;

  async function handleTutupPaksa() {
    if (!user || !profil) return;
    if (selisihKas !== 0 && !keterangan.trim()) {
      showToast("error", "Ada selisih kas — wajib isi keterangan sebelum menutup paksa shift ini.");
      return;
    }
    setSedangTutup(true);
    try {
      await updateDoc(doc(db, "outlets", outletId, "shift", shift.id), {
        totalOmset,
        omsetTunai: totalOmsetTunai,
        omsetNonTunai: totalOmsetNonTunai,
        totalKasKeluar: totalKasKeluarDihitung,
        kasSeharusnya,
        kasFisik,
        selisihKas,
        keteranganSelisih: keterangan.trim(),
        status: "terkunci",
        waktuTutup: serverTimestamp(),
        ditutupPaksaOlehUid: user.uid,
        ditutupPaksaOlehNama: profil.nama,
      });

      await setDoc(
        doc(db, "outlets", outletId, "summary_harian", shift.tanggal),
        {
          totalOmset: increment(totalOmset),
          omsetTunai: increment(totalOmsetTunai),
          omsetNonTunai: increment(totalOmsetNonTunai),
          totalKasKeluar: increment(totalKasKeluarDihitung),
          selisihKas: increment(selisihKas),
          jumlahShift: increment(1),
        },
        { merge: true },
      );

      if (selisihKas < 0) {
        await addDoc(collection(db, "outlets", outletId, "tanggungan_kasir"), {
          shiftId: shift.id,
          tanggal: shift.tanggal,
          kasirUid: shift.kasirUid,
          kasirNama: shift.kasirNama,
          nominal: Math.abs(selisihKas),
          keterangan: keterangan.trim(),
          status: "belum_lunas",
          waktu: serverTimestamp(),
        });
      }

      showToast("success", `Shift ${shift.tanggal} (${shift.kasirNama}) berhasil ditutup paksa.`);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menutup paksa: ${error.message}` : "Gagal menutup paksa shift.",
      );
    } finally {
      setSedangTutup(false);
    }
  }

  return (
    <div className="border-t border-amber-200 bg-amber-50 px-5 py-4">
      <div className="flex items-start gap-2 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Shift ini masih berstatus <span className="font-semibold">Sedang Berjalan</span> — kemungkinan
          Kasir lupa menutupnya, atau akunnya sudah dinonaktifkan sebelum sempat Tutup Shift. Owner/Finance
          bisa menutupnya paksa dari sini, dihitung otomatis dari data penjualan &amp; kas keluar shift ini.
        </p>
      </div>

      {memuatTotal ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-amber-800">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Menghitung data shift...
        </div>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-white p-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500">Omset Tunai</dt>
              <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(totalOmsetTunai)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Omset Non-Tunai</dt>
              <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(totalOmsetNonTunai)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Kas Keluar</dt>
              <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(totalKasKeluarDihitung)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Kas Seharusnya</dt>
              <dd className="font-medium tabular-nums text-slate-900">{formatRupiah(kasSeharusnya)}</dd>
            </div>
          </dl>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <NumberField
              id={`kas-fisik-paksa-${shift.id}`}
              label="Kas Fisik (bila diketahui)"
              value={kasFisik}
              onChange={setKasFisik}
              prefix="Rp"
              hint="Isi 0 bila kas fisik sudah tidak bisa dihitung ulang."
            />
            <div>
              <label htmlFor={`keterangan-paksa-${shift.id}`} className="block text-sm font-semibold text-slate-800">
                Keterangan
              </label>
              <input
                id={`keterangan-paksa-${shift.id}`}
                type="text"
                value={keterangan}
                onChange={(event) => setKeterangan(event.target.value)}
                placeholder="mis. Kasir lupa menutup shift, ditutup paksa oleh Owner"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <button
              type="button"
              onClick={handleTutupPaksa}
              disabled={sedangTutup}
              aria-busy={sedangTutup}
              className={[
                "inline-flex h-[42px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm",
                "motion-safe:transition motion-safe:duration-150",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700",
                sedangTutup ? "cursor-not-allowed bg-amber-400" : "bg-amber-600 hover:bg-amber-700 active:scale-[0.98]",
              ].join(" ")}
            >
              {sedangTutup ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <>
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  Tutup Paksa
                </>
              )}
            </button>
          </div>
          {selisihKas !== 0 ? (
            <p className="mt-2 text-xs text-amber-800">
              Selisih kas: <span className="font-semibold tabular-nums">{formatRupiah(selisihKas)}</span>
              {selisihKas < 0 ? " — akan tercatat sebagai tanggungan Kasir yang bersangkutan." : ""}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Tanggungan Kasir — daftar Selisih Kas negatif yang belum diganti,
 * dibuat otomatis saat Kasir Tutup Shift dengan kekurangan (lihat
 * src/app/shift/page.tsx). Owner/Finance menandai lunas dari sini
 * setelah Kasir mengganti secara nyata (di luar aplikasi — tidak ada
 * pencatatan pembayaran tunai di dalam sistem ini).
 */
function TanggunganKasirKartu() {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [daftar, setDaftar] = useState<TanggunganKasir[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [sedangUbah, setSedangUbah] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "tanggungan_kasir"), where("status", "==", "belum_lunas")),
      (snap) => {
        setDaftar(
          snap.docs.map((d) => ({
            id: d.id,
            shiftId: d.data().shiftId ?? "",
            tanggal: d.data().tanggal ?? "",
            kasirUid: d.data().kasirUid ?? "",
            kasirNama: d.data().kasirNama ?? "",
            nominal: d.data().nominal ?? 0,
            keterangan: d.data().keterangan ?? "",
            status: "belum_lunas",
          })),
        );
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, [outletId]);

  async function tandaiLunas(id: string) {
    setSedangUbah(id);
    try {
      await updateDoc(doc(db, "outlets", outletId, "tanggungan_kasir", id), { status: "lunas" });
      showToast("success", "Tanggungan ditandai lunas.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menandai lunas: ${error.message}` : "Gagal menandai lunas.",
      );
    } finally {
      setSedangUbah(null);
    }
  }

  if (memuat || daftar.length === 0) return null;

  return (
    <section
      aria-labelledby="bagian-tanggungan"
      className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm"
    >
      <h2 id="bagian-tanggungan" className="text-base font-semibold text-rose-900">
        Tanggungan Kasir (Selisih Kas Minus, Belum Lunas)
      </h2>
      <ul className="mt-3 flex flex-col divide-y divide-rose-100">
        {daftar.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div>
              <p className="font-medium text-rose-900">
                {t.kasirNama} · {t.tanggal}
              </p>
              <p className="text-xs text-rose-700">
                {formatRupiah(t.nominal)}
                {t.keterangan ? ` — ${t.keterangan}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => tandaiLunas(t.id)}
              disabled={sedangUbah === t.id}
              aria-busy={sedangUbah === t.id}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm motion-safe:transition motion-safe:duration-150 hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
            >
              {sedangUbah === t.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              Tandai Lunas
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface RiwayatNotaRefund {
  id: string;
  tanggalTransaksiAsal: string;
  tanggalRefund: string;
  menuNama: string;
  qty: number;
  totalRefund: number;
  alasan: string;
  metode: "tunai" | "non_tunai";
  kasirNama: string;
}

/**
 * Riwayat Nota Refund — jejak audit SEMUA refund lintas shift/hari
 * (src/app/refund/page.tsx), khusus untuk Owner/Finance melihat POLA
 * dan ALASAN refund terjadi (rasa tidak sesuai, salah pesan Kasir,
 * dll). Kasir sengaja tidak butuh approval untuk membuat Nota Refund
 * (atas permintaan pemilik cafe, supaya operasional tetap cepat) —
 * jejak transparansi untuk Owner justru ada DI SINI, bukan di alur
 * approval sebelum refund terjadi.
 */
function RiwayatRefundKartu() {
  const outletId = useOutletId();
  const [daftar, setDaftar] = useState<RiwayatNotaRefund[]>([]);
  const [memuat, setMemuat] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "outlets", outletId, "nota_refund"), orderBy("waktuDibuat", "desc")),
      (snap) => {
        setDaftar(
          snap.docs.slice(0, 50).map((d) => ({
            id: d.id,
            tanggalTransaksiAsal: d.data().tanggalTransaksiAsal ?? "",
            tanggalRefund: d.data().tanggalRefund ?? "",
            menuNama: d.data().menuNama ?? "",
            qty: d.data().qty ?? 0,
            totalRefund: d.data().totalRefund ?? 0,
            alasan: d.data().alasan ?? "",
            metode: (d.data().metode ?? "tunai") as "tunai" | "non_tunai",
            kasirNama: d.data().kasirNama ?? "",
          })),
        );
        setMemuat(false);
      },
      () => setMemuat(false),
    );
    return unsub;
  }, [outletId]);

  if (memuat || daftar.length === 0) return null;

  return (
    <section
      aria-labelledby="bagian-refund"
      className="kartu-interaktif rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="bagian-refund" className="text-base font-semibold text-slate-900">
        Riwayat Nota Refund (50 terbaru)
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Refund transaksi dari shift yang sudah ditutup/hari lain — bukan Bonus/Refund cepat di shift
        yang masih berjalan (itu sudah tercermin langsung di Omset shift terkait).
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-slate-100">
        {daftar.map((r) => (
          <li key={r.id} className="py-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-slate-900">
                {r.menuNama} × {r.qty}
              </p>
              <p className="font-semibold tabular-nums text-rose-700">{formatRupiah(r.totalRefund)}</p>
            </div>
            <p className="text-xs text-slate-500">
              Transaksi asal {r.tanggalTransaksiAsal} · direfund {r.tanggalRefund} oleh {r.kasirNama} ·{" "}
              {r.metode === "tunai" ? "Tunai" : "Non-tunai"}
            </p>
            <p className="text-xs text-slate-500">Alasan: {r.alasan}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Ekspor Laporan Shift ke Excel (.xlsx) & PDF (A4) berkop surat.
 *
 * Rentang tanggal disaring DI SISI KLIEN dari daftar shift yang sudah
 * ada di layar, bukan lewat query Firestore baru — daftarnya memang
 * sudah dimuat seluruhnya untuk ditampilkan di halaman ini, jadi
 * query tambahan hanya akan memakan kuota baca tanpa menambah apa pun.
 */
function EksporLaporanKartu({ daftarShift }: { daftarShift: RiwayatShift[] }) {
  const { showToast } = useToast();
  const { detail: perusahaan } = useDetailPerusahaan();
  const [dariTanggal, setDariTanggal] = useState(tanggalAwalBulanISO());
  const [sampaiTanggal, setSampaiTanggal] = useState(tanggalIniISO());
  const [sedangEkspor, setSedangEkspor] = useState<"excel" | "pdf" | null>(null);
  // Preset mana (kalau ada) yang PERSIS cocok dengan rentang tanggal
  // aktif — dihitung ulang tiap render (bukan disimpan sebagai state
  // terpisah) supaya tidak pernah "nyangkut" menyorot preset yang
  // salah begitu tanggalnya digeser manual.
  const periodeAktif = (["harian", "mingguan", "bulanan", "tahunan"] as const).find((p) => {
    const r = rentangPeriodeLaporan(p);
    return r.mulai === dariTanggal && r.selesai === sampaiTanggal;
  }) ?? null;

  const terpilih = useMemo(
    () =>
      daftarShift
        .filter((s) => s.tanggal >= dariTanggal && s.tanggal <= sampaiTanggal)
        .slice()
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    [daftarShift, dariTanggal, sampaiTanggal],
  );

  const total = useMemo(
    () => ({
      omset: terpilih.reduce((t, s) => t + s.totalOmset, 0),
      kasKeluar: terpilih.reduce((t, s) => t + s.totalKasKeluar, 0),
      selisih: terpilih.reduce((t, s) => t + s.selisihKas, 0),
    }),
    [terpilih],
  );

  function susunOpsi(): OpsiLaporan<RiwayatShift> {
    return {
      judul: "LAPORAN SHIFT HARIAN",
      periode: `${formatTanggalPanjang(dariTanggal)} s/d ${formatTanggalPanjang(sampaiTanggal)}`,
      perusahaan,
      namaBerkas: `Laporan-Shift_${dariTanggal}_sd_${sampaiTanggal}`,
      kolom: [
        { judul: "Tanggal", ambil: (s) => s.tanggal, lebar: 14 },
        { judul: "Kasir", ambil: (s) => s.kasirNama || "—", lebar: 22 },
        { judul: "Status", ambil: (s) => labelStatus(s.status), lebar: 16 },
        { judul: "Total Omset", ambil: (s) => s.totalOmset, angka: true, lebar: 16 },
        { judul: "Kas Keluar", ambil: (s) => s.totalKasKeluar, angka: true, lebar: 16 },
        { judul: "Selisih Kas", ambil: (s) => s.selisihKas, angka: true, lebar: 16 },
      ],
      baris: terpilih,
      ringkasan: [
        { label: "Jumlah Shift", nilai: String(terpilih.length) },
        { label: "Total Omset", nilai: formatRupiah(total.omset) },
        { label: "Total Kas Keluar", nilai: formatRupiah(total.kasKeluar) },
        { label: "Total Selisih Kas", nilai: formatRupiah(total.selisih) },
      ],
    };
  }

  async function handleEkspor(jenis: "excel" | "pdf") {
    if (terpilih.length === 0) {
      showToast("error", "Tidak ada shift pada rentang tanggal itu.");
      return;
    }
    setSedangEkspor(jenis);
    try {
      const opsi = susunOpsi();
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
      aria-labelledby="bagian-ekspor"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        id="bagian-ekspor"
        className="flex items-center gap-2 text-base font-semibold text-slate-900"
      >
        <Download className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Ekspor Laporan (Excel / PDF A4)
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Laporan dicetak dengan KOP SURAT berisi Detail Perusahaan. Atur
        datanya di menu Profil Akun bagian Detail Perusahaan.
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
          <label htmlFor="ekspor-dari" className="block text-sm font-semibold text-slate-800">
            Dari Tanggal
          </label>
          <input
            id="ekspor-dari"
            type="date"
            value={dariTanggal}
            onChange={(event) => setDariTanggal(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label htmlFor="ekspor-sampai" className="block text-sm font-semibold text-slate-800">
            Sampai Tanggal
          </label>
          <input
            id="ekspor-sampai"
            type="date"
            value={sampaiTanggal}
            onChange={(event) => setSampaiTanggal(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-600">
        {terpilih.length} shift terpilih · Total Omset {formatRupiah(total.omset)}
      </p>

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

/** Kategori "keluar" milik Finance (Gaji Karyawan/Biaya Operasional/
 *  Lainnya, lihat KATEGORI_KELUAR di transaksi-finance/page.tsx) —
 *  disalin nilainya di sini (bukan diimpor) supaya modul laba-rugi ini
 *  tidak perlu mengimpor seluruh page transaksi-finance hanya untuk 3
 *  string konstan. */
const KATEGORI_KELUAR_FINANCE = ["Gaji Karyawan", "Biaya Operasional", "Lainnya"] as const;

interface RincianHarianLabaRugi {
  tanggal: string;
  totalOmset: number;
  totalHppTerjual: number;
  totalKasKeluar: number;
  labaOperasional: number;
}

interface HasilLabaRugiPeriode {
  rincian: RincianHarianLabaRugi[];
  totalOmset: number;
  totalHpp: number;
  totalKasKeluarOperasional: number;
  labaKotorSetelahHpp: number;
  labaOperasional: number;
  keluarFinancePerKategori: Record<(typeof KATEGORI_KELUAR_FINANCE)[number], number>;
  labaBersihFinal: number;
}

/** Ekspor Laporan Laba/Rugi periode — permintaan pemilik cafe:
 *  laporan Laba/Rugi yang SUDAH di-review & dirangkum, bukan sekadar
 *  rekap shift mentah (beda dengan EksporLaporanKartu di atas).
 *
 *  Menggabungkan DUA sumber yang SENGAJA terpisah secara arsitektur
 *  (lihat komentar kepala src/shared/lib/laba-harian.ts &
 *  src/app/transaksi-finance/page.tsx):
 *  1. hitungLabaHarian() per tanggal dalam periode -> Omset, HPP
 *     Terjual, Kas Keluar operasional harian Kasir (Wifi/Listrik/dst
 *     yang dibayar LANGSUNG dari kas shift) = "Laba Operasional".
 *  2. transaksi_finance arah "keluar" dalam periode yang sama,
 *     dijumlah per kategori (Gaji Karyawan/Biaya Operasional/Lainnya)
 *     -> dikurangkan SEKALI LAGI di lapisan akhir supaya Laba Bersih
 *     Final benar-benar utuh (hitungLabaHarian SENGAJA tidak
 *     memasukkan ini, lihat komentar di file itu).
 *
 *  Tidak mengubah hitungLabaHarian() itu sendiri — laporan ini murni
 *  mengagregasi hasilnya + query tambahan yang terpisah. */
function EksporLabaRugiKartu() {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const { detail: perusahaan } = useDetailPerusahaan();
  const [dariTanggal, setDariTanggal] = useState(tanggalAwalBulanISO());
  const [sampaiTanggal, setSampaiTanggal] = useState(tanggalIniISO());
  const [sedangHitung, setSedangHitung] = useState(false);
  const [sedangEkspor, setSedangEkspor] = useState<"excel" | "pdf" | null>(null);
  const [hasil, setHasil] = useState<HasilLabaRugiPeriode | null>(null);

  const periodeAktif =
    (["harian", "mingguan", "bulanan", "tahunan"] as const).find((p) => {
      const r = rentangPeriodeLaporan(p);
      return r.mulai === dariTanggal && r.selesai === sampaiTanggal;
    }) ?? null;

  async function handleHitung() {
    const daftarTanggal = daftarTanggalAntara(dariTanggal, sampaiTanggal);
    if (daftarTanggal.length === 0) {
      showToast("error", "Rentang tanggal tidak valid.");
      return;
    }
    if (daftarTanggal.length > 366) {
      showToast("error", "Rentang tanggal terlalu panjang (maks. 1 tahun sekali hitung).");
      return;
    }
    setSedangHitung(true);
    setHasil(null);
    try {
      const rincian: RincianHarianLabaRugi[] = [];
      for (const tanggal of daftarTanggal) {
        const h = await hitungLabaHarian(outletId, tanggal);
        rincian.push({
          tanggal,
          totalOmset: h.totalOmset,
          totalHppTerjual: h.totalHppTerjual,
          totalKasKeluar: h.totalKasKeluar,
          labaOperasional: h.labaBersih,
        });
      }

      // SENGAJA tidak menambahkan where("arah","==","keluar") di query —
      // filter "arah" disaring di memori setelah baca, bukan di query
      // Firestore, supaya query ini cuma butuh index rentang tanggal
      // biasa (sama seperti query lain di halaman ini), bukan index
      // gabungan (equality + range) baru yang belum tentu sudah ada di
      // project ini (Spark Plan, tidak ada firestore.indexes.json).
      const transaksiFinanceSnap = await getDocs(
        query(
          collection(db, "outlets", outletId, "transaksi_finance"),
          where("tanggal", ">=", dariTanggal),
          where("tanggal", "<=", sampaiTanggal),
        ),
      );
      const keluarFinancePerKategori = {
        "Gaji Karyawan": 0,
        "Biaya Operasional": 0,
        Lainnya: 0,
      } as Record<(typeof KATEGORI_KELUAR_FINANCE)[number], number>;
      for (const d of transaksiFinanceSnap.docs) {
        const data = d.data();
        if (data.arah !== "keluar") continue;
        const kategori = KATEGORI_KELUAR_FINANCE.includes(data.kategori)
          ? (data.kategori as (typeof KATEGORI_KELUAR_FINANCE)[number])
          : "Lainnya";
        keluarFinancePerKategori[kategori] += data.nominal ?? 0;
      }

      const totalOmset = rincian.reduce((t, r) => t + r.totalOmset, 0);
      const totalHpp = rincian.reduce((t, r) => t + r.totalHppTerjual, 0);
      const totalKasKeluarOperasional = rincian.reduce((t, r) => t + r.totalKasKeluar, 0);
      const labaOperasional = rincian.reduce((t, r) => t + r.labaOperasional, 0);
      const totalKeluarFinance =
        keluarFinancePerKategori["Gaji Karyawan"] +
        keluarFinancePerKategori["Biaya Operasional"] +
        keluarFinancePerKategori.Lainnya;

      setHasil({
        rincian,
        totalOmset,
        totalHpp,
        totalKasKeluarOperasional,
        labaKotorSetelahHpp: totalOmset - totalHpp,
        labaOperasional,
        keluarFinancePerKategori,
        labaBersihFinal: labaOperasional - totalKeluarFinance,
      });
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menghitung: ${error.message}` : "Gagal menghitung laba/rugi.",
      );
    } finally {
      setSedangHitung(false);
    }
  }

  async function handleEkspor(jenis: "excel" | "pdf") {
    if (!hasil) return;
    setSedangEkspor(jenis);
    try {
      const opsi: OpsiLaporan<RincianHarianLabaRugi> = {
        judul: "LAPORAN LABA/RUGI",
        periode: `${formatTanggalPanjang(dariTanggal)} s/d ${formatTanggalPanjang(sampaiTanggal)}`,
        perusahaan,
        namaBerkas: `Laporan-Laba-Rugi_${dariTanggal}_sd_${sampaiTanggal}`,
        kolom: [
          { judul: "Tanggal", ambil: (r) => r.tanggal, lebar: 14 },
          { judul: "Omset", ambil: (r) => r.totalOmset, angka: true, lebar: 16 },
          { judul: "HPP Terjual", ambil: (r) => r.totalHppTerjual, angka: true, lebar: 16 },
          { judul: "Kas Keluar Operasional", ambil: (r) => r.totalKasKeluar, angka: true, lebar: 18 },
          { judul: "Laba Operasional", ambil: (r) => r.labaOperasional, angka: true, lebar: 16 },
        ],
        baris: hasil.rincian,
        ringkasan: [
          { label: "Total Omset", nilai: formatRupiah(hasil.totalOmset) },
          { label: "Total HPP Terjual", nilai: `− ${formatRupiah(hasil.totalHpp)}` },
          { label: "Laba Kotor", nilai: formatRupiah(hasil.labaKotorSetelahHpp) },
          {
            label: "Total Kas Keluar Operasional (Kasir)",
            nilai: `− ${formatRupiah(hasil.totalKasKeluarOperasional)}`,
          },
          { label: "= Laba Operasional", nilai: formatRupiah(hasil.labaOperasional) },
          {
            label: "Gaji Karyawan (Finance)",
            nilai: `− ${formatRupiah(hasil.keluarFinancePerKategori["Gaji Karyawan"])}`,
          },
          {
            label: "Biaya Operasional (Finance)",
            nilai: `− ${formatRupiah(hasil.keluarFinancePerKategori["Biaya Operasional"])}`,
          },
          { label: "Lainnya (Finance)", nilai: `− ${formatRupiah(hasil.keluarFinancePerKategori.Lainnya)}` },
          { label: "= LABA BERSIH FINAL", nilai: formatRupiah(hasil.labaBersihFinal) },
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
      aria-labelledby="bagian-laba-rugi"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="bagian-laba-rugi" className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <TrendingDown className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Laporan Laba/Rugi (Direview &amp; Dirangkum)
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Omset dikurangi HPP Terjual &amp; Kas Keluar operasional Kasir, LALU dikurangi lagi Gaji Karyawan /
        Biaya Operasional / Lainnya yang dicatat Finance — jadi Laba Bersih Final yang utuh, bukan cuma
        laba operasional harian.
      </p>

      <div className="mt-4">
        <PeriodePicker
          periodeAktif={periodeAktif}
          onPilih={(r) => {
            setDariTanggal(r.mulai);
            setSampaiTanggal(r.selesai);
            setHasil(null);
          }}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="labarugi-dari" className="block text-sm font-semibold text-slate-800">
            Dari Tanggal
          </label>
          <input
            id="labarugi-dari"
            type="date"
            value={dariTanggal}
            onChange={(event) => {
              setDariTanggal(event.target.value);
              setHasil(null);
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label htmlFor="labarugi-sampai" className="block text-sm font-semibold text-slate-800">
            Sampai Tanggal
          </label>
          <input
            id="labarugi-sampai"
            type="date"
            value={sampaiTanggal}
            onChange={(event) => {
              setSampaiTanggal(event.target.value);
              setHasil(null);
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleHitung}
        disabled={sedangHitung}
        className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-slate-800 px-4 text-sm font-semibold text-white motion-safe:transition hover:bg-slate-900 disabled:opacity-60"
      >
        {sedangHitung ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Calculator className="h-4 w-4" aria-hidden="true" />}
        {sedangHitung ? "Menghitung..." : "Hitung Laba/Rugi Periode"}
      </button>
      <p className="mt-1.5 text-[11px] text-slate-400">
        Menghitung ulang tiap tanggal dalam rentang (bisa perlu beberapa detik untuk periode panjang).
      </p>

      {hasil ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <dl className="flex flex-col gap-1.5 text-sm">
            <BarisRingkasLabaRugi label="Total Omset" nilai={hasil.totalOmset} />
            <BarisRingkasLabaRugi label="Total HPP Terjual" nilai={-hasil.totalHpp} />
            <BarisRingkasLabaRugi label="Laba Kotor" nilai={hasil.labaKotorSetelahHpp} tebal />
            <BarisRingkasLabaRugi
              label="Kas Keluar Operasional (Kasir)"
              nilai={-hasil.totalKasKeluarOperasional}
            />
            <BarisRingkasLabaRugi label="Laba Operasional" nilai={hasil.labaOperasional} tebal />
            <BarisRingkasLabaRugi
              label="Gaji Karyawan (Finance)"
              nilai={-hasil.keluarFinancePerKategori["Gaji Karyawan"]}
            />
            <BarisRingkasLabaRugi
              label="Biaya Operasional (Finance)"
              nilai={-hasil.keluarFinancePerKategori["Biaya Operasional"]}
            />
            <BarisRingkasLabaRugi label="Lainnya (Finance)" nilai={-hasil.keluarFinancePerKategori.Lainnya} />
            <div className="mt-1 border-t border-slate-300 pt-1.5">
              <BarisRingkasLabaRugi label="LABA BERSIH FINAL" nilai={hasil.labaBersihFinal} tebal besar />
            </div>
          </dl>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => handleEkspor("excel")}
              disabled={sedangEkspor !== null}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm motion-safe:transition hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-emerald-400"
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
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm motion-safe:transition hover:bg-emerald-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sedangEkspor === "pdf" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileText className="h-4 w-4" aria-hidden="true" />
              )}
              {sedangEkspor === "pdf" ? "Menyiapkan..." : "Ekspor PDF (A4)"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function BarisRingkasLabaRugi({
  label,
  nilai,
  tebal,
  besar,
}: {
  label: string;
  nilai: number;
  tebal?: boolean;
  besar?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={`text-slate-600 ${tebal ? "font-semibold text-slate-800" : ""}`}>{label}</dt>
      <dd
        className={`tabular-nums ${besar ? "text-base" : ""} ${
          tebal ? "font-semibold" : "font-medium"
        } ${nilai < 0 ? "text-rose-700" : "text-emerald-800"}`}
      >
        {nilai < 0 ? `− ${formatRupiah(Math.abs(nilai))}` : formatRupiah(nilai)}
      </dd>
    </div>
  );
}

function labelStatus(status: RiwayatShift["status"]): string {
  return status === "buka" ? "Sedang Berjalan" : status === "tutup" ? "Ditutup" : "Terkunci";
}

function formatTanggalPanjang(iso: string): string {
  const [tahun, bulan, hari] = iso.split("-").map(Number);
  if (!tahun || !bulan || !hari) return iso;
  return new Date(tahun, bulan - 1, hari).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function tanggalAwalBulanISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function tanggalIniISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Hitung ulang Laba Bersih & HPP Terjual untuk hari LAMPAU secara
 * manual. Dashboard sudah menghitung otomatis untuk HARI INI setiap
 * dibuka (lihat src/app/dashboard/page.tsx) — tombol ini untuk
 * mem-back-fill hari-hari sebelumnya (mis. resep baru disusun
 * belakangan, atau Owner belum sempat buka Dashboard hari itu).
 */
interface HasilHitungUlang {
  tanggal: string;
  totalOmset: number;
  totalHppTerjual: number;
  labaBersih: number;
}

function HitungUlangLabaKartu() {
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [tanggal, setTanggal] = useState(tanggalIniISO());
  const [sedangHitung, setSedangHitung] = useState(false);
  // Hasil ditampilkan sebagai LIST yang menumpuk di kartu ini (bukan
  // toast sekali muncul lalu hilang) — supaya Owner/Finance yang
  // menghitung ulang beberapa tanggal berturut-turut bisa melihat dan
  // membandingkan semua hasilnya sekaligus tanpa harus mengingat-ingat
  // toast yang sudah lewat. Terbaru di atas.
  const [riwayatHasil, setRiwayatHasil] = useState<HasilHitungUlang[]>([]);

  async function handleHitung() {
    setSedangHitung(true);
    try {
      // Ringkasan harian ditulis ULANG dari sumber aslinya (dokumen shift
      // + subkoleksi penjualan), bukan sekadar menambah labaBersih.
      // summary_harian normalnya dibentuk lewat increment() oleh Kasir
      // saat Tutup Shift; kalau penulisan itu sempat gagal (internet
      // putus di tengah jalan) atau terlanjur terhitung dobel oleh data
      // lama, angkanya akan meleset selamanya karena increment tidak
      // bisa "diperbaiki" tanpa tahu nilai benarnya. Tombol ini jadi
      // pemulihannya: menimpa semua angka hari itu dengan hasil hitung
      // ulang yang otoritatif.
      //
      // MITIGASI RACE CONDITION (bug: shift lain menutup di tengah proses
      // hitung ulang): hitungLabaHarian() membaca banyak dokumen shift
      // lewat beberapa query TERPISAH (bukan satu transaksi atomik —
      // Firestore transaction tidak bisa meng-query koleksi yang jumlah
      // dokumennya belum diketahui di awal, jadi atomik penuh TIDAK
      // mungkin dicapai murni dari sisi client tanpa Cloud Functions).
      // Kalau ADA Kasir lain yang menutup shift (menulis increment() ke
      // summary_harian tanggal yang sama) tepat di antara pembacaan di
      // sini dan penimpaan absolut di bawah, kontribusi shift itu akan
      // hilang dari ringkasan — walau dokumen shift aslinya sendiri tetap
      // benar, sehingga akan otomatis terkoreksi lagi pada Hitung Ulang
      // berikutnya untuk tanggal yang sama.
      //
      // Supaya jendela race ini SEMPIT (bukan nol, tapi jauh lebih kecil
      // dari sekali baca), hitung ulang dilakukan berkali-kali sampai DUA
      // hasil BERTURUT-TURUT persis sama — artinya tidak ada shift yang
      // menutup di antara kedua pembacaan terakhir itu — baru hasilnya
      // ditulis. Kalau setelah beberapa kali percobaan belum juga
      // konvergen (kemungkinan besar karena memang sedang ramai Kasir
      // menutup shift beruntun), hasil PALING TERAKHIR tetap dipakai
      // supaya tombol ini tidak macet menunggu selamanya.
      let hasil = await hitungLabaHarian(outletId, tanggal);
      const MAKS_PERCOBAAN_KONVERGENSI = 4;
      for (let percobaan = 0; percobaan < MAKS_PERCOBAAN_KONVERGENSI; percobaan++) {
        const hasilBerikutnya = await hitungLabaHarian(outletId, tanggal);
        const konvergen =
          hasilBerikutnya.totalOmset === hasil.totalOmset &&
          hasilBerikutnya.omsetTunai === hasil.omsetTunai &&
          hasilBerikutnya.omsetNonTunai === hasil.omsetNonTunai &&
          hasilBerikutnya.totalKasKeluar === hasil.totalKasKeluar &&
          hasilBerikutnya.selisihKas === hasil.selisihKas &&
          hasilBerikutnya.jumlahShift === hasil.jumlahShift &&
          hasilBerikutnya.totalHppTerjual === hasil.totalHppTerjual;
        hasil = hasilBerikutnya;
        if (konvergen) break;
      }
      await setDoc(
        doc(db, "outlets", outletId, "summary_harian", tanggal),
        {
          totalOmset: hasil.totalOmset,
          omsetTunai: hasil.omsetTunai,
          omsetNonTunai: hasil.omsetNonTunai,
          totalKasKeluar: hasil.totalKasKeluar,
          selisihKas: hasil.selisihKas,
          jumlahShift: hasil.jumlahShift,
          labaBersih: hasil.labaBersih,
          totalHpp: hasil.totalHppTerjual,
        },
        { merge: true },
      );
      setRiwayatHasil((sebelumnya) => [
        {
          tanggal,
          totalOmset: hasil.totalOmset,
          totalHppTerjual: hasil.totalHppTerjual,
          labaBersih: hasil.labaBersih,
        },
        // Tanggal yang sama dihitung ulang lagi -> ganti barisnya yang
        // lama, jangan menumpuk duplikat untuk tanggal yang sama.
        ...sebelumnya.filter((b) => b.tanggal !== tanggal),
      ]);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal menghitung: ${error.message}` : "Gagal menghitung Laba Bersih.",
      );
    } finally {
      setSedangHitung(false);
    }
  }

  return (
    <section
      aria-labelledby="bagian-hitung-laba"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 id="bagian-hitung-laba" className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <Calculator className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        Hitung Ulang Laporan Harian
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Dashboard sudah otomatis menghitung Laba Bersih hari ini setiap
        dibuka. Pakai ini untuk hari-hari sebelumnya, atau bila angka
        ringkasan suatu hari terlihat janggal — omset, kas keluar, selisih
        kas, HPP, dan laba hari itu akan dihitung ulang dari data shift
        aslinya lalu ditimpa.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div>
          <label htmlFor="tanggal-hitung-laba" className="block text-sm font-semibold text-slate-800">
            Tanggal
          </label>
          <input
            id="tanggal-hitung-laba"
            type="date"
            value={tanggal}
            onChange={(event) => setTanggal(event.target.value)}
            className="mt-1.5 rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <button
          type="button"
          onClick={handleHitung}
          disabled={sedangHitung}
          aria-busy={sedangHitung}
          className={[
            "inline-flex h-[42px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm",
            "motion-safe:transition motion-safe:duration-150",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
            sedangHitung
              ? "cursor-not-allowed bg-emerald-400"
              : "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]",
          ].join(" ")}
        >
          {sedangHitung ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Hitung"}
        </button>
      </div>

      {riwayatHasil.length > 0 ? (
        <ul className="mt-4 flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50">
          {riwayatHasil.map((baris) => (
            <li key={baris.tanggal} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
              <span className="font-medium text-slate-900">{baris.tanggal}</span>
              <span className="text-xs text-slate-600">
                Omset <span className="font-medium tabular-nums text-slate-900">{formatRupiah(baris.totalOmset)}</span>
                {" · "}HPP Terjual{" "}
                <span className="font-medium tabular-nums text-slate-900">{formatRupiah(baris.totalHppTerjual)}</span>
                {" · "}Laba Bersih{" "}
                <span className="font-semibold tabular-nums text-emerald-700">{formatRupiah(baris.labaBersih)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function StatusBadge({ status }: { status: RiwayatShift["status"] }) {
  // Pakai labelStatus() yang sama dengan yang dicetak di ekspor — kalau
  // istilahnya diubah, layar dan laporan berubah bersamaan.
  return <span>{labelStatus(status)}</span>;
}
