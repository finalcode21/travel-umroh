import { NextRequest, NextResponse } from "next/server";

import {
  authProblemToResponse,
  getTenantAuthContext,
} from "@/lib/authz";
import { patchDeparture } from "@/lib/paket";

/**
 * PATCH /api/tenant/paket/[id]/departures/[depId]
 *
 * Mengubah keberangkatan satu paket (package.update).
 * tenantId (query, wajib); keberangkatan milik tenant lain → 404.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; depId: string }> },
) {
  const tenantId = request.nextUrl.searchParams.get("tenantId") ?? "";
  const { id, depId } = await params;

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId wajib diisi" }, { status: 400 });
  }
  if (!id || id === "") {
    return NextResponse.json({ error: "id paket wajib diisi" }, { status: 400 });
  }
  if (!depId || depId === "") {
    return NextResponse.json(
      { error: "id keberangkatan wajib diisi" },
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
    return NextResponse.json({ error: "body JSON tidak valid" }, { status: 400 });
  }

  const result = await patchDeparture(
    auth.context.userId,
    tenantId,
    id,
    depId,
    input,
  );

  if (!result.ok) {
    const response = authProblemToResponse(result.problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  return NextResponse.json({ departure: result.row }, { status: 200 });
}
