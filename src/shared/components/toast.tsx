"use client";

// ============================================================
// Sistem notifikasi toast (webrules-hikimori poin 9).
// Dipakai lintas halaman (Kalkulator HPP, nanti Tutup Shift,
// Belanja & Nota, dll) — sesuai "Rule of Two" ini WAJIB tinggal
// di src/shared, bukan di dalam satu folder halaman.
//
// PENTING (webrules-hikimori poin 11): semua komponen di file ini
// didefinisikan di TOP-LEVEL module, sejajar satu sama lain —
// TIDAK ADA yang didefinisikan bersarang di dalam function
// komponen lain, supaya tidak memicu bug kehilangan fokus input
// di halaman manapun yang memakai ToastProvider ini.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";

// ------------------------------------------------------------
// SECTION: Tipe & Context
// ------------------------------------------------------------

export type ToastType = "success" | "error";

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  /** true = sedang animasi keluar, akan dihapus dari DOM sesaat lagi. */
  leaving: boolean;
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4000;
const LEAVE_ANIMATION_MS = 200;

/** Hook untuk dipakai halaman manapun: const { showToast } = useToast(); */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast harus dipakai di dalam <ToastProvider>.");
  }
  return ctx;
}

// ------------------------------------------------------------
// SECTION: Provider (bungkus di root layout.tsx)
// ------------------------------------------------------------

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    timers.current.delete(id);
  }, []);

  const startLeaving = useCallback(
    (id: string) => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      const timer = setTimeout(() => removeToast(id), LEAVE_ANIMATION_MS);
      timers.current.set(id, timer);
    },
    [removeToast],
  );

  const showToast = useCallback(
    (type: ToastType, message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id, type, message, leaving: false }]);

      const timer = setTimeout(() => startLeaving(id), AUTO_DISMISS_MS);
      timers.current.set(id, timer);
    },
    [startLeaving],
  );

  // Bersihkan semua timer saat provider unmount, supaya tidak
  // memanggil setState setelah komponen sudah tidak ada.
  useEffect(() => {
    const timersMap = timers.current;
    return () => {
      timersMap.forEach((timer) => clearTimeout(timer));
      timersMap.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={startLeaving} />
    </ToastContext.Provider>
  );
}

// ------------------------------------------------------------
// SECTION: Komponen visual (top-level, tidak bersarang)
// ------------------------------------------------------------

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const isSuccess = toast.type === "success";

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={[
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-4 shadow-lg",
        "motion-safe:transition motion-safe:duration-200",
        isSuccess
          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
          : "border-rose-300 bg-rose-50 text-rose-900",
      ].join(" ")}
      style={{
        animation: `${toast.leaving ? "toast-slide-out" : "toast-slide-in"} 200ms ease forwards`,
      }}
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {isSuccess ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <XCircle className="h-5 w-5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{isSuccess ? "Berhasil" : "Gagal"}</p>
        <p className="mt-0.5 text-sm leading-snug break-words">{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Tutup notifikasi"
        className={[
          "shrink-0 rounded-md p-1 motion-safe:transition-colors motion-safe:duration-150",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
          isSuccess
            ? "hover:bg-emerald-100 focus-visible:outline-emerald-600"
            : "hover:bg-rose-100 focus-visible:outline-rose-600",
        ].join(" ")}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
