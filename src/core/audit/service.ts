import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { getRequestMeta } from "@/core/auth/session";

export interface AuditInput {
  userId: string | null;
  companyId: string | null;
  action: string;
  module: string;
  resource: string;
  resourceId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ip?: string;
  userAgent?: string;
}

/** Fire-and-forget safe: audit failures must not roll back business ops. */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const meta = input.ip ? {} : await getRequestMeta();
    await db.insert(auditLogs).values({
      userId: input.userId,
      companyId: input.companyId,
      action: input.action,
      module: input.module,
      resource: input.resource,
      resourceId: input.resourceId ?? null,
      oldValues: input.oldValues ?? null,
      newValues: input.newValues ?? null,
      ip: input.ip ?? meta.ip,
      userAgent: input.userAgent ?? meta.userAgent,
    });
  } catch (e) {
    console.error("[audit] failed to record", e);
  }
}

export interface AuditFilter {
  companyId?: string | null;
  q?: string;
  action?: string;
  module?: string;
  page?: number;
  pageSize?: number;
}

export async function listAuditLogs(filter: AuditFilter) {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const conditions: SQL[] = [];
  if (filter.companyId) conditions.push(eq(auditLogs.companyId, filter.companyId));
  if (filter.action) conditions.push(eq(auditLogs.action, filter.action));
  if (filter.module) conditions.push(eq(auditLogs.module, filter.module));
  if (filter.q) {
    const like = `%${filter.q}%`;
    const cond = or(
      ilike(auditLogs.resource, like),
      ilike(auditLogs.resourceId, like),
      ilike(users.name, like),
    );
    if (cond) conditions.push(cond);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        module: auditLogs.module,
        resource: auditLogs.resource,
        resourceId: auditLogs.resourceId,
        oldValues: auditLogs.oldValues,
        newValues: auditLogs.newValues,
        ip: auditLogs.ip,
        createdAt: auditLogs.createdAt,
        userName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(where),
  ]);

  return { rows, total: Number(total), page, pageSize };
}

export async function listAuditActions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLogs.action })
    .from(auditLogs)
    .orderBy(auditLogs.action);
  return rows.map((r) => r.action);
}
