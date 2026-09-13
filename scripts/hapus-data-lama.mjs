// ============================================================
// SKRIP: Hapus Data Lama (pra-Multi-Cabang)
// ============================================================
//
// TIDAK dijalankan otomatis oleh aplikasi — ini skrip SEKALI JALAN
// yang harus dijalankan MANUAL oleh Owner/Anda sendiri di komputer,
// karena butuh kredensial Admin SDK (Service Account Key) yang tidak
// boleh ada di kode aplikasi/browser.
//
// KONTEKS: sebelum fitur Multi-Cabang, seluruh data operasional
// (bahan_baku, menu, shift, dst) hidup di koleksi TOP-LEVEL datar.
// Data itu SUDAH DIKONFIRMASI hanya data dummy/uji coba (trial), BUKAN
// data produksi sungguhan — jadi TIDAK PERLU dipindahkan/disalin,
// cukup DIHAPUS supaya proyek Firebase bersih sebelum dipakai dengan
// struktur baru `outlets/{outletId}/...`.
//
// APA YANG DIHAPUS (koleksi TOP-LEVEL lama beserta SEMUA sub-
// koleksinya, ditemukan otomatis lewat listCollections() — tidak
// perlu didaftar manual satu per satu):
//   bahan_baku, stok_kasir, menu_harga, menu, shift, kas_belanja,
//   summary_harian, summary_bulanan, tiket_approval, profil_cafe,
//   notifikasi, tanggungan_kasir, nota_refund, saldo_finance,
//   transaksi_finance, slot_shift, serah_terima_kas, catatan_owner,
//   backup_log.
//
// YANG **TIDAK** DISENTUH SAMA SEKALI (tetap ada seperti semula):
//   - `users`      — akun login staff/Owner, BUKAN data dummy.
//   - `usernames`  — pemetaan username -> email, ikut `users`.
//   - `outlets`    — daftar Outlet (dibuat/diatur lewat halaman
//                    Kelola Outlet di aplikasi, bukan skrip ini).
//
// Setelah skrip ini selesai, buka aplikasi, login sebagai Owner, buat
// Outlet pertama ("SRASA BOOK") lewat halaman Kelola Outlet, lalu
// mulai input data dari nol di struktur baru.
//
// CARA PAKAI:
//   1. Di Firebase Console > Project Settings > Service Accounts,
//      klik "Generate new private key" — unduh file JSON-nya.
//      SIMPAN FILE INI BAIK-BAIK, JANGAN DIUNGGAH KE GIT/PUBLIK.
//   2. Install dependensi (sekali saja):
//        npm install firebase-admin
//   3. Jalankan:
//        node scripts/hapus-data-lama.mjs /path/ke/service-account.json
//   4. Tunggu sampai selesai (skrip mencetak jumlah dokumen yang
//      dihapus per koleksi).
// ============================================================

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const [, , pathKredensial] = process.argv;

if (!pathKredensial) {
  console.error("Cara pakai: node scripts/hapus-data-lama.mjs /path/ke/service-account.json");
  process.exit(1);
}

// Koleksi top-level LAMA yang dihapus (users/usernames/outlets SENGAJA
// TIDAK ada di daftar ini — lihat komentar kepala berkas).
const DAFTAR_KOLEKSI_DIHAPUS = [
  "bahan_baku",
  "stok_kasir",
  "menu_harga",
  "menu",
  "shift",
  "kas_belanja",
  "summary_harian",
  "summary_bulanan",
  "tiket_approval",
  "profil_cafe",
  "notifikasi",
  "tanggungan_kasir",
  "nota_refund",
  "saldo_finance",
  "transaksi_finance",
  "slot_shift",
  "serah_terima_kas",
  "catatan_owner",
  "backup_log",
];

const kredensial = JSON.parse(readFileSync(pathKredensial, "utf8"));
initializeApp({ credential: cert(kredensial) });
const db = getFirestore();

const BATAS_BATCH = 400; // di bawah limit 500 operasi/batch Firestore

/**
 * Hapus SEMUA dokumen dalam satu koleksi, TERMASUK sub-koleksinya
 * (ditemukan otomatis lewat listCollections() per dokumen — tidak
 * perlu tahu strukturnya di muka). Mengembalikan jumlah dokumen
 * (tidak termasuk sub-koleksi) yang dihapus di level koleksi ini.
 */
async function hapusKoleksiRekursif(colRef, indentasi = "") {
  const snapshot = await colRef.get();
  if (snapshot.empty) return 0;

  // Sub-koleksi dulu (dari dalam ke luar), baru dokumen induknya —
  // supaya tidak ada sub-koleksi yang "yatim" kalau skrip terhenti
  // di tengah jalan.
  for (const dokumen of snapshot.docs) {
    const subKoleksi = await dokumen.ref.listCollections();
    for (const subCol of subKoleksi) {
      await hapusKoleksiRekursif(subCol, indentasi + "  ");
    }
  }

  let batch = db.batch();
  let hitungDalamBatch = 0;
  for (const dokumen of snapshot.docs) {
    batch.delete(dokumen.ref);
    hitungDalamBatch += 1;
    if (hitungDalamBatch >= BATAS_BATCH) {
      await batch.commit();
      batch = db.batch();
      hitungDalamBatch = 0;
    }
  }
  if (hitungDalamBatch > 0) {
    await batch.commit();
  }

  console.log(`${indentasi}  → ${snapshot.size} dokumen dihapus dari "${colRef.path}"`);
  return snapshot.size;
}

async function main() {
  console.log("\n=== Hapus Data Lama (dummy/trial, pra-Multi-Cabang) ===\n");
  console.log(
    "Koleksi berikut TIDAK disentuh: users, usernames, outlets.\n",
  );

  let totalDihapus = 0;
  for (const namaKoleksi of DAFTAR_KOLEKSI_DIHAPUS) {
    console.log(`Menghapus koleksi "${namaKoleksi}"...`);
    totalDihapus += await hapusKoleksiRekursif(db.collection(namaKoleksi));
  }

  console.log(`\n=== Selesai. Total ${totalDihapus} dokumen top-level lama dihapus (termasuk sub-koleksinya). ===`);
  console.log(
    "Langkah selanjutnya: login sebagai Owner di aplikasi, buka /kelola-outlet, tambahkan Outlet pertama (\"SRASA BOOK\"), lalu mulai input data dari nol.\n",
  );
}

main().catch((error) => {
  console.error("\nPenghapusan GAGAL di tengah jalan:", error);
  console.error(
    "Skrip ini aman dijalankan ulang (menghapus dokumen yang tersisa tidak berbahaya) — silakan perbaiki masalah di atas lalu jalankan lagi perintah yang sama.",
  );
  process.exit(1);
});
