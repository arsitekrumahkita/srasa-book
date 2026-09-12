// ============================================================
// Baris rincian angka (label kiri, nilai kanan). Dipindah dari
// app/kalkulator-hpp ke sini (Rule of Two) begitu halaman lain
// (dashboard, shift) mulai memakainya juga.
// ============================================================

export function ResultRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span
        className={
          emphasis
            ? "text-sm font-semibold text-slate-900"
            : "text-sm text-slate-600"
        }
      >
        {label}
      </span>
      <span
        className={
          emphasis
            ? "text-base font-bold tabular-nums text-slate-900"
            : "text-sm font-medium tabular-nums text-slate-700"
        }
      >
        {value}
      </span>
    </div>
  );
}
