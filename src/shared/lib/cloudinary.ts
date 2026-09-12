// ============================================================
// Upload gambar nota ke Cloudinary (PRD bagian 5.1, 9.3, 12).
// Dipakai lintas halaman (Belanja & Nota, Kas Keluar saat shift)
// -> sengaja di src/shared/lib sejak awal meski belum ada
// pemanggilnya (akan aktif mulai modul Belanja & Nota, Sprint 1).
//
// Pakai "unsigned upload preset" (dikonfigurasi di dashboard
// Cloudinary), BUKAN API Secret — supaya upload bisa langsung dari
// browser tanpa backend/Cloud Functions sama sekali, sesuai
// batasan Firebase Spark Plan (tidak ada server-side kita sendiri).
// API Secret Cloudinary TIDAK PERNAH dipakai di sisi klien.
// ============================================================

export interface HasilUploadNota {
  url: string;
  publicId: string;
  bytes: number;
}

const MAKS_DIMENSI_PANJANG = 1600; // px, sisi terpanjang gambar setelah dikompres
const KUALITAS_AWAL = 0.7;
const TARGET_MAKS_BYTES = 300 * 1024; // ~300KB sesuai PRD bagian 12

/**
 * Mengecilkan gambar di sisi klien sebelum diunggah: resize sisi
 * terpanjang ke maksimal 1600px, lalu encode JPEG. Kalau hasilnya
 * masih di atas target ukuran, kualitas diturunkan sekali lagi.
 * Ini murni optimasi bandwidth/kuota Cloudinary — bukan bagian
 * dari logika bisnis, jadi aman gagal-lunak (fallback ke file asli
 * bila kompresi tidak berhasil, misalnya browser tidak mendukung).
 */
async function kompresGambar(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const skala = Math.min(
      1,
      MAKS_DIMENSI_PANJANG / Math.max(bitmap.width, bitmap.height),
    );
    const lebar = Math.round(bitmap.width * skala);
    const tinggi = Math.round(bitmap.height * skala);

    const canvas = document.createElement("canvas");
    canvas.width = lebar;
    canvas.height = tinggi;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, lebar, tinggi);

    const blobDenganKualitas = (kualitas: number) =>
      new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", kualitas),
      );

    let hasil = await blobDenganKualitas(KUALITAS_AWAL);
    if (hasil && hasil.size > TARGET_MAKS_BYTES) {
      hasil = await blobDenganKualitas(0.5);
    }

    return hasil ?? file;
  } catch {
    // Browser tidak mendukung createImageBitmap/canvas, atau file
    // bukan gambar yang bisa didekode — unggah apa adanya saja.
    return file;
  }
}

/**
 * Mengunggah satu foto nota ke Cloudinary dan mengembalikan URL +
 * public ID untuk disimpan di dokumen Firestore terkait (lihat
 * skema `kas_belanja/{id}/nota/{id}` dan `shift/{id}/kas_keluar/{id}`
 * pada PRD bagian 10).
 *
 * Melempar Error dengan pesan yang bisa langsung ditampilkan lewat
 * toast bila konfigurasi belum diisi atau upload gagal.
 */
export async function uploadNotaImage(file: File): Promise<HasilUploadNota> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error(
      "Konfigurasi Cloudinary belum diisi di .env.local (NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME / NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET).",
    );
  }

  const gambarTerkompres = await kompresGambar(file);

  const formData = new FormData();
  formData.append("file", gambarTerkompres, file.name);
  formData.append("upload_preset", uploadPreset);
  formData.append("folder", "nota-belanja");

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: "POST", body: formData },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Upload nota gagal (${response.status}). ${detail || "Cek koneksi internet dan coba lagi."}`,
    );
  }

  const data = (await response.json()) as {
    secure_url: string;
    public_id: string;
    bytes: number;
  };

  return { url: data.secure_url, publicId: data.public_id, bytes: data.bytes };
}
