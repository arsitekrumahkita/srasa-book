// ============================================================
// Bagian MURNI (tanpa Firebase) dari analitik tren rentang waktu —
// dipisah dari tren.ts KHUSUS supaya bisa diuji dengan Vitest tanpa
// memicu inisialisasi Firebase Auth/Firestore (lihat komentar di
// vitest.config.mts: hanya fungsi murni di src/shared/lib yang
// diuji, tanpa environment/setup Firebase). tren.ts meng-impor
// ulang semuanya dari sini.
// ============================================================

export function formatTanggalId(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatBulanId(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function tanggalKe(offsetHari: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetHari);
  return formatTanggalId(d);
}

export function daftarTanggalAntara(mulai: string, selesai: string): string[] {
  const hasil: string[] = [];
  const d = new Date(`${mulai}T00:00:00`);
  const akhir = new Date(`${selesai}T00:00:00`);
  // Batas pengaman: jangan pernah membangun daftar tanggal tak
  // terbatas kalau input rusak/kebalik.
  let pengaman = 0;
  while (d <= akhir && pengaman < 3660) {
    hasil.push(formatTanggalId(d));
    d.setDate(d.getDate() + 1);
    pengaman++;
  }
  return hasil;
}

export function daftarBulanAntara(mulai: string, selesai: string): string[] {
  const hasil: string[] = [];
  const [yMulai, mMulaiRaw] = mulai.split("-").map(Number);
  const [ySelesai, mSelesaiRaw] = selesai.split("-").map(Number);
  let y = yMulai;
  let m = mMulaiRaw;
  let pengaman = 0;
  while ((y < ySelesai || (y === ySelesai && m <= mSelesaiRaw)) && pengaman < 600) {
    hasil.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    pengaman++;
  }
  return hasil;
}
