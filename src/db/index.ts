import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";

/**
 * Koneksi runtime aplikasi. Selalu memakai DATABASE_URL (pooled connection
 * dari Neon) — cocok untuk Node & Vercel serverless. Migrasi database
 * memakai DIRECT_URL via drizzle.config.ts.
 */
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL belum diisi. Jalankan `neon link` atau set variabel di .env.local",
  );
}

declare global {
  var __dbPool: Pool | undefined;
}

/**
 * Satu pool per proses; di dev Next.js HMR bisa me-recreate modul,
 * jadi pool disimpan di global untuk mencegah kebocoran koneksi.
 */
const pool =
  global.__dbPool ??
  new Pool({ connectionString: databaseUrl, max: 10 });

if (process.env.NODE_ENV !== "production") {
  global.__dbPool = pool;
}

export const db = drizzle(pool, { schema });

export { schema };
export type Db = typeof db;
