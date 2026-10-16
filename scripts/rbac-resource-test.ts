/**
 * Uji integrasi RBAC & kepemilikan resource — travel-umroh
 * (HANYA Neon Development).
 *
 * Endpoint yang diuji: GET /api/tenant/installation (permission
 * `installation.own.read`, scope tenant). Semua request memakai HTTP nyata
 * dengan cookie session Better Auth hasil signUp/signIn sungguhan.
 *
 * Skenario:
 *  - RBAC-01: Request tanpa session → 401
 *  - RBAC-02: Cookie palsu → 401
 *  - RBAC-03: Admin Tenant A membaca instalasi Tenant A → 200 (isi = DB)
 *  - RBAC-04: installationId milik Tenant B dikirim dengan tenantId Tenant A
 *             → 404 (kepemilikan resource diverifikasi server)
 *  - RBAC-05: Admin A meminta tenant Tenant B → 404
 *  - RBAC-06: tenantId tidak dikenal → 404
 *  - RBAC-07: Staf Tenant B (anggota aktif, tanpa izin baca instalasi) → 403
 *  - RBAC-08: Anggota Tenant A tanpa role apa pun → 403
 *  - RBAC-09: Staf B memanipulasi tenantId ke Tenant A → 404
 *  - RBAC-10: Request sah tetap berfungsi setelah penolakan → 200 (isi = DB)
 *
 * Tambahan: baris instalasi Tenant A dibaca dari DB sebelum dan sesudah
 * seluruh tes; harus identik — membuktikan request yang ditolak tidak
 * mengubah data.
 *
 * Jalankan: npx tsx scripts/rbac-resource-test.ts
 */

import "./load-env";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { auth } from "@/auth";
import { provisionTenantFromSignup } from "@/lib/provisioning";
import { hasPermission } from "@/lib/authz";

const STARTUP_TIMEOUT_MS = 60000;

const TAG = `rbac-${Date.now().toString(36)}`;
const PASSWORD_OK = "C0rrect-Passw0rd!x";
const BASE_URL = `http://localhost:${process.env.TEST_PORT ?? "3210"}`;
const serverPort = Number(process.env.TEST_PORT ?? "3210");

// ============================================================================
// Server lifecycle
// ============================================================================

import { spawn, execSync } from "child_process";
import { setTimeout } from "timers/promises";

let serverProcess: ReturnType<typeof spawn> | null = null;

async function startServer(): Promise<void> {
  console.log(`Memulai server Next.js di port ${serverPort}...`);
  const spawnCmd = "cmd";
  const spawnArgs = ["/c", "npx.cmd", "next", "dev", "--port", String(serverPort)];
  serverProcess = spawn(
    spawnCmd,
    spawnArgs,
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: String(serverPort),
        NODE_ENV: "development",
        TEST_PORT: String(serverPort),
        BETTER_AUTH_URL: `http://localhost:${serverPort}`,
        NEXT_PUBLIC_APP_URL: `http://localhost:${serverPort}`,
      },
      shell: true,
    },
  );

  serverProcess.stdout?.on("data", (d: Buffer) =>
    process.stdout.write(`[server] ${d.toString()}`),
  );
  serverProcess.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[server] ${d.toString()}`),
  );

  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      console.log(`Server siap (status ${response.status}).`);
      return;
    } catch {
      // Server belum siap, lanjutkan polling.
    }
    await setTimeout(500);
  }
  throw new Error(`Server tidak siap setelah ${STARTUP_TIMEOUT_MS}ms`);
}

async function stopServer(): Promise<void> {
  if (!serverProcess) return;
  console.log("Menghentikan server...");
  const pid = serverProcess.pid;
  if (pid) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } catch {
      serverProcess.kill("SIGTERM");
    }
  } else {
    serverProcess.kill("SIGTERM");
  }
  await setTimeout(1500);
  if (!serverProcess.killed) {
    serverProcess.kill("SIGKILL");
  }
  serverProcess = null;
}

// ============================================================================
// Helper HTTP dan auth
// ============================================================================

interface SignInResult {
  userId: string;
  cookie: string;
}

async function signUp(email: string, name: string): Promise<SignInResult> {
  const res = await auth.api.signUpEmail({
    body: { email, password: PASSWORD_OK, name },
    returnHeaders: true,
  });
  return {
    userId: res.response.user.id,
    cookie: [...res.headers.getSetCookie()].join("; "),
  };
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  return [...res.headers.getSetCookie()].join("; ");
}

/** Bawa request HTTP nyata ke server yang berjalan dengan cookie diberikan. */
async function fetchWithContext(
  path: string,
  cookie: string,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers["Cookie"] = cookie;
  }
  const response = await fetch(`${BASE_URL}${path}`, { method: "GET", headers });
  let parsedBody: unknown = null;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = await response.text();
  }
  return { status: response.status, body: parsedBody };
}

// ============================================================================
// Setup dan cleanup
// ============================================================================

interface TestUser {
  userId: string;
  cookie: string;
  email: string;
}

let td: {
  adminA: TestUser;
  tenantA: { tenantId: string; installationId: string };
  adminB: TestUser;
  tenantB: { tenantId: string; installationId: string };
  staffB: TestUser;
  noperm: TestUser;
} | null = null;

/**
 * Pindahkan identitas yang baru diprovision ke tenant lain sebagai anggota
 * aktif. `tenant_users.user_id` adalah primary key — satu identitas hanya
 * boleh jadi anggota satu tenant — jadi tenant miliknya sendiri dibersihkan
 * (semua baris ini adalah data uji yang dibuat skrip ini).
 *
 * `ownTenantId` adalah ID tenant milik user hasil provisioning (BUKAN
 * auth_users.platform_account_id — kolom itu menyimpan accounts.id).
 */
async function moveUserToTenant(
  userId: string,
  ownTenantId: string,
  targetTenantId: string,
): Promise<void> {
  const [ownTenantRow] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, ownTenantId))
    .limit(1);
  if (!ownTenantRow) {
    throw new Error("tenant milik user yang dipindahkan tidak ditemukan");
  }

  await db
    .delete(schema.tenantRoleAssignments)
    .where(eq(schema.tenantRoleAssignments.tenantId, ownTenantId));
  await db
    .delete(schema.roles)
    .where(eq(schema.roles.tenantId, ownTenantId));
  await db
    .delete(schema.installations)
    .where(eq(schema.installations.tenantId, ownTenantId));
  await db
    .delete(schema.tenantUsers)
    .where(eq(schema.tenantUsers.tenantId, ownTenantId));
  await db.delete(schema.tenants).where(eq(schema.tenants.id, ownTenantId));
  if (ownTenantRow.accountId) {
    await db
      .delete(schema.accounts)
      .where(eq(schema.accounts.id, ownTenantRow.accountId));
  }
  await db
    .update(schema.authUsers)
    .set({ platformAccountId: null })
    .where(eq(schema.authUsers.id, userId));

  await db
    .insert(schema.tenantUsers)
    .values({ userId, tenantId: targetTenantId, status: "active" });
}

async function setup(): Promise<NonNullable<typeof td>> {
  // --- Tenant A: admin A -----------------------------------------------
  const emailA = `admin-${TAG}@example.test`;
  const adminAId = await signUp(emailA, `Admin A ${TAG}`);
  const outcomeA = await provisionTenantFromSignup({
    userId: adminAId.userId,
    email: emailA,
    businessName: `Tenant A ${TAG}`,
  });
  if (!outcomeA.ok) {
    throw new Error(`Provisioning Tenant A gagal: ${outcomeA.reason}`);
  }

  // Pre-kondisi: admin A harus punya permission installation.own.read.
  // Gagal cepat di sini membuktikan katalog permission benar-benar ada.
  if (!(await hasPermission(adminAId.userId, "installation.own.read", "tenant", outcomeA.tenantId))) {
    throw new Error("pre-kondisi gagal: admin tidak memiliki installation.own.read");
  }

  // --- Tenant B: admin B ------------------------------------------------
  const emailB = `admin-b-${TAG}@example.test`;
  const adminBId = await signUp(emailB, `Admin B ${TAG}`);
  const outcomeB = await provisionTenantFromSignup({
    userId: adminBId.userId,
    email: emailB,
    businessName: `Tenant B ${TAG}`,
  });
  if (!outcomeB.ok) {
    throw new Error(`Provisioning Tenant B gagal: ${outcomeB.reason}`);
  }

  // --- Staf Tenant B: anggota aktif, role tenant.staff (tanpa izin baca
  //     instalasi — STAFF_CODES tidak memuat installation.own.read) --------
  const emailStaff = `staff-${TAG}@example.test`;
  const staffId = await signUp(emailStaff, `Staff B ${TAG}`);
  const staffProvision = await provisionTenantFromSignup({
    userId: staffId.userId,
    email: emailStaff,
    businessName: `Staff Own Tenant ${TAG}`,
  });
  if (!staffProvision.ok) {
    throw new Error(`Provisioning Staff gagal: ${staffProvision.reason}`);
  }
  await moveUserToTenant(staffId.userId, staffProvision.tenantId, outcomeB.tenantId);

  const [staffRole] = await db
    .select()
    .from(schema.roles)
    .where(
      and(
        eq(schema.roles.tenantId, outcomeB.tenantId),
        eq(schema.roles.scope, "tenant"),
        eq(schema.roles.code, "tenant.staff"),
      ),
    )
    .limit(1);
  if (staffRole) {
    await db
      .insert(schema.tenantRoleAssignments)
      .values({
        userId: staffId.userId,
        roleId: staffRole.id,
        tenantId: outcomeB.tenantId,
        assignedBy: "system",
      })
      .onConflictDoNothing();
  }
  // Pre-kondisi: staf memang TIDAK punya izin baca instalasi.
  if (await hasPermission(staffId.userId, "installation.own.read", "tenant", outcomeB.tenantId)) {
    throw new Error("pre-kondisi gagal: staf ternyata punya installation.own.read");
  }
  const staffCookie = await signIn(emailStaff, PASSWORD_OK);

  // --- Anggota Tenant A tanpa role apa pun (nol izin) --------------------
  const emailNoperm = `noperm-${TAG}@example.test`;
  const nopermId = await signUp(emailNoperm, `NoPerm ${TAG}`);
  const nopermProvision = await provisionTenantFromSignup({
    userId: nopermId.userId,
    email: emailNoperm,
    businessName: `NoPerm Own Tenant ${TAG}`,
  });
  if (!nopermProvision.ok) {
    throw new Error(`Provisioning NoPerm gagal: ${nopermProvision.reason}`);
  }
  await moveUserToTenant(nopermId.userId, nopermProvision.tenantId, outcomeA.tenantId);
  const nopermCookie = await signIn(emailNoperm, PASSWORD_OK);

  return {
    adminA: { userId: adminAId.userId, cookie: adminAId.cookie, email: emailA },
    tenantA: {
      tenantId: outcomeA.tenantId,
      installationId: outcomeA.installationId,
    },
    adminB: { userId: adminBId.userId, cookie: adminBId.cookie, email: emailB },
    tenantB: {
      tenantId: outcomeB.tenantId,
      installationId: outcomeB.installationId,
    },
    staffB: { userId: staffId.userId, cookie: staffCookie, email: emailStaff },
    noperm: { userId: nopermId.userId, cookie: nopermCookie, email: emailNoperm },
  };
}

async function cleanup(): Promise<void> {
  if (!td) return;
  const users = [td.adminA, td.adminB, td.staffB, td.noperm];
  for (const user of users) {
    const [u] = await db
      .select()
      .from(schema.authUsers)
      .where(eq(schema.authUsers.id, user.userId))
      .limit(1);
    if (!u) continue;
    // Tenant milik user ini (bila ada) dihapus berikut seluruh rantainya;
    // FK ON DELETE CASCADE menjaga installations/tenantUsers/roles ikut
    // terhapus. Kunci: pilih tenant berdasarkan accountId, bukan id.
    if (u.platformAccountId) {
      const [ownTenant] = await db
        .select()
        .from(schema.tenants)
        .where(eq(schema.tenants.accountId, u.platformAccountId))
        .limit(1);
      if (ownTenant) {
        await db
          .delete(schema.tenantRoleAssignments)
          .where(eq(schema.tenantRoleAssignments.tenantId, ownTenant.id));
        await db
          .delete(schema.roles)
          .where(eq(schema.roles.tenantId, ownTenant.id));
        await db
          .delete(schema.installations)
          .where(eq(schema.installations.tenantId, ownTenant.id));
        await db.delete(schema.tenants).where(eq(schema.tenants.id, ownTenant.id));
        await db
          .delete(schema.accounts)
          .where(eq(schema.accounts.id, ownTenant.accountId));
      }
    }
    await db
      .delete(schema.tenantRoleAssignments)
      .where(eq(schema.tenantRoleAssignments.userId, u.id));
    await db
      .delete(schema.tenantUsers)
      .where(eq(schema.tenantUsers.userId, u.id));
    await db
      .delete(schema.authSessions)
      .where(eq(schema.authSessions.userId, u.id));
    await db
      .delete(schema.authAccounts)
      .where(eq(schema.authAccounts.userId, u.id));
    await db
      .delete(schema.authVerifications)
      .where(eq(schema.authVerifications.identifier, u.email));
    await db
      .delete(schema.authUsers)
      .where(eq(schema.authUsers.id, u.id));
  }
}

// ============================================================================
// Tes
// ============================================================================

let failures = 0;
function ok(name: string) {
  console.log(`PASS  ${name}`);
}
function fail(name: string, detail?: string) {
  failures++;
  console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
}

function bodyAs(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)
    : null;
}

/** Baca baris instalasi Tenant A langsung dari DB. */
async function readInstallA() {
  const [row] = await db
    .select()
    .from(schema.installations)
    .where(eq(schema.installations.tenantId, td!.tenantA.tenantId))
    .limit(1);
  return row;
}

async function main(): Promise<void> {
  try {
    await startServer();
    console.log("Setup data uji...");
    td = await setup();

    const installBefore = await readInstallA();
    if (!installBefore) throw new Error("instalasi Tenant A tidak ditemukan");

    console.log("\n--- Menjalankan tes RBAC & resource ownership ---\n");
    const path = `/api/tenant/installation`;

    // RBAC-01: tanpa session
    {
      const res = await fetchWithContext(`${path}?tenantId=${td!.tenantA.tenantId}`, "");
      res.status === 401
        ? ok("RBAC-01: request tanpa session → 401")
        : fail("RBAC-01", `harus 401, dapat ${res.status}`);
    }

    // RBAC-02: cookie palsu
    {
      const res = await fetchWithContext(
        `${path}?tenantId=${td!.tenantA.tenantId}`,
        "better-auth.session_token=palsu-total",
      );
      res.status === 401
        ? ok("RBAC-02: cookie palsu → 401")
        : fail("RBAC-02", `harus 401, dapat ${res.status}`);
    }

    // RBAC-03: admin A baca instalasi Tenant A → 200, isi = DB
    {
      const res = await fetchWithContext(
        `${path}?tenantId=${td!.tenantA.tenantId}`,
        td!.adminA.cookie,
      );
      const body = bodyAs(res.body);
      const inst = body?.installation as Record<string, unknown> | undefined;
      if (res.status !== 200) {
        fail("RBAC-03", `harus 200, dapat ${res.status} :: ${JSON.stringify(res.body)}`);
      } else if (inst?.id !== installBefore.id) {
        fail("RBAC-03", `installation.id tidak sama dengan DB`);
      } else if (inst?.name !== installBefore.name || inst?.status !== installBefore.status) {
        fail("RBAC-03", "name/status tidak sama dengan DB");
      } else if (body?.tenantId !== td!.tenantA.tenantId) {
        fail("RBAC-03", "tenantId pada respons tidak sesuai tenant terverifikasi");
      } else {
        ok("RBAC-03: admin A membaca instalasi Tenant A → 200 (isi = DB)");
      }
    }

    // RBAC-04: installationId milik Tenant B + tenantId Tenant A → 404
    {
      const res = await fetchWithContext(
        `${path}?tenantId=${td!.tenantA.tenantId}&installationId=${td!.tenantB.installationId}`,
        td!.adminA.cookie,
      );
      res.status === 404
        ? ok("RBAC-04: installationId lintas tenant → 404")
        : fail("RBAC-04", `harus 404, dapat ${res.status}`);
    }

    // RBAC-05: admin A minta tenant Tenant B → 404
    {
      const res = await fetchWithContext(
        `${path}?tenantId=${td!.tenantB.tenantId}`,
        td!.adminA.cookie,
      );
      res.status === 404
        ? ok("RBAC-05: admin A → Tenant B → 404")
        : fail("RBAC-05", `harus 404, dapat ${res.status}`);
    }

    // RBAC-06: tenantId tidak dikenal
    {
      const res = await fetchWithContext(
        `${path}?tenantId=00000000-0000-0000-0000-00000000abcd`,
        td!.adminA.cookie,
      );
      res.status === 404
        ? ok("RBAC-06: tenantId tidak dikenal → 404")
        : fail("RBAC-06", `harus 404, dapat ${res.status}`);
    }

    // RBAC-07: staf Tenant B (tanpa izin) → 403
    {
      const res = await fetchWithContext(
        `${path}?tenantId=${td!.tenantB.tenantId}`,
        td!.staffB.cookie,
      );
      const body = bodyAs(res.body);
      if (res.status !== 403) {
        fail("RBAC-07", `harus 403, dapat ${res.status} :: ${JSON.stringify(res.body)}`);
      } else if (body?.error !== "forbidden") {
        fail("RBAC-07", `pesan tidak sesuai, dapat ${JSON.stringify(body)}`);
      } else {
        ok("RBAC-07: staf Tenant B tanpa izin baca instalasi → 403");
      }
    }

    // RBAC-08: anggota Tenant A tanpa role → 403
    {
      const res = await fetchWithContext(
        `${path}?tenantId=${td!.tenantA.tenantId}`,
        td!.noperm.cookie,
      );
      res.status === 403
        ? ok("RBAC-08: anggota tanpa role → 403")
        : fail("RBAC-08", `harus 403, dapat ${res.status} :: ${JSON.stringify(res.body)}`);
    }

    // RBAC-09: staf B memanipulasi tenantId ke Tenant A → 404
    {
      const res = await fetchWithContext(
        `${path}?tenantId=${td!.tenantA.tenantId}`,
        td!.staffB.cookie,
      );
      res.status === 404
        ? ok("RBAC-09: staf B memanipulasi tenantId ke Tenant A → 404")
        : fail("RBAC-09", `harus 404, dapat ${res.status}`);
    }

    // RBAC-10: request sah tetap berfungsi setelah penolakan → 200, isi = DB
    {
      const res = await fetchWithContext(
        `${path}?tenantId=${td!.tenantA.tenantId}&installationId=${td!.tenantA.installationId}`,
        td!.adminA.cookie,
      );
      const body = bodyAs(res.body);
      const inst = body?.installation as Record<string, unknown> | undefined;
      if (res.status !== 200) {
        fail("RBAC-10", `harus 200, dapat ${res.status} :: ${JSON.stringify(res.body)}`);
      } else if (inst?.id !== installBefore.id) {
        fail("RBAC-10", "id tidak sama dengan DB");
      } else {
        ok("RBAC-10: request sah setelah penolakan tetap berfungsi → 200 (isi = DB)");
      }
    }

    // Bukti dampak DB: instalasi Tenant A tidak berubah oleh request manapun,
    // termasuk yang ditolak.
    const installAfter = await readInstallA();
    if (
      installAfter &&
      installAfter.id === installBefore.id &&
      installAfter.name === installBefore.name &&
      installAfter.status === installBefore.status
    ) {
      ok("DB-IMPAK: baris instalasi Tenant A identik sebelum & sesudah tes");
    } else {
      fail("DB-IMPAK", "baris instalasi Tenant A berubah selama tes");
    }

    console.log(
      `\n=== ${failures === 0 ? "SEMUA TES LULUS" : failures + " TES GAGAL"} ===`,
    );
  } catch (e) {
    console.error("Error during test:", e);
    failures++;
    console.log(`=== ${failures} TES GAGAL ===`);
  } finally {
    await cleanup();
    await stopServer();
  }

  // Tutup pool Neon agar proses bisa berakhir; akhiri deterministik.
  const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
  if (client?.end) await client.end();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("Fatal error:", e);
  await stopServer();
  process.exit(1);
});
