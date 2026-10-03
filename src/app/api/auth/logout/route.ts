import { NextResponse } from "next/server";
import { destroySession } from "@/core/auth/sessions";
import { AppError } from "@/lib/errors";

export async function POST() {
  try {
    // Destroy the session identified by the cookie
    const { cookies } = await import("next/headers");
    const cookie = await cookies();
    const token = cookie.get("tu_session")?.value ?? null;
    if (token) {
      await destroySession(token);
    }
    return NextResponse.json({ ok: true, message: "Berhasil keluar." });
  } catch (e) {
    const { message } = toPublicError(e);
    if (e instanceof AppError) {
      return NextResponse.json({ error: e.code, message }, { status: 401 });
    }
    console.error("[auth] logout failed", e);
    return NextResponse.json({ error: "INTERNAL", message: "Gagal keluar." }, { status: 500 });
  }
}

function toPublicError(e: unknown): { message: string } {
  if (e instanceof AppError) return { message: e.message };
  return { message: "Terjadi kesalahan." };
}
