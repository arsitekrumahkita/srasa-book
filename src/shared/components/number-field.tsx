// ============================================================
// Komponen input angka. Dipindah dari app/kalkulator-hpp ke sini
// (Rule of Two) begitu halaman /shift dan /belanja-nota mulai
// memakainya juga.
//
// REVISI: dulu pakai <input type="number"> bawaan browser, jadi
// saat mengetik angka besar (mis. Rp150000) tidak ada pemisah
// ribuan sama sekali — permintaan user: tambahkan titik pemisah
// ribuan SAAT MENGETIK, bukan cuma di tampilan hasil akhir
// (formatRupiah). Sekarang pakai <input type="text"> yang
// memformat ulang tampilannya tiap kali diketik, tapi `onChange`
// yang dikirim ke pemanggil TETAP angka murni (number) seperti
// sebelumnya — tidak ada perubahan API, semua pemanggil lama tidak
// perlu diubah.
//
// Didefinisikan di TOP-LEVEL file (bukan bersarang di komponen
// lain) — lihat webrules-hikimori poin 11: ini yang mencegah bug
// fokus/kursor hilang setiap satu huruf diketik.
// ============================================================

import { useEffect, useRef, useState } from "react";

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
  min?: number;
  step?: number;
  disabled?: boolean;
}

/** Angka -> teks tampilan gaya Indonesia: titik pemisah ribuan, koma
 *  pemisah desimal (mis. 12500.5 -> "12.500,5"). Desimal cuma muncul
 *  kalau sungguh ada (150000 -> "150.000", bukan "150.000,0") — qty
 *  bulat jauh lebih sering dipakai daripada takaran resep pecahan
 *  (mis. 0.5 kg). */
function formatTampilan(nilai: number): string {
  if (!Number.isFinite(nilai)) return "";
  if (nilai === 0) return "0";
  const [bagianBulat, bagianDesimal] = Math.abs(nilai).toString().split(".");
  const bulatBerpemisah = bagianBulat.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const hasil = bagianDesimal ? `${bulatBerpemisah},${bagianDesimal}` : bulatBerpemisah;
  return nilai < 0 ? `-${hasil}` : hasil;
}

/** Teks yang sedang diketik -> angka mentah. Titik dibuang (dianggap
 *  pemisah ribuan), koma pertama jadi titik desimal supaya bisa
 *  di-parseFloat. */
function teksKeAngka(teks: string): number {
  const bersih = teks.replace(/\./g, "").replace(",", ".");
  const angka = parseFloat(bersih);
  return Number.isFinite(angka) ? angka : 0;
}

/** Saring karakter yang boleh masuk sambil mengetik: hanya digit dan
 *  SATU koma desimal. Titik yang diketik user sendiri sengaja dibuang
 *  di sini — pemisah ribuan selalu ditambahkan ULANG otomatis di
 *  bawah, user tidak perlu (dan tidak bisa) mengetik titik sendiri. */
function saringInput(teks: string): string {
  let sudahAdaKoma = false;
  let hasil = "";
  for (const ch of teks) {
    if (ch >= "0" && ch <= "9") {
      hasil += ch;
    } else if (ch === "," && !sudahAdaKoma) {
      hasil += ch;
      sudahAdaKoma = true;
    }
  }
  return hasil;
}

/** Sisipkan ulang titik pemisah ribuan ke teks yang SEDANG diketik
 *  (bukan format akhir) — bagian desimal (setelah koma) dibiarkan
 *  apa adanya supaya angka nol di belakang koma ("12,50") atau koma
 *  yang baru saja diketik ("12,") tidak hilang sebelum user selesai
 *  mengetik. */
function formatSaatMengetik(disaring: string): string {
  const [bagianBulat, ...sisaDesimal] = disaring.split(",");
  const bulatBerpemisah = bagianBulat.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return sisaDesimal.length > 0 ? `${bulatBerpemisah},${sisaDesimal.join("")}` : bulatBerpemisah;
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  prefix,
  suffix,
  hint,
  min = 0,
  step = 1,
  disabled = false,
}: NumberFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;

  // Teks yang SUNGGUH tampil di kotak input — sengaja dipisah dari
  // `value` (angka mentah milik pemanggil) supaya user bisa mengetik
  // koma desimal / angka nol di ujung tanpa diformat ulang paksa yang
  // menghapusnya tiap satu huruf diketik.
  const [teks, setTeks] = useState(() => formatTampilan(value));
  // Jangan timpa apa yang sedang diketik user dari efek sinkronisasi
  // di bawah — hanya relevan kalau `value` berubah dari LUAR (mis.
  // draf otomatis yang dimuat ulang) saat field ini tidak sedang fokus.
  const sedangFokus = useRef(false);

  useEffect(() => {
    if (!sedangFokus.current) {
      setTeks(formatTampilan(value));
    }
  }, [value]);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-800">
        {label}
      </label>
      <div className="mt-1.5 flex items-center rounded-lg border border-slate-300 bg-white focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-100">
        {prefix ? (
          <span className="pl-3 text-sm text-slate-500 select-none">{prefix}</span>
        ) : null}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={teks}
          disabled={disabled}
          aria-describedby={hintId}
          data-step={step}
          onFocus={() => {
            sedangFokus.current = true;
          }}
          onChange={(event) => {
            const disaring = saringInput(event.target.value);
            setTeks(formatSaatMengetik(disaring));
            onChange(teksKeAngka(disaring));
          }}
          onBlur={() => {
            sedangFokus.current = false;
            // Rapikan tampilan akhir & terapkan batas minimum di sini
            // saja (bukan sambil mengetik) supaya user tidak diganggu
            // saat masih mengetik angka yang lebih besar.
            const nilaiAkhir = value < min ? min : value;
            if (nilaiAkhir !== value) onChange(nilaiAkhir);
            setTeks(formatTampilan(nilaiAkhir));
          }}
          className="w-full min-w-0 flex-1 rounded-lg bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none disabled:cursor-not-allowed disabled:text-slate-400"
        />
        {suffix ? (
          <span className="pr-3 text-sm text-slate-500 select-none">{suffix}</span>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
