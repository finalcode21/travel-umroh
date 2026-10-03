import { NextResponse } from "next/server";
import { getCurrentUser } from "@/core/auth/sessions";
import { AppError } from "@/lib/errors";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ ok: false, user: null });
    }
    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isPlatformAdmin: user.isPlatformAdmin,
        companyId: user.companyId,
        branchId: user.branchId,
        allBranches: user.allBranches,
      },
    });
  } catch (e) {
    const { message } = toPublicError(e);
    if (e instanceof AppError) {
      return NextResponse.json({ error: e.code, message }, { status: 401 });
    }
    console.error("[auth] me failed", e);
    return NextResponse.json({ error: "INTERNAL", message: "Gagal memuat profil." }, { status: 500 });
  }
}

function toPublicError(e: unknown): { message: string } {
  if (e instanceof AppError) return { message: e.message };
  return { message: "Terjadi kesalahan." };
}
