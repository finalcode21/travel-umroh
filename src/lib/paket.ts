import { and, asc, eq, ilike, or, sql, SQL } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { hasPermission, type AuthProblem } from "@/lib/authz";

// ============================================================================
// Validasi Zod
// ============================================================================

export const PAKET_STATUS_VALUES = ["draft", "published", "closed", "archived"] as const;
export const DEPARTURE_STATUS_VALUES = ["open", "closed"] as const;

const priceSchema = z
  .number()
  .int("priceIdr harus bilangan bulat (rupiah utuh)")
  .min(0, "priceIdr tidak boleh negatif")
  .max(2_000_000_000, "priceIdr melebihi batas integer");

const capacitySchema = z
  .number()
  .int("capacity harus bilangan bulat")
  .min(0, "capacity tidak boleh negatif")
  .max(10_000, "capacity terlalu besar");

export const paketCreateSchema = z.object({
  code: z.string().trim().min(1, "code wajib diisi").max(32, "code maksimal 32 karakter"),
  name: z.string().trim().min(1, "name wajib diisi").max(120, "name maksimal 120 karakter"),
  description: z.string().trim().max(2000).optional(),
  priceIdr: priceSchema.default(0),
  capacity: capacitySchema.default(0),
  status: z.enum(PAKET_STATUS_VALUES).default("draft"),
});

export const paketPatchSchema = z
  .object({
    name: z.string().trim().min(1, "name tidak boleh kosong").max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    priceIdr: priceSchema.optional(),
    capacity: capacitySchema.optional(),
    status: z.enum(PAKET_STATUS_VALUES).optional(),
  });

export const departureCreateSchema = z.object({
  code: z.string().trim().min(1, "code wajib diisi").max(32, "code maksimal 32 karakter"),
  departOn: z.string().min(1, "departOn wajib diisi"),
  returnOn: z.string().min(1).optional().nullable(),
  capacity: capacitySchema.default(0),
  status: z.enum(DEPARTURE_STATUS_VALUES).default("open"),
  notes: z.string().trim().max(1000).optional(),
});

export const departurePatchSchema = z.object({
  departOn: z.string().min(1).optional(),
  returnOn: z.string().min(1).optional().nullable(),
  capacity: capacitySchema.optional(),
  status: z.enum(DEPARTURE_STATUS_VALUES).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * Mengubah error Zod menjadi satu pesan ringkas untuk problem "validation".
 */
function zodProblem(error: z.ZodError): AuthProblem {
  return {
    kind: "validation",
    message: error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; "),
  };
}

// ============================================================================
// Tipe hasil
// ============================================================================

export interface PaketRow {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  priceIdr: number;
  capacity: number;
  status: string;
  createdAt: Date;
}

export interface DepartureRow {
  id: string;
  tenantId: string;
  packageId: string;
  code: string;
  departOn: Date;
  returnOn: Date | null;
  capacity: number;
  status: string;
  notes: string | null;
  createdAt: Date;
}

export interface PaketDetail extends PaketRow {
  description: string | null;
  updatedAt: Date;
  departures: DepartureRow[];
}

// ============================================================================
// Otorisasi
// ============================================================================

async function requirePackagePermissions(
  userId: string,
  codes: readonly string[],
  tenantId: string,
): Promise<{ ok: true } | { ok: false; problem: AuthProblem }> {
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

// ============================================================================
// List dengan cursor pagination (F-04 pattern — diterapkan untuk paket)
// ============================================================================


/**
 * Cursor memakai string waktu presisi mikrodetik dari DB (to_char … US)
 * karena `Date.toISOString()` hanya menjaga milidetik — pakai ms menyebabkan
 * baris kursor muncul lagi di halaman berikutnya (overlap).
 */
const CURSOR_TS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeCursor(row: { createdAt: string; id: string }): string {
  return Buffer.from(`${row.createdAt}|${row.id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!createdAt || !id || !CURSOR_TS_PATTERN.test(createdAt)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}


export async function getPaketList(
  userId: string,
  tenantId: string,
  opts: {
    search?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  } = {},
): Promise<
  | { ok: true; rows: PaketRow[]; nextCursor?: string }
  | { ok: false; problem: AuthProblem }
> {
  const auth = await requirePackagePermissions(userId, ["package.read"], tenantId);
  if (!auth.ok) return auth;

  const conditions: SQL[] = [eq(schema.packages.tenantId, tenantId)];

  const term = opts.search?.trim();
  if (term) {
    const like = `%${term}%`;
    const searchCondition = or(
      ilike(schema.packages.name, like),
      ilike(schema.packages.code, like),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  if (opts.status && opts.status.trim()) {
    conditions.push(eq(schema.packages.status, opts.status.trim()));
  }

  if (opts.cursor) {
    const decoded = decodeCursor(opts.cursor);
    if (!decoded) {
      return {
        ok: false,
        problem: { kind: "validation", message: "cursor tidak valid" },
      };
    }
    conditions.push(
      sql`(${schema.packages.createdAt}, ${schema.packages.id}) > (${decoded.createdAt}::timestamptz, ${decoded.id}::uuid)`,
    );
  }

  const where = conditions.length > 1 ? and(...conditions) : conditions[0]!;

  const limit = opts.limit && opts.limit > 0 ? Math.min(100, opts.limit) : undefined;

  const query = db
    .select({
      id: schema.packages.id,
      tenantId: schema.packages.tenantId,
      code: schema.packages.code,
      name: schema.packages.name,
      priceIdr: schema.packages.priceIdr,
      capacity: schema.packages.capacity,
      status: schema.packages.status,
      createdAt: schema.packages.createdAt,
      // presisi mikrodetik dari DB — untuk kursor (lihat encodeCursor).
      createdAtMicro: sql<string>`to_char(${schema.packages.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(schema.packages)
    .where(where)
    .orderBy(asc(schema.packages.createdAt), asc(schema.packages.id));

  let queryRows: (PaketRow & { createdAtMicro: string })[];
  if (limit) {
    queryRows = await query.limit(limit + 1);
  } else {
    queryRows = await query;
  }

  const rows: PaketRow[] = queryRows.map(({ createdAtMicro: _m, ...r }) => r);

  if (limit && queryRows.length > limit) {
    const last = queryRows[limit - 1]!;
    const pageRows = queryRows.slice(0, limit).map(({ createdAtMicro: _m, ...r }) => r);
    return { ok: true, rows: pageRows, nextCursor: encodeCursor({ createdAt: last.createdAtMicro, id: last.id }) };
  }

  return { ok: true, rows };
}

// ============================================================================
// Create
// ============================================================================

export async function createPaket(
  userId: string,
  tenantId: string,
  input: unknown,
): Promise<
  | { ok: true; row: PaketDetail }
  | { ok: false; problem: AuthProblem; conflict?: boolean }
> {
  const auth = await requirePackagePermissions(userId, ["package.create"], tenantId);
  if (!auth.ok) return auth;

  const parsed = paketCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, problem: zodProblem(parsed.error) };
  }

  const data = parsed.data;
  const code = data.code;
  const existing = await db
    .select({ id: schema.packages.id })
    .from(schema.packages)
    .where(and(eq(schema.packages.tenantId, tenantId), eq(schema.packages.code, code)))
    .limit(1);

  if (existing[0]) {
    return {
      ok: false,
      problem: { kind: "no_permission", message: "code paket sudah digunakan di tenant ini" },
      conflict: true,
    };
  }

  try {
    const [row] = await db
      .insert(schema.packages)
      .values({
        tenantId,
        code,
        name: data.name,
        description: data.description ?? null,
        priceIdr: data.priceIdr,
        capacity: data.capacity,
        status: data.status,
      })
      .returning();

    return {
      ok: true,
      row: {
        id: row.id,
        tenantId: row.tenantId,
        code: row.code,
        name: row.name,
        description: row.description,
        priceIdr: row.priceIdr,
        capacity: row.capacity,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        departures: [],
      },
    };
  } catch (e) {
    const error = e as { code?: string; cause?: { code?: string } };
    const pgCode = error.code ?? error.cause?.code;
    if (pgCode === "23505") {
      // umunique (tenant_id, code) — balapan dengan writer lain.
      return {
        ok: false,
        problem: { kind: "no_permission", message: "code paket sudah digunakan di tenant ini" },
        conflict: true,
      };
    }
    throw e;
  }
}

// ============================================================================
// Detail + edit
// ============================================================================

export async function getPaketById(
  userId: string,
  tenantId: string,
  id: string,
): Promise<
  | { ok: true; row: PaketDetail }
  | { ok: false; problem: AuthProblem }
> {
  const auth = await requirePackagePermissions(userId, ["package.read"], tenantId);
  if (!auth.ok) return auth;

  const [row] = await db
    .select()
    .from(schema.packages)
    .where(and(eq(schema.packages.id, id), eq(schema.packages.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return {
      ok: false,
      problem: { kind: "no_membership", message: "Paket tidak ditemukan" },
    };
  }

  const depRows = await db
    .select()
    .from(schema.departures)
    .where(eq(schema.departures.packageId, row.id))
    .orderBy(asc(schema.departures.departOn));

  return {
    ok: true,
    row: {
      id: row.id,
      tenantId: row.tenantId,
      code: row.code,
      name: row.name,
      description: row.description,
      priceIdr: row.priceIdr,
      capacity: row.capacity,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      departures: depRows.map((d) => ({
        id: d.id,
        tenantId: d.tenantId,
        packageId: d.packageId,
        code: d.code,
        departOn: d.departOn,
        returnOn: d.returnOn,
        capacity: d.capacity,
        status: d.status,
        notes: d.notes,
        createdAt: d.createdAt,
      })),
    },
  };
}

function detailFromRow(
  row: typeof schema.packages.$inferSelect,
  departures: DepartureRow[],
): PaketDetail {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    name: row.name,
    description: row.description,
    priceIdr: row.priceIdr,
    capacity: row.capacity,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    departures,
  };
}

export async function patchPaket(
  userId: string,
  tenantId: string,
  id: string,
  input: unknown,
): Promise<
  | { ok: true; row: PaketDetail }
  | { ok: false; problem: AuthProblem }
> {
  const auth = await requirePackagePermissions(userId, ["package.update"], tenantId);
  if (!auth.ok) return auth;

  const parsed = paketPatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, problem: zodProblem(parsed.error) };
  }

  const [existing] = await db
    .select()
    .from(schema.packages)
    .where(and(eq(schema.packages.id, id), eq(schema.packages.tenantId, tenantId)))
    .limit(1);

  if (!existing) {
    return {
      ok: false,
      problem: { kind: "no_membership", message: "Paket tidak ditemukan" },
    };
  }

  const data = parsed.data;
  const [row] = await db
    .update(schema.packages)
    .set({
      name: data.name !== undefined ? data.name : existing.name,
      description:
        data.description !== undefined && data.description.length === 0
          ? null
          : data.description !== undefined
            ? data.description
            : existing.description,
      priceIdr: data.priceIdr !== undefined ? data.priceIdr : existing.priceIdr,
      capacity: data.capacity !== undefined ? data.capacity : existing.capacity,
      status: data.status !== undefined ? data.status : existing.status,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.packages.id, id), eq(schema.packages.tenantId, tenantId)))
    .returning();

  const depRows = await db
    .select()
    .from(schema.departures)
    .where(eq(schema.departures.packageId, row.id))
    .orderBy(asc(schema.departures.departOn));

  return {
    ok: true,
    row: detailFromRow(
      row,
      depRows.map((d) => ({
        id: d.id,
        tenantId: d.tenantId,
        packageId: d.packageId,
        code: d.code,
        departOn: d.departOn,
        returnOn: d.returnOn,
        capacity: d.capacity,
        status: d.status,
        notes: d.notes,
        createdAt: d.createdAt,
      })),
    ),
  };
}

// ============================================================================
// Keberangkatan (departures)
// ============================================================================

function dateOrNull(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function departureFromRow(d: typeof schema.departures.$inferSelect): DepartureRow {
  return {
    id: d.id,
    tenantId: d.tenantId,
    packageId: d.packageId,
    code: d.code,
    departOn: d.departOn,
    returnOn: d.returnOn,
    capacity: d.capacity,
    status: d.status,
    notes: d.notes,
    createdAt: d.createdAt,
  };
}

export async function createDeparture(
  userId: string,
  tenantId: string,
  packageId: string,
  input: unknown,
): Promise<
  | { ok: true; row: DepartureRow }
  | { ok: false; problem: AuthProblem; conflict?: boolean }
> {
  const auth = await requirePackagePermissions(userId, ["package.update"], tenantId);
  if (!auth.ok) return auth;

  const parsed = departureCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, problem: zodProblem(parsed.error) };
  }

  const [paket] = await db
    .select({ id: schema.packages.id })
    .from(schema.packages)
    .where(and(eq(schema.packages.id, packageId), eq(schema.packages.tenantId, tenantId)))
    .limit(1);

  if (!paket) {
    return {
      ok: false,
      problem: { kind: "no_membership", message: "Paket tidak ditemukan" },
    };
  }

  const departOn = dateOrNull(parsed.data.departOn);
  if (!departOn) {
    return {
      ok: false,
      problem: { kind: "validation", message: "departOn: format tanggal tidak valid" },
    };
  }
  const returnOn = dateOrNull(parsed.data.returnOn ?? null);
  if (returnOn && returnOn <= departOn) {
    return {
      ok: false,
      problem: { kind: "validation", message: "returnOn harus setelah departOn" },
    };
  }

  try {
    const [row] = await db
      .insert(schema.departures)
      .values({
        tenantId,
        packageId: paket.id,
        code: parsed.data.code,
        departOn,
        returnOn,
        capacity: parsed.data.capacity,
        status: parsed.data.status,
        notes: parsed.data.notes ?? null,
      })
      .returning();

    return { ok: true, row: departureFromRow(row) };
  } catch (e) {
    const error = e as { code?: string; constraint?: string; cause?: { code?: string } };
    const pgCode = error.code ?? error.cause?.code;
    if (pgCode === "23505") {
      return {
        ok: false,
        problem: { kind: "no_permission", message: "code keberangkatan sudah ada di paket ini" },
        conflict: true,
      };
    }
    if (pgCode === "23514") {
      // check constraint: return_on > depart_on
      return {
        ok: false,
        problem: { kind: "validation", message: "returnOn harus setelah departOn" },
      };
    }
    throw e;
  }
}

export async function patchDeparture(
  userId: string,
  tenantId: string,
  packageId: string,
  departureId: string,
  input: unknown,
): Promise<
  | { ok: true; row: DepartureRow }
  | { ok: false; problem: AuthProblem }
> {
  const auth = await requirePackagePermissions(userId, ["package.update"], tenantId);
  if (!auth.ok) return auth;

  const parsed = departurePatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, problem: zodProblem(parsed.error) };
  }

  const [existing] = await db
    .select()
    .from(schema.departures)
    .where(
      and(
        eq(schema.departures.id, departureId),
        eq(schema.departures.packageId, packageId),
        eq(schema.departures.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!existing) {
    return {
      ok: false,
      problem: { kind: "no_membership", message: "Keberangkatan tidak ditemukan" },
    };
  }

  const data = parsed.data;
  const departOn =
    data.departOn !== undefined ? dateOrNull(data.departOn) : existing.departOn;
  const returnOn =
    data.returnOn !== undefined ? dateOrNull(data.returnOn ?? null) : existing.returnOn;

  if (!departOn) {
    return {
      ok: false,
      problem: { kind: "validation", message: "departOn: format tanggal tidak valid" },
    };
  }
  if (returnOn && returnOn <= departOn) {
    return {
      ok: false,
      problem: { kind: "validation", message: "returnOn harus setelah departOn" },
    };
  }

  const [row] = await db
    .update(schema.departures)
    .set({
      departOn,
      returnOn,
      capacity: data.capacity !== undefined ? data.capacity : existing.capacity,
      status: data.status !== undefined ? data.status : existing.status,
      notes:
        data.notes !== undefined && data.notes.length === 0
          ? null
          : data.notes !== undefined
            ? data.notes
            : existing.notes,
      updatedAt: new Date(),
    })
    .where(eq(schema.departures.id, departureId))
    .returning();

  return { ok: true, row: departureFromRow(row) };
}
