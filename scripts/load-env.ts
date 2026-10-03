import { config } from "dotenv";

/**
 * Environment bootstrap for standalone scripts.
 *
 * `dotenv/config` only reads `.env`, but this app keeps its secrets in
 * `.env.local` (Next.js convention). Loading happens here — and this module
 * must be imported FIRST in any script, because ESM evaluates imports before
 * the importing module's own body. `src/db/index.ts` captures
 * `process.env.DATABASE_URL` at module-evaluation time, so env loading has to
 * happen before that module is reached.
 */
config({ path: ".env.local" });
config();

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
  );
  process.exit(1);
}