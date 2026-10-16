/**
 * Uji integrasi modul jamaah — travel-umroh (HANYA Neon Development).
 *
 * Endpoint yang diuji:
 *   - GET    /api/tenant/jamaah?tenantId=…            (jamaah.read)
 *   - POST   /api/tenant/jamaah?tenantId=…            (jamaah.create)
 *   - GET    /api/tenant/jamaah/[id]?tenantId=…       (jamaah.read)
 *   - PATCH  /api/tenant/jamaah/[id]?tenantId=…       (jamaah.update)
 *
 * Semua request memakai HTTP nyata + cookie session Better Auth hasil
 * signUp/signIn sungguhan. Selain itu, jalur library (getJamaahList /
 * createJamaah) diuji langsung dengan userId hasil autentikasi, sehingga
 * kegagalan bisa dipisahkan antara "route salah memanggil" dan "logika
 * otorisasi salah".
 *
 * Skenario:
 *   JA-01  GET list tanpa session → 401
 *   JA-02  GET list cookie palsu → 401
 *   JA-03  GET list admin Tenant A → 200 (memuat baris yang dibuat)
 *   JA-04  GET list admin A memakai tenantId Tenant B → 404
 *   JA-05  POST create admin A → 201
 *   JA-06  POST registrant_no duplikat → 409
 *   JA-07  POST payload tidak valid (fullName kosong) → 400
 *   JA-08  GET detail jamaah A lewat tenantId Tenant B → 404
 *   JA-09  PATCH jamaah Tenant A oleh admin A → 200
 *   JA-10  GET list oleh anggota aktif tanpa role → 403
 *   JA-11  Isolasi: daftar Tenant B tidak memuat baris Tenant A
 *   JA-12  Library: createJamaah dengan userId sah benar-benar berhasil
 *
 * Skenario yang bergantung pada tabel `pilgrims`: JA-03, JA-05, JA-06, JA-07,
 * JA-08, JA-09, JA-11, JA-12. Skenario yang ditolak sebelum menyentuh tabel:
 * JA-01, JA-02, JA-04, JA-10.
 *
 * Bila tabel `pilgrims` belum ada di database, skenario yang bergantung tabel
 * dilaporkan sebagai BLOKIR (bukan lulus/gagal) dan proses keluar dengan status
 * bukan-nol.
 *
 * Jalankan: npx tsx scripts/jamaah-smoke.ts
 */
import "./load-env";

import { spawn, execSync } from "child_process";
import { setTimeout } from "timers/promises";
import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { auth } from "@/auth";
import { provisionTenantFromSignup } from "@/lib/provisioning";
import { createJamaah, hasPermission } from "@/lib/authz";

const STARTUP_TIMEOUT_MS = 60000;
const TAG = `jamaah-${Date.now().toString(36)}`;
const PASSWORD_OK = "C0rrect-Passw0rd!x";
const serverPort = Number(process.env.TEST_PORT ?? "3211");
const BASE_URL = `http://localhost:${serverPort}`;

// ============================================================================
// Server lifecycle
// ============================================================================

let serverProcess: ReturnType<typeof spawn> | null = null;

async function startServer(): Promise<void> {
  console.log(`Memulai server Next.js di port ${serverPort}...`);
  serverProcess = spawn("cmd", ["/c", "npx.cmd", "next", "dev", "--port", String(serverPort)], {
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
  });

  serverProcess.stdout?.on("data", (d: Buffer) => process.stdout.write(`[server] ${d.toString()}`));
  serverProcess.stderr?.on("data", (d: Buffer) => process.stderr.write(`[server] ${d.toString()}`));

  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/`, { method: "GET", signal: AbortSignal.timeout(2000) });
      console.log(`Server siap (status ${response.status}).`);
      return;
    } catch {
      // belum siap
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
  if (!serverProcess.killed) serverProcess.kill("SIGKILL");
  serverProcess = null;
}

// ============================================================================
// Helper HTTP & auth
// ============================================================================

interface TestUser {
  userId: string;
  cookie: string;
  email: string;
}

async function signUp(email: string, name: string): Promise<TestUser> {
  const res = await auth.api.signUpEmail({
    body: { email, password: PASSWORD_OK, name },
    returnHeaders: true,
  });
  return {
    userId: res.response.user.id,
    cookie: [...res.headers.getSetCookie()].join("; "),
    email,
  };
}

async function signIn(email: string): Promise<string> {
  const res = await auth.api.signInEmail({
    body: { email, password: PASSWORD_OK },
    returnHeaders: true,
  });
  return [...res.headers.getSetCookie()].join("; ");
}

async function request(
  method: "GET" | "POST" | "PATCH",
  path: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (cookie) headers["Cookie"] = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = await response.text();
  }
  return { status: response.status, body: parsed };
}

/** Pindahkan identitas ke tenant lain sebagai anggota aktif (satu tenant per identitas). */
async function moveUserToTenant(userId: string, ownTenantId: string, targetTenantId: string): Promise<void> {
  const [ownTenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, ownTenantId))
    .limit(1);
  if (!ownTenant) throw new Error("tenant milik user yang dipindahkan tidak ditemukan");

  await db.delete(schema.tenantRoleAssignments).where(eq(schema.tenantRoleAssignments.tenantId, ownTenantId));
  await db.delete(schema.roles).where(eq(schema.roles.tenantId, ownTenantId));
  await db.delete(schema.installations).where(eq(schema.installations.tenantId, ownTenantId));
  await db.delete(schema.tenantUsers).where(eq(schema.tenantUsers.tenantId, ownTenantId));
  await db.delete(schema.tenants).where(eq(schema.tenants.id, ownTenantId));
  if (ownTenant.accountId) {
    await db.delete(schema.accounts).where(eq(schema.accounts.id, ownTenant.accountId));
  }
  await db.update(schema.authUsers).set({ platformAccountId: null }).where(eq(schema.authUsers.id, userId));
  await db.insert(schema.tenantUsers).values({ userId, tenantId: targetTenantId, status: "active" });
}

// ============================================================================
// Setup / cleanup
// ============================================================================

let tenantA = "";
let tenantB = "";
let jamaahA = "";
let jamaahA2 = "";
const users: TestUser[] = [];

async function setup(): Promise<{ adminA: TestUser; adminB: TestUser; noperm: TestUser }> {
  const adminA = await signUp(`admin-a-${TAG}@example.test`, `Admin A ${TAG}`);
  const outcomeA = await provisionTenantFromSignup({
    userId: adminA.userId,
    email: adminA.email,
    businessName: `Jamaah Tenant A ${TAG}`,
  });
  if (!outcomeA.ok) throw new Error(`Provisioning Tenant A gagal: ${outcomeA.reason}`);
  tenantA = outcomeA.tenantId;

  const adminB = await signUp(`admin-b-${TAG}@example.test`, `Admin B ${TAG}`);
  const outcomeB = await provisionTenantFromSignup({
    userId: adminB.userId,
    email: adminB.email,
    businessName: `Jamaah Tenant B ${TAG}`,
  });
  if (!outcomeB.ok) throw new Error(`Provisioning Tenant B gagal: ${outcomeB.reason}`);
  tenantB = outcomeB.tenantId;

  const noperm = await signUp(`noperm-${TAG}@example.test`, `NoPerm ${TAG}`);
  const nopermProvision = await provisionTenantFromSignup({
    userId: noperm.userId,
    email: noperm.email,
    businessName: `NoPerm Own ${TAG}`,
  });
  if (!nopermProvision.ok) throw new Error(`Provisioning NoPerm gagal: ${nopermProvision.reason}`);
  await moveUserToTenant(noperm.userId, nopermProvision.tenantId, tenantA);
  const nopermCookie = await signIn(noperm.email);
  const nopermUser = { ...noperm, cookie: nopermCookie };

  users.push(adminA, adminB, nopermUser);
  return { adminA, adminB, noperm: nopermUser };
}

async function cleanup(): Promise<void> {
  // Bila tabel `pilgrims` belum ada, lewati pembersihan baris jamaah.
  const hasPilgrims =
    pilgrimsReady || (await pilgrimsTableExists().catch(() => false));
  if (hasPilgrims) {
    if (tenantA) await db.delete(schema.pilgrims).where(eq(schema.pilgrims.tenantId, tenantA));
    if (tenantB) await db.delete(schema.pilgrims).where(eq(schema.pilgrims.tenantId, tenantB));
  }

  for (const user of users) {
    const [u] = await db
      .select()
      .from(schema.authUsers)
      .where(eq(schema.authUsers.id, user.userId))
      .limit(1);
    if (!u) continue;
    if (u.platformAccountId) {
      const [ownTenant] = await db
        .select()
        .from(schema.tenants)
        .where(eq(schema.tenants.accountId, u.platformAccountId))
        .limit(1);
      if (ownTenant) {
        if (hasPilgrims) {
          await db.delete(schema.pilgrims).where(eq(schema.pilgrims.tenantId, ownTenant.id));
        }
        await db.delete(schema.tenantRoleAssignments).where(eq(schema.tenantRoleAssignments.tenantId, ownTenant.id));
        await db.delete(schema.roles).where(eq(schema.roles.tenantId, ownTenant.id));
        await db.delete(schema.installations).where(eq(schema.installations.tenantId, ownTenant.id));
        await db.delete(schema.tenants).where(eq(schema.tenants.id, ownTenant.id));
        await db.delete(schema.accounts).where(eq(schema.accounts.id, ownTenant.accountId));
      }
    }
    await db.delete(schema.tenantRoleAssignments).where(eq(schema.tenantRoleAssignments.userId, u.id));
    await db.delete(schema.tenantUsers).where(eq(schema.tenantUsers.userId, u.id));
    await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, u.id));
    await db.delete(schema.authAccounts).where(eq(schema.authAccounts.userId, u.id));
    await db.delete(schema.authVerifications).where(eq(schema.authVerifications.identifier, u.email));
    await db.delete(schema.authUsers).where(eq(schema.authUsers.id, u.id));
  }
}

// ============================================================================
// Tes
// ============================================================================

let failures = 0;
let blocked = 0;
let pilgrimsReady = false;

/** Tabel `pilgrims` harus ada sebelum skenario yang menyentuh data jamaah. */
async function pilgrimsTableExists(): Promise<boolean> {
  const rows = await db.execute(
    sql`select 1 from information_schema.tables where table_schema='public' and table_name='pilgrims'`,
  );
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  return list.length > 0;
}

function ok(name: string) {
  console.log(`PASS  ${name}`);
}
function fail(name: string, detail?: string) {
  failures++;
  console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
}
function skip(name: string, reason: string) {
  blocked++;
  console.log(`BLOKIR  ${name} :: ${reason}`);
}
function record(name: string, actual: number, expected: number, extra?: string) {
  actual === expected
    ? ok(`${name} → ${expected}`)
    : fail(name, `harus ${expected}, dapat ${actual}${extra ? ` :: ${extra}` : ""}`);
}

/** Jalankan skenario yang memerlukan tabel `pilgrims`, atau tandai BLOKIR. */
async function needsPilgrims(name: string, fn: () => Promise<void>): Promise<void> {
  if (!pilgrimsReady) {
    skip(name, "tabel `pilgrims` belum ada di database (migrasi belum diterapkan)");
    return;
  }
  await fn();
}

async function main(): Promise<void> {
  try {
    await startServer();
    console.log("Setup data uji...");
    const { adminA, adminB, noperm } = await setup();

    // Pre-kondisi: katalog izin jamaah benar-benar ada untuk admin tenant.
    if (!(await hasPermission(adminA.userId, "jamaah.read", "tenant", tenantA))) {
      throw new Error("pre-kondisi gagal: admin A tidak memiliki jamaah.read");
    }
    console.log("Pre-kondisi: admin A memiliki jamaah.read.");

    pilgrimsReady = await pilgrimsTableExists();
    console.log(
      pilgrimsReady
        ? "Pre-kondisi: tabel `pilgrims` tersedia."
        : "BLOKIR: tabel `pilgrims` TIDAK ADA di database.",
    );

    const list = (cookie: string, tenantId = tenantA) =>
      request("GET", `/api/tenant/jamaah?tenantId=${tenantId}`, cookie);

    console.log("\n--- Tanpa data jamaah (ditolak sebelum query) ---\n");
    record("JA-01: GET list tanpa session", (await list("")).status, 401);
    record("JA-02: GET list cookie palsu", (await list("better-auth.session_token=palsu")).status, 401);
    record("JA-04: GET list admin A dengan tenantId Tenant B", (await list(adminA.cookie, tenantB)).status, 404);
    record("JA-10: GET list oleh anggota aktif tanpa role", (await list(noperm.cookie)).status, 403);

    console.log("\n--- Jalur library (userId hasil autentikasi) ---\n");
    // JA-12: jalur library harus berhasil — memisahkan bug route dari bug authz.
    await needsPilgrims("JA-12: createJamaah(userId sah) di jalur library", async () => {
      const created = await createJamaah(adminA.userId, tenantA, {
        registrantNo: `LIB-${TAG}`,
        fullName: `Jamaah Library ${TAG}`,
      });
      if (created.ok) {
        jamaahA = created.row.id;
        ok("JA-12: createJamaah(userId sah) berhasil di jalur library");
      } else {
        fail("JA-12: createJamaah(userId sah) gagal", created.problem.message);
      }
    });

    console.log("\n--- Endpoint HTTP dengan data jamaah ---\n");
    await needsPilgrims("JA-03: GET list admin Tenant A", async () => {
      record("JA-03: GET list admin Tenant A", (await list(adminA.cookie)).status, 200);
    });

    // JA-05: POST create lewat HTTP.
    await needsPilgrims("JA-05: POST create admin A", async () => {
      const res = await request("POST", `/api/tenant/jamaah?tenantId=${tenantA}`, adminA.cookie, {
        registrantNo: `HTTP-${TAG}`,
        fullName: `Jamaah HTTP ${TAG}`,
      });
      const body = res.body as { jamaah?: { id?: string } } | null;
      if (res.status === 201 && body?.jamaah?.id) {
        jamaahA2 = body.jamaah.id;
        ok("JA-05: POST create admin A → 201");
      } else {
        fail("JA-05: POST create admin A", `harus 201, dapat ${res.status} :: ${JSON.stringify(res.body)}`);
      }
    });

    await needsPilgrims("JA-06: POST registrant_no duplikat", async () => {
      record(
        "JA-06: POST registrant_no duplikat",
        (
          await request("POST", `/api/tenant/jamaah?tenantId=${tenantA}`, adminA.cookie, {
            registrantNo: `HTTP-${TAG}`,
            fullName: `Duplikat ${TAG}`,
          })
        ).status,
        409,
      );
    });

    await needsPilgrims("JA-07: POST payload tidak valid (fullName kosong)", async () => {
      record(
        "JA-07: POST payload tidak valid (fullName kosong)",
        (
          await request("POST", `/api/tenant/jamaah?tenantId=${tenantA}`, adminA.cookie, {
            registrantNo: `BAD-${TAG}`,
            fullName: "   ",
          })
        ).status,
        400,
      );
    });

    await needsPilgrims("JA-08: GET detail jamaah A lewat tenantId Tenant B", async () => {
      record(
        "JA-08: GET detail jamaah A lewat tenantId Tenant B",
        (await request("GET", `/api/tenant/jamaah/${jamaahA}?tenantId=${tenantB}`, adminA.cookie)).status,
        404,
      );
    });

    await needsPilgrims("JA-09: PATCH jamaah Tenant A oleh admin A", async () => {
      record(
        "JA-09: PATCH jamaah Tenant A oleh admin A",
        (
          await request("PATCH", `/api/tenant/jamaah/${jamaahA}?tenantId=${tenantA}`, adminA.cookie, {
            fullName: `Jamaah Library ${TAG} (diubah)`,
          })
        ).status,
        200,
      );
    });

    // JA-11: isolasi antartenant pada respons daftar.
    await needsPilgrims("JA-11: isolasi daftar antartenant", async () => {
      const res = await list(adminB.cookie, tenantB);
      const body = res.body as { rows?: { registrantNo?: string }[] } | null;
      if (res.status !== 200) {
        fail("JA-11: daftar Tenant B", `harus 200, dapat ${res.status}`);
      } else {
        const leaked = (body?.rows ?? []).some((r) => String(r.registrantNo ?? "").startsWith("HTTP-"));
        leaked
          ? fail("JA-11: isolasi antartenant", "baris Tenant A terlihat di daftar Tenant B")
          : ok("JA-11: daftar Tenant B tidak memuat baris Tenant A");
      }
    });

    console.log(
      `\n=== ${failures} TES GAGAL, ${blocked} BLOKIR ===`,
    );
    if (failures === 0 && blocked === 0) console.log("=== SEMUA TES LULUS ===");
  } catch (e) {
    console.error("Error during test:", e);
    failures++;
    console.log(`=== ${failures} TES GAGAL ===`);
  } finally {
    await cleanup();
    await stopServer();
  }

  const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
  if (client?.end) await client.end();
  process.exit(failures > 0 || blocked > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("Fatal error:", e);
  await stopServer();
  process.exit(1);
});
