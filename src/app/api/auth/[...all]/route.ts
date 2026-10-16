import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/auth";

/**
 * Mount Better Auth di /api/auth/[...all].
 *
 * GET  = endpoint session/oidc dsb., POST = action (sign-up/sign-in/sign-out).
 * Handler memakai konfigurasi dari src/auth.ts (database Neon Development
 * saat develop; probe smoke test ada di scripts/auth-smoke.ts).
 */
export const { GET, POST } = toNextJsHandler(auth.handler);
