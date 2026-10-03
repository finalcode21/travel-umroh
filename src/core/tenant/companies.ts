import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { branches, companies, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/core/audit/service";
import { recordActivity } from "@/core/activity/service";
import { createDefaultRolesForCompany } from "@/core/auth/provision";
import { moduleManifests } from "@/modules/registry";

export interface CompanyDTO {
  id: string;
  name: string;
  legalName: string | null;
  slug: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
  taxInfo: string | null;
  currency: string;
  timezone: string;
  locale: string;
  status: "ACTIVE" | "SUSPENDED";
}

export function toCompanyDTO(c: typeof companies.$inferSelect): CompanyDTO {
  return {
    id: c.id,
    name: c.name,
    legalName: c.legalName,
    slug: c.slug,
    address: c.address,
    phone: c.phone,
    email: c.email,
    website: c.website,
    logoUrl: c.logoUrl,
    taxInfo: c.taxInfo,
    currency: c.currency,
    timezone: c.timezone,
    locale: c.locale,
    status: c.status,
  };
}

export async function getCompany(id: string): Promise<CompanyDTO | null> {
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  return company ? toCompanyDTO(company) : null;
}

export async function updateCompany(
  actorId: string,
  companyId: string,
  input: Partial<Omit<CompanyDTO, "id" | "slug">>,
): Promise<CompanyDTO> {
  const [before] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!before) throw new AppError("NOT_FOUND", "Perusahaan tidak ditemukan.");
  const [after] = await db
    .update(companies)
    .set({ ...input, updatedBy: actorId })
    .where(eq(companies.id, companyId))
    .returning();
  await recordAudit({
    userId: actorId,
    companyId,
    action: "UPDATE",
    module: "core",
    resource: "company",
    resourceId: companyId,
    oldValues: { name: before.name, currency: before.currency, timezone: before.timezone },
    newValues: { name: after.name, currency: after.currency, timezone: after.timezone },
  });
  return toCompanyDTO(after);
}

/* --------------------- Platform-level management --------------------- */

export interface PlatformCompanyRow extends CompanyDTO {
  userCount: number;
  branchCount: number;
  activeModules: number;
  createdAt: string;
}

export async function listPlatformCompanies(q?: string): Promise<PlatformCompanyRow[]> {
  const conditions: SQL[] = [];
  if (q) {
    const like = `%${q}%`;
    const cond = or(ilike(companies.name, like), ilike(companies.slug, like));
    if (cond) conditions.push(cond);
  }

  const rows = await db
    .select({
      company: companies,
      userCount: count(users.id),
    })
    .from(companies)
    .leftJoin(users, eq(users.companyId, companies.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(companies.id)
    .orderBy(desc(companies.createdAt));

  const branchCounts = await db
    .select({ companyId: branches.companyId, total: count() })
    .from(branches)
    .groupBy(branches.companyId);
  const branchMap = new Map(branchCounts.map((b) => [b.companyId, Number(b.total)]));

  return rows.map(({ company, userCount }) => ({
    ...toCompanyDTO(company),
    userCount: Number(userCount),
    branchCount: branchMap.get(company.id) ?? 0,
    activeModules: 0, // filled by caller if needed
    createdAt: company.createdAt.toISOString(),
  }));
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || `company-${Date.now().toString(36)}`
  );
}

/** Platform admin creates a company with default branch + roles. */
export async function createPlatformCompany(
  actorId: string,
  input: {
    name: string;
    legalName?: string;
    address?: string;
    phone?: string;
    email?: string;
    currency: string;
    timezone: string;
    status: "ACTIVE" | "SUSPENDED";
  },
): Promise<CompanyDTO> {
  let slug = slugify(input.name);
  const [taken] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.slug, slug));
  if (taken) slug = `${slug}-${Date.now().toString(36)}`;

  const [company] = await db
    .insert(companies)
    .values({
      name: input.name,
      legalName: input.legalName,
      slug,
      address: input.address,
      phone: input.phone,
      email: input.email,
      currency: input.currency,
      timezone: input.timezone,
      status: input.status,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();

  await db.insert(branches).values({
    companyId: company.id,
    name: "Kantor Pusat",
    code: "HQ",
    createdBy: actorId,
  });
  await createDefaultRolesForCompany(company.id, actorId);

  await recordAudit({
    userId: actorId,
    companyId: null,
    action: "CREATE",
    module: "core",
    resource: "company",
    resourceId: company.id,
    newValues: { name: company.name, slug: company.slug },
  });
  await recordActivity({
    companyId: company.id,
    userId: actorId,
    type: "company.created",
    message: `Perusahaan ${company.name} dibuat oleh platform admin`,
  });
  return toCompanyDTO(company);
}

export async function setPlatformCompanyStatus(
  actorId: string,
  companyId: string,
  status: "ACTIVE" | "SUSPENDED",
): Promise<CompanyDTO> {
  const [before] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!before) throw new AppError("NOT_FOUND", "Perusahaan tidak ditemukan.");
  const [after] = await db
    .update(companies)
    .set({ status, updatedBy: actorId })
    .where(eq(companies.id, companyId))
    .returning();
  await recordAudit({
    userId: actorId,
    companyId: null,
    action: "UPDATE",
    module: "core",
    resource: "company",
    resourceId: companyId,
    oldValues: { status: before.status },
    newValues: { status: after.status },
  });
  return toCompanyDTO(after);
}

/** Module registry summary shown on the dashboard. */
export function getModuleManifestSummaries() {
  return moduleManifests.map((m) => ({
    code: m.code,
    name: m.name,
    version: m.version,
  }));
}
