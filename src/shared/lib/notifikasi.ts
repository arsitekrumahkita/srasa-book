"use client";

// ============================================================
// Hook baca notifikasi gabungan (untukUid + untukPeran). Dipakai
// di /notifikasi DAN kartu "Aktivitas Terbaru" Dashboard -> Rule of
// Two terpenuhi, pindah ke shared.
//
// Firestore tidak mendukung query OR dalam satu listener, jadi dua
// listener terpisah lalu digabung — lihat komentar lebih detail di
// src/app/notifikasi/page.tsx (tempat pola ini pertama kali dipakai).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useAuth } from "./auth-context";
import { db } from "./firebase";

export interface Notifikasi {
  id: string;
  judul: string;
  pesan: string;
  prioritas: string;
  dibaca: boolean;
  untukUid: string | null;
  waktu: { seconds: number } | null;
}

function petakanNotifikasi(id: string, data: Record<string, unknown>): Notifikasi {
  return {
    id,
    judul: (data.judul as string) ?? "Notifikasi",
    pesan: (data.pesan as string) ?? "",
    prioritas: (data.prioritas as string) ?? "sedang",
    dibaca: data.dibaca === true,
    untukUid: (data.untukUid as string) ?? null,
    waktu: (data.waktu as { seconds: number }) ?? null,
  };
}

export function useNotifikasiGabungan(): { daftar: Notifikasi[]; memuat: boolean } {
  const { user, profil } = useAuth();
  const [untukSaya, setUntukSaya] = useState<Notifikasi[]>([]);
  const [untukPeran, setUntukPeran] = useState<Notifikasi[]>([]);
  const [memuat, setMemuat] = useState(true);

  useEffect(() => {
    if (!user || !profil) return;
    let sisaListener = 2;
    const selesaiSatu = () => {
      sisaListener -= 1;
      if (sisaListener <= 0) setMemuat(false);
    };

    const unsub1 = onSnapshot(
      query(collection(db, "notifikasi"), where("untukUid", "==", user.uid)),
      (snap) => {
        setUntukSaya(snap.docs.map((d) => petakanNotifikasi(d.id, d.data())));
        selesaiSatu();
      },
      selesaiSatu,
    );

    const unsub2 = onSnapshot(
      query(collection(db, "notifikasi"), where("untukPeran", "==", profil.peran)),
      (snap) => {
        setUntukPeran(snap.docs.map((d) => petakanNotifikasi(d.id, d.data())));
        selesaiSatu();
      },
      selesaiSatu,
    );

    return () => {
      unsub1();
      unsub2();
    };
  }, [user, profil]);

  const daftar = useMemo(() => {
    const semua = [...untukSaya, ...untukPeran];
    semua.sort((a, b) => (b.waktu?.seconds ?? 0) - (a.waktu?.seconds ?? 0));
    return semua;
  }, [untukSaya, untukPeran]);

  return { daftar, memuat };
}
