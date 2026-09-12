"use client";

// ============================================================
// Baca/tulis Detail Perusahaan (profil_cafe/utama). Dipakai LINTAS
// HALAMAN — Profil Akun (Owner mengaturnya) dan Riwayat (ekspor
// memakainya sebagai KOP surat) -> shared (Rule of Two terpenuhi).
// ============================================================

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import {
  DETAIL_PERUSAHAAN_KOSONG,
  ID_DOKUMEN_PERUSAHAAN,
  type DetailPerusahaan,
} from "@/shared/types/perusahaan";

function bacaDokumen(data: Record<string, unknown> | undefined): DetailPerusahaan {
  return {
    nama: (data?.nama as string) ?? "",
    bidangUsaha: (data?.bidangUsaha as string) ?? "",
    alamat: (data?.alamat as string) ?? "",
    telepon: (data?.telepon as string) ?? "",
    email: (data?.email as string) ?? "",
    website: (data?.website as string) ?? "",
    npwp: (data?.npwp as string) ?? "",
    catatanKaki: (data?.catatanKaki as string) ?? "",
  };
}

export async function ambilDetailPerusahaan(): Promise<DetailPerusahaan> {
  try {
    const snap = await getDoc(doc(db, "profil_cafe", ID_DOKUMEN_PERUSAHAAN));
    return bacaDokumen(snap.data());
  } catch {
    // Gagal baca (offline/izin) -> kembalikan yang kosong. Ekspor tetap
    // bisa jalan, kopnya saja yang minimal — lebih baik daripada tombol
    // Ekspor yang gagal total hanya karena kop belum diisi.
    return DETAIL_PERUSAHAAN_KOSONG;
  }
}

export async function simpanDetailPerusahaan(detail: DetailPerusahaan): Promise<void> {
  await setDoc(
    doc(db, "profil_cafe", ID_DOKUMEN_PERUSAHAAN),
    { ...detail, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Versi hook untuk dipakai di komponen (Profil Akun & kartu Ekspor). */
export function useDetailPerusahaan(): {
  detail: DetailPerusahaan;
  memuat: boolean;
  setDetail: (d: DetailPerusahaan) => void;
} {
  const [detail, setDetail] = useState<DetailPerusahaan>(DETAIL_PERUSAHAAN_KOSONG);
  const [memuat, setMemuat] = useState(true);

  useEffect(() => {
    let dibatalkan = false;
    ambilDetailPerusahaan().then((hasil) => {
      if (dibatalkan) return;
      setDetail(hasil);
      setMemuat(false);
    });
    return () => {
      dibatalkan = true;
    };
  }, []);

  return { detail, memuat, setDetail };
}
