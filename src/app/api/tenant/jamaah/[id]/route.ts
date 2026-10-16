import { NextRequest, NextResponse } from "next/server";

import { authProblemToResponse, getJamaahById, patchJamaah, getTenantAuthContext, type JamaahPatchInput } from "@/lib/authz";

/**
 * GET/PATCH /api/tenant/jamaah/[id]
 *
 * Operasi berbasis satu jamaah yang dibatasi tenant dan dilindungi RBAC.
 * - GET    → baca detail jamaah (jamaah.read).
 * - PATCH  → ubah data jamaah (jamaah.update).
 *
 * Parameter:
 *   tenantId (query, wajib) — pembatas tenant yang terverifikasi.
 *   id       (path)        — jamaah yang diminta (dari params.id).
 *
 * Karena ID jamaah dikombinasikan dengan tenantId, ID jamaah milik tenant lain
 * selalu menjadi 404 (bukan 403) agar tidak membocorkan keberadaan resource.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = request.nextUrl.searchParams.get("tenantId") ?? "";
  const { id } = await params;

  if (!tenantId) {
    return NextResponse.json(
      { error: "tenantId wajib diisi" },
      { status: 400 },
    );
  }

  if (!id || id === "") {
    return NextResponse.json(
      { error: "id jamaah wajib diisi" },
      { status: 400 },
    );
  }

  const auth = await getTenantAuthContext(request, tenantId);
  if (!auth.ok) {
    return NextResponse.json(
      authProblemToResponse(auth.problem, true).body,
      { status: authProblemToResponse(auth.problem, true).status },
    );
  }

  const result = await getJamaahById(
    auth.context.userId,
    tenantId,
    id,
  );

  if (!result.ok) {
    return NextResponse.json(
      authProblemToResponse(result.problem, true).body,
      { status: authProblemToResponse(result.problem, true).status },
    );
  }

  return NextResponse.json(
    {
      jamaah: result.row,
    },
    { status: 200 },
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = request.nextUrl.searchParams.get("tenantId") ?? "";
  const { id } = await params;

  if (!tenantId) {
    return NextResponse.json(
      { error: "tenantId wajib diisi" },
      { status: 400 },
    );
  }

  if (!id || id === "") {
    return NextResponse.json(
      { error: "id jamaah wajib diisi" },
      { status: 400 },
    );
  }

  const auth = await getTenantAuthContext(request, tenantId);
  if (!auth.ok) {
    return NextResponse.json(
      authProblemToResponse(auth.problem, true).body,
      { status: authProblemToResponse(auth.problem, true).status },
    );
  }

  let input: JamaahPatchInput;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json(
      { error: "body JSON tidak valid" },
      { status: 400 },
    );
  }

  const result = await patchJamaah(
    auth.context.userId,
    tenantId,
    id,
    input,
  );

  if (!result.ok) {
    return NextResponse.json(
      authProblemToResponse(result.problem, true).body,
      { status: authProblemToResponse(result.problem, true).status },
    );
  }

  return NextResponse.json(
    {
      jamaah: result.row,
    },
    { status: 200 },
  );
}
