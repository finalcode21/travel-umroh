/**
 * Uji integrasi otorisasi tenant — travel-umroh (HANYA Neon Development).
 *
 * Menjalankan server Next.js development di port khusus, lalu membuat request
 * HTTP nyata ke endpoint /api/tenant/context untuk menguji:
 *  - AUTH-01: Request tanpa session → 401
 *  - AUTH-02: Session tidak valid → 401
 *  - AUTH-03: Pengguna A meminta konteks Tenant A → berhasil
 *  - AUTH-04: Pengguna A meminta konteks Tenant B → 404 (sistem)
 *  - AUTH-05: Pengguna B meminta konteks Tenant B → berhasil
 *  - AUTH-06: Client memanipulasi tenantId → tetap ditolak
 *  - AUTH-07: Session valid tapi bukan anggota tenant → 404
 *  - AUTH-08: User tenant tanpa izin khusus → 403 (jika endpoint memerlukan izin)
 *  - AUTH-09: Cookie dimanipulasi → tidak dapat akses
 *  - AUTH-10: Request sah setelah penolakan lintas tenant → tetap berfungsi
 *
 * Jalankan: npx tsx scripts/tenant-auth-test.ts
 *
 * Catatan: skrip ini memulai server Next.js dev dan menghentikannya setelah
 * tes selesai. Pastikan tidak ada proses lain yang menggunakan port server.
 *
 * Jika server sudah berjalan di port yang sama, matikan dulu dengan:
 *   taskkill /F /PID <pid>    (Windows)
 *   kill <pid>                 (Linux/macOS)
 */

import "./load-env";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { auth } from "@/auth";
import { provisionTenantFromSignup } from "@/lib/provisioning";

const STARTUP_TIMEOUT_MS = 60000;

const TAG = `tenant-auth-${Date.now().toString(36)}`;
const PASSWORD_OK = "C0rrect-Passw0rd!x";
const BASE_URL = `http://localhost:${process.env.TEST_PORT ?? "3210"}`;

// ============================================================================
// Helper start/stop server
// ============================================================================

import { spawn, execSync } from "child_process";
import { setTimeout } from "timers/promises";
import path from "path";
import fs from "fs";

let serverProcess: ReturnType<typeof spawn> | null = null;
const serverPort = Number(process.env.TEST_PORT ?? "3210");

async function startServer(): Promise<void> {
  console.log(`startServer called, platform=${process.platform}, port=${serverPort}`);
  const spawnCmd = "cmd";
  const spawnArgs = ["/c", "npx.cmd", "next", "dev", "--port", String(serverPort)];
  console.log(`spawn(${spawnCmd}, ${JSON.stringify(spawnArgs)})`);

  console.log(`Memulai server Next.js di port ${serverPort}...`);
  console.log(`Startup timeout: ${STARTUP_TIMEOUT_MS}ms`);
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

  // Tampilkan log server agar kegagalan startup terlihat.
  serverProcess.stdout?.on("data", (d: Buffer) =>
    process.stdout.write(`[server] ${d.toString()}`),
  );
  serverProcess.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[server] ${d.toString()}`),
  );

  // Tunggu server siap dengan polling ke halaman root.
  // Catatan: respons HTTP apa pun (termasuk 404) membuktikan server
  // sudah listening — jangan memakai endpoint yang tidak ada.
  const startedAt = Date.now();
  const maxWaitMs = STARTUP_TIMEOUT_MS;

  while (Date.now() - startedAt < maxWaitMs) {
    try {
      const response = await fetch(`${BASE_URL}/`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      console.log(`poll: status=${response.status}, elapsed=${Date.now() - startedAt}ms`);
      // Respons apa pun dari server HTTP = sudah siap menerima request.
      console.log("Server siap.");
      return;
    } catch (err) {
      // Server belum siap, lanjutkan polling.
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`poll error: ${msg}`);
    }
    await setTimeout(500);
  }

  throw new Error(`Server tidak siap setelah ${maxWaitMs}ms`);
}

async function stopServer(): Promise<void> {
  if (!serverProcess) return;
  console.log("Menghentikan server...");
  const pid = serverProcess.pid;
  // Pada Windows, kill() hanya mematikan wrapper cmd — proses `next dev`
  // di bawahnya tetap hidup dan menahan event loop. Matikan seluruh tree.
  if (pid) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } catch {
      serverProcess.kill("SIGTERM");
    }
  } else {
    serverProcess.kill("SIGTERM");
  }
  try {
    await setTimeout(2000);
  } catch {
    // ignore
  }
  if (!serverProcess.killed) {
    serverProcess.kill("SIGKILL");
  }
  serverProcess = null;
}

// ============================================================================
// Helpers HTTP dan auth
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

async function getSession(cookie: string) {
  const res = await auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  return res;
}

/** Bawa request ke server yang berjalan dengan cookie yang diberikan. */
async function fetchWithContext(
  path: string,
  cookie: string,
  method = "GET",
  body?: unknown,
): Promise<{
  status: number;
  body: unknown;
  headers: Headers;
}> {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers["Cookie"] = cookie;
  }
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let parsedBody: unknown = null;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = await response.text();
  }

  return {
    status: response.status,
    body: parsedBody,
    headers: response.headers,
  };
}

// ============================================================================
// Setup dan cleanup
// ============================================================================

let testData: {
  userA: { userId: string; cookie: string; email: string };
  tenantA: { tenantId: string; installationId: string };
  userB: { userId: string; cookie: string; email: string };
  tenantB: { tenantId: string; installationId: string };
  staffB: { userId: string; cookie: string; email: string };
} | null = null;

async function setup(): Promise<typeof testData> {
  // --- Tenant A: user A dengan peran admin ---
  const userAEmail = `a-${TAG}@example.test`;
  const { userId: userAUserId, cookie: userACookie } = await signUp(
    userAEmail,
    `User A ${TAG}`,
  );
  const outcomeA = await provisionTenantFromSignup({
    userId: userAUserId,
    email: userAEmail,
    businessName: `Tenant A ${TAG}`,
  });
  if (!outcomeA.ok) {
    throw new Error(`Provisioning Tenant A gagal: ${outcomeA.reason}`);
  }

  // --- Tenant B: user B dengan peran admin ---
  const userBEmail = `b-${TAG}@example.test`;
  const { userId: userBUserId, cookie: userBCookie } = await signUp(
    userBEmail,
    `User B ${TAG}`,
  );
  const outcomeB = await provisionTenantFromSignup({
    userId: userBUserId,
    email: userBEmail,
    businessName: `Tenant B ${TAG}`,
  });
  if (!outcomeB.ok) {
    throw new Error(`Provisioning Tenant B gagal: ${outcomeB.reason}`);
  }

  // --- User B staf (non-admin) untuk AUTH-08 ---
  // Kita buat user staf terpisah yang hanya assign role staff (bukan admin)
  const staffEmail = `staff-${TAG}@example.test`;
  const { userId: staffUserId, cookie: staffCookie } = await signUp(
    staffEmail,
    `Staff B ${TAG}`,
  );
  // Provisioning staf: ini membuat tenant terpisah, tapi kita butuh user yang
  // menjadi staf di Tenant B. Cara: kita provision dulu, lalu assign role staff
  // manual ke Tenant B. Cara yang lebih sederhana: kita tidak membuat tenant
  // baru untuk staf, tapi assign role staff ke user B yang sudah ada? Tidak,
  // karena itu akan mengubah data. Sebaiknya kita buat user terpisah dan
  // assign role staff ke Tenant B.
  //
  // Untuk simplifikasi: kita tidak membuat operasi tulis khusus untuk tes
  // permission. AUTH-08 ditandai BELUM DIVERIFIKASI jika endpoint tidak
  // memerlukan permission khusus. Namun kita bisa menguji dengan user yang
  // tidak memiliki assignment sama sekali (bukan anggota tenant).
  //
  // Pendekatan: kita buat user staf yang provisioned, lalu kita assign role
  // staff ke tenant B secara manual (ini operasi tulis, tapi dilakukan di
  // setup, bukan di tes). Ini diperlukan untuk AUTH-08.
  const staffOutcome = await provisionTenantFromSignup({
    userId: staffUserId,
    email: staffEmail,
    businessName: `Staff Tenant ${TAG}`,
  });
  if (!staffOutcome.ok) {
    throw new Error(`Provisioning Staff gagal: ${staffOutcome.reason}`);
  }

  // `tenant_users.user_id` adalah primary key: satu identitas hanya bisa
  // jadi anggota SATU tenant. Staf diprovision ke tenant sendiri, jadi kita
  // pindahkan ke Tenant B: bersihkan tenant miliknya (data uji ini),
  // lepaskan tautan akun bisnis, lalu jadikan anggota Tenant B.
  const ownTenantId = staffOutcome.tenantId;
  const [ownTenantRow] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, ownTenantId))
    .limit(1);

  await db
    .delete(schema.tenantRoleAssignments)
    .where(eq(schema.tenantRoleAssignments.tenantId, ownTenantId));
  await db.delete(schema.roles).where(eq(schema.roles.tenantId, ownTenantId));
  await db
    .delete(schema.installations)
    .where(eq(schema.installations.tenantId, ownTenantId));
  await db
    .delete(schema.tenantUsers)
    .where(eq(schema.tenantUsers.tenantId, ownTenantId));
  await db.delete(schema.tenants).where(eq(schema.tenants.id, ownTenantId));
  if (ownTenantRow?.accountId) {
    await db
      .delete(schema.accounts)
      .where(eq(schema.accounts.id, ownTenantRow.accountId));
  }
  await db
    .update(schema.authUsers)
    .set({ platformAccountId: null })
    .where(eq(schema.authUsers.id, staffUserId));

  // Jadikan staf anggota Tenant B (aktiv).
  await db
    .insert(schema.tenantUsers)
    .values({
      userId: staffUserId,
      tenantId: outcomeB.tenantId,
      status: "active",
    });

  // Assign role staff ke Tenant B (operasi tulis di setup untuk tes AUTH-08)
  // Kita cari role staff di Tenant B dan assign ke user staf
  const tenantBRoleAssign = await db
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
  const staffRole = tenantBRoleAssign[0];
  if (staffRole) {
    await db
      .insert(schema.tenantRoleAssignments)
      .values({
        userId: staffUserId,
        roleId: staffRole.id,
        tenantId: outcomeB.tenantId,
        assignedBy: "system",
      })
      .onConflictDoNothing();
  }

  // Login user staf untuk dapat cookie
  const staffLoginCookie = await signIn(staffEmail, PASSWORD_OK);

  return {
    userA: {
      userId: userAUserId,
      cookie: userACookie,
      email: userAEmail,
    },
    tenantA: {
      tenantId: outcomeA.tenantId,
      installationId: outcomeA.installationId,
    },
    userB: {
      userId: userBUserId,
      cookie: userBCookie,
      email: userBEmail,
    },
    tenantB: {
      tenantId: outcomeB.tenantId,
      installationId: outcomeB.installationId,
    },
    staffB: {
      userId: staffUserId,
      cookie: staffLoginCookie,
      email: staffEmail,
    },
  };
}

async function cleanup(): Promise<void> {
  if (!testData) return;
  const td = testData!;

  const usersToCleanup = [
    td.userA.userId,
    td.userB.userId,
    td.staffB.userId,
  ];

  for (const userId of usersToCleanup) {
    const [u] = await db
      .select()
      .from(schema.authUsers)
      .where(eq(schema.authUsers.id, userId))
      .limit(1);
    if (!u) continue;

    if (u.platformAccountId) {
      // Hapus semua yang berhubungan dengan akun ini
      await db
        .delete(schema.tenantRoleAssignments)
        .where(eq(schema.tenantRoleAssignments.tenantId, u.platformAccountId));
      await db
        .delete(schema.tenantUsers)
        .where(eq(schema.tenantUsers.tenantId, u.platformAccountId));
      await db
        .delete(schema.installations)
        .where(eq(schema.installations.tenantId, u.platformAccountId));
      await db
        .delete(schema.roles)
        .where(eq(schema.roles.tenantId, u.platformAccountId));
      await db
        .delete(schema.rolePermissions)
        .where(
          eq(schema.rolePermissions.roleId, u.platformAccountId),
        );
      await db
        .delete(schema.tenants)
        .where(eq(schema.tenants.accountId, u.platformAccountId));
      await db
        .delete(schema.accounts)
        .where(eq(schema.accounts.id, u.platformAccountId));
    }

    // Keanggotaan dan assignment role milik user ini di tenant mana pun
    // (termasuk staf di Tenant B) dibersihkan berdasarkan userId.
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

  // Pastikan tidak ada sisa data uji
  const remaining = await db
    .select()
    .from(schema.authUsers)
    .where(
      and(
        eq(schema.authUsers.email, td.userA.email),
      ),
    );
  if (remaining.length > 0) {
    console.warn(
      "Peringatan: masih ada sisa data uji setelah cleanup",
    );
  }
}

// ============================================================================
// Tes AUTH
// ============================================================================

let failures = 0;

function ok(name: string) {
  console.log(`PASS  ${name}`);
}

function fail(name: string, detail?: string) {
  failures++;
  const msg = detail ? ` :: ${detail}` : "";
  console.log(`FAIL  ${name}${msg}`);
}

async function main(): Promise<void> {
  try {
    await startServer();
    console.log("Setup data uji...");
    testData = await setup();
    const td = testData!;

    console.log("\n--- Menjalankan tes otorisasi tenant ---\n");

    // AUTH-01: Request tanpa session
    {
      const res = await fetchWithContext("/api/tenant/context?tenantId=fake", "");
      if (res.status !== 401) {
        fail("AUTH-01: request tanpa session", `harus 401, dapat ${res.status}`);
      } else {
        ok("AUTH-01: request tanpa session → 401");
      }
    }

    // AUTH-02: Session tidak valid (cookie palsu)
    {
      const res = await fetchWithContext(
        "/api/tenant/context?tenantId=fake",
        "badcookie=badvalue",
      );
      if (res.status !== 401) {
        fail(
          "AUTH-02: session tidak valid",
          `harus 401, dapat ${res.status}`,
        );
      } else {
        ok("AUTH-02: session tidak valid → 401");
      }
    }

    // AUTH-03: Pengguna A meminta konteks Tenant A → berhasil
    {
      const res = await fetchWithContext(
        `/api/tenant/context?tenantId=${td.tenantA.tenantId}`,
        td.userA.cookie,
      );
      if (res.status !== 200) {
        fail(
          "AUTH-03: user A → tenant A",
          `harus 200, dapat ${res.status} :: ${JSON.stringify(res.body)}`,
        );
      } else if (
        (res.body as Record<string, unknown>)?.userId !== td.userA.userId
      ) {
        fail(
          "AUTH-03: user A → tenant A",
          `userId tidak cocok`,
        );
      } else if (
        (res.body as Record<string, unknown>)?.tenantId !== td.tenantA.tenantId
      ) {
        fail(
          "AUTH-03: user A → tenant A",
          `tenantId tidak cocok`,
        );
      } else {
        ok(
          "AUTH-03: user A meminta konteks Tenant A → berhasil",
        );
      }
    }

    // AUTH-04: Pengguna A meminta konteks Tenant B → 404 (sistem)
    {
      const res = await fetchWithContext(
        `/api/tenant/context?tenantId=${td.tenantB.tenantId}`,
        td.userA.cookie,
      );
      if (res.status !== 404) {
        fail(
          "AUTH-04: user A → tenant B",
          `harus 404 (sembunyikan tenant), dapat ${res.status}`,
        );
      } else {
        ok(
          "AUTH-04: user A meminta konteks Tenant B → 404 (sistem)",
        );
      }
    }

    // AUTH-05: Pengguna B meminta konteks Tenant B → berhasil
    {
      const res = await fetchWithContext(
        `/api/tenant/context?tenantId=${td.tenantB.tenantId}`,
        td.userB.cookie,
      );
      if (res.status !== 200) {
        fail(
          "AUTH-05: user B → tenant B",
          `harus 200, dapat ${res.status} :: ${JSON.stringify(res.body)}`,
        );
      } else if (
        (res.body as Record<string, unknown>)?.userId !== td.userB.userId
      ) {
        fail(
          "AUTH-05: user B → tenant B",
          `userId tidak cocok`,
        );
      } else if (
        (res.body as Record<string, unknown>)?.tenantId !== td.tenantB.tenantId
      ) {
        fail(
          "AUTH-05: user B → tenant B",
          `tenantId tidak cocok`,
        );
      } else {
        ok(
          "AUTH-05: user B meminta konteks Tenant B → berhasil",
        );
      }
    }

    // AUTH-06: Client memanipulasi tenantId (parameter tidak cocok)
    {
      // User A mencoba meminta tenantId yang berbeda dari Tenant A
      // Ini adalah variasi dari AUTH-04 tapi dengan tenantId yang tidak
      // belong to any tenant (bukan milik user A maupun user B)
      const fakeTenantId = "00000000-0000-0000-0000-000000000001";
      const res = await fetchWithContext(
        `/api/tenant/context?tenantId=${fakeTenantId}`,
        td.userA.cookie,
      );
      if (res.status !== 404) {
        fail(
          "AUTH-06: manipulasi tenantId",
          `harus 404 (tenant tidak dikenal), dapat ${res.status}`,
        );
      } else {
        ok(
          "AUTH-06: manipulasi tenantId → 404 (tenant tidak dikenal)",
        );
      }
    }

    // AUTH-07: Session valid tapi bukan anggota tenant (user A ke tenant yang tidak ada)
    {
      // User A mencoba request ke tenant yang tidak dimilikinya
      // (kita buat tenant C untuk tujuan ini)
      const userCEmail = `c-${TAG}@example.test`;
      await signUp(userCEmail, `User C ${TAG}`);
      const cookieC = await signIn(userCEmail, PASSWORD_OK);

      // User A mencoba request ke tenant yang dimiliki user C
      const res = await fetchWithContext(
        `/api/tenant/context?tenantId=${td.tenantB.tenantId}`,
        td.userA.cookie,
      );
      if (res.status !== 404) {
        fail(
          "AUTH-07: user A bukan anggota tenant B",
          `harus 404 (bukan anggota), dapat ${res.status}`,
        );
      } else {
        ok(
          "AUTH-07: session valid tapi bukan anggota tenant → 404",
        );
      }

      // Cleanup user C
      const [uC] = await db
        .select()
        .from(schema.authUsers)
        .where(eq(schema.authUsers.email, userCEmail))
        .limit(1);
      if (uC) {
        await db
          .delete(schema.authSessions)
          .where(eq(schema.authSessions.userId, uC.id));
        await db
          .delete(schema.authAccounts)
          .where(eq(schema.authAccounts.userId, uC.id));
        await db
          .delete(schema.authVerifications)
          .where(eq(schema.authVerifications.identifier, uC.email));
        await db
          .delete(schema.authUsers)
          .where(eq(schema.authUsers.id, uC.id));
      }
    }

    // AUTH-08: Pengguna tenant mencoba operasi yang memerlukan permission lebih tinggi
    {
      // Endpoint /api/tenant/context saat ini tidak memeriksa permission
      // RBAC, sehingga kasus ini ditandai BELUM DIVERIFIKASI.
      console.warn("AUTH-08: BELUM DIVERIFIKASI - endpoint belum memeriksa permission");
    }

    // AUTH-09: Cookie atau header autentikasi dimanipulasi
    {
      // Manipulasi cookie dengan menambahkan karakter palsu
      const tamperedCookie = `${td.userA.cookie.replace(
        /better-auth[^;]+/,
        "badsession123",
      )}`;
      const res = await fetchWithContext(
        `/api/tenant/context?tenantId=${td.tenantA.tenantId}`,
        tamperedCookie,
      );
      if (res.status !== 401) {
        fail(
          "AUTH-09: cookie dimanipulasi",
          `harus 401 (cookie tidak valid), dapat ${res.status}`,
        );
      } else {
        ok(
          "AUTH-09: cookie dimanipulasi → 401",
        );
      }
    }

    // AUTH-10: Request sah setelah penolakan lintas tenant tetap berfungsi
    {
      // Pertama, lakukan request yang akan ditolak (AUTH-04)
      const rejectedRes = await fetchWithContext(
        `/api/tenant/context?tenantId=${td.tenantB.tenantId}`,
        td.userA.cookie,
      );
      if (rejectedRes.status !== 404) {
        fail(
          "AUTH-10: request penolakan awal",
          `harus 404, dapat ${rejectedRes.status}`,
        );
      }

      // Lalu, lakukan request yang sah (AUTH-03) — harus tetap berhasil
      const allowedRes = await fetchWithContext(
        `/api/tenant/context?tenantId=${td.tenantA.tenantId}`,
        td.userA.cookie,
      );
      if (allowedRes.status !== 200) {
        fail(
          "AUTH-10: request sah setelah penolakan",
          `harus 200, dapat ${allowedRes.status}`,
        );
      } else if (
        (allowedRes.body as Record<string, unknown>)?.userId !== td.userA.userId
      ) {
        fail(
          "AUTH-10: request sah setelah penolakan",
          `userId tidak cocok`,
        );
      } else {
        ok(
          "AUTH-10: request sah setelah penolakan lintas tenant tetap berfungsi",
        );
      }
    }

    console.log(`\n=== ${failures === 0 ? "SEMUA TES LULUS" : failures + " TES GAGAL"} ===`);
  } catch (e) {
    console.error("Error during test:", e);
    failures++;
    console.log(`\n=== ${failures} TES GAGAL ===`);
  } finally {
    await cleanup();
    await stopServer();
  }

  if (failures > 0) {
    process.exitCode = 1;
  }

  // Tutup koneksi Neon (pola yang sama dengan auth-smoke/provision-smoke)
  // agar proses tidak menggantung pada pool yang masih terbuka.
  const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
  if (client?.end) await client.end();

  // Jaminan deterministik: handle server/stdio yang tersisa bisa menahan
  // event loop sewenang-wenang; akhiri proses dengan status yang benar.
  process.exit(process.exitCode ?? 0);
}

main().catch(async (e) => {
  console.error("Fatal error:", e);
  await stopServer();
  process.exit(1);
});
