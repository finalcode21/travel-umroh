import { NextRequest, NextResponse } from "next/server";

import {
  authProblemToResponse,
  getJamaahList,
  createJamaah,
  getTenantAuthContext,
  type JamaahCreateInput,
} from "@/lib/authz";

/**
 * GET/POST /api/tenant/jamaah
 *
 * Endpoint jamaah yang dibatasi tenant dan dilindungi RBAC.
 * - GET  → daftar jamaah (opsional pencarian + pagination).
 * - POST → buat jamaah baru dengan pemeriksaan konflik registrant_no.
 *
 * Permission yang dibutuhkan:
 *   - GET  : jamaah.read
 *   - POST : jamaah.create
 *
 * Parameter wajib: tenantId (query).
 * Resource selalu dikunci ke tenantId yang terverifikasi dari context;
 * client tidak boleh menjadi otoritas kepemilikan.
 */
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId") ?? "";
  const search = request.nextUrl.searchParams.get("search") ?? undefined;
  const limitRaw = request.nextUrl.searchParams.get("limit");

  if (!tenantId) {
    return NextResponse.json(
      { error: "tenantId wajib diisi" },
      { status: 400 },
    );
  }

  const auth = await getTenantAuthContext(request, tenantId);
  if (!auth.ok) {
    const response = authProblemToResponse(auth.problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  const limit =
    limitRaw !== null && limitRaw !== undefined
      ? Math.max(1, Math.min(100, Number(limitRaw)))
      : undefined;

  const result = await getJamaahList(
    auth.context.userId,
    tenantId,
    search,
    limit,
  );

  if (!result.ok) {
    const response = authProblemToResponse(result.problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  return NextResponse.json(
    {
      rows: result.rows,
    },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId") ?? "";

  if (!tenantId) {
    return NextResponse.json(
      { error: "tenantId wajib diisi" },
      { status: 400 },
    );
  }

  const auth = await getTenantAuthContext(request, tenantId);
  if (!auth.ok) {
    const response = authProblemToResponse(auth.problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  let input: JamaahCreateInput;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json(
      { error: "body JSON tidak valid" },
      { status: 400 },
    );
  }

  const result = await createJamaah(
    auth.context.userId,
    tenantId,
    input,
  );

  if (!result.ok) {
    if (result.conflict) {
      return NextResponse.json(
        {
          error:
            result.problem.message ??
            "registrantNo sudah digunakan di tenant ini",
        },
        { status: 409 },
      );
    }
    const response = authProblemToResponse(result.problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  return NextResponse.json(
    {
      jamaah: result.row,
    },
    { status: 201 },
  );
}
