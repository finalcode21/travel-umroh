"use client";

import { createAuthClient } from "better-auth/react";

/** Client Better Auth yang menggunakan handler lokal /api/auth. */
export const authClient = createAuthClient();
