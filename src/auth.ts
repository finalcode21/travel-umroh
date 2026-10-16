import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";

import { db } from "@/db";
import {
  authUsers,
  authSessions,
  authAccounts,
  authVerifications,
} from "@/db/schema";

/**
 * Konfigurasi Better Auth — identity & session layer untuk travel-umroh.
 *
 * Tabel dipetakan ke nama kustom via `modelName` + drizzleAdapter.schema
 * agar sesuai dengan skema Core (lihat header src/db/schema.ts):
 *   user         → auth_users
 *   session      → auth_sessions
 *   account      → auth_accounts
 *   verification → auth_verifications
 *
 * Versi yang terpasang (verifikasi npm ls):
 *   better-auth              1.7.7
 *   @better-auth/drizzle-adapter  1.7.7
 *   drizzle-orm              0.45.4
 *
 * Validasi: hash kolom & unique key inti mengikuti dokumentasi resmi Better Auth
 * 1.7.x (core schema). Nama tabel fisik HANYA menjadi auth_* bila modelName
 * di atas disetel — defaultnya masing-masing adalah user/session/account/verification.
 */
/**
 * Base URL per environment:
 * - lokal/dev  : BETTER_AUTH_URL di .env.local (mis. http://localhost:3000)
 * - deploy     : BETTER_AUTH_URL diasetkan oleh platform deployment
 * Tanpa BETTER_AUTH_URL, fallback ke localhost agar dev tetap berjalan.
 */
const baseURL =
  process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  baseURL,
  database: drizzleAdapter(db as Parameters<typeof drizzleAdapter>[0], {
    provider: "pg",
    // KEY WAJIB mencerminan tabel fisik (modelName), bukan nama model logis.
    // Validasi runtime `@better-auth/drizzle-adapter` 1.7.7 mengintrospeksi
    // kunci schema ini dan membandingkannya dengan backend `getAuthTables`
    // yang memakai modelName (auth_users, …) — key "user" menyebabkan
    // "Missing tables" walau tabel fisiknya ada. Adapter juga mengambil
    // tabel lewat schema[modelName] di jalur query, jadi key harus sama.
    schema: {
      auth_users: authUsers,
      auth_sessions: authSessions,
      auth_accounts: authAccounts,
      auth_verifications: authVerifications,
    },
  }),
  user: {
    modelName: "auth_users",
    additionalFields: {
      phone: {
        type: "string",
        required: false,
        input: true,
        returned: true,
      },
      platformAccountId: {
        type: "string",
        required: false,
        input: false,
        returned: true,
      },
    },
  },
  session: {
    modelName: "auth_sessions",
  },
  account: {
    modelName: "auth_accounts",
  },
  verification: {
    modelName: "auth_verifications",
  },
  // Login email + password (provider "credential") wajib diaktifkan eksplisit;
  // tanpa ini signUpEmail/signInEmail menolak dengan
  // "Email and password sign up is not enabled" (temuan smoke test).
  emailAndPassword: {
    enabled: true,
  },
});
