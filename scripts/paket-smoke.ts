/**
 * Uji integrasi modul paket — travel-umroh (HANYA Neon Development).
 *
 * Endpoint yang diuji:
 *   - GET    /api/tenant/paket?tenantId=…                      (package.read)
 *   - POST   /api/tenant/paket?tenantId=…                      (package.create)
 *   - GET/PATCH /api/tenant/paket/[id]?tenantId=…              (package.read/update)
 *   - POST   /api/tenant/paket/[id]/departures?tenantId=…      (package.update)
 *   - PATCH  /api/tenant/paket/[id]/departures/[depId]?…       (package.update)
 *
 * Skenario:
 *   PK-01  GET list tanpa session → 401
 *   PK-02  GET list cookie palsu → 401
 *   PK-03  GET list admin Tenant B dengan tenantId Tenant A → 404
 *   PK-04  POST create admin A → 201
 *   PK-05  POST code duplikat → 409
 *   PK-06  POST payload tidak valid (name kosong) → 400
 *   PK-07  POST payload tidak valid (priceIdr negatif) → 400
 *   PK-08  GET detail paket A lewat tenantId Tenant B → 404
 *   PK-09  PATCH paket Tenant A oleh admin A → 200
 *   PK-10  GET list oleh anggota aktif tanpa role → 403
 *   PK-11  Isolasi: daftar Tenant B tidak memuat paket Tenant A
 *   PK-12  POST departure admin A → 201
 *   PK-13  POST departure code duplikat → 409
 *   PK-14  POST departure returnOn ≤ departOn → 400
 *   PK-15  PATCH departure status → 200
 *   PK-16  Cursor pagination: halaman pertama berisi ≤ limit dan nextCursor berlanjut
 *   PK-17  Departure paket milik Tenant B dituliskan lewat tenant A → 404
 *
 * Jalankan: npx tsx scripts/paket-smoke.ts
 */
import "./load-env";

import { spawn, execSync } from "child_process";
import { setTimeout } from "timers/promises";
import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { auth } from "@/auth";
import { provisionTenantFromSignup } from "@/lib/provisioning";
import { hasPermission } from "@/lib/authz";

const STARTUP_TIMEOUT_MS = 60000;
const TAG = `paket-${Date.now().toString(36)}`;
const PASSWORD_OK = "C0rrect-Passw0rd!x";
const serverPort = Number(process.env.TEST_PORT ?? "3212");
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
  const contentType = response.headers.get("content-type") ?? "";
  let parsed: unknown = null;
  if (contentType.includes("application/json")) {
    parsed = await response.json();
  } else {
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
let paketA = "";
let departureA = "";
const users: TestUser[] = [];

async function setup(): Promise<{ adminA: TestUser; adminB: TestUser; noperm: TestUser }> {
  const adminA = await signUp(`admin-a-${TAG}@example.test`, `Admin A ${TAG}`);
  const outcomeA = await provisionTenantFromSignup({
    userId: adminA.userId,
    email: adminA.email,
    businessName: `Paket Tenant A ${TAG}`,
  });
  if (!outcomeA.ok) throw new Error(`Provisioning Tenant A gagal: ${outcomeA.reason}`);
  tenantA = outcomeA.tenantId;

  const adminB = await signUp(`admin-b-${TAG}@example.test`, `Admin B ${TAG}`);
  const outcomeB = await provisionTenantFromSignup({
    userId: adminB.userId,
    email: adminB.email,
    businessName: `Paket Tenant B ${TAG}`,
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

/** Tabel packages harus ada sebelum skenario data. */
async function packagesTableExists(): Promise<boolean> {
  const rows = await db.execute(
    sql`select 1 from information_schema.tables where table_schema='public' and table_name='packages'`,
  );
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  return list.length > 0;
}

async function cleanup(): Promise<void> {
  // departures terhapus otomatis lewat FK cascade saat packages dihapus.
  for (const tenantId of [tenantA, tenantB]) {
    if (!tenantId) continue;
    await db.delete(schema.departures).where(eq(schema.departures.tenantId, tenantId));
    await db.delete(schema.packages).where(eq(schema.packages.tenantId, tenantId));
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
let packagesReady = false;

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

async function needsPackages(name: string, fn: () => Promise<void>): Promise<void> {
  if (!packagesReady) {
    skip(name, "tabel `packages` belum ada di database (migrasi 0003 belum diterapkan)");
    return;
  }
  await fn();
}

async function main(): Promise<void> {
  try {
    await startServer();
    console.log("Setup data uji...");
    const { adminA, adminB, noperm } = await setup();

    if (!(await hasPermission(adminA.userId, "package.read", "tenant", tenantA))) {
      throw new Error("pre-kondisi gagal: admin A tidak memiliki package.read");
    }
    console.log("Pre-kondisi: admin A memiliki package.read.");

    packagesReady = await packagesTableExists();
    console.log(
      packagesReady
        ? "Pre-kondisi: tabel `packages` tersedia."
        : "BLOKIR: tabel `packages` TIDAK ADA di database.",
    );

    const list = (cookie: string, tenantId = tenantA) =>
      request("GET", `/api/tenant/paket?tenantId=${tenantId}`, cookie);

    console.log("\n--- Tanpa data paket (ditolak sebelum query) ---\n");
    record("PK-01: GET list tanpa session", (await list("")).status, 401);
    record("PK-02: GET list cookie palsu", (await list("better-auth.session_token=palsu")).status, 401);
    record("PK-03: GET list admin B dengan tenantId Tenant A", (await list(adminB.cookie, tenantA)).status, 404);
    record("PK-10: GET list oleh anggota aktif tanpa role", (await list(noperm.cookie)).status, 403);

    console.log("\n--- Endpoint HTTP dengan data paket ---\n");
    await needsPackages("PK-04: POST create admin A", async () => {
      const res = await request("POST", `/api/tenant/paket?tenantId=${tenantA}`, adminA.cookie, {
        code: `PKG-${TAG}`,
        name: `Paket Reguler ${TAG}`,
        priceIdr: 35000000,
        capacity: 40,
      });
      const body = res.body as { paket?: { id?: string } } | null;
      if (res.status === 201 && body?.paket?.id) {
        paketA = body.paket.id;
        ok("PK-04: POST create admin A → 201");
      } else {
        fail("PK-04: POST create admin A", `harus 201, dapat ${res.status} :: ${JSON.stringify(res.body)}`);
      }
    });

    await needsPackages("PK-05: POST code duplikat", async () => {
      record(
        "PK-05: POST code duplikat",
        (
          await request("POST", `/api/tenant/paket?tenantId=${tenantA}`, adminA.cookie, {
            code: `PKG-${TAG}`,
            name: `Duplikat ${TAG}`,
          })
        ).status,
        409,
      );
    });

    await needsPackages("PK-06: POST name kosong → 400", async () => {
      record(
        "PK-06: POST name kosong",
        (
          await request("POST", `/api/tenant/paket?tenantId=${tenantA}`, adminA.cookie, {
            code: `BAD-${TAG}`,
            name: "   ",
          })
        ).status,
        400,
      );
    });

    await needsPackages("PK-07: POST priceIdr negatif → 400", async () => {
      record(
        "PK-07: POST priceIdr negatif",
        (
          await request("POST", `/api/tenant/paket?tenantId=${tenantA}`, adminA.cookie, {
            code: `NEG-${TAG}`,
            name: `Negatif ${TAG}`,
            priceIdr: -1,
          })
        ).status,
        400,
      );
    });

    await needsPackages("PK-08: GET detail paket A lewat tenantId Tenant B", async () => {
      record(
        "PK-08: GET detail paket A lewat tenantId Tenant B",
        (await request("GET", `/api/tenant/paket/${paketA}?tenantId=${tenantB}`, adminA.cookie)).status,
        404,
      );
    });

    await needsPackages("PK-09: PATCH paket Tenant A oleh admin A", async () => {
      record(
        "PK-09: PATCH paket Tenant A",
        (
          await request("PATCH", `/api/tenant/paket/${paketA}?tenantId=${tenantA}`, adminA.cookie, {
            status: "published",
            priceIdr: 36000000,
          })
        ).status,
        200,
      );
    });

    await needsPackages("PK-11: isolasi daftar antartenant", async () => {
      // Admin B buat paket di Tenant B agar daftar B non-kosong.
      await request("POST", `/api/tenant/paket?tenantId=${tenantB}`, adminB.cookie, {
        code: `PKGB-${TAG}`,
        name: `Paket B ${TAG}`,
      });
      const res = await list(adminB.cookie, tenantB);
      const body = res.body as { rows?: { code?: string }[] } | null;
      if (res.status !== 200) {
        fail("PK-11: daftar Tenant B", `harus 200, dapat ${res.status}`);
      } else {
        const leaked = (body?.rows ?? []).some((r) => String(r.code ?? "").startsWith(`PKG-${TAG}`));
        leaked
          ? fail("PK-11: isolasi antartenant", "baris Tenant A terlihat di daftar Tenant B")
          : ok("PK-11: daftar Tenant B tidak memuat paket Tenant A");
      }
    });

    console.log("\n--- Keberangkatan ---\n");
    await needsPackages("PK-12: POST departure admin A", async () => {
      const res = await request(
        "POST",
        `/api/tenant/paket/${paketA}/departures?tenantId=${tenantA}`,
        adminA.cookie,
        {
          code: `DEP-${TAG}`,
          departOn: new Date(Date.now() + 86400000 * 30).toISOString(),
          returnOn: new Date(Date.now() + 86400000 * 40).toISOString(),
          capacity: 40,
        },
      );
      const body = res.body as { departure?: { id?: string } } | null;
      if (res.status === 201 && body?.departure?.id) {
        departureA = body.departure.id;
        ok("PK-12: POST departure admin A → 201");
      } else {
        fail("PK-12: POST departure admin A", `harus 201, dapat ${res.status} :: ${JSON.stringify(res.body)}`);
      }
    });

    await needsPackages("PK-13: POST departure code duplikat", async () => {
      record(
        "PK-13: POST departure code duplikat",
        (
          await request(
            "POST",
            `/api/tenant/paket/${paketA}/departures?tenantId=${tenantA}`,
            adminA.cookie,
            {
              code: `DEP-${TAG}`,
              departOn: new Date(Date.now() + 86400000 * 50).toISOString(),
            },
          )
        ).status,
        409,
      );
    });

    await needsPackages("PK-14: POST departure returnOn ≤ departOn → 400", async () => {
      record(
        "PK-14: POST departure returnOn ≤ departOn",
        (
          await request(
            "POST",
            `/api/tenant/paket/${paketA}/departures?tenantId=${tenantA}`,
            adminA.cookie,
            {
              code: `BAD-DEP-${TAG}`,
              departOn: new Date(Date.now() + 86400000 * 30).toISOString(),
              returnOn: new Date(Date.now() + 86400000 * 10).toISOString(),
            },
          )
        ).status,
        400,
      );
    });

    await needsPackages("PK-15: PATCH departure status → 200", async () => {
      record(
        "PK-15: PATCH departure status",
        (
          await request(
            "PATCH",
            `/api/tenant/paket/${paketA}/departures/${departureA}?tenantId=${tenantA}`,
            adminA.cookie,
            { status: "closed" },
          )
        ).status,
        200,
      );
    });

    await needsPackages("PK-17: PATCH departure milik Tenant B lewat Tenant A → 404", async () => {
      const madeB = await request(
        "POST",
        `/api/tenant/paket?tenantId=${tenantB}`,
        adminB.cookie,
        { code: `PKGB-DEP-${TAG}`, name: `B ${TAG}` },
      );
      const body = madeB.body as { paket?: { id?: string } } | null;
      const paketBId = body?.paket?.id ?? "";
      const depB = await request(
        "POST",
        `/api/tenant/paket/${paketBId}/departures?tenantId=${tenantB}`,
        adminB.cookie,
        { code: "D1", departOn: new Date(Date.now() + 86400000 * 90).toISOString() },
      );
      const depBody = depB.body as { departure?: { id?: string } } | null;
      const depBId = depBody?.departure?.id ?? "";
      record(
        "PK-17: departure Tenant B lewat tenantId Tenant A",
        (
          await request(
            "PATCH",
            `/api/tenant/paket/${paketBId}/departures/${depBId}?tenantId=${tenantA}`,
            adminA.cookie,
            { status: "closed" },
          )
        ).status,
        404,
      );
    });

    console.log("\n--- Cursor pagination (PK-16) ---\n");
    await needsPackages("PK-16: cursor pagination", async () => {
      // Buat 5 paket tambahan untuk Tenant B.
      for (let i = 0; i < 5; i++) {
        const res = await request("POST", `/api/tenant/paket?tenantId=${tenantB}`, adminB.cookie, {
          code: `CUR-${TAG}-${i}`,
          name: `Cursor ${TAG} ${i}`,
        });
        if (res.status !== 201) {
          fail("PK-16: membuat data cursor", `status ${res.status}`);
          return;
        }
      }
      const page1 = await request(
        "GET",
        `/api/tenant/paket?tenantId=${tenantB}&limit=3`,
        adminB.cookie,
      );
      const b1 = page1.body as { rows?: { id: string }[]; nextCursor?: string | null } | null;
      if (page1.status !== 200 || !b1?.nextCursor) {
        fail("PK-16: halaman 1", `harus 200 + nextCursor, dapat ${page1.status}`);
        return;
      }
      if ((b1.rows ?? []).length !== 3) {
        fail("PK-16: ukuran halaman 1", `harus 3, dapat ${(b1.rows ?? []).length}`);
        return;
      }
      const page2 = await request(
        "GET",
        `/api/tenant/paket?tenantId=${tenantB}&limit=3&cursor=${b1.nextCursor}`,
        adminB.cookie,
      );
      const b2 = page2.body as { rows?: { id: string }[] } | null;
      if (page2.status !== 200) {
        fail("PK-16: halaman 2", `harus 200, dapat ${page2.status}`);
        return;
      }
      const ids1 = new Set((b1.rows ?? []).map((r) => r.id));
      const overlap = (b2?.rows ?? []).some((r) => ids1.has(r.id));
      overlap
        ? fail("PK-16: halaman 2", "memuat baris yang sudah ada di halaman 1")
        : ok("PK-16: cursor pagination tanpa duplikasi");
    });

    console.log(`\n=== ${failures} TES GAGAL, ${blocked} BLOKIR ===`);
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
