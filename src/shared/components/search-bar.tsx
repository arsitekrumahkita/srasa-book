// ============================================================
// Search bar reusable — dipakai lintas halaman (Kelola Akun, Kelola
// Outlet, Kalkulator HPP, Riwayat, Dashboard, dst.) untuk menyaring
// daftar panjang, atas permintaan pemilik cafe: "Tambah Search Bar di
// semua menu dan semua Sub-menu". Murni komponen tampilan — filter
// SESUNGGUHNYA (cocokkan `nilai` ke field mana pun) dilakukan oleh
// pemanggil lewat helper `cocokDenganPencarian()` di bawah, supaya
// setiap halaman bebas menentukan field mana yang mau dicocokkan.
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { Search, X } from "lucide-react";

interface SearchBarProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Label aksesibilitas kalau tidak ada label terlihat di atasnya
   *  (kotak pencarian biasanya berdiri sendiri tanpa <label> teks). */
  ariaLabel: string;
}

export function SearchBar({ id, value, onChange, placeholder = "Cari...", ariaLabel }: SearchBarProps) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        aria-hidden="true"
      />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-9 text-sm text-slate-900 outline-none motion-safe:transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Bersihkan pencarian"
          className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 motion-safe:transition hover:bg-slate-100 hover:text-slate-600 active:scale-90"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** Cocokkan satu teks pencarian ke beberapa field sekaligus (nama,
 *  kategori, dst.), tidak peka huruf besar/kecil, mengabaikan spasi di
 *  ujung. `undefined`/`null` di salah satu field aman diabaikan.
 *  Pencarian kosong ("") SELALU cocok — supaya list utuh lagi begitu
 *  kotak pencarian dikosongkan. */
export function cocokDenganPencarian(kataKunci: string, ...field: (string | number | undefined | null)[]): boolean {
  const kunci = kataKunci.trim().toLowerCase();
  if (!kunci) return true;
  return field.some((f) => f !== undefined && f !== null && String(f).toLowerCase().includes(kunci));
}
