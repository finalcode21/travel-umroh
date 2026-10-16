import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db, schema } from "@/db";
import {
  getTenantAuthContext,
  authProblemToResponse,
  hasPermission,
} from "@/lib/authz";

/**
 * GET /api/tenant/installation
 *
 * Endpoint bisnis minimal yang dilindungi penuh: session valid, keanggotaan
 * tenant aktif, DAN permission RBAC tenant `installation.own.read`.
 *
 * Parameter:
 *   - tenantId       (query, wajib) — tenant yang diminta.
 *   - installationId (query, opsional) — bila diberikan, resource divalidasi
 *     milik tenant yang sudah terverifikasi; selain itu 404.
 *
 * Query resource SELALU dibatasi oleh tenant yang sudah diverifikasi dari
 * session + tenant_users; client tidak pernah menjadi sumber kebenaran
 * kepemilikan. Tidak ada operasi tulis pada endpoint ini.
 *
 * Kebijakan status:
 *   - 400 parameter wajib kosong.
 *   - 401 tanpa session valid.
 *   - 404 tenant/keanggotaan tidak dikenal, atau installationId bukan milik
 *     tenant terverifikasi (keberadaan resource disembunyikan).
 *   - 403 anggota aktif tetapi tidak punya permission `installation.own.read`.
 *   - 200 konteks instalasi milik tenant terverifikasi.
 *
 * Permission diwajibkan: `installation.own.read` (scope tenant).
 */
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId") ?? "";
  const installationId = request.nextUrl.searchParams.get("installationId");

  if (!tenantId) {
    return NextResponse.json(
      { error: "tenantId wajib diisi" },
      { status: 400 },
    );
  }

  // 1) Autentikasi + keanggotaan tenant aktif (terpusat, hasil
  //    getTenantAuthContext adalah satu-satunya sumber tenantId yang sah).
  const result = await getTenantAuthContext(request, tenantId);
  if (!result.ok) {
    const denial = authProblemToResponse(result.problem, true);
    return NextResponse.json(denial.body, { status: denial.status });
  }
  const context = result.context;

  // 2) Permission RBAC — tanpa ini keanggotaan saja tidak cukup.
  const allowed = await hasPermission(
    context.userId,
    "installation.own.read",
    "tenant",
    tenantId,
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403 },
    );
  }

  // 3) Query resource dibatasi oleh tenant yang sudah terverifikasi;
  //    installationId (jika ada) tunduk pada batas tenant, bukan penggantinya.
  const conditions = [eq(schema.installations.tenantId, tenantId)];
  if (installationId) {
    conditions.push(eq(schema.installations.id, installationId));
  }

  const rows = await db
    .select({
      id: schema.installations.id,
      name: schema.installations.name,
      status: schema.installations.status,
      tenantId: schema.installations.tenantId,
    })
    .from(schema.installations)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404 },
    );
  }

  const installation = rows[0];

  return NextResponse.json(
    {
      installation: {
        id: installation.id,
        name: installation.name,
        status: installation.status,
      },
      tenantId,
    },
    { status: 200 },
  );
}
