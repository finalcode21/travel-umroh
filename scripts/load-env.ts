// Hook lingkungan untuk skrip CLI (auth-smoke, provision-smoke, dll.).
// Dipanggil paling awal di setiap skrip Node/ESM yang butuh koneksi DB.
import dotenv from "dotenv";

// .env.local biasanya ditulis oleh `neon link`. Beberapa tool CLI/TSX bisa
// menjalankan skrip from project root, sehingga kita coba beberapa lokasi umum.
const candidates = [
  ".env.local",
  "../.env.local",
  "../../.env.local",
  ".env",
  "../.env",
  "../../.env",
];

let loaded = false;
for (const candidate of candidates) {
  const result = dotenv.config({ path: candidate, quiet: true });
  if (result.parsed && Object.keys(result.parsed).length > 0) {
    loaded = true;
    break;
  }
}

if (!loaded) {
  console.warn(
    "Peringatan: tidak ada .env.local/.env yang terbaca. " +
      "Jalankan `neon link` di root project, atau tempel DATABASE_URL / " +
      "DIRECT_URL manual ke .env.local.",
  );
}

export {};
