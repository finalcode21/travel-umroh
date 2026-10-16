import { NextRequest, NextResponse } from "next/server";

import {
  authProblemToResponse,
  getTenantAuthContext,
} from "@/lib/authz";
import { createDeparture } from "@/lib/paket";

/**
 * POST /api/tenant/paket/[id]/departures
 *
 * Menambahkan keberangkatan pada satu paket (package.update).
 * tenantId (query, wajib); paket milik tenant lain → 404.
 */
export async function POST(
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

  const result = await createDeparture(auth.context.userId, tenantId, id, input);

  if (!result.ok) {
    if (result.conflict) {
      return NextResponse.json(
        {
          error: result.problem.message ?? "code keberangkatan sudah ada di paket ini",
        },
        { status: 409 },
      );
    }
    const response = authProblemToResponse(result.problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  return NextResponse.json({ departure: result.row }, { status: 201 });
}
