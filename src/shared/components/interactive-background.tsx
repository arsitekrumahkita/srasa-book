"use client";

// ============================================================
// Komponen: Latar Interaktif — model GALAXY (bintang-bintang di
// langit gelap) di belakang kartu Login, bergerak mengikuti ARAH
// pointer mouse dengan efek paralaks (permintaan pemilik cafe:
// "Model Galaxy bintang bergerak mengikuti kursor mouse" — revisi
// dari versi blob warna sebelumnya yang dianggap kurang terasa
// efeknya).
//
// Digambar lewat <canvas> (bukan ratusan elemen DOM) supaya ratusan
// bintang tetap ringan dijalankan browser. Tiap bintang punya
// "kedalaman" (depth) acak — bintang yang lebih dekat (depth besar)
// bergerak lebih jauh mengikuti mouse dan berkedip lebih cepat,
// bintang jauh bergerak halus saja — itulah yang bikin terasa seperti
// galaxy 3D, bukan sekadar titik-titik menempel di kursor.
//
// SENGAJA:
// - Kanvas HANYA digambar ulang lewat requestAnimationFrame, TANPA
//   library animasi/partikel eksternal — ringan, tanpa dependency baru.
// - Menghormati prefers-reduced-motion (WCAG): bintang tetap tampil
//   tapi diam di posisi awal & tidak berkedip, tidak mengikuti mouse.
// - `aria-hidden` + `pointer-events-none` — murni dekoratif, tidak
//   pernah menghalangi klik ke form Login atau dibaca screen reader.
// - Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useEffect, useRef } from "react";

interface Bintang {
  /** Posisi dasar, 0..1 relatif ke ukuran kanvas. */
  x: number;
  y: number;
  radius: number;
  /** 0.2 (jauh, nyaris diam) .. 1 (dekat, ikut mouse paling jauh). */
  depth: number;
  faseKedip: number;
  kecepatanKedip: number;
}

const JUMLAH_BINTANG = 180;
/** Beberapa "bintang jatuh" sesekali lewat, aksen galaxy tambahan. */
const JEDA_BINTANG_JATUH_MS = 4500;

export function LatarInteraktif() {
  const refCanvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = refCanvas.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const kurangiAnimasi = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let lebar = 0;
    let tinggi = 0;
    let dpr = 1;

    function aturUkuran() {
      if (!canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      lebar = window.innerWidth;
      tinggi = window.innerHeight;
      canvas.width = lebar * dpr;
      canvas.height = tinggi * dpr;
      canvas.style.width = `${lebar}px`;
      canvas.style.height = `${tinggi}px`;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    aturUkuran();

    const bintangList: Bintang[] = Array.from({ length: JUMLAH_BINTANG }, () => ({
      x: Math.random(),
      y: Math.random(),
      radius: Math.random() * 1.3 + 0.4,
      depth: Math.random() * 0.8 + 0.2,
      faseKedip: Math.random() * Math.PI * 2,
      kecepatanKedip: Math.random() * 1.5 + 0.5,
    }));

    interface BintangJatuh {
      x: number;
      y: number;
      panjang: number;
      sudut: number;
      kecepatan: number;
      umur: number;
      umurMaksimal: number;
    }
    const bintangJatuhList: BintangJatuh[] = [];
    let waktuBintangJatuhBerikutnya = kurangiAnimasi ? Infinity : JEDA_BINTANG_JATUH_MS;

    let arahX = 0;
    let arahY = 0;
    let mouseHalusX = 0;
    let mouseHalusY = 0;

    function tangkapGerakMouse(event: MouseEvent) {
      arahX = (event.clientX / window.innerWidth) * 2 - 1;
      arahY = (event.clientY / window.innerHeight) * 2 - 1;
    }
    if (!kurangiAnimasi) {
      window.addEventListener("mousemove", tangkapGerakMouse);
    }
    window.addEventListener("resize", aturUkuran);

    let frameId = 0;
    const waktuAwal = performance.now();
    let waktuFrameLalu = waktuAwal;

    function gambar(waktuSekarang: number) {
      const t = (waktuSekarang - waktuAwal) / 1000;
      const dtMs = waktuSekarang - waktuFrameLalu;
      waktuFrameLalu = waktuSekarang;

      if (!kurangiAnimasi) {
        // Interpolasi halus (lerp) supaya gerak bintang mengikuti mouse
        // dengan lembut, bukan langsung meloncat ke posisi baru.
        mouseHalusX += (arahX - mouseHalusX) * 0.04;
        mouseHalusY += (arahY - mouseHalusY) * 0.04;
      }

      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, lebar, tinggi);

      // Langit galaxy: gradien gelap navy -> hijau tua sangat pekat,
      // supaya kartu Login putih di atasnya kelihatan menonjol seperti
      // jendela pesawat luar angkasa.
      const gradien = ctx.createRadialGradient(
        lebar * 0.5,
        tinggi * 0.35,
        0,
        lebar * 0.5,
        tinggi * 0.5,
        Math.max(lebar, tinggi) * 0.9,
      );
      gradien.addColorStop(0, "#0f2f27");
      gradien.addColorStop(0.55, "#08181a");
      gradien.addColorStop(1, "#020608");
      ctx.fillStyle = gradien;
      ctx.fillRect(0, 0, lebar, tinggi);

      const JANGKAUAN_MAKS = 70; // px pergeseran maksimum bintang terdekat

      for (const bintang of bintangList) {
        const dx = mouseHalusX * JANGKAUAN_MAKS * bintang.depth;
        const dy = mouseHalusY * JANGKAUAN_MAKS * bintang.depth;
        const px = bintang.x * lebar + dx;
        const py = bintang.y * tinggi + dy;

        const kedip = kurangiAnimasi
          ? 0.85
          : 0.5 + 0.5 * Math.sin(t * bintang.kecepatanKedip + bintang.faseKedip);
        const alpha = 0.25 + kedip * 0.75 * bintang.depth + 0.1;

        ctx.beginPath();
        ctx.fillStyle = `rgba(255,255,255,${Math.min(alpha, 1).toFixed(3)})`;
        ctx.arc(px, py, bintang.radius * (0.7 + bintang.depth * 0.6), 0, Math.PI * 2);
        ctx.fill();

        // Bintang besar/dekat diberi sedikit cahaya (glow) tipis —
        // aksen galaxy, bukan sekadar titik polos.
        if (bintang.depth > 0.7) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(110,231,183,${(alpha * 0.35).toFixed(3)})`;
          ctx.arc(px, py, bintang.radius * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // --- Bintang jatuh sesekali (aksen, bukan elemen utama) ---
      if (!kurangiAnimasi) {
        waktuBintangJatuhBerikutnya -= dtMs;
        if (waktuBintangJatuhBerikutnya <= 0) {
          waktuBintangJatuhBerikutnya = JEDA_BINTANG_JATUH_MS + Math.random() * 3500;
          bintangJatuhList.push({
            x: Math.random() * lebar * 0.6 + lebar * 0.2,
            y: Math.random() * tinggi * 0.25,
            panjang: Math.random() * 60 + 60,
            sudut: (Math.PI / 4) * (Math.random() * 0.4 + 0.8),
            kecepatan: Math.random() * 6 + 8,
            umur: 0,
            umurMaksimal: 700 + Math.random() * 300,
          });
        }
        for (let i = bintangJatuhList.length - 1; i >= 0; i -= 1) {
          const bj = bintangJatuhList[i];
          bj.umur += dtMs;
          bj.x += Math.cos(bj.sudut) * bj.kecepatan;
          bj.y += Math.sin(bj.sudut) * bj.kecepatan;
          const progres = bj.umur / bj.umurMaksimal;
          if (progres >= 1) {
            bintangJatuhList.splice(i, 1);
            continue;
          }
          const alphaEkor = Math.sin(Math.PI * (1 - progres)) * 0.8;
          const ekorX = bj.x - Math.cos(bj.sudut) * bj.panjang;
          const ekorY = bj.y - Math.sin(bj.sudut) * bj.panjang;
          const gradienEkor = ctx.createLinearGradient(ekorX, ekorY, bj.x, bj.y);
          gradienEkor.addColorStop(0, "rgba(255,255,255,0)");
          gradienEkor.addColorStop(1, `rgba(255,255,255,${alphaEkor.toFixed(3)})`);
          ctx.strokeStyle = gradienEkor;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(ekorX, ekorY);
          ctx.lineTo(bj.x, bj.y);
          ctx.stroke();
        }
      }

      frameId = requestAnimationFrame(gambar);
    }
    frameId = requestAnimationFrame(gambar);

    return () => {
      window.removeEventListener("mousemove", tangkapGerakMouse);
      window.removeEventListener("resize", aturUkuran);
      cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <canvas
      ref={refCanvas}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10"
    />
  );
}
