import { NextRequest, NextResponse } from "next/server";

import {
  authProblemToResponse,
  getTenantAuthContext,
} from "@/lib/authz";
import { getPaketById, patchPaket } from "@/lib/paket";

/**
 * GET/PATCH /api/tenant/paket/[id]
 *
 * Operasi berbasis satu paket yang dibatasi tenant dan dilindungi RBAC.
 * - GET   → detail paket termasuk daftar keberangkatan (package.read).
 * - PATCH → ubah data paket (package.update).
 *
 * Parameter:
 *   tenantId (query, wajib) — pembatas tenant yang terverifikasi.
 *   id       (path)         — paket yang diminta.
 *
 * ID paket milik tenant lain selalu dijawab 404 (bukan 403) agar tidak
 * membocorkan keberadaan resource.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = request.nextUrl.searchParams.get("tenantId") ?? "";
  const { id } = await params;

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId wajib diisi" }, { status: 400 });
  }
  if (!id || id === "") {
    return NextResponse.json({ error: "id paket wajib diisi" }, { status: 400 });
  }

  const auth = await getTenantAuthContext(request, tenantId);
  if (!auth.ok) {
    const response = authProblemToResponse(auth.problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  const result = await getPaketById(auth.context.userId, tenantId, id);

  if (!result.ok) {
    const response = authProblemToResponse(result.problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  return NextResponse.json({ paket: result.row }, { status: 200 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = request.nextUrl.searchParams.get("tenantId") ?? "";
  const { id } = await params;

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId wajib diisi" }, { status: 400 });
  }
  if (!id || id === "") {
    return NextResponse.json({ error: "id paket wajib diisi" }, { status: 400 });
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
    return NextResponse.json({ error: "body JSON tidak valid" }, { status: 400 });
  }

  const result = await patchPaket(auth.context.userId, tenantId, id, input);

  if (!result.ok) {
    const response = authProblemToResponse(result.problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  return NextResponse.json({ paket: result.row }, { status: 200 });
}
