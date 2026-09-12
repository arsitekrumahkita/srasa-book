// ============================================================
// Detail Perusahaan — dipakai sebagai KOP SURAT pada semua ekspor
// (Excel & PDF A4), dan diatur Owner lewat halaman Profil Akun.
//
// Disimpan sebagai SATU dokumen tetap: profil_cafe/utama. Satu cafe =
// satu dokumen, jadi tidak perlu koleksi ber-ID acak — ID tetap
// membuat pembacaannya murah (getDoc langsung, tanpa query) dan
// tidak mungkin terjadi "dua profil perusahaan" yang saling bertabrakan.
//
// firestore.rules: boleh DIBACA semua peran aktif (Kasir/Purchasing
// pun perlu, karena ekspor mereka juga berkop), tapi hanya Owner/
// Finance yang boleh menulis. Tidak ada data sensitif di sini —
// isinya justru identitas yang memang dicetak di atas laporan.
// ============================================================

export const ID_DOKUMEN_PERUSAHAAN = "utama";

export interface DetailPerusahaan {
  nama: string;
  /** Baris kecil di bawah nama, mis. "Coffee & Eatery". */
  bidangUsaha: string;
  alamat: string;
  telepon: string;
  email: string;
  website: string;
  npwp: string;
  /** Dicetak kecil di kaki setiap halaman laporan. */
  catatanKaki: string;
}

export const DETAIL_PERUSAHAAN_KOSONG: DetailPerusahaan = {
  nama: "",
  bidangUsaha: "",
  alamat: "",
  telepon: "",
  email: "",
  website: "",
  npwp: "",
  catatanKaki: "",
};
