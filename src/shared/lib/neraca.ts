// ============================================================
// NERACA (Balance Sheet) — permintaan pemilik cafe, khusus akun
// Finance. Disusun dari data yang SUDAH ADA di aplikasi ini; tidak
// ada input manual dan tidak ada koleksi baru.
//
// ---- APA ITU NERACA (penjelasan singkat, karena diminta) ----
// Laba/Rugi menjawab "berapa untungnya selama periode ini".
// Neraca menjawab pertanyaan yang berbeda: "PADA SATU TANGGAL,
// perusahaan ini punya apa saja, dan siapa yang berhak atasnya".
// Isinya tiga kelompok dengan satu persamaan wajib:
//
//     ASET  =  LIABILITAS  +  EKUITAS
//   (punya)     (utang)       (hak pemilik)
//
// Contoh: kalau di laci ada Rp500rb dan stok bahan senilai Rp2jt,
// asetnya Rp2,5jt. Kalau tidak ada utang sama sekali, berarti
// seluruh Rp2,5jt itu hak pemilik (ekuitas).
//
// ---- BAGAIMANA ANGKANYA DIAMBIL DI SINI ----
// ASET (semuanya aset lancar, cafe ini belum mencatat aset tetap):
//  1. Kas Outlet          <- shift.kasFisik (hasil hitung fisik saat
//                            Tutup Kasir) pada hari terakhir yang
//                            shift-nya sudah terkunci.
//  2. Saldo Finance       <- saldo_finance/utama (saldo berjalan).
//  3. Kas di Purchasing   <- sisa uang muka sesi belanja yang masih
//                            BERJALAN dengan sumber Kas Resto.
//  4. Persediaan          <- Σ bahan_baku.stokSaatIni x
//                            hargaSatuanTerakhir.
//  5. Piutang Kasir       <- tanggungan_kasir yang belum lunas
//                            (uang yang masih harus diganti Kasir).
//
// LIABILITAS: aplikasi ini BELUM punya pencatatan utang sama sekali
// (tidak ada utang supplier, tidak ada pinjaman), jadi nilainya 0.
// Ini bukan asumsi ngawur — memang tidak ada fiturnya, dan itu
// dinyatakan terang-terangan di laporan supaya tidak menyesatkan.
//
// EKUITAS dihitung sebagai SISA: Ekuitas = Aset - Liabilitas. Itu
// definisi bakunya, dan konsekuensinya neraca ini SELALU seimbang.
// Yang lebih berguna adalah RINCIANNYA, karena dua komponen di bawah
// bisa dilacak dari data:
//  - Modal Disetor Owner  <- transaksi_finance "Tambah Dana".
//  - Akumulasi Laba Bersih<- Σ summary_harian.labaBersih.
//  - Selisih Belum Terjelaskan = sisanya.
//
// SELISIH ITU FITUR, BUKAN BUG. Dia menangkap hal-hal yang memang
// belum terekam aplikasi, terutama: (a) setoran kas dari outlet ke
// Finance/Owner tidak dicatat sebagai transaksi (Cash Opname cuma
// melaporkan berapa yang SEHARUSNYA disetor), dan (b) hari-hari yang
// labaBersih-nya belum pernah dihitung ulang lewat Riwayat > Hitung
// Ulang Laba. Makin kecil selisihnya, makin rapi pembukuannya.
//
// ---- CATATAN TEKNIS ----
// Semua query di sini memakai range/equality pada SATU field saja,
// penyaringan sisanya dilakukan di memori — supaya tidak butuh index
// gabungan baru yang harus dibuat manual di Firebase Console (project
// ini Spark Plan, tanpa firestore.indexes.json). Tidak ada
// collectionGroup query, konsisten dengan modul lain di app ini.
// ============================================================

import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "./firebase";

const ID_SALDO_FINANCE = "utama";

export interface PosNeraca {
  label: string;
  nilai: number;
  /** Penjelasan pos ini dalam bahasa awam — ditampilkan di UI dan
   *  ikut tercetak di ekspor, karena pemilik memang belum familier
   *  dengan istilah neraca. */
  penjelasan: string;
}

export interface HasilNeraca {
  tanggal: string;
  aset: PosNeraca[];
  totalAset: number;
  liabilitas: PosNeraca[];
  totalLiabilitas: number;
  /** Total ekuitas = totalAset - totalLiabilitas (definisi baku). */
  totalEkuitas: number;
  rincianEkuitas: PosNeraca[];
  /** Info tambahan buat catatan kaki laporan. */
  catatan: {
    /** Tanggal shift terkunci yang dipakai sebagai sumber Kas Outlet
     *  (bisa lebih awal dari tanggal neraca kalau hari itu belum ada
     *  shift yang ditutup). Kosong kalau memang belum ada sama sekali. */
    tanggalKasOutlet: string;
    /** Bahan dengan stok minus ikut menurunkan nilai persediaan —
     *  ditandai supaya Finance tahu angkanya perlu dibersihkan dulu. */
    jumlahBahanStokMinus: number;
    /** Hari yang ringkasannya ada tapi labaBersih-nya belum pernah
     *  dihitung ulang — penyebab paling umum Selisih membengkak. */
    jumlahHariLabaBelumDihitung: number;
  };
}

/** Kas fisik di laci outlet pada tanggal neraca.
 *
 *  Dipakai shift yang sudah TERKUNCI saja, karena cuma shift terkunci
 *  yang kasFisik-nya sudah dihitung & dikonfirmasi Kasir. Kalau pada
 *  tanggal neraca belum ada shift terkunci (mis. neraca dibuka pagi
 *  hari), dipakai tanggal terkunci TERAKHIR sebelum itu — sebab uang
 *  di laci memang tidak berubah sampai shift berikutnya ditutup. */
async function ambilKasOutlet(
  outletId: string,
  tanggal: string,
): Promise<{ nilai: number; tanggalDipakai: string }> {
  const snap = await getDocs(
    query(
      collection(db, "outlets", outletId, "shift"),
      where("tanggal", "<=", tanggal),
      orderBy("tanggal", "desc"),
      limit(40),
    ),
  );
  const terkunci = snap.docs
    .map((d) => ({
      tanggal: (d.data().tanggal as string) ?? "",
      status: (d.data().status as string) ?? "buka",
      kasFisik: (d.data().kasFisik as number) ?? 0,
    }))
    .filter((s) => s.status === "terkunci");
  if (terkunci.length === 0) return { nilai: 0, tanggalDipakai: "" };

  // snap sudah urut tanggal menurun, jadi elemen pertama = terbaru.
  const tanggalDipakai = terkunci[0].tanggal;
  const nilai = terkunci
    .filter((s) => s.tanggal === tanggalDipakai)
    .reduce((total, s) => total + s.kasFisik, 0);
  return { nilai, tanggalDipakai };
}

/** Uang muka belanja yang masih dipegang Purchasing.
 *
 *  Hanya sesi berstatus 'terbuka' DAN bersumber Kas Resto: sesi
 *  Saldo Finance tidak pakai uang muka sama sekali (saldonya langsung
 *  terpotong tiap item disimpan, lihat handleTambahItem di
 *  belanja-nota/page.tsx), jadi tidak ada kas fisik yang menggantung. */
async function ambilKasDiPurchasing(outletId: string): Promise<number> {
  const snap = await getDocs(
    query(collection(db, "outlets", outletId, "kas_belanja"), where("status", "==", "terbuka")),
  );
  let total = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if ((data.sumberDana ?? "kas_resto") !== "kas_resto") continue;
    total += ((data.modalDiberikan as number) ?? 0) - ((data.totalBelanja as number) ?? 0);
  }
  return total;
}

export async function hitungNeraca(outletId: string, tanggal: string): Promise<HasilNeraca> {
  const [
    kasOutlet,
    kasPurchasing,
    saldoSnap,
    bahanSnap,
    tanggunganSnap,
    transaksiSnap,
    pengajuanSnap,
    summarySnap,
  ] = await Promise.all([
    ambilKasOutlet(outletId, tanggal),
    ambilKasDiPurchasing(outletId),
    getDoc(doc(db, "outlets", outletId, "saldo_finance", ID_SALDO_FINANCE)),
    getDocs(collection(db, "outlets", outletId, "bahan_baku")),
    getDocs(
      query(collection(db, "outlets", outletId, "tanggungan_kasir"), where("status", "==", "belum_lunas")),
    ),
    getDocs(
      query(collection(db, "outlets", outletId, "transaksi_finance"), where("tanggal", "<=", tanggal)),
    ),
    getDocs(
      query(collection(db, "outlets", outletId, "pengajuan_dana"), where("status", "==", "disetujui")),
    ),
    getDocs(collection(db, "outlets", outletId, "summary_harian")),
  ]);

  const saldoFinance = saldoSnap.exists() ? ((saldoSnap.data().saldo as number) ?? 0) : 0;

  // --- Persediaan bahan baku ---
  let nilaiPersediaan = 0;
  let jumlahBahanStokMinus = 0;
  for (const b of bahanSnap.docs) {
    const data = b.data();
    const stok = (data.stokSaatIni as number) ?? 0;
    const harga = (data.hargaSatuanTerakhir as number) ?? 0;
    if (stok < 0) jumlahBahanStokMinus += 1;
    nilaiPersediaan += stok * harga;
  }
  nilaiPersediaan = Math.round(nilaiPersediaan);

  // --- Piutang tanggungan Kasir (yang belum lunas per tanggal ini) ---
  let piutangTanggungan = 0;
  for (const t of tanggunganSnap.docs) {
    const data = t.data();
    if (((data.tanggal as string) ?? "") > tanggal) continue;
    piutangTanggungan += (data.nominal as number) ?? 0;
  }

  // --- Dana yang MASUK ke Saldo Finance dari luar sistem ---
  // Dua pintu masuknya (lihat komentar kepala src/shared/lib/
  // pengajuan-dana.ts): Tambah Dana manual oleh Finance, dan Pengajuan
  // Dana Purchasing yang disetujui Finance. Keduanya menambah aset
  // tanpa mengurangi aset lain, jadi dua-duanya harus ikut dihitung di
  // sisi ekuitas — kalau salah satu terlewat, angkanya lari ke
  // "Selisih Belum Terjelaskan" dan bikin laporan terlihat berantakan
  // padahal datanya benar.
  let modalDisetor = 0;
  for (const t of transaksiSnap.docs) {
    const data = t.data();
    if ((data.arah as string) !== "masuk") continue;
    modalDisetor += (data.nominal as number) ?? 0;
  }
  for (const p of pengajuanSnap.docs) {
    const data = p.data();
    if (((data.tanggal as string) ?? "") > tanggal) continue;
    modalDisetor += (data.nominalDisetujui as number) ?? 0;
  }

  // --- Akumulasi laba bersih dari ringkasan harian ---
  let akumulasiLaba = 0;
  let jumlahHariLabaBelumDihitung = 0;
  for (const s of summarySnap.docs) {
    // ID dokumen summary_harian ADALAH tanggalnya ("YYYY-MM-DD"),
    // jadi perbandingan string sudah benar secara kronologis.
    if (s.id > tanggal) continue;
    const data = s.data();
    if (data.labaBersih === undefined || data.labaBersih === null) {
      jumlahHariLabaBelumDihitung += 1;
      continue;
    }
    akumulasiLaba += (data.labaBersih as number) ?? 0;
  }

  const aset: PosNeraca[] = [
    {
      label: "Kas Outlet (uang tunai di laci)",
      nilai: kasOutlet.nilai,
      penjelasan: kasOutlet.tanggalDipakai
        ? `Hasil hitung kas fisik saat Tutup Kasir pada ${kasOutlet.tanggalDipakai}.`
        : "Belum ada shift yang ditutup, jadi belum ada angka kas fisik yang bisa dipakai.",
    },
    {
      label: "Saldo Deposito Finance",
      nilai: saldoFinance,
      penjelasan: "Saldo berjalan dana Finance saat ini — rinciannya ada di menu Mutasi Finance.",
    },
    {
      label: "Kas Belanja di Tangan Purchasing",
      nilai: kasPurchasing,
      penjelasan: "Sisa uang muka belanja (sumber Kas Resto) pada sesi belanja yang masih berjalan.",
    },
    {
      label: "Persediaan Bahan Baku",
      nilai: nilaiPersediaan,
      penjelasan: "Nilai stok gudang: jumlah stok tiap bahan dikali harga beli terakhirnya.",
    },
    {
      label: "Piutang Tanggungan Kasir",
      nilai: piutangTanggungan,
      penjelasan: "Kekurangan kas shift yang belum diganti Kasir — masih menjadi hak perusahaan.",
    },
  ];
  const totalAset = aset.reduce((t, p) => t + p.nilai, 0);

  const liabilitas: PosNeraca[] = [
    {
      label: "Utang Usaha / Pinjaman",
      nilai: 0,
      penjelasan:
        "Aplikasi ini belum punya pencatatan utang (belanja tempo ke supplier, pinjaman, dsb), jadi dianggap nihil.",
    },
  ];
  const totalLiabilitas = liabilitas.reduce((t, p) => t + p.nilai, 0);

  // Ekuitas = Aset - Liabilitas. Ini definisi baku, jadi neraca pasti
  // seimbang; yang informatif adalah rincian di bawahnya.
  const totalEkuitas = totalAset - totalLiabilitas;
  const selisih = totalEkuitas - modalDisetor - akumulasiLaba;

  const rincianEkuitas: PosNeraca[] = [
    {
      label: "Modal Disetor / Dana Masuk ke Finance",
      nilai: modalDisetor,
      penjelasan:
        "Seluruh dana yang pernah masuk ke Saldo Finance dari luar omset: Tambah Dana oleh Finance, ditambah Pengajuan Dana Purchasing yang disetujui.",
    },
    {
      label: "Akumulasi Laba Bersih",
      nilai: akumulasiLaba,
      penjelasan:
        jumlahHariLabaBelumDihitung > 0
          ? `Dijumlah dari ringkasan harian. ${jumlahHariLabaBelumDihitung} hari belum punya angka laba — hitung lewat Riwayat > Hitung Ulang Laba supaya lebih akurat.`
          : "Dijumlah dari laba bersih seluruh hari yang sudah terhitung.",
    },
    {
      label: "Selisih Belum Terjelaskan",
      nilai: selisih,
      penjelasan:
        "Sisa yang belum bisa ditelusuri. Penyebab tersering: setoran kas outlet ke Finance/Owner belum tercatat sebagai transaksi, dan hari-hari yang labanya belum dihitung ulang.",
    },
  ];

  return {
    tanggal,
    aset,
    totalAset,
    liabilitas,
    totalLiabilitas,
    totalEkuitas,
    rincianEkuitas,
    catatan: {
      tanggalKasOutlet: kasOutlet.tanggalDipakai,
      jumlahBahanStokMinus,
      jumlahHariLabaBelumDihitung,
    },
  };
}
