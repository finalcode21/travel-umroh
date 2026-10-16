import { NextRequest, NextResponse } from "next/server";

import {
  getTenantAuthContext,
  authProblemToResponse,
} from "@/lib/authz";

/**
 * GET /api/tenant/context
 *
 * Endpoint terlindungi yang mengembalikan konteks minimum milik tenant yang
 * sudah diverifikasi. Hanya dipakai untuk verifikasi isolasi tenant; tidak
 * mengekspos secret, cookie, atau data jamaah.
 *
 * Parameter:
 *   tenantId (query, wajib) — tenant yang diminta.
 *
 * Permission yang diwajibkan: keanggotaan aktif pada tenant_users untuk
 * tenantId tersebut. Permission RBAC tidak diperiksa oleh endpoint ini.
 */
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId") ?? "";

  if (!tenantId) {
    return NextResponse.json(
      { error: "tenantId wajib diisi" },
      { status: 400 },
    );
  }

  const result = await getTenantAuthContext(request, tenantId);

  if (!result.ok) {
    const response = authProblemToResponse(result.problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  const { userId, tenant } = result.context;

  const tenantIdValue = "tenantId" in tenant ? tenant.tenantId : "";
  const tenantStatusValue = "status" in tenant ? tenant.status : "unknown";

  return NextResponse.json(
    {
      userId,
      tenantId: tenantIdValue,
      tenantStatus: tenantStatusValue,
    },
    { status: 200 },
  );
}
