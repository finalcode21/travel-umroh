import { NextRequest, NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { authProblemToResponse, getSessionFromRequest, type AuthProblem } from "@/lib/authz";

/**
 * GET /api/tenant/mine
 *
 * Mengembalikan daftar tenant (id, nama, slug, status keanggotaan) tempat
 * identitas sesi terdaftar aktif di tenant_users. Dibatasi baris milik
 * sesi itu sendiri — bukan sumber kepemilikan dari client.
 */
export async function GET(_request: NextRequest) {
  const auth = await getSessionFromRequest(_request);
  if (!auth.ok) {
    const problem: AuthProblem = { kind: "no_session", message: "Autentikasi diperlukan" };
    const response = authProblemToResponse(problem, true);
    return NextResponse.json(response.body, { status: response.status });
  }

  const rows = await db
    .select({
      tenantId: schema.tenantUsers.tenantId,
      status: schema.tenantUsers.status,
      tenantName: schema.tenants.name,
      slug: schema.tenants.slug,
      tenantStatus: schema.tenants.status,
    })
    .from(schema.tenantUsers)
    .innerJoin(
      schema.tenants,
      and(
        eq(schema.tenantUsers.tenantId, schema.tenants.id),
        eq(schema.tenantUsers.status, "active"),
      ),
    )
    .where(
      and(
        eq(schema.tenantUsers.userId, auth.userId),
        eq(schema.tenantUsers.status, "active"),
      ),
    );

  return NextResponse.json({ rows }, { status: 200 });
}
