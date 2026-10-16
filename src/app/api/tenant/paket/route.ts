import { NextRequest, NextResponse } from "next/server";

import {
  authProblemToResponse,
  getTenantAuthContext,
} from "@/lib/authz";
import { getPaketList, createPaket } from "@/lib/paket";

/**
 * GET/POST /api/tenant/paket
 *
 * Endpoint paket umrah yang dibatasi tenant dan dilindungi RBAC.
 * - GET  → daftar paket (pencarian, filter status, cursor pagination).
 *   Permission: package.read
 * - POST → buat paket baru dengan pemeriksaan konflik code per tenant.
 *   Permission: package.create
 *
 * Parameter wajib: tenantId (query).
 * Resource selalu dikunci ke tenantId yang terverifikasi dari context;
 * kegagalan otorisasi lintas tenant dijawab 404 agar tidak membocorkan
 * keberadaan tenant.
 */
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId") ?? "";
  const search = request.nextUrl.searchParams.get("search") ?? undefined;
  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
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

  const result = await getPaketList(auth.context.userId, tenantId, {
    search,
    status,
    cursor,
    limit,
  });

  if (!result.ok) {
    const response = authProblemToResponse(result.problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  return NextResponse.json(
    { rows: result.rows, nextCursor: result.nextCursor ?? null },
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

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json(
      { error: "body JSON tidak valid" },
      { status: 400 },
    );
  }

  const result = await createPaket(auth.context.userId, tenantId, input);

  if (!result.ok) {
    if (result.conflict) {
      return NextResponse.json(
        {
          error: result.problem.message ?? "code paket sudah digunakan di tenant ini",
        },
        { status: 409 },
      );
    }
    const response = authProblemToResponse(result.problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  return NextResponse.json(
    { paket: result.row },
    { status: 201 },
  );
}
