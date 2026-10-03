import { NextRequest, NextResponse } from "next/server";
import { signUp } from "@/core/auth/sessions";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, password, companyId, branchId } = body as {
      name?: string;
      email?: string;
      password?: string;
      companyId?: string;
      branchId?: string;
    };
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Nama, email, dan password wajib diisi." },
        { status: 400 },
      );
    }

    const { user, isSuperAdmin } = await signUp({
      name,
      email,
      password,
      companyId,
      branchId,
    });

    return NextResponse.json({
      ok: true,
      isSuperAdmin,
      user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin },
    });
  } catch (e) {
    const { message } = toPublicError(e);
    if (e instanceof AppError) {
      return NextResponse.json({ error: e.code, message }, { status: 400 });
    }
    console.error("[auth] signup failed", e);
    return NextResponse.json(
      { error: "INTERNAL", message: "Gagal mendaftar. Coba lagi nanti." },
      { status: 500 },
    );
  }
}

function toPublicError(e: unknown): { message: string } {
  if (e instanceof AppError) return { message: e.message };
  return { message: "Terjadi kesalahan." };
}
