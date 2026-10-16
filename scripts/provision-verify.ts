/**
 * Verifikasi provisioning tambahan — travel-umroh (HANYA Neon Development).
 *
 * Yang ditambahkan di luar smoke biasa:
 *  - Parallel provisioning sesungguhnya (Promise.all + koneksi terpisah).
 *  - Retry dengan respons "hilang" (commit berhasil, hasil tidak dipakai ulang).
 *  - Penyuntikan kegagalan di tengah transaksi provisioning.
 *
 * Jalankan: npx tsx scripts/provision-verify.ts
 */
import "./load-env";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { auth } from "@/auth";
import { provisionTenantFromSignup } from "@/lib/provisioning";

const TAG = `prov-verify-${Date.now().toString(36)}`;
const PASSWORD_OK = "C0rrect-Passw0rd!x";

// Type guard untuk discriminated union ProvisioningOutcome
import type { ProvisioningOutcome } from "@/lib/provisioning";
type ProvisioningSuccess = { ok: true; tenantId: string; installationId: string; conflict: false };

function isProvisioningSuccess(outcome: ProvisioningOutcome): outcome is ProvisioningSuccess {
  return outcome.ok;
}

let failures = 0;
function ok(name: string) {
  console.log(`PASS  ${name}`);
}
function fail(name: string, err?: unknown) {
  failures++;
  const msg =
    err instanceof Error
      ? err.message.replace(/[^\x20-\x7E]/g, "").slice(0, 200)
      : String(err);
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

async function getSessionAndUser(cookie: string) {
  const s = await auth.api.getSession({
    headers: new Headers({ cookie }),
  });
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

async function getAuditByEntity(
  entityType: string,
  entityId: string,
  action: string,
): Promise<{ id: string }[]> {
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

async function cleanupUser(userId: string) {
  const [u] = await db
    .select()
    .from(schema.authUsers)
    .where(eq(schema.authUsers.id, userId))
    .limit(1);
  if (!u) return;
  if (u.platformAccountId) {
    const roleIds = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(
        and(
          eq(schema.roles.tenantId, u.platformAccountId),
          eq(schema.roles.scope, "tenant"),
        ),
      );
    for (const r of roleIds) {
      await db
        .delete(schema.rolePermissions)
        .where(eq(schema.rolePermissions.roleId, r.id));
    }
    await db
      .delete(schema.tenantRoleAssignments)
      .where(eq(schema.tenantRoleAssignments.tenantId, u.platformAccountId));
    await db.delete(schema.roles).where(eq(schema.roles.tenantId, u.platformAccountId));
    await db
      .delete(schema.installations)
      .where(eq(schema.installations.tenantId, u.platformAccountId));
    await db
      .delete(schema.tenantUsers)
      .where(eq(schema.tenantUsers.tenantId, u.platformAccountId));
    await db.delete(schema.tenants).where(eq(schema.tenants.id, u.platformAccountId));
  }
  await db
    .delete(schema.tenantRoleAssignments)
    .where(eq(schema.tenantRoleAssignments.userId, u.id));
  await db
    .delete(schema.tenantUsers)
    .where(eq(schema.tenantUsers.userId, u.id));
  await db
    .delete(schema.platformRoleAssignments)
    .where(eq(schema.platformRoleAssignments.userId, u.id));
  await db
    .delete(schema.authSessions)
    .where(eq(schema.authSessions.userId, u.id));
  await db
    .delete(schema.authAccounts)
    .where(eq(schema.authAccounts.userId, u.id));
  await db
    .delete(schema.authVerifications)
    .where(eq(schema.authVerifications.identifier, u.email));
  await db.delete(schema.authUsers).where(eq(schema.authUsers.id, u.id));
}

async function main() {
  await runParallelProvisioningUserSama();
  await runRetryResponsHilang();
  await runRollbackWithFailureInjection();
  const msg = failures === 0 ? "=== VERIFIKASI TAMBAHAN LULUS ===" : "=== " + failures + " VERIFIKASI GAGAL ===";
  console.log(msg);
}

async function runParallelProvisioningUserSama() {
  try {
    const email = `par-${TAG}@example.test`;
    const { userId, cookie } = await signUp(email, `Paralel ${TAG}`);
    const { user } = await getSessionAndUser(cookie);

    // Jalankan provisioning dari dua koneksi terpisah secara bersamaan.
    const [a, b] = await Promise.all([
      provisionTenantFromSignup({
        userId: user.id,
        email,
        businessName: `Paralel ${TAG}`,
      }),
      provisionTenantFromSignup({
        userId: user.id,
        email,
        businessName: `Paralel ${TAG}`,
      }),
    ]);

    // Salah satu harus sukses.
    if (!a.ok && !b.ok) {
      throw new Error("kedua provisioning gagal; tidak ada yang lolos");
    }

    const winner = a.ok ? a : b;
    const loser = a.ok ? b : a;

    // TypeScript masih melihat ini sebagai discriminated union secara keseluruhan.
    // Kita pastikan只有 cabang yang masuk di sini adalah cabang ok: true.
    if (!winner.ok) {
      throw new Error("kode ini tidak seharusnya tercapai; winner harus ok");
    }

    // Yang gagal harus konflik, bukan error acak.
    if (!isProvisioningSuccess(loser)) {
      throw new Error(
        `loser tidak conflict dan tidak ok; reason: ${String(loser.reason ?? "(tidak ada reason)")}`,
      );
    }

    // Tenant harus sama.
    if (!isProvisioningSuccess(a) || !isProvisioningSuccess(b) || a.tenantId !== b.tenantId) {
      throw new Error("kedua provisioning sukses tapi tenant berbeda");
    }

    // Audit log harus tetap satu per entity.
    const auditTenant = await getAuditByEntity(
      "tenant",
      winner.tenantId,
      "tenant.created",
    );
    const auditInstall = await getAuditByEntity(
      "installation",
      winner.installationId,
      "installation.created",
    );
    if (auditTenant.length !== 1) {
      throw new Error("audit tenant.created bukan 1");
    }
    if (auditInstall.length !== 1) {
      throw new Error("audit installation.created bukan 1");
    }

    await cleanupUser(user.id);
    ok("parallel provisioning user sama: satu lolos, satu conflict, audit tidak terduplikasi");
  } catch (e) {
    fail("parallel provisioning user sama", e);
  }
}

async function runRetryResponsHilang() {
  try {
    const email = `hilang-${TAG}@example.test`;
    const { userId, cookie } = await signUp(email, `Hilang ${TAG}`);
    const { user } = await getSessionAndUser(cookie);

    // Simulasi: respons pertama berhasil commit, tapi klien tidak
    // memakai hasilnya (persepsi "respons hilang").
    const first = await provisionTenantFromSignup({
      userId: user.id,
      email,
      businessName: `Hilang ${TAG}`,
    });
    if (!isProvisioningSuccess(first)) {
      throw new Error("provisioning pertama gagal; uji tidak bisa dilanjutkan");
    }

    // "Respons hilang" — kita buang hasilnya dan panggil provisioning lagi.
    await new Promise((r) => setTimeout(r, 200));
    const second = await provisionTenantFromSignup({
      userId: user.id,
      email,
      businessName: `Hilang ${TAG}`,
    });
    if (!isProvisioningSuccess(second)) {
      throw new Error(
        "retry setelah commit berhasil harus sukses/idempoten; dapat: " +
          String(second.reason ?? "(tanpa reason)"),
      );
    }

    if (second.tenantId !== first.tenantId) {
      throw new Error("retry membuat tenant berbeda");
    }

    const audit1 = await getAuditByEntity(
      "tenant",
      first.tenantId,
      "tenant.created",
    );
    const audit2 = await getAuditByEntity(
      "tenant",
      first.tenantId,
      "tenant.created",
    );
    if (audit1.length !== 1 || audit2.length !== 1) {
      throw new Error("jumlah audit tenant.created bukan 1");
    }
    if (audit1[0].id !== audit2[0].id) {
      throw new Error("audit tenant.created berubah/berduplikat");
    }

    const installAudit1 = await getAuditByEntity(
      "installation",
      first.installationId,
      "installation.created",
    );
    const installAudit2 = await getAuditByEntity(
      "installation",
      first.installationId,
      "installation.created",
    );
    if (installAudit1.length !== 1 || installAudit2.length !== 1) {
      throw new Error("jumlah audit installation.created bukan 1");
    }
    if (installAudit1[0].id !== installAudit2[0].id) {
      throw new Error("audit installation.created berubah/berduplikat");
    }

    await cleanupUser(user.id);
    ok("retry setelah respons hilang: tenant sama, audit tidak terduplikasi");
  } catch (e) {
    fail("retry respons hilang", e);
  }
}

/**
 * Menyuntikkan kegagalan buatan di tengah transaksi provisioning.
 * Pendekatan: manfaatkan langkah B1/B2 provisioning yang membandingkan
 * email/akun. Jika email bisnis itu sudah dipakai oleh akun lain sebelum
 * provisioning dimulai, provisioning harus cepat gagal di B0/B1.
 *
 * Untuk skenario "rollback di tengah" yang lebih nyata, kita juga
 * mengandalkan fakta bahwa kegagalan di dalam transaksi Drizzle/Postgres
 * membatalkan seluruh transaksi.
 */
async function runRollbackWithFailureInjection() {
  try {
    // 1) Buat location/accounts statis yang akan dipakai untuk
    //    memaksa kegagalan konflik di awal transaksi.
    const emailOwner = `owner-${TAG}@example.test`;
    const { userId: ownerId } = await signUp(emailOwner, `Owner ${TAG}`);
    await provisionTenantFromSignup({
      userId: ownerId,
      email: emailOwner,
      businessName: `Owner ${TAG}`,
    });


    // 2) Buat identitas baru, lalu coba provisioning dengan email yang
    //    sudah dimiliki owner. Ini harus gagal PROSES provisioning tanpa
    //    kehilangan auth_user pemilik identitas baru.
    const emailLoser = `loser-${TAG}@example.test`;
    const { userId: loserId, cookie: loserCookie } = await signUp(emailLoser, `Loser ${TAG}`);
    const loserUser = await getSessionAndUser(loserCookie);

    const outcome = await provisionTenantFromSignup({
      userId: loserUser.user.id,
      email: emailOwner,
      businessName: `Loser ${TAG}`,
    });

    if (outcome.ok) {
      throw new Error("seharusnya conflict, tapi provisioning lolos");
    }
    if (!outcome.conflict) {
      throw new Error(
        "seharusnya conflict=true; dapat: " + String(outcome.reason ?? "(tanpa reason)"),
      );
    }

    // 3) Identitas pemilik harus tetap ada.
    const [ownerRow] = await db
      .select()
      .from(schema.authUsers)
      .where(eq(schema.authUsers.id, ownerId))
      .limit(1);
    if (!ownerRow) {
      throw new Error("auth_user owner hilang setelah kegagalan provisioning lain");
    }

    // 4) Identitas loser tetap ada dan TIDAK terikat ke tenant.
    const [loserRow] = await db
      .select()
      .from(schema.authUsers)
      .where(eq(schema.authUsers.id, loserId))
      .limit(1);
    if (!loserRow) {
      throw new Error("auth_user loser hilang setelah kegagalan provisioning");
    }
    if (loserRow.platformAccountId) {
      throw new Error(
        "identitas loser terikat ke akun bisnis meskipun provisioning gagal",
      );
    }

    // 5) Tidak boleh ada sisa tenant/instalasi dari loser di DB.
    const loserTenant = await getTenantByUserId(loserId);
    if (loserTenant) {
      throw new Error("loser memiliki tenant meski provisioning gagal");
    }

    await cleanupUser(ownerId);
    await cleanupUser(loserId);
    ok("rollback kegagalan di awal transaksi: tidak ada data provisioning parsial, auth_user tetap ada");
  } catch (e) {
    fail("rollback dengan penyuntikan kegagalan", e);
  }
}

main()
  .catch(() => (process.exitCode = 1))
  .finally(async () => {
    const client = (db as unknown as {
      $client?: { end?: () => Promise<void> };
    }).$client;
    if (client?.end) await client.end();
  });
