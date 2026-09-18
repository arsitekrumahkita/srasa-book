"use client";

// ============================================================
// Ekspor laporan ke Excel (.xlsx) dan PDF (A4) dengan KOP SURAT
// berisi Detail Perusahaan — atas permintaan pemilik cafe.
//
// Kedua pustaka (exceljs & jspdf) di-import SECARA DINAMIS di dalam
// fungsi, bukan di puncak berkas. Ini disengaja: keduanya berat
// (ratusan KB) dan hanya dipakai saat tombol Ekspor benar-benar
// ditekan. Dengan import dinamis, bundel halaman Riwayat tetap
// ringan untuk mayoritas kunjungan yang tidak mengekspor apa pun —
// penting karena aplikasi ini dipakai dari HP di cafe.
//
// Struktur kop mengikuti surat resmi: nama perusahaan besar di
// tengah, bidang usaha & alamat/kontak di bawahnya, garis pemisah
// tebal, baru judul laporan + periode. Kaki halaman berisi catatan
// perusahaan, waktu cetak, dan nomor halaman.
// ============================================================

import type { DetailPerusahaan } from "@/shared/types/perusahaan";
// Nama brand dipakai sebagai cadangan kop surat kalau Detail
// Perusahaan belum diisi — lihat src/shared/lib/brand.ts.
import { NAMA_BRAND } from "@/shared/lib/brand";

/** Satu kolom pada tabel laporan. */
export interface KolomLaporan<T> {
  judul: string;
  /** Ambil nilai mentah dari satu baris data. */
  ambil: (baris: T) => string | number;
  /** Lebar MINIMUM kolom Excel (karakter) — lebar sebenarnya SELALU
   *  dihitung otomatis (autofit) dari isi terpanjang kolom ini; field
   *  ini hanya dipakai kalau hasil autofit lebih sempit dari nilai ini.
   *  PDF menghitung lebarnya sendiri (autoTable), tidak memakai field ini. */
  lebar?: number;
  /** Kolom angka dirata-kanan & diformat ribuan di kedua keluaran. */
  angka?: boolean;
}

/** Tabel TAMBAHAN opsional, dicetak SETELAH tabel utama tapi SEBELUM
 *  ringkasan — dipakai untuk laporan yang perlu lebih dari satu tabel
 *  sekaligus (mis. Cash Opname: tabel utama Kas Keluar per kategori +
 *  tabel tambahan Rincian Pemakaian Bahan). Tipe barisnya SENGAJA
 *  `unknown` (bukan generik terikat ke T laporan utama) — setiap
 *  tabel tambahan bebas punya bentuk data sendiri. */
export interface TabelTambahan {
  judul: string;
  kolom: KolomLaporan<unknown>[];
  baris: unknown[];
}

export interface OpsiLaporan<T> {
  judul: string;
  /** mis. "12 Agustus 2026 s/d 12 September 2026" */
  periode: string;
  perusahaan: DetailPerusahaan;
  kolom: KolomLaporan<T>[];
  baris: T[];
  /** Tabel-tabel tambahan, dicetak berurutan setelah tabel utama. */
  tabelTambahan?: TabelTambahan[];
  /** Baris ringkasan di bawah tabel, mis. Total Omset. */
  ringkasan?: { label: string; nilai: string }[];
  /** Nama berkas tanpa ekstensi. */
  namaBerkas: string;
}

function tanggalCetak(): string {
  return new Date().toLocaleString("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function unduh(blob: Blob, namaBerkas: string): void {
  const url = URL.createObjectURL(blob);
  const tautan = document.createElement("a");
  tautan.href = url;
  tautan.download = namaBerkas;
  document.body.appendChild(tautan);
  tautan.click();
  document.body.removeChild(tautan);
  // Beri jeda sebelum mencabut URL — sebagian browser membatalkan
  // unduhan kalau objek URL-nya dicabut terlalu cepat.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Baris-baris kop yang dipakai BERSAMA oleh Excel & PDF, supaya kedua
 *  keluaran tidak pernah berbeda isinya. */
function barisKop(p: DetailPerusahaan): string[] {
  const kontak = [
    p.telepon ? `Telp: ${p.telepon}` : "",
    p.email ? `Email: ${p.email}` : "",
    p.website,
  ]
    .filter(Boolean)
    .join("  •  ");

  return [p.bidangUsaha, p.alamat, kontak, p.npwp ? `NPWP: ${p.npwp}` : ""].filter(
    Boolean,
  );
}

// ------------------------------------------------------------
// EXCEL
// ------------------------------------------------------------

export async function eksporExcel<T>(opsi: OpsiLaporan<T>): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  // Metadata dokumen (bukan yang tercetak) — baris baru diratakan jadi
  // spasi di sini saja, kop surat sesungguhnya di bawah TETAP menghormati
  // Enter (webrules-hikimori poin 10: Nama Perusahaan boleh 2-3 baris).
  wb.creator = (opsi.perusahaan.nama || NAMA_BRAND).replace(/\n/g, " ");
  wb.created = new Date();

  const ws = wb.addWorksheet("Laporan", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
  });

  const jumlahKolom = Math.max(opsi.kolom.length, 2);
  const kolomTerakhir = String.fromCharCode(64 + jumlahKolom);

  function tambahBarisKop(teks: string, ukuran: number, tebal: boolean) {
    const baris = ws.addRow([teks]);
    ws.mergeCells(`A${baris.number}:${kolomTerakhir}${baris.number}`);
    baris.getCell(1).font = { size: ukuran, bold: tebal };
    baris.getCell(1).alignment = { horizontal: "center" };
    return baris;
  }

  // --- KOP SURAT ---
  // Nama Perusahaan boleh 2-3 baris (mis. nama + anak kalimat) — setiap
  // baris yang diketik pakai Enter di Profil Akun dicetak sebagai baris
  // kop TERSENDIRI di sini, bukan digabung jadi satu baris panjang.
  const barisNama = (opsi.perusahaan.nama || NAMA_BRAND).split("\n").filter((b) => b.trim());
  for (const baris of barisNama.length > 0 ? barisNama : [NAMA_BRAND]) {
    tambahBarisKop(baris, 16, true);
  }
  for (const teks of barisKop(opsi.perusahaan)) {
    tambahBarisKop(teks, 10, false);
  }

  // Garis pemisah tebal di bawah kop, seperti kop surat cetak.
  const barisGaris = ws.addRow([]);
  ws.mergeCells(`A${barisGaris.number}:${kolomTerakhir}${barisGaris.number}`);
  barisGaris.getCell(1).border = { bottom: { style: "medium" } };

  ws.addRow([]);
  tambahBarisKop(opsi.judul, 13, true);
  tambahBarisKop(`Periode: ${opsi.periode}`, 10, false);
  ws.addRow([]);

  // --- TABEL (dipakai untuk tabel utama MAUPUN setiap tabelTambahan,
  // supaya keduanya identik gaya visualnya). ---
  function tambahTabel<U>(kolom: KolomLaporan<U>[], baris: U[]) {
    const barisHeader = ws.addRow(kolom.map((k) => k.judul));
    barisHeader.eachCell((sel) => {
      sel.font = { bold: true, color: { argb: "FFFFFFFF" } };
      sel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF047857" } };
      sel.alignment = { horizontal: "center", vertical: "middle" };
      sel.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    for (const baris1 of baris) {
      const barisExcel = ws.addRow(kolom.map((k) => k.ambil(baris1)));
      barisExcel.eachCell((sel, kolomKe) => {
        const k = kolom[kolomKe - 1];
        sel.border = {
          top: { style: "hair" },
          left: { style: "thin" },
          bottom: { style: "hair" },
          right: { style: "thin" },
        };
        if (k?.angka) {
          sel.numFmt = "#,##0";
          sel.alignment = { horizontal: "right" };
        }
      });
    }

    // Autofit lebar kolom tabel ini juga — sama seperti tabel utama di
    // bawah, supaya tabel tambahan tidak pernah terpotong/kosong.
    kolom.forEach((k, indeks) => {
      const isiTerpanjang = Math.max(
        k.judul.length,
        ...baris.map((b) => panjangTampil(k.ambil(b), k.angka)),
        0,
      );
      const lebarAutofit = Math.min(Math.max(isiTerpanjang + 3, 8), 60);
      const kolomExcel = ws.getColumn(indeks + 1);
      kolomExcel.width = Math.max(lebarAutofit, k.lebar ?? 0, kolomExcel.width ?? 0);
    });
  }

  tambahTabel(opsi.kolom, opsi.baris);

  // --- TABEL TAMBAHAN ---
  for (const tabel of opsi.tabelTambahan ?? []) {
    ws.addRow([]);
    tambahBarisKop(tabel.judul, 11, true);
    tambahTabel(tabel.kolom, tabel.baris);
  }

  // --- RINGKASAN ---
  if (opsi.ringkasan?.length) {
    ws.addRow([]);
    for (const item of opsi.ringkasan) {
      const baris = ws.addRow([item.label, item.nilai]);
      baris.getCell(1).font = { bold: true };
      baris.getCell(2).font = { bold: true };
    }
  }

  // --- KAKI ---
  ws.addRow([]);
  const barisCetak = ws.addRow([`Dicetak: ${tanggalCetak()}`]);
  barisCetak.getCell(1).font = { size: 9, italic: true, color: { argb: "FF64748B" } };
  if (opsi.perusahaan.catatanKaki) {
    const barisCatatan = ws.addRow([opsi.perusahaan.catatanKaki]);
    barisCatatan.getCell(1).font = { size: 9, italic: true, color: { argb: "FF64748B" } };
  }

  // Lebar kolom: AUTOFIT WAJIB — dihitung dari isi SESUNGGUHNYA setiap
  // kolom (bukan tebakan tetap), supaya "Kasir Nama Panjang" atau angka
  // besar tidak pernah terpotong dan kolom pendek tidak menyisakan
  // ruang kosong berlebihan. `kolom.lebar` (kalau diisi pemanggil)
  // dipakai sebagai batas MINIMUM saja, bukan menimpa hasil autofit.
  function panjangTampil(nilai: string | number, angka: boolean | undefined): number {
    // Kolom angka dicetak dengan numFmt "#,##0" (pemisah ribuan) —
    // dihitung dengan format yang sama supaya lebar kolomnya pas dengan
    // yang benar-benar terlihat di Excel, bukan angka mentah tanpa koma.
    if (angka && typeof nilai === "number") {
      return nilai.toLocaleString("en-US").length;
    }
    // Nilai bisa memuat baris baru (mis. keterangan multi-baris) —
    // yang menentukan lebar kolom adalah baris TERPANJANGnya, bukan
    // total seluruh karakter.
    return Math.max(...String(nilai).split("\n").map((baris) => baris.length));
  }

  // Lebar kolom tabel utama & setiap tabelTambahan sudah di-autofit
  // masing-masing di dalam tambahTabel() di atas (dipanggil SEBELUM
  // fungsi panjangTampil ini secara tertulis, tapi tetap valid berkat
  // hoisting deklarasi function di JavaScript).

  const buffer = await wb.xlsx.writeBuffer();
  unduh(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${opsi.namaBerkas}.xlsx`,
  );
}

// ------------------------------------------------------------
// PDF (A4)
// ------------------------------------------------------------

export async function eksporPdf<T>(opsi: OpsiLaporan<T>): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const dok = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const lebarHalaman = dok.internal.pageSize.getWidth(); // 210mm
  const tinggiHalaman = dok.internal.pageSize.getHeight(); // 297mm
  const margin = 15;
  const tengah = lebarHalaman / 2;

  // --- KOP SURAT ---
  let y = 18;
  dok.setFont("helvetica", "bold");
  dok.setFontSize(16);
  // Nama Perusahaan boleh 2-3 baris — setiap baris hasil Enter di Profil
  // Akun dicetak sebagai barisnya sendiri (webrules-hikimori poin 10),
  // bukan dirapatkan jadi satu baris.
  const barisNama = (opsi.perusahaan.nama || NAMA_BRAND).split("\n").filter((b) => b.trim());
  for (const baris of barisNama.length > 0 ? barisNama : [NAMA_BRAND]) {
    dok.text(baris, tengah, y, { align: "center" });
    y += 6.5;
  }
  y -= 6.5;

  dok.setFont("helvetica", "normal");
  dok.setFontSize(9);
  dok.setTextColor(70, 70, 70);
  for (const teks of barisKop(opsi.perusahaan)) {
    y += 4.5;
    // Alamat panjang dipotong otomatis supaya tidak melewati margin.
    for (const potongan of dok.splitTextToSize(teks, lebarHalaman - margin * 2) as string[]) {
      dok.text(potongan, tengah, y, { align: "center" });
      y += 4.5;
    }
    y -= 4.5;
  }

  y += 4;
  dok.setDrawColor(4, 120, 87);
  dok.setLineWidth(0.8);
  dok.line(margin, y, lebarHalaman - margin, y);

  // --- JUDUL LAPORAN ---
  y += 9;
  dok.setTextColor(15, 23, 42);
  dok.setFont("helvetica", "bold");
  dok.setFontSize(12);
  dok.text(opsi.judul, tengah, y, { align: "center" });

  y += 5.5;
  dok.setFont("helvetica", "normal");
  dok.setFontSize(9.5);
  dok.setTextColor(70, 70, 70);
  dok.text(`Periode: ${opsi.periode}`, tengah, y, { align: "center" });

  // --- TABEL (fungsi dipakai ulang untuk tabel utama MAUPUN setiap
  // tabelTambahan, supaya gaya visualnya identik). ---
  function tinggiHalamanSaatIni(): number {
    return (dok as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 6;
  }

  function tambahTabel<U>(kolom: KolomLaporan<U>[], baris: U[], startY: number) {
    autoTable(dok, {
      startY,
      margin: { left: margin, right: margin, bottom: 22 },
      head: [kolom.map((k) => k.judul)],
      body: baris.map((b) =>
        kolom.map((k) => {
          const nilai = k.ambil(b);
          return typeof nilai === "number" ? nilai.toLocaleString("id-ID") : String(nilai);
        }),
      ),
      styles: { fontSize: 8.5, cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.1 },
      headStyles: { fillColor: [4, 120, 87], textColor: 255, fontStyle: "bold", halign: "center" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: Object.fromEntries(kolom.map((k, i) => [i, { halign: k.angka ? "right" : "left" }])),
    });
  }

  tambahTabel(opsi.kolom, opsi.baris, y + 6);

  // --- TABEL TAMBAHAN ---
  for (const tabel of opsi.tabelTambahan ?? []) {
    let ySubJudul = tinggiHalamanSaatIni() + 8;
    if (ySubJudul > tinggiHalaman - 30) {
      dok.addPage();
      ySubJudul = 20;
    }
    dok.setFont("helvetica", "bold");
    dok.setFontSize(10.5);
    dok.setTextColor(15, 23, 42);
    dok.text(tabel.judul, margin, ySubJudul);
    tambahTabel(tabel.kolom, tabel.baris, ySubJudul + 3);
  }

  // --- RINGKASAN ---
  //
  // PERBAIKAN LAYOUT (permintaan pemilik cafe: hasil ekspor harus rapi
  // & mudah dibaca): nilai ringkasan yang PENDEK (mis. cuma nominal
  // Rupiah) tetap dicetak sebaris dengan label, rata kanan, seperti
  // semula. Tapi nilai yang PANJANG (mis. catatan penjelas, daftar
  // bahan menipis yang digabung koma) dulu dicetak mentah dengan
  // align:"right" TANPA dipotong ke baris baru — kalau lebih panjang
  // dari lebar halaman, teksnya melebar ke KIRI sampai menabrak/
  // menimpa labelnya sendiri, tidak terbaca. Sekarang nilai panjang
  // dipindah ke baris sendiri di bawah labelnya, dibungkus otomatis
  // (splitTextToSize) supaya selalu muat dalam margin halaman.
  let yRingkasan = tinggiHalamanSaatIni() + 8;
  if (opsi.ringkasan?.length) {
    const lebarTersedia = lebarHalaman - margin * 2;
    for (const item of opsi.ringkasan) {
      // Baris pemisah seksi (label diisi, nilai sengaja kosong — lihat
      // pola "— TUNAI —" dkk di cash-opname/page.tsx) dicetak sebagai
      // sub-judul kecil, bukan pasangan label/nilai.
      if (item.nilai === "") {
        if (yRingkasan > tinggiHalaman - 28) {
          dok.addPage();
          yRingkasan = 25;
        }
        yRingkasan += 1.5;
        dok.setFont("helvetica", "bold");
        dok.setFontSize(8.5);
        dok.setTextColor(4, 120, 87);
        dok.text(item.label, margin, yRingkasan);
        yRingkasan += 5.5;
        continue;
      }

      dok.setFont("helvetica", "bold");
      dok.setFontSize(9.5);
      const cukupSebaris = dok.getTextWidth(item.nilai) <= lebarTersedia * 0.55;

      if (cukupSebaris) {
        if (yRingkasan > tinggiHalaman - 28) {
          dok.addPage();
          yRingkasan = 25;
        }
        dok.setTextColor(15, 23, 42);
        dok.text(item.label, margin, yRingkasan);
        dok.text(item.nilai, lebarHalaman - margin, yRingkasan, { align: "right" });
        yRingkasan += 6;
      } else {
        const potongan = dok.splitTextToSize(item.nilai, lebarTersedia - 3) as string[];
        const tinggiButuh = 5 + potongan.length * 4.3 + 2;
        if (yRingkasan + tinggiButuh > tinggiHalaman - 28) {
          dok.addPage();
          yRingkasan = 25;
        }
        dok.setTextColor(15, 23, 42);
        dok.text(item.label, margin, yRingkasan);
        yRingkasan += 5;
        dok.setFont("helvetica", "normal");
        dok.setFontSize(9);
        dok.setTextColor(51, 65, 85);
        for (const baris of potongan) {
          dok.text(baris, margin + 3, yRingkasan);
          yRingkasan += 4.3;
        }
        yRingkasan += 2;
      }
    }
  }

  // --- KAKI HALAMAN (di setiap halaman) ---
  const jumlahHalaman = dok.getNumberOfPages();
  for (let halaman = 1; halaman <= jumlahHalaman; halaman += 1) {
    dok.setPage(halaman);
    dok.setDrawColor(226, 232, 240);
    dok.setLineWidth(0.2);
    dok.line(margin, tinggiHalaman - 16, lebarHalaman - margin, tinggiHalaman - 16);

    dok.setFont("helvetica", "normal");
    dok.setFontSize(7.5);
    dok.setTextColor(100, 116, 139);
    dok.text(`Dicetak: ${tanggalCetak()}`, margin, tinggiHalaman - 11);
    dok.text(
      `Halaman ${halaman} dari ${jumlahHalaman}`,
      lebarHalaman - margin,
      tinggiHalaman - 11,
      { align: "right" },
    );
    if (opsi.perusahaan.catatanKaki) {
      dok.text(opsi.perusahaan.catatanKaki, tengah, tinggiHalaman - 7, { align: "center" });
    }
  }

  unduh(dok.output("blob"), `${opsi.namaBerkas}.pdf`);
}
