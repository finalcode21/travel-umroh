import { and, eq, ilike, or, SQL } from "drizzle-orm";

import { db, schema } from "@/db";

export type RoleScope = "platform" | "tenant";

export interface RoleAssignment {
  roleId: string;
  scope: RoleScope;
  tenantId?: string;
}

export interface PermissionCheck {
  code: string;
  scope: RoleScope;
  tenantId?: string;
}

export async function getRolesForUser(
  userId: string,
  tenantId?: string,
): Promise<RoleAssignment[]> {
  if (tenantId) {
    const rows = await db
      .select({
        roleId: schema.tenantRoleAssignments.roleId,
        scope: schema.roles.scope,
        tenantId: schema.roles.tenantId,
      })
      .from(schema.tenantRoleAssignments)
      .innerJoin(
        schema.roles,
        and(
          eq(schema.tenantRoleAssignments.roleId, schema.roles.id),
          eq(schema.tenantRoleAssignments.tenantId, schema.roles.tenantId),
        ),
      )
      .where(
        and(
          eq(schema.tenantRoleAssignments.userId, userId),
          eq(schema.tenantRoleAssignments.tenantId, tenantId),
        ),
      );

    return rows.map((r) => ({
      roleId: r.roleId,
      scope: "tenant" as const,
      tenantId: r.tenantId ?? undefined,
    }));
  }

  const rows = await db
    .select({
      roleId: schema.platformRoleAssignments.roleId,
      scope: schema.roles.scope,
    })
    .from(schema.platformRoleAssignments)
    .innerJoin(
      schema.roles,
      and(
        eq(schema.platformRoleAssignments.roleId, schema.roles.id),
        eq(schema.platformRoleAssignments.scope, schema.roles.scope),
      ),
    )
    .where(eq(schema.platformRoleAssignments.userId, userId));

  return rows.map((r) => ({
    roleId: r.roleId,
    scope: "platform" as const,
  }));
}

export async function getPermissionsForUser(
  userId: string,
  scope: RoleScope,
  tenantId?: string,
): Promise<string[]> {
  const roles = await getRolesForUser(userId, tenantId);
  const roleIds = roles.map((r) => r.roleId);

  if (roleIds.length === 0) {
    return [];
  }

  if (scope === "tenant" && tenantId) {
    const rows = await db
      .select({ code: schema.permissions.code })
      .from(schema.rolePermissions)
      .innerJoin(
        schema.roles,
        and(
          eq(schema.rolePermissions.roleId, schema.roles.id),
          eq(schema.rolePermissions.scope, schema.roles.scope),
          eq(schema.roles.tenantId, tenantId),
          eq(schema.roles.scope, "tenant"),
        ),
      )
      .innerJoin(
        schema.permissions,
        and(
          eq(schema.rolePermissions.permissionId, schema.permissions.id),
          eq(schema.rolePermissions.scope, schema.permissions.scope),
          eq(schema.permissions.scope, "tenant"),
        ),
      )
      .where(
        and(
          eq(schema.rolePermissions.scope, "tenant"),
          ...roleIds.map((id) => eq(schema.roles.id, id)),
        ),
      );

    const codes = rows.map((r) => r.code);
    return [...new Set(codes)];
  }

  const rows = await db
    .select({ code: schema.permissions.code })
    .from(schema.rolePermissions)
    .innerJoin(
      schema.roles,
      and(
        eq(schema.rolePermissions.roleId, schema.roles.id),
        eq(schema.rolePermissions.scope, schema.roles.scope),
      ),
    )
    .innerJoin(
      schema.permissions,
      and(
        eq(schema.rolePermissions.permissionId, schema.permissions.id),
        eq(schema.rolePermissions.scope, schema.permissions.scope),
      ),
    )
    .where(
      and(
        eq(schema.rolePermissions.scope, scope),
        ...roleIds.map((id) => eq(schema.roles.id, id)),
      ),
    );

  const codes = rows.map((r) => r.code);
  return [...new Set(codes)];
}

export async function hasPermission(
  userId: string,
  code: string,
  scope: RoleScope,
  tenantId?: string,
): Promise<boolean> {
  const permissions = await getPermissionsForUser(userId, scope, tenantId);
  return permissions.includes(code);
}

export function isJahadPermissionCode(code: string): boolean {
  return code.startsWith("jamaah.");
}

export async function requireJahadPermissions(
  userId: string,
  codes: readonly string[],
  tenantId: string,
): Promise<
  | { ok: true }
  | { ok: false; problem: AuthProblem }
> {
  for (const code of codes) {
    const permitted = await hasPermission(userId, code, "tenant", tenantId);
    if (!permitted) {
      return {
        ok: false,
        problem: {
          kind: "no_permission",
          message: `Izin "${code}" diperlukan`,
        },
      };
    }
  }
  return { ok: true };
}

export async function getJamaahList(
  userId: string,
  tenantId: string,
  search?: string,
  limit?: number,
  cursor?: string,
): Promise<
  | { ok: true; rows: JamaahRow[]; nextCursor?: string }
  | { ok: false; problem: AuthProblem }
> {
  const auth = await requireJahadPermissions(userId, ["jamaah.read"], tenantId);
  if (!auth.ok) return auth;

  const conditions: SQL[] = [eq(schema.pilgrims.tenantId, tenantId)];
  const term = search?.trim();
  if (term) {
    const like = `%${term}%`;
    const searchCondition = or(
      ilike(schema.pilgrims.fullName, like),
      ilike(schema.pilgrims.registrantNo, like),
      ilike(schema.pilgrims.phone, like),
      ilike(schema.pilgrims.email, like),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const where = conditions.length > 1 ? and(...conditions) : conditions[0]!;

  const d = db
    .select({
      id: schema.pilgrims.id,
      registrantNo: schema.pilgrims.registrantNo,
      fullName: schema.pilgrims.fullName,
      phone: schema.pilgrims.phone,
      email: schema.pilgrims.email,
      status: schema.pilgrims.status,
      createdAt: schema.pilgrims.createdAt,
    })
    .from(schema.pilgrims)
    .where(where)
    .orderBy(schema.pilgrims.createdAt);

  let rows: JamaahRow[];
  if (limit && limit > 0) {
    rows = await d.limit(limit + 1);
  } else {
    rows = await d;
  }

  // TODO(kursor): cursor pagination ditunda sampai pemeriksaan frontend selesai.
  return { ok: true, rows };
}

export interface JamaahRow {
  id: string;
  registrantNo: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: string;
  createdAt: Date;
}

export interface JamaahDetail {
  id: string;
  tenantId: string;
  registrantNo: string;
  fullName: string;
  identityNo: string | null;
  phone: string | null;
  email: string | null;
  dateOfBirth: Date | null;
  address: string | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getJamaahById(
  userId: string,
  tenantId: string,
  id: string,
): Promise<
  | { ok: true; row: JamaahDetail }
  | { ok: false; problem: AuthProblem }
> {
  const auth = await requireJahadPermissions(userId, ["jamaah.read"], tenantId);
  if (!auth.ok) return auth;

  const rows = await db
    .select()
    .from(schema.pilgrims)
    .where(
      and(
        eq(schema.pilgrims.id, id),
        eq(schema.pilgrims.tenantId, tenantId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      problem: {
        kind: "no_membership",
        message: "Jamaah tidak ditemukan",
      },
    };
  }

  return {
    ok: true,
    row: {
      id: row.id,
      tenantId: row.tenantId,
      registrantNo: row.registrantNo,
      fullName: row.fullName,
      identityNo: row.identityNo,
      phone: row.phone,
      email: row.email,
      dateOfBirth: row.dateOfBirth,
      address: row.address,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

export interface JamaahCreateInput {
  registrantNo: string;
  fullName: string;
  identityNo?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  address?: string;
  notes?: string;
}

export async function createJamaah(
  userId: string,
  tenantId: string,
  input: JamaahCreateInput,
): Promise<
  | { ok: true; row: JamaahDetail }
  | { ok: false; problem: AuthProblem; conflict?: boolean }
> {
  const auth = await requireJahadPermissions(userId, ["jamaah.create"], tenantId);
  if (!auth.ok) return auth;

  if (!input.registrantNo.trim()) {
    return {
      ok: false,
      problem: {
        kind: "validation",
        message: "registrantNo wajib diisi",
      },
      conflict: false,
    };
  }
  if (!input.fullName.trim()) {
    return {
      ok: false,
      problem: {
        kind: "validation",
        message: "fullName wajib diisi",
      },
      conflict: false,
    };
  }

  const registrantNo = input.registrantNo.trim();
  const existing = await db
    .select({ id: schema.pilgrims.id })
    .from(schema.pilgrims)
    .where(
      and(
        eq(schema.pilgrims.tenantId, tenantId),
        eq(schema.pilgrims.registrantNo, registrantNo),
      ),
    )
    .limit(1);

  if (existing[0]) {
    return {
      ok: false,
      problem: {
        kind: "no_permission",
        message: "registrantNo sudah digunakan di tenant ini",
      },
      conflict: true,
    };
  }

  try {
    const [row] = await db
      .insert(schema.pilgrims)
      .values({
        tenantId,
        registrantNo,
        fullName: input.fullName.trim(),
        identityNo: input.identityNo?.trim() ?? null,
        phone: input.phone?.trim() ?? null,
        email: input.email?.trim().toLowerCase() ?? null,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
        address: input.address?.trim() ?? null,
        notes: input.notes?.trim() ?? null,
      })
      .returning();

    return {
      ok: true,
      row: {
        id: row.id,
        tenantId: row.tenantId,
        registrantNo: row.registrantNo,
        fullName: row.fullName,
        identityNo: row.identityNo,
        phone: row.phone,
        email: row.email,
        dateOfBirth: row.dateOfBirth,
        address: row.address,
        status: row.status,
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    };
  } catch (e) {
    const error = e as { code?: string; detail?: string };
      throw e;
  }

}

export interface JamaahPatchInput {
  fullName?: string;
  identityNo?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  address?: string;
  status?: string;
  notes?: string;
}

export async function patchJamaah(
  userId: string,
  tenantId: string,
  id: string,
  input: JamaahPatchInput,
): Promise<
  | { ok: true; row: JamaahDetail }
  | { ok: false; problem: AuthProblem }
> {
  const auth = await requireJahadPermissions(userId, ["jamaah.update"], tenantId);
  if (!auth.ok) return auth;

  const [existing] = await db
    .select()
    .from(schema.pilgrims)
    .where(
      and(
        eq(schema.pilgrims.id, id),
        eq(schema.pilgrims.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!existing) {
    return {
      ok: false,
      problem: {
        kind: "no_membership",
        message: "Jamaah tidak ditemukan",
      },
    };
  }

  const updatedAt = new Date();
  const [row] = await db
    .update(schema.pilgrims)
    .set({
      fullName: input.fullName !== undefined ? input.fullName.trim() : existing.fullName,
      identityNo: input.identityNo !== undefined ? input.identityNo.trim() : existing.identityNo,
      phone: input.phone !== undefined ? input.phone.trim() : existing.phone,
      email: input.email !== undefined ? input.email.trim().toLowerCase() : existing.email,
      dateOfBirth: input.dateOfBirth !== undefined ? new Date(input.dateOfBirth) : existing.dateOfBirth,
      address: input.address !== undefined ? input.address.trim() : existing.address,
      status: input.status !== undefined ? input.status.trim() : existing.status,
      notes: input.notes !== undefined ? input.notes.trim() : existing.notes,
      updatedAt,
    })
    .where(eq(schema.pilgrims.id, id))
    .returning();

  if (!row) {
    return {
      ok: false,
      problem: {
        kind: "no_permission",
        message: "gagal memperbarui jamaah",
      },
    };
  }

  return {
    ok: true,
    row: {
      id: row.id,
      tenantId: row.tenantId,
      registrantNo: row.registrantNo,
      fullName: row.fullName,
      identityNo: row.identityNo,
      phone: row.phone,
      email: row.email,
      dateOfBirth: row.dateOfBirth,
      address: row.address,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

export interface TenantMembership {
  userId: string;
  tenantId: string;
  status: string;
}

export interface TenantAuthContext {
  session: import("better-auth").Session;
  userId: string;
  tenant: TenantMembership;
}

export interface TenantMembershipResult {
  member: boolean;
  membership?: TenantMembership;
}

export type AuthProblem =
  | { kind: "no_session"; message: string }
  | { kind: "no_user"; message: string }
  | { kind: "no_membership"; message: string }
  | { kind: "membership_inactive"; message: string }
  | { kind: "no_permission"; message: string }
  | { kind: "validation"; message: string };

export type GetSessionResult =
  | { ok: true; session: import("better-auth").Session; userId: string }
  | { ok: false };

export async function getSessionFromRequest(
  request: Request,
): Promise<GetSessionResult> {
  const headers = new Headers(request.headers);
  const result = await import("@/auth").then((m) => m.auth.api.getSession({ headers }));
  if (!result) {
    return { ok: false };
  }
  const session = result.session;
  const userId = result.user.id;
  if (!session || !userId) {
    return { ok: false };
  }
  return { ok: true, session, userId };
}

export async function checkTenantMembership(
  session: import("better-auth").Session,
  tenantId: string,
): Promise<TenantMembershipResult> {
  const userId = session.userId;
  if (!userId) {
    return { member: false };
  }

  const rows = await db
    .select()
    .from(schema.tenantUsers)
    .where(
      and(
        eq(schema.tenantUsers.userId, userId),
        eq(schema.tenantUsers.tenantId, tenantId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { member: false };
  }

  if (row.status !== "active") {
    return { member: false };
  }

  return {
    member: true,
    membership: {
      userId: row.userId,
      tenantId: row.tenantId,
      status: row.status,
    },
  };
}

export async function getTenantAuthContext(
  request: Request,
  requireTenantId?: string,
): Promise<
  | { ok: true; context: TenantAuthContext }
  | { ok: false; problem: AuthProblem }
> {
  const authResult = await getSessionFromRequest(request);
  if (!authResult.ok) {
    return {
      ok: false,
      problem: {
        kind: "no_session",
        message: "Autentikasi diperlukan",
      },
    };
  }

  const session = authResult.session;
  const userId = authResult.userId;

  if (requireTenantId) {
    const result = await checkTenantMembership(session, requireTenantId);
    if (!result.member || !result.membership) {
      return {
        ok: false,
        problem: {
          kind: "no_membership",
          message: "Anggota tenant tidak ditemukan",
        },
      };
    }
    return {
      ok: true,
      context: {
        session,
        userId,
        tenant: result.membership,
      },
    };
  }

  return {
    ok: true,
    context: {
      session,
      userId,
      tenant: { userId, tenantId: "", status: "unknown" },
    },
  };
}

export interface AuthResponse {
  status: number;
  body: Record<string, unknown>;
}

export function authProblemToResponse(
  problem: AuthProblem,
  hideResource: boolean = false,
): AuthResponse {
  switch (problem.kind) {
    case "no_session":
      return { status: 401, body: { error: "unauthorized" } };
    case "no_user":
      return { status: 401, body: { error: "unauthorized" } };
    case "no_membership":
      if (hideResource) {
        return { status: 404, body: { error: "not_found" } };
      }
      return { status: 403, body: { error: "forbidden" } };
    case "membership_inactive":
      return { status: 403, body: { error: "forbidden" } };
    case "no_permission":
      return { status: 403, body: { error: "forbidden" } };
    case "validation":
      return {
        status: 400,
        body: { error: "validation_failed", message: problem.message },
      };
  }
}
