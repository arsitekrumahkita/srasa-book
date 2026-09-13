"use client";

// ============================================================
// Komponen: Latar Interaktif — gumpalan warna lembut (blob) di
// belakang kartu Login yang mengikuti ARAH gerakan pointer mouse
// (permintaan pemilik cafe: "background login page yg interaktif
// bisa dimainkan mengikuti arah panah pointer mouse"). Efek paralaks
// halus: tiap blob bergerak dengan kecepatan & jarak berbeda supaya
// terasa punya kedalaman, bukan sekadar ikut nempel di posisi kursor.
//
// SENGAJA:
// - Murni CSS transform + requestAnimationFrame, TANPA canvas/library
//   animasi eksternal — ringan, tidak menambah dependency.
// - Menghormati prefers-reduced-motion (webrules-hikimori/WCAG): kalau
//   pengguna mengaktifkan itu di sistemnya, blob berhenti bergerak dan
//   ditampilkan diam di posisi tengah, bukan mengikuti mouse.
// - `aria-hidden` + `pointer-events-none` — murni dekoratif, tidak
//   pernah menghalangi klik ke form Login atau dibaca screen reader.
// - Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useRef } from "react";

interface DefinisiBlob {
  kelasPosisi: string;
  kelasUkuran: string;
  kelasWarna: string;
  /** Seberapa jauh blob ini bisa bergeser dari posisi aslinya (px). */
  jangkauan: number;
  /** Seberapa cepat blob ini "mengejar" posisi mouse — makin kecil,
   *  makin lamban/berat terasa (efek paralaks kedalaman). */
  kecepatan: number;
}

const DAFTAR_BLOB: DefinisiBlob[] = [
  {
    kelasPosisi: "-left-24 -top-24",
    kelasUkuran: "h-96 w-96",
    kelasWarna: "bg-emerald-300/30",
    jangkauan: 50,
    kecepatan: 0.05,
  },
  {
    kelasPosisi: "top-1/3 right-[-9rem]",
    kelasUkuran: "h-[28rem] w-[28rem]",
    kelasWarna: "bg-teal-300/25",
    jangkauan: 70,
    kecepatan: 0.035,
  },
  {
    kelasPosisi: "bottom-[-7rem] left-1/3",
    kelasUkuran: "h-80 w-80",
    kelasWarna: "bg-emerald-400/20",
    jangkauan: 60,
    kecepatan: 0.06,
  },
  {
    kelasPosisi: "right-1/4 bottom-1/4",
    kelasUkuran: "h-56 w-56",
    kelasWarna: "bg-emerald-200/25",
    jangkauan: 90,
    kecepatan: 0.08,
  },
];

export function LatarInteraktif() {
  const refBlob = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const kurangiAnimasi = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (kurangiAnimasi) return; // Blob tetap diam — lihat komentar kepala berkas.

    // Posisi mouse dinormalisasi ke -1..1 dari TITIK TENGAH layar, jadi
    // "arah" pointer (kiri/kanan/atas/bawah) langsung terasa sebagai
    // arah gerak blob, bukan cuma menempel di posisi mutlaknya.
    let arahX = 0;
    let arahY = 0;
    const posisiSaatIni = DAFTAR_BLOB.map(() => ({ x: 0, y: 0 }));
    let frameId = 0;

    function tangkapGerakMouse(event: MouseEvent) {
      arahX = (event.clientX / window.innerWidth) * 2 - 1;
      arahY = (event.clientY / window.innerHeight) * 2 - 1;
    }
    window.addEventListener("mousemove", tangkapGerakMouse);

    function animasikan() {
      DAFTAR_BLOB.forEach((blob, i) => {
        const el = refBlob.current[i];
        if (!el) return;
        const target = posisiSaatIni[i];
        target.x += (arahX * blob.jangkauan - target.x) * blob.kecepatan;
        target.y += (arahY * blob.jangkauan - target.y) * blob.kecepatan;
        el.style.transform = `translate3d(${target.x.toFixed(1)}px, ${target.y.toFixed(1)}px, 0)`;
      });
      frameId = requestAnimationFrame(animasikan);
    }
    frameId = requestAnimationFrame(animasikan);

    return () => {
      window.removeEventListener("mousemove", tangkapGerakMouse);
      cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-teal-50"
    >
      {DAFTAR_BLOB.map((blob, i) => (
        <div
          key={i}
          ref={(el) => {
            refBlob.current[i] = el;
          }}
          className={`absolute rounded-full blur-3xl will-change-transform ${blob.kelasPosisi} ${blob.kelasUkuran} ${blob.kelasWarna}`}
        />
      ))}
    </div>
  );
}
