"use client";

// ============================================================
// Satu baris "Item Belanja" beserta alur Ajukan Koreksi.
//
// Item yang SUDAH disimpan sengaja TIDAK bisa diubah Purchasing
// sendiri (permintaan pemilik cafe: "jika ingin edit maka
// membutuhkan Approval Akun Finance demi keamanan menghindari
// kecurangan"). Alasannya konkret: item belanja langsung memotong
// Saldo Finance saat disimpan, jadi mengizinkan edit bebas = membuka
// pintu mengubah saldo perusahaan tanpa pengawasan.
//
// Yang bisa dilakukan Purchasing di sini hanyalah MENGAJUKAN koreksi
// (ubah jumlah/harga, atau hapus) beserta alasannya. Tidak ada satu
// pun efek ke stok/saldo sampai Finance menekan Setujui — lihat
// setujuiPermintaanUbah() di src/shared/lib/permintaan-ubah-belanja.ts.
//
// Top-level component, tidak bersarang (webrules-hikimori poin 11).
// ============================================================

import { useState } from "react";
import { Loader2, PencilLine, Trash2, X } from "lucide-react";
import { NumberField } from "@/shared/components/number-field";
import { useToast } from "@/shared/components/toast";
import { useAuth } from "@/shared/lib/auth-context";
import { useOutletId } from "@/shared/lib/outlet-context";
import { formatRupiah, formatRupiahSatuan } from "@/shared/lib/format";
import {
  ajukanPermintaanUbah,
  batalkanPermintaanUbah,
  type PermintaanUbahBelanja,
} from "@/shared/lib/permintaan-ubah-belanja";

export interface ItemBelanjaBaris {
  id: string;
  bahanId: string | null;
  bahanNama: string;
  qty: number;
  satuan: string;
  hargaSatuan: number;
  subtotal: number;
}

function tanggalHariIni(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function BarisItemBelanja({
  belanjaId,
  item,
  sumberDana,
  permintaanMenunggu,
}: {
  belanjaId: string;
  item: ItemBelanjaBaris;
  sumberDana: "kas_resto" | "saldo_finance";
  permintaanMenunggu: PermintaanUbahBelanja | null;
}) {
  const { user, profil } = useAuth();
  const outletId = useOutletId();
  const { showToast } = useToast();
  const [formTerbuka, setFormTerbuka] = useState(false);
  const [qtyBaru, setQtyBaru] = useState(item.qty);
  const [totalBaru, setTotalBaru] = useState(item.subtotal);
  const [alasan, setAlasan] = useState("");
  const [sedangProses, setSedangProses] = useState(false);

  function bukaForm() {
    setQtyBaru(item.qty);
    setTotalBaru(item.subtotal);
    setAlasan("");
    setFormTerbuka(true);
  }

  async function kirim(jenis: "ubah" | "hapus") {
    if (!user || !profil) return;
    if (!alasan.trim()) {
      showToast("error", "Tulis alasan koreksinya — Finance perlu dasar untuk menyetujui.");
      return;
    }
    if (jenis === "ubah") {
      if (qtyBaru <= 0 || totalBaru <= 0) {
        showToast("error", "Jumlah dan total harga baru harus lebih besar dari 0.");
        return;
      }
      if (qtyBaru === item.qty && totalBaru === item.subtotal) {
        showToast("error", "Belum ada yang berubah dari data aslinya.");
        return;
      }
    }
    setSedangProses(true);
    try {
      await ajukanPermintaanUbah(outletId, {
        belanjaId,
        itemId: item.id,
        jenis,
        bahanId: item.bahanId,
        bahanNama: item.bahanNama,
        satuan: item.satuan,
        sumberDana,
        qtyLama: item.qty,
        hargaSatuanLama: item.hargaSatuan,
        subtotalLama: item.subtotal,
        qtyBaru: jenis === "hapus" ? 0 : qtyBaru,
        hargaSatuanBaru: jenis === "hapus" ? 0 : (qtyBaru > 0 ? totalBaru / qtyBaru : 0),
        subtotalBaru: jenis === "hapus" ? 0 : totalBaru,
        alasan: alasan.trim(),
        purchasingUid: user.uid,
        purchasingNama: profil.nama,
        tanggal: tanggalHariIni(),
      });
      showToast("success", "Permintaan koreksi terkirim — menunggu persetujuan Finance.");
      setFormTerbuka(false);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal mengirim permintaan: ${error.message}` : "Gagal mengirim permintaan.",
      );
    } finally {
      setSedangProses(false);
    }
  }

  async function batalkan() {
    if (!permintaanMenunggu) return;
    setSedangProses(true);
    try {
      await batalkanPermintaanUbah(outletId, permintaanMenunggu.id);
      showToast("success", "Permintaan koreksi dibatalkan.");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? `Gagal membatalkan: ${error.message}` : "Gagal membatalkan permintaan.",
      );
    } finally {
      setSedangProses(false);
    }
  }

  return (
    <li className="py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-slate-700">
          {item.bahanNama} · {item.qty} {item.satuan} × {formatRupiahSatuan(item.hargaSatuan)}
        </span>
        <span className="shrink-0 font-medium tabular-nums text-slate-900">
          {formatRupiah(item.subtotal)}
        </span>
      </div>

      {permintaanMenunggu ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5">
          <span className="text-xs font-medium text-amber-800">
            {permintaanMenunggu.jenis === "hapus"
              ? "Permintaan HAPUS menunggu persetujuan Finance"
              : `Permintaan ubah ke ${permintaanMenunggu.qtyBaru} ${permintaanMenunggu.satuan} / ${formatRupiah(permintaanMenunggu.subtotalBaru)} menunggu Finance`}
          </span>
          <button
            type="button"
            onClick={batalkan}
            disabled={sedangProses}
            className="ml-auto text-xs font-semibold text-amber-900 underline underline-offset-2 disabled:opacity-60"
          >
            Batalkan
          </button>
        </div>
      ) : formTerbuka ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700">Ajukan Koreksi</p>
            <button
              type="button"
              onClick={() => setFormTerbuka(false)}
              className="text-slate-400 hover:text-slate-600"
              aria-label="Tutup form koreksi"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <NumberField
              id={`koreksi-qty-${item.id}`}
              label={`Jumlah Baru (${item.satuan})`}
              value={qtyBaru}
              onChange={setQtyBaru}
            />
            <NumberField
              id={`koreksi-total-${item.id}`}
              label="Total Harga Baru"
              value={totalBaru}
              onChange={setTotalBaru}
              prefix="Rp"
            />
          </div>
          <div className="mt-2">
            <label htmlFor={`koreksi-alasan-${item.id}`} className="block text-xs font-semibold text-slate-700">
              Alasan (wajib)
            </label>
            <input
              id={`koreksi-alasan-${item.id}`}
              type="text"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder="misalnya: salah ketik jumlah, seharusnya 2 kg"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => kirim("ubah")}
              disabled={sedangProses}
              className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white motion-safe:transition hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-60"
            >
              {sedangProses ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Ajukan Perubahan
            </button>
            <button
              type="button"
              onClick={() => kirim("hapus")}
              disabled={sedangProses}
              className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-300 px-3 text-xs font-semibold text-rose-700 motion-safe:transition hover:bg-rose-50 active:scale-[0.98] disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Ajukan Hapus
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={bukaForm}
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 underline underline-offset-2 motion-safe:transition hover:text-emerald-700"
        >
          <PencilLine className="h-3 w-3" aria-hidden="true" />
          Ajukan koreksi
        </button>
      )}
    </li>
  );
}
