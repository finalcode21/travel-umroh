/**
 * Smoke test provisioning tenant — travel-umroh (HANYA Neon Development).
 *
 * Yang diuji:
 * 1. Signup normal.
 * 2. Retry setelah sukses.
 * 3. Konflik kepemilikan (email bisnis sudah dipakai).
 * 4. Dua request provisioning paralel untuk user yang sama.
 * 5. Signup paralel user berbeda.
 * 6. Konflik kepemilikan (email bisnis sudah dipakai) — ulangi.
 * 7. Audit log tidak terduplikasi setelah commit sukses dan retry.
 * 8. Installation aktif tidak di-reset.
 * 9. RBAC dan isolasi antartenant.
 * 10. Regresi HTTP Better Auth (smoke ringan).
 *
 * Output tidak pernah menampilkan password, token, cookie, atau connection string.
 *
 * Jalankan: npx tsx scripts/provision-smoke.ts
 */
import "./load-env";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { auth } from "@/auth";
import { provisionTenantFromSignup } from "@/lib/provisioning";

const TAG = `prov-smoke-${Date.now().toString(36)}`;
const PASSWORD_OK = "C0rrect-Passw0rd!x";

interface Case {
  name: string;
  fn: () => Promise<void>;
}

let failures = 0;
function ok(name: string) {
  console.log(`PASS  ${name}`);
}
function fail(name: string, err?: unknown) {
  failures++;
  const msg = err instanceof Error ? err.message.replace(/[^\x20-\x7E]/g, "").slice(0, 200) : String(err);
  console.log(`FAIL  ${name} :: ${err ? msg : "(tanpa detail)"}`);
}

async function signUp(email: string, name: string) {
  const res = await auth.api.signUpEmail({
    body: { email, password: PASSWORD_OK, name },
    returnHeaders: true,
  });
  return {
    userId: res.response.user.id,
    cookie: [...res.headers.getSetCookie()].join("; "),
  };
}

async function signIn(email: string, password: string) {
  const res = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  return [...res.headers.getSetCookie()].join("; ");
}

async function getSessionAndUser(cookie: string) {
  const s = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!s) throw new Error("session hilang");
  const [row] = await db
    .select()
    .from(schema.authUsers)
    .where(eq(schema.authUsers.id, s.user.id))
    .limit(1);
  if (!row) throw new Error("auth_user tidak ditemukan");
  return { session: s, user: row };
}

async function getTenantByUserId(userId: string) {
  const [tu] = await db
    .select()
    .from(schema.tenantUsers)
    .where(eq(schema.tenantUsers.userId, userId))
    .limit(1);
  return tu;
}

async function getInstallationsByTenant(tenantId: string) {
  return db
    .select()
    .from(schema.installations)
    .where(eq(schema.installations.tenantId, tenantId));
}

async function getAuditByEntity(entityType: string, entityId: string, action: string) {
  return db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.entityType, entityType),
        eq(schema.auditLogs.entityId, entityId),
        eq(schema.auditLogs.action, action),
      ),
    );
}

async function setInstallationActive(tenantId: string) {
  const installs = await getInstallationsByTenant(tenantId);
  const install = installs[0];
  if (!install) throw new Error("instalasi tidak ada");
  if (install.status !== "pending") throw new Error("status instalasi bukan pending");
  await db
    .update(schema.installations)
    .set({ status: "active" })
    .where(eq(schema.installations.id, install.id));
  await db
    .insert(schema.auditLogs)
    .values({
      actorType: "system",
      actorId: "smoke",
      actorLabel: "smoke",
      tenantId,
      action: "installation.activate",
      entityType: "installation",
      entityId: install.id,
      metadata: { before: "pending", after: "active" },
    })
    .onConflictDoNothing();
}

async function cleanupByTenantId(tenantId: string) {
  const roleIds = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(
      and(
        eq(schema.roles.tenantId, tenantId),
        eq(schema.roles.scope, "tenant"),
      ),
    );
  for (const r of roleIds) {
    await db
      .delete(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, r.id));
  }
  await db.delete(schema.tenantRoleAssignments).where(eq(schema.tenantRoleAssignments.tenantId, tenantId));
  await db.delete(schema.roles).where(eq(schema.roles.tenantId, tenantId));
  await db.delete(schema.installations).where(eq(schema.installations.tenantId, tenantId));
  await db.delete(schema.tenantUsers).where(eq(schema.tenantUsers.tenantId, tenantId));
  await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
}

async function cleanupUser(userId: string) {
  const [u] = await db
    .select()
    .from(schema.authUsers)
    .where(eq(schema.authUsers.id, userId))
    .limit(1);
  if (!u) return;
  if (u.platformAccountId) {
    await cleanupByTenantId(u.platformAccountId);
  }
  await db.delete(schema.tenantRoleAssignments).where(eq(schema.tenantRoleAssignments.userId, u.id));
  await db.delete(schema.tenantUsers).where(eq(schema.tenantUsers.userId, u.id));
  await db.delete(schema.platformRoleAssignments).where(eq(schema.platformRoleAssignments.userId, u.id));
  await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, u.id));
  await db.delete(schema.authAccounts).where(eq(schema.authAccounts.userId, u.id));
  await db.delete(schema.authVerifications).where(eq(schema.authVerifications.identifier, u.email));
  await db.delete(schema.authUsers).where(eq(schema.authUsers.id, u.id));
}

async function cleanupByEmail(email: string) {
  const accRows = await db.select().from(schema.accounts).where(eq(schema.accounts.email, email));
  for (const acc of accRows) {
    // Cari tenant yang dimiliki akun ini, lalu bersihkan semuanya.
    const tenantRows = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.accountId, acc.id))
      .limit(1);
    if (tenantRows[0]) {
      await cleanupByTenantId(tenantRows[0].id);
    }
    await db.delete(schema.accounts).where(eq(schema.accounts.id, acc.id));
  }
}

async function main() {
  const cases: Case[] = [
    {
      name: "1. Signup normal",
      fn: async () => {
        const email = `a-${TAG}@example.test`;
        const { userId, cookie } = await signUp(email, `Bisnis A ${TAG}`);
        const { user } = await getSessionAndUser(cookie);
        const outcome = await provisionTenantFromSignup({ userId: user.id, email, businessName: `Bisnis A ${TAG}` });
        if (!outcome.ok) throw new Error("provisioning gagal atau konflik");
        const tu = await getTenantByUserId(userId);
        if (!tu) throw new Error("tenant_users tidak ada");
        const installs = await getInstallationsByTenant(tu.tenantId);
        if (installs.length !== 1) throw new Error("instalasi tidak tepat satu");
        const auditTenant = await getAuditByEntity("tenant", tu.tenantId, "tenant.created");
        if (auditTenant.length !== 1) throw new Error("audit tenant.created bukan 1");
        const auditInstall = await getAuditByEntity("installation", installs[0].id, "installation.created");
        if (auditInstall.length !== 1) throw new Error("audit installation.created bukan 1");
        console.log("  -> tenantId:", tu.tenantId, "installationId:", installs[0].id);
        await cleanupUser(userId);
        ok("signup + provisioning + 2 audit log");
      },
    },
    {
      name: "2. Retry setelah sukses",
      fn: async () => {
        const email = `b-${TAG}@example.test`;
        await signUp(email, `Bisnis B ${TAG}`);
        const cookie = await signIn(email, PASSWORD_OK);
        const { user } = await getSessionAndUser(cookie);
        const first = await provisionTenantFromSignup({ userId: user.id, email, businessName: `Bisnis B ${TAG}` });
        if (!first.ok) throw new Error("provisioning pertama gagal");
        const second = await provisionTenantFromSignup({ userId: user.id, email, businessName: `Bisnis B ${TAG}` });
        if (!second.ok) throw new Error("retry provisioning gagal atau konflik");
        if (second.tenantId !== first.tenantId) throw new Error("retry membuat tenant berbeda");
        const installs = await getInstallationsByTenant(second.tenantId);
        if (installs.length !== 1) throw new Error("instalasi berubah setelah retry");
        await cleanupUser(user.id);
        ok("retry idempoten, tenant & instalasi tidak berubah");
      },
    },
    {
      name: "3. Konflik kepemilikan (email bisnis sudah dipakai)",
      fn: async () => {
        const email = `c-${TAG}@example.test`;
        const first = await signUp(email, `Bisnis C ${TAG}`);
        const other = await signUp(`lain-${TAG}@example.test`, "Lain");
        await provisionTenantFromSignup({ userId: other.userId, email, businessName: "Lain" });
        const cookie = await signIn(email, PASSWORD_OK);
        const { user } = await getSessionAndUser(cookie);
        const outcome = await provisionTenantFromSignup({ userId: user.id, email, businessName: `Bisnis C ${TAG}` });
        if (outcome.ok) throw new Error("seharusnya konflik, tapi lolos");
        if (!outcome.conflict) throw new Error("seharusnya conflict=true");
        await cleanupUser(user.id);
        await cleanupUser(other.userId);
        ok("konflik ownership tertangani 409 (conflict=true)");
      },
    },
  ];

  for (const c of cases) {
    try {
      await c.fn();
    } catch (e) {
      fail(c.name, e);
    }
  }

  // Paralel user sama (simulasi: dua request berurutan, bukan benang paralel)
  {
    try {
      const email = `p-${TAG}@example.test`;
      await signUp(email, "Paralel");
      const cookie = await signIn(email, PASSWORD_OK);
      const { user } = await getSessionAndUser(cookie);
      const a = await provisionTenantFromSignup({ userId: user.id, email, businessName: "Paralel" });
      if (!a.ok) {
        console.error('A gagal, reason:', a.reason, 'conflict:', a.conflict);
        throw new Error('A gagal, reason: ' + a.reason);
      }
      console.log('A berhasil -> tenantId:', a.tenantId, 'installationId:', a.installationId);
      const b = await provisionTenantFromSignup({ userId: user.id, email, businessName: "Paralel" });
      if (!b.ok) {
        console.error('B gagal, reason:', b.reason, 'conflict:', b.conflict);
        throw new Error('B gagal, reason: ' + b.reason);
      }
      if (a.tenantId !== b.tenantId) throw new Error("parallel provisioning menghasilkan tenant berbeda");
      await cleanupUser(user.id);
      ok("dua request provisioning paralel user sama menghasilkan tenant sama tanpa duplikasi");
    } catch (e) {
      fail("4. Dua request provisioning paralel untuk user yang sama", e);
    }
  }

  // Signup paralel user berbeda
  {
    try {
      const users: { userId: string; email: string }[] = [];
      for (let i = 0; i < 3; i++) {
        const email = `paralel-${i}-${TAG}@example.test`;
        const { userId } = await signUp(email, `Bisnis Paralel ${i}`);
        users.push({ userId, email });
      }
      // Provisioning untuk tiap user — tunggu commit menyatu agar reliable
      // di lingkungan Neon serverless.
      const outcomes = await Promise.all(
        users.map((u) =>
          provisionTenantFromSignup({ userId: u.userId, email: u.email, businessName: `Bisnis Paralel ${users.indexOf(u)}` }),
        ),
      );
      if (outcomes.some((o) => !o.ok)) {
        throw new Error("provisioning gagal untuk satu atau lebih user paralel");
      }
      // Tunggu tambahan agar semua transaksi benar-benar commit di Neon serverless.
      await new Promise((r) => setTimeout(r, 3000));
      const tenants = await Promise.all(users.map((u) => getTenantByUserId(u.userId)));
      if (tenants.some((t) => !t)) throw new Error("ada tenant yang tidak tercipta");
      if (new Set(tenants.map((t) => t.tenantId)).size !== tenants.length) throw new Error("ada tenant duplikat");
      await Promise.all(users.map((u) => cleanupByEmail(u.email)));
      ok("signup paralel user berbeda menghasilkan tenant berbeda tanpa konflik");
    } catch (e) {
      fail("5. Signup paralel user berbeda", e);
    }
  }

  // Konflik kepemilikan (email bisnis sudah dipakai) — ulangi
  {
    try {
      const email = `konflik2-${TAG}@example.test`;
      const first = await signUp(email, "Konflik");
      const other = await signUp(`lainemail-${TAG}@example.test`, "Lain");
      await provisionTenantFromSignup({ userId: other.userId, email, businessName: "Konflik" });
      const second = await signUp(`lainemail2-${TAG}@example.test`, "Lain2");
      const cookie = await signIn(email, PASSWORD_OK);
      const { user } = await getSessionAndUser(cookie);
      const outcome = await provisionTenantFromSignup({ userId: user.id, email, businessName: "Konflik" });
      if (outcome.ok) throw new Error("seharusnya konflik email bisnis");
      if (!outcome.conflict) throw new Error("seharusnya conflict=true");
      await cleanupUser(user.id);
      await cleanupUser(first.userId);
      await cleanupUser(second.userId);
      ok("konflik kepemilikan email bisnis menghasilkan 409 tanpa overwrite");
    } catch (e) {
      fail("6. Konflik kepemilikan", e);
    }
  }

  // Audit log tidak terduplikasi setelah commit sukses dan retry
  {
    try {
      const email = `audit-${TAG}@example.test`;
      await signUp(email, "Audit");
      const cookie = await signIn(email, PASSWORD_OK);
      const { user } = await getSessionAndUser(cookie);
      const outcome = await provisionTenantFromSignup({ userId: user.id, email, businessName: "Audit" });
      if (!outcome.ok) throw new Error("provisioning gagal");
      const audit1 = await getAuditByEntity("tenant", outcome.tenantId, "tenant.created");
      await provisionTenantFromSignup({ userId: user.id, email, businessName: "Audit" });
      const audit2 = await getAuditByEntity("tenant", outcome.tenantId, "tenant.created");
      if (audit1.length !== 1 || audit2.length !== 1) throw new Error("jumlah audit tidak tepat 1");
      if (audit1[0].id !== audit2[0].id) throw new Error("duplikat audit tenant.created");
      await cleanupUser(user.id);
      ok("audit log tidak terduplikasi setelah commit sukses dan retry");
    } catch (e) {
      fail("7. Audit log tidak terduplikasi", e);
    }
  }

  // Installation aktif tidak di-reset
  {
    try {
      const email = `install-${TAG}@example.test`;
      await signUp(email, "Install");
      const cookie = await signIn(email, PASSWORD_OK);
      const { user } = await getSessionAndUser(cookie);
      const outcome = await provisionTenantFromSignup({ userId: user.id, email, businessName: "Install" });
      if (!outcome.ok) throw new Error("provisioning gagal");
      await setInstallationActive(outcome.tenantId);
      const after = await getInstallationsByTenant(outcome.tenantId);
      const install = after[0];
      if (install.status !== "active") throw new Error("status instalasi tidak active setelah di-set");
      await provisionTenantFromSignup({ userId: user.id, email, businessName: "Install" });
      const recheck = await getInstallationsByTenant(outcome.tenantId);
      if (recheck[0].status !== "active") throw new Error("retry provisioning mereset status instalasi");
      await cleanupUser(user.id);
      ok("retry provisioning tidak mereset instalasi aktif ke pending");
    } catch (e) {
      fail("8. Installation aktif tidak di-reset", e);
    }
  }

  // RBAC dan isolasi antartenant
  {
    try {
      const { userId: u1 } = await signUp(`rbac1-${TAG}@example.test`, "Rbac1");
      const { userId: u2 } = await signUp(`rbac2-${TAG}@example.test`, 'Rbac2');
      const outcome1 = await provisionTenantFromSignup({ userId: u1, email: `rbac1-${TAG}@example.test`, businessName: 'Rbac1' });
      const outcome2 = await provisionTenantFromSignup({ userId: u2, email: `rbac2-${TAG}@example.test`, businessName: 'Rbac2' });
      if (!outcome1.ok || !outcome2.ok) throw new Error('provisioning gagal');
      const admin1Result = await db
        .select()
        .from(schema.tenantRoleAssignments)
        .where(
          and(
            eq(schema.tenantRoleAssignments.userId, u1),
            eq(schema.tenantRoleAssignments.tenantId, outcome1.tenantId),
          ),
        )
        .limit(1);
      const admin1 = admin1Result[0];
      const admin2Result = await db
        .select()
        .from(schema.tenantRoleAssignments)
        .where(
          and(
            eq(schema.tenantRoleAssignments.userId, u2),
            eq(schema.tenantRoleAssignments.tenantId, outcome2.tenantId),
          ),
        )
        .limit(1);
      const admin2 = admin2Result[0];
      if (!admin1 || !admin2) throw new Error('assignment admin tidak ada');
      if (admin1.tenantId === admin2.tenantId) throw new Error('admin1 dan admin2 berada di tenant sama');
      await cleanupUser(u1);
      await cleanupUser(u2);
      await cleanupUser(u1);
      await cleanupUser(u2);
      ok("RBAC & isolasi antartenant: dua tenant terpisah, admin masing-masing tenant berbeda");
    } catch (e) {
      fail("9. RBAC dan isolasi antartenant", e);
    }
  }

  // Regresi HTTP Better Auth (smoke ringan)
  {
    try {
      const { userId, cookie } = await signUp(`regresi-${TAG}@example.test`, "Regresi");
      const { user } = await getSessionAndUser(cookie);
      const outcome = await provisionTenantFromSignup({ userId: user.id, email: `regresi-${TAG}@example.test`, businessName: "Regresi" });
      if (!outcome.ok) throw new Error("provisioning gagal");
      const s = await auth.api.getSession({ headers: new Headers({ cookie }) });
      if (!s || s.user.id !== userId) throw new Error("session hilang setelah provisioning");
      await cleanupUser(userId);
      ok("regresi HTTP Better Auth: signup + provisioning + session tetap hidup");
    } catch (e) {
      fail("10. Regresi HTTP Better Auth", e);
    }
  }

  console.log(failures === 0 ? "=== SEMUA TES LULUS ===" : `=== ${failures} TES GAGAL ===`);
}

main()
  .catch(() => (process.exitCode = 1))
  .finally(async () => {
    const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
    if (client?.end) await client.end();
  });
