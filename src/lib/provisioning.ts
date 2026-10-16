import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { shortHash, suggestSlug } from "./slug";

// Template izin tenant — harus sama dengan konten `scripts/seed-rbac.ts`
// (sekali ditulis di sini agar provisioning tidak bergantung script seed di
// luar konteks transaksi provisioning).
const ADMIN_CODES = [
  "package.create",
  "package.read",
  "package.update",
  "jamaah.create",
  "jamaah.read",
  "jamaah.update",
  "reservation.create",
  "reservation.read",
  "reservation.cancel",
  "payment.create",
  "payment.read",
  "staff.read",
  "tenant-role.assign",
  "installation.own.read",
] as const;

const STAFF_CODES = [
  "package.create",
  "package.read",
  "package.update",
  "jamaah.create",
  "jamaah.read",
  "jamaah.update",
  "reservation.create",
  "reservation.read",
  "reservation.cancel",
  "payment.create",
  "payment.read",
] as const;

export type ProvisioningOutcome =
  | { ok: true; tenantId: string; installationId: string; conflict: false }
  | { ok: false; conflict: boolean; reason: string; tenantId?: never; installationId?: never };

/**
 * Provisioning tenant dari hasil signup Better Auth.
 *
 * Prinsip utama:
 * - Semua langkah B1–B8 berada dalam satu transaksi DB.
 * - auth_user TIDAK pernah dihapus; jika provisioning gagal, identitas tetap
 *   ada (pending-auth) dan bisa di-retry.
 * - Setiap ON CONFLICT DO NOTHING wajib re-SELECT + verifikasi kepemilikan &
 *   status; konflik yang tidak sesuai menghasilkan 409, bukan sukses.
 * - Audit log `tenant.created` & `installation.created` dibuat melalui entity
 *   key: jika event sudah ada (mis. retry setelah commit berhasil tapi respons
 *   hilang), log kedua TIDAK ditulis ulang.
 * - Installation yang sudah ada tidak diubah statusnya; bila sudah lebih maju
 *   dari pending, provisioning hanya idempoten, tidak mereset ke pending.
 */
export async function provisionTenantFromSignup(params: {
  userId: string;
  email: string;
  businessName: string;
}): Promise<ProvisioningOutcome> {
  const { userId, email, businessName } = params;

  return await db.transaction(async (tx) => {
    // ---------------------------------------------------------------
    // B0 — pra-kondisi wajib: pastikan user belum punya akun bisnis
    //       dan belum terikat ke tenant lain.
    // ---------------------------------------------------------------
    const authUserRows = await tx
      .select()
      .from(schema.authUsers)
      .where(eq(schema.authUsers.id, userId))
      .limit(1);
    const authUser = authUserRows[0];
    if (!authUser) {
      return { ok: false, conflict: false, reason: "identitas tidak ada" };
    }
    // ---------------------------------------------------------------
    // B0 — pra-kondisi wajib + handling retry idempoten.
    // ---------------------------------------------------------------
    if (!authUser) {
      return { ok: false, conflict: false, reason: "identitas tidak ada" };
    }

    // Retry idempoten: identitas sudah terikat ke akun bisnis.
    // Jika request ulang sesuai, kembalikan status yang sudah ada.
    if (authUser.platformAccountId) {
      const linkedAccountRows = await tx
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, authUser.platformAccountId))
        .limit(1);

      const linkedAccount = linkedAccountRows[0];
      if (!linkedAccount) {
        return {
          ok: false,
          conflict: true,
          reason: "platform_account_id tidak merujuk ke akun yang ada",
        };
      }

      if (linkedAccount.email !== email) {
        return {
          ok: false,
          conflict: true,
          reason: "identitas terikat ke akun bisnis dengan email berbeda",
        };
      }

      // Cari tenant + instalasi yang sudah ada untuk account ini.
      const tenantRows = await tx
        .select()
        .from(schema.tenants)
        .where(eq(schema.tenants.accountId, linkedAccount.id))
        .limit(1);

      const tenantRow = tenantRows[0];
      if (!tenantRow) {
        // Akun sudah ada tapi tenant belum terbentuk: tidak biasa, tapi
        // tetap jangan buat ulang di jalur retry ini.
        return { ok: false, conflict: true, reason: "akun bisnis belum memiliki tenant" };
      }

      const tenantId = tenantRow.id;
      const installationRows = await tx
        .select()
        .from(schema.installations)
        .where(eq(schema.installations.tenantId, tenantId))
        .limit(1);

      const installationRow = installationRows[0];
      if (!installationRow) {
        return { ok: false, conflict: true, reason: "tenant belum memiliki instalasi" };
      }

      return {
        ok: true,
        tenantId,
        installationId: installationRow.id,
        conflict: false,
      };
    }

    const existingAccountRows = await tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.email, email))
      .limit(1);
    if (existingAccountRows.length > 0) {
      return {
        ok: false,
        conflict: true,
        reason: "email bisnis sudah terdaftar di akun lain",
      };
    }

    // ---------------------------------------------------------------
    // B1 — INSERT accounts.
    // ---------------------------------------------------------------
    const accountResult = await tx
      .insert(schema.accounts)
      .values({
        email,
        contactName: email.split("@")[0] ?? "pelanggan",
        status: "pending",
      })
      .onConflictDoNothing()
      .returning({ id: schema.accounts.id, email: schema.accounts.email });

    const accountRow =
      accountResult.length > 0
        ? accountResult[0]
        : (await tx
            .select()
            .from(schema.accounts)
            .where(eq(schema.accounts.email, email))
            .limit(1))[0];

    if (!accountRow) {
      return { ok: false, conflict: true, reason: "gagal membuat akun bisnis" };
    }

    const accountId = accountRow.id;

    // ---------------------------------------------------------------
    // B2 — UPDATE platform_account_id di auth_users.
    // ---------------------------------------------------------------
    const alreadyLinked = authUser.platformAccountId === accountId;
    if (!alreadyLinked) {
      await tx
        .update(schema.authUsers)
        .set({ platformAccountId: accountId })
        .where(eq(schema.authUsers.id, userId));
    }

    const refreshedUserRows = await tx
      .select()
      .from(schema.authUsers)
      .where(eq(schema.authUsers.id, userId))
      .limit(1);
    const refreshedUser = refreshedUserRows[0];

    if (!refreshedUser) {
      return { ok: false, conflict: true, reason: "identitas tidak ditemukan" };
    }
    if (refreshedUser.platformAccountId !== accountId) {
      return {
        ok: false,
        conflict: true,
        reason: "platform_account_id tidak cocok; mungkin tertaut ke akun lain",
      };
    }

    // ---------------------------------------------------------------
    // B3 — INSERT tenants.
    // ---------------------------------------------------------------
    const slugHash = shortHash(`${accountId}-${businessName}-${Date.now()}`);
    const slug = suggestSlug(businessName, slugHash);

    const tenantResult = await tx
      .insert(schema.tenants)
      .values({
        accountId,
        name: businessName,
        slug,
        status: "pending",
      })
      .onConflictDoNothing()
      .returning({ id: schema.tenants.id, slug: schema.tenants.slug });

    let tenantRow =
      tenantResult.length > 0
        ? tenantResult[0]
        : (await tx
            .select()
            .from(schema.tenants)
            .where(eq(schema.tenants.accountId, accountId))
            .limit(1))[0];

    if (!tenantRow) {
      // Kemungkinan bentrok slug; coba suffix lain.
      const fallbackSlug = suggestSlug(businessName, shortHash(`${businessName}-${accountId}`));
      const retry = await tx
        .insert(schema.tenants)
        .values({
          accountId,
          name: businessName,
          slug: fallbackSlug,
          status: "pending",
        })
        .onConflictDoNothing()
        .returning({ id: schema.tenants.id, slug: schema.tenants.slug });

      tenantRow =
        retry.length > 0
          ? retry[0]
          : (await tx
              .select()
              .from(schema.tenants)
              .where(eq(schema.tenants.accountId, accountId))
              .limit(1))[0];
    }

    if (!tenantRow) {
      return { ok: false, conflict: true, reason: "gagal membuat tenant" };
    }

    const tenantId = tenantRow.id;
    const finalSlug = tenantRow.slug;

    // ---------------------------------------------------------------
    // B4 — INSERT tenant_users.
    // ---------------------------------------------------------------
    const userTenantResult = await tx
      .insert(schema.tenantUsers)
      .values({
        userId,
        tenantId,
        status: "active",
      })
      .onConflictDoNothing()
      .returning({ userId: schema.tenantUsers.userId, tenantId: schema.tenantUsers.tenantId });

    const userTenantRow =
      userTenantResult.length > 0
        ? userTenantResult[0]
        : (await tx
            .select()
            .from(schema.tenantUsers)
            .where(eq(schema.tenantUsers.userId, userId))
            .limit(1))[0];

    if (!userTenantRow) {
      return { ok: false, conflict: true, reason: "gagal membuat keanggotaan tenant" };
    }

    // ---------------------------------------------------------------
    // B5 — INSERT roles + role_permissions.
    // ---------------------------------------------------------------
    const rolesToCreate = [
      {
        code: "tenant.admin",
        name: "Admin Tenant",
        isSystem: true,
        permissionCodes: ADMIN_CODES,
      },
      {
        code: "tenant.staff",
        name: "Staf Tenant",
        isSystem: true,
        permissionCodes: STAFF_CODES,
      },
    ] as const;

    const createdRoles: { code: string; id: string }[] = [];

    for (const role of rolesToCreate) {
      const existingRoleRows = await tx
        .select()
        .from(schema.roles)
        .where(
          and(
            eq(schema.roles.scope, "tenant"),
            eq(schema.roles.tenantId, tenantId),
            eq(schema.roles.code, role.code),
          ),
        )
        .limit(1);

      const existingRole = existingRoleRows[0];
      if (existingRole) {
        // Role tenant yang sudah ada milik tenant yang sama — idempoten.
        createdRoles.push({ code: role.code, id: existingRole.id });
        continue;
      }

      const inserted = await tx
        .insert(schema.roles)
        .values({
          scope: "tenant",
          tenantId,
          code: role.code,
          name: role.name,
          isSystem: true,
        })
        .onConflictDoNothing()
        .returning({ id: schema.roles.id });

      const roleRow =
        inserted.length > 0
          ? inserted[0]
          : (await tx
              .select()
              .from(schema.roles)
              .where(
                and(
                  eq(schema.roles.scope, "tenant"),
                  eq(schema.roles.tenantId, tenantId),
                  eq(schema.roles.code, role.code),
                ),
              )
              .limit(1))[0];

      if (!roleRow) {
        return { ok: false, conflict: true, reason: `gagal membuat role ${role.code}` };
      }
      createdRoles.push({ code: role.code, id: roleRow.id });
    }

    // role_permissions
    for (const role of createdRoles) {
      const roleRow = (
        await tx
          .select()
          .from(schema.roles)
          .where(
            and(
              eq(schema.roles.id, role.id),
              eq(schema.roles.scope, "tenant"),
              eq(schema.roles.tenantId, tenantId),
            ),
          )
          .limit(1)
      )[0];

      if (!roleRow) {
        return { ok: false, conflict: true, reason: `role ${role.code} tidak ditemukan setelah insert` };
      }

      const codesForRole = createdRoles.find((r) => r.code === role.code)?.code === "tenant.admin"
        ? ADMIN_CODES
        : STAFF_CODES;

      for (const code of codesForRole) {
        const permRows = await tx
          .select()
          .from(schema.permissions)
          .where(
            and(
              eq(schema.permissions.code, code),
              eq(schema.permissions.scope, "tenant"),
            ),
          )
          .limit(1);
        const perm = permRows[0];

        if (!perm) {
          return { ok: false, conflict: true, reason: `permission ${code} tidak ada di katalog` };
        }

        const existingRpRows = await tx
          .select()
          .from(schema.rolePermissions)
          .where(
            and(
              eq(schema.rolePermissions.roleId, role.id),
              eq(schema.rolePermissions.permissionId, perm.id),
            ),
          )
          .limit(1);

        if (existingRpRows.length === 0) {
          await tx
            .insert(schema.rolePermissions)
            .values({
              roleId: role.id,
              permissionId: perm.id,
              scope: "tenant",
            })
            .onConflictDoNothing();
        }
      }
    }

    // ---------------------------------------------------------------
    // B6 — INSERT tenant_role_assignments (admin pertama).
    // ---------------------------------------------------------------
    const adminRole = createdRoles.find((r) => r.code === "tenant.admin");
    if (!adminRole) {
      return { ok: false, conflict: true, reason: "role admin tidak ditemukan" };
    }

    const assignmentRows = await tx
      .insert(schema.tenantRoleAssignments)
      .values({
        userId,
        roleId: adminRole.id,
        tenantId,
        assignedBy: "system",
      })
      .onConflictDoNothing()
      .returning({ userId: schema.tenantRoleAssignments.userId, roleId: schema.tenantRoleAssignments.roleId });

    if (assignmentRows.length === 0) {
      const existingAssignmentRows = await tx
        .select()
        .from(schema.tenantRoleAssignments)
        .where(
          and(
            eq(schema.tenantRoleAssignments.userId, userId),
            eq(schema.tenantRoleAssignments.roleId, adminRole.id),
          ),
        )
        .limit(1);

      if (existingAssignmentRows.length === 0) {
        return { ok: false, conflict: true, reason: "gagal membuat assignment admin" };
      }
    }

    // ---------------------------------------------------------------
    // B7 — INSERT installations (hanya jika belum ada; jangan ubah status).
    // ---------------------------------------------------------------
    const installationRows = await tx
      .select()
      .from(schema.installations)
      .where(eq(schema.installations.tenantId, tenantId))
      .limit(1);

    let installationId: string;
    if (installationRows.length === 0) {
      const insertedRows = await tx
        .insert(schema.installations)
        .values({
          tenantId,
          name: businessName,
          status: "pending",
        })
        .onConflictDoNothing()
        .returning({ id: schema.installations.id });

      if (insertedRows.length > 0) {
        installationId = insertedRows[0].id;
      } else {
        // Konflik unik tapi kita tidak tahu baris milik siapa; cek ulang.
        const retryRows = await tx
          .select()
          .from(schema.installations)
          .where(eq(schema.installations.tenantId, tenantId))
          .limit(1);

        const retryRow = retryRows[0];
        if (!retryRow) {
          return { ok: false, conflict: true, reason: "gagal membuat instalasi" };
        }
        if (retryRow.tenantId !== tenantId) {
          return { ok: false, conflict: true, reason: "instalasi milik tenant lain" };
        }
        // Milik tenant yang sama — idempoten.
        installationId = retryRow.id;
      }
    } else {
      // Instalasi sudah ada. Jangan ubah status; simpan ID-nya saja.
      const existingInstall = installationRows[0];
      if (existingInstall.tenantId !== tenantId) {
        return { ok: false, conflict: true, reason: "instalasi milik tenant lain" };
      }
      installationId = existingInstall.id;
    }

    // ---------------------------------------------------------------
    // B8 — Audit log: tenant.created & installation.created.
    //       Idempoten berbasis entity key.
    // ---------------------------------------------------------------
    await writeAuditIfMissing(tx, {
      actorType: "system",
      actorId: "system",
      actorLabel: "provisioning",
      tenantId,
      action: "tenant.created",
      entityType: "tenant",
      entityId: tenantId,
      metadata: {
        accountId,
        slug: finalSlug,
        userId,
        email,
      },
    });

    await writeAuditIfMissing(tx, {
      actorType: "system",
      actorId: "system",
      actorLabel: "provisioning",
      tenantId,
      action: "installation.created",
      entityType: "installation",
      entityId: installationId,
      metadata: {
        tenantId,
        name: businessName,
      },
    });      return { ok: true, tenantId, installationId, conflict: false };
  });
}

// Keep the below helper; already defined.

/**
 * Tulis audit log hanya jika event belum ada, berdasarkan entity key.
 * Dipanggil di dalam transaksi provisioning agar atomis.
 */
async function writeAuditIfMissing(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  event: {
    actorType: "system" | "user" | "service";
    actorId: string;
    actorLabel: string;
    tenantId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
) {
  const existingRows = await tx
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityType, event.entityType),
        eq(schema.auditLogs.entityId, event.entityId),
        eq(schema.auditLogs.action, event.action),
      ),
    )
    .limit(1);

  if (existingRows.length > 0) {
    return;
  }

  await tx.insert(schema.auditLogs).values({
    actorType: event.actorType,
    actorId: event.actorId,
    actorLabel: event.actorLabel,
    tenantId: event.tenantId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    metadata: event.metadata,
  });
}
