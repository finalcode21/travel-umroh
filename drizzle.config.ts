import { config } from "dotenv";

// Neon CLI menulis variabel ke .env.local; muat itu lebih dulu.
let loaded = false;
for (const path of [".env.local", ".env"]) {
  const result = config({ path, quiet: true });
  if (result.parsed) {
    loaded = true;
    break;
  }
}
if (!loaded && !process.env.DATABASE_URL) {
  console.warn(
    "Katalog .env.local/.env tidak ditemukan — koneksi mengandalkan env proses.",
  );
}
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit hanya dipakai untuk migrasi/schema tooling, jadi memakai
 * DIRECT_URL (unpooled direct connection) — bukan DATABASE_URL (pooled).
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? "",
  },
  strict: true,
  verbose: true,
});
