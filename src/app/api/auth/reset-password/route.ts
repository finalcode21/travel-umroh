import { NextRequest, NextResponse } from "next/server";
import { resetPassword } from "@/core/auth/sessions";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, newPassword } = body as { token?: string; newPassword?: string };
    if (!token || !newPassword) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Token reset dan password wajib diisi." },
        { status: 400 },
      );
    }
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Password minimal 8 karakter." },
        { status: 400 },
      );
    }

    await resetPassword(token, newPassword);
    return NextResponse.json({ ok: true, message: "Kata sandi berhasil diubah." });
  } catch (e) {
    const { message } = toPublicError(e);
    if (e instanceof AppError) {
      return NextResponse.json({ error: e.code, message }, { status: 400 });
    }
    console.error("[auth] reset-password failed", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Gagal mengubah kata sandi." },
      { status: 500 },
    );
  }
}

function toPublicError(e: unknown): { message: string } {
  if (e instanceof AppError) return { message: e.message };
  return { message: "Terjadi kesalahan." };
}
