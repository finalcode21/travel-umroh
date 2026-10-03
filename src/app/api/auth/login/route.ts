import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { signIn } from "@/core/auth/sessions";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body as { email?: string; password?: string };
    if (!email || !password) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Email dan password wajib diisi." },
        { status: 400 },
      );
    }

    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
    const userAgent = h.get("user-agent") ?? undefined;

    const { user } = await signIn({ email, password, ip, userAgent });
    return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (e) {
    const { message } = toPublicError(e);
    if (e instanceof AppError) {
      return NextResponse.json({ error: e.code, message }, { status: 401 });
    }
    console.error("[auth] login failed", e);
    return NextResponse.json({ error: "INTERNAL", message: "Gagal masuk. Coba lagi nanti." }, { status: 500 });
  }
}

function toPublicError(e: unknown): { message: string } {
  if (e instanceof AppError) return { message: e.message };
  return { message: "Terjadi kesalahan." };
}
