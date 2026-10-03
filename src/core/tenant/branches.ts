import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { branches, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { assertBranchAccess } from "@/core/acl";
import { recordAudit } from "@/core/audit/service";
import { recordActivity } from "@/core/activity/service";
import type { CurrentUser } from "@/types";

export interface BranchDTO {
  id: string;
  companyId: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  managerId: string | null;
  status: "ACTIVE" | "INACTIVE";
  userCount: number;
}

export async function listBranches(user: CurrentUser): Promise<BranchDTO[]> {
  const rows = await db.query.branches.findMany({
    where: user.companyId ? eq(branches.companyId, user.companyId) : undefined,
    with: {
      users: { columns: { id: true } },
    },
    orderBy: (b, { asc }) => [asc(b.name)],
  });
  return rows
    .filter((b) => assertBranchRead(user, b.id))
    .map((b) => ({
      id: b.id,
      companyId: b.companyId,
      name: b.name,
      code: b.code,
      address: b.address,
      phone: b.phone,
      email: b.email,
      managerId: b.managerId,
      status: b.status,
      userCount: b.users.length,
    }));
}

function assertBranchRead(user: CurrentUser, branchId: string): boolean {
  if (user.isPlatformAdmin || user.allBranches) return true;
  return user.accessibleBranchIds.includes(branchId);
}

export async function createBranch(
  user: CurrentUser,
  input: { name: string; code: string; address?: string; phone?: string; email?: string; status: "ACTIVE" | "INACTIVE" },
): Promise<BranchDTO> {
  if (!user.companyId) throw new AppError("FORBIDDEN", "Tidak ada perusahaan aktif.");
  const [existing] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(eq(branches.companyId, user.companyId), eq(branches.code, input.code)),
    );
  if (existing) {
    throw new AppError("CONFLICT", `Kode cabang "${input.code}" sudah digunakan.`);
  }
  const [branch] = await db
    .insert(branches)
    .values({
      companyId: user.companyId,
      name: input.name,
      code: input.code,
      address: input.address,
      phone: input.phone,
      email: input.email,
      status: input.status,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  await recordAudit({
    userId: user.id,
    companyId: user.companyId,
    action: "CREATE",
    module: "core",
    resource: "branch",
    resourceId: branch.id,
    newValues: { name: branch.name, code: branch.code },
  });
  await recordActivity({
    companyId: user.companyId,
    userId: user.id,
    type: "branch.create",
    message: `Cabang ${branch.name} (${branch.code}) dibuat`,
  });
  return { ...branch, userCount: 0 };
}

export async function updateBranch(
  user: CurrentUser,
  branchId: string,
  input: Partial<{ name: string; code: string; address: string; phone: string; email: string; status: "ACTIVE" | "INACTIVE" }>,
): Promise<BranchDTO> {
  const [before] = await db.select().from(branches).where(eq(branches.id, branchId));
  if (!before) throw new AppError("NOT_FOUND", "Cabang tidak ditemukan.");
  if (before.companyId !== user.companyId && !user.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Cabang milik perusahaan lain.");
  }
  assertBranchAccess(user, branchId);

  if (input.code && input.code !== before.code) {
    const [dup] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(eq(branches.companyId, before.companyId), eq(branches.code, input.code)),
      );
    if (dup) throw new AppError("CONFLICT", `Kode cabang "${input.code}" sudah digunakan.`);
  }

  const [after] = await db
    .update(branches)
    .set({ ...input, updatedBy: user.id })
    .where(eq(branches.id, branchId))
    .returning();

  await recordAudit({
    userId: user.id,
    companyId: before.companyId,
    action: "UPDATE",
    module: "core",
    resource: "branch",
    resourceId: branchId,
    oldValues: { name: before.name, code: before.code, status: before.status },
    newValues: { name: after.name, code: after.code, status: after.status },
  });
  return { ...after, userCount: 0 };
}

export async function deleteBranch(user: CurrentUser, branchId: string): Promise<void> {
  const [before] = await db.select().from(branches).where(eq(branches.id, branchId));
  if (!before) throw new AppError("NOT_FOUND", "Cabang tidak ditemukan.");
  if (before.companyId !== user.companyId && !user.isPlatformAdmin) {
    throw new AppError("FORBIDDEN", "Cabang milik perusahaan lain.");
  }
  const [assigned] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.branchId, branchId))
    .limit(1);
  if (assigned) {
    throw new AppError(
      "CONFLICT",
      "Cabang masih memiliki pengguna. Pindahkan pengguna terlebih dahulu.",
    );
  }
  await db.delete(branches).where(eq(branches.id, branchId));
  await recordAudit({
    userId: user.id,
    companyId: before.companyId,
    action: "DELETE",
    module: "core",
    resource: "branch",
    resourceId: branchId,
    oldValues: { name: before.name, code: before.code },
  });
}
