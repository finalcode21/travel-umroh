import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Fail loudly but allow `next build` to succeed (pages are dynamic).
  console.warn(
    "[db] DATABASE_URL is not set. Database features will not work until it is configured.",
  );
}

const globalForDb = globalThis as unknown as { __travelUmrohPool?: Pool };

export const pool =
  globalForDb.__travelUmrohPool ??
  new Pool({
    connectionString,
    max: 5,
    ssl: { rejectUnauthorized: false }, // Neon requires SSL; rejectUnauthorized=False avoids cert-branding strictness
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__travelUmrohPool = pool;
}

export const db = drizzle(pool, { schema, casing: "snake_case" });

export type Database = typeof db;
export { schema };
