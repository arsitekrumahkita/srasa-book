// ============================================================
// Komponen input angka. Dipindah dari app/kalkulator-hpp ke sini
// (Rule of Two) begitu halaman /shift dan /belanja-nota mulai
// memakainya juga.
//
// Didefinisikan di TOP-LEVEL file (bukan bersarang di komponen
// lain) — lihat webrules-hikimori poin 11: ini yang mencegah bug
// fokus/kursor hilang setiap satu huruf diketik.
// ============================================================

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
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          disabled={disabled}
          aria-describedby={hintId}
          onChange={(event) => {
            const next = event.target.valueAsNumber;
            onChange(Number.isNaN(next) ? 0 : next);
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
