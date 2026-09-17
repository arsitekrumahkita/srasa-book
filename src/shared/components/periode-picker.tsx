// ============================================================
// Baris tombol preset periode (Harian/Mingguan/Bulanan/Tahunan) untuk
// halaman Laporan — dipakai BERDAMPINGAN dengan input tanggal manual
// yang sudah ada di tiap halaman (bukan penggantinya): klik satu
// preset di sini otomatis mengisi tanggal Dari/Sampai, tapi Owner/
// Finance/Purchasing tetap bebas menggeser tanggalnya sendiri setelah
// itu kalau perlu rentang yang tidak persis Harian/Mingguan/dst.
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { LABEL_PERIODE_LAPORAN, rentangPeriodeLaporan, type PeriodeLaporan } from "@/shared/lib/periode-laporan";

const SEMUA_PERIODE: PeriodeLaporan[] = ["harian", "mingguan", "bulanan", "tahunan"];

interface PeriodePickerProps {
  onPilih: (rentang: { mulai: string; selesai: string }, periode: PeriodeLaporan) => void;
  /** Periode preset yang SEDANG cocok dengan rentang tanggal aktif di
   *  form (dihitung pemanggil) — dipakai untuk menyorot tombol yang
   *  aktif. null kalau rentang aktif tidak persis cocok preset mana
   *  pun (mis. sudah digeser manual). */
  periodeAktif: PeriodeLaporan | null;
}

export function PeriodePicker({ onPilih, periodeAktif }: PeriodePickerProps) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preset periode laporan">
      {SEMUA_PERIODE.map((periode) => (
        <button
          key={periode}
          type="button"
          onClick={() => onPilih(rentangPeriodeLaporan(periode), periode)}
          className={[
            "inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold motion-safe:transition active:scale-95",
            periodeAktif === periode
              ? "bg-emerald-600 text-white"
              : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
          ].join(" ")}
        >
          {LABEL_PERIODE_LAPORAN[periode]}
        </button>
      ))}
    </div>
  );
}
