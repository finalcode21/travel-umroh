import { NextRequest, NextResponse } from "next/server";
import { requestPasswordReset } from "@/core/auth/sessions";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body as { email?: string };
    if (!email) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Email wajib diisi." },
        { status: 400 },
      );
    }

    const token = await requestPasswordReset(email);
    // In production, send this token to the user's email via an email service.
    // Here we return it so the app can display it in the UI (demo mode).
    return NextResponse.json({ ok: true, resetToken: token });
  } catch (e) {
    const { message } = toPublicError(e);
    if (e instanceof AppError) {
      return NextResponse.json({ error: e.code, message }, { status: 400 });
    }
    console.error("[auth] forgot-password failed", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Gagal memproses permintaan reset." },
      { status: 500 },
    );
  }
}

function toPublicError(e: unknown): { message: string } {
  if (e instanceof AppError) return { message: e.message };
  return { message: "Terjadi kesalahan." };
}
