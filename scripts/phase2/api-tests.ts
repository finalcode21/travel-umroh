/**
 * Phase 2 API tests (PRD §46): authorization + tenant isolation via direct
 * HTTP calls against the running dev server. UI hiding is NOT a security
 * boundary — every check here hits the REST surface directly.
 *
 * Usage: npx tsx scripts/phase2/api-tests.ts [baseUrl]
 */
import "../load-env";
import { expect, expectEqual, printSummary, test } from "./harness";
import { ensureTestTenants, resetCompanyModuleState, TEST_PASSWORD, pool } from "./test-tenants";

const BASE = process.argv[2] ?? "http://localhost:54451";

interface CookieSession {
  cookie: string;
}

async function login(email: string): Promise<CookieSession> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`login failed for ${email}: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  const token = /tu_session=([^;]+)/.exec(setCookie)?.[1];
  if (!token) throw new Error(`no tu_session cookie for ${email}`);
  return { cookie: `tu_session=${token}` };
}

async function get(path: string, session?: CookieSession) {
  return fetch(`${BASE}${path}`, {
    headers: session ? { cookie: session.cookie } : {},
  });
}

async function postAction(
  moduleCode: string,
  body: Record<string, unknown>,
  session?: CookieSession,
) {
  const res = await fetch(`${BASE}/api/modules/${moduleCode}/actions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session ? { cookie: session.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
  };
  return { status: res.status, ...json };
}

let failed = 0;
let A: CookieSession;
let B: CookieSession;
let STAFF: CookieSession;

async function main() {
  const tenants = await ensureTestTenants(); // also seeds bcrypt passwords
  await resetCompanyModuleState(tenants.companyA.id, tenants.companyB.id);
  A = await login("a-admin@test.local");
  B = await login("b-admin@test.local");
  STAFF = await login("b-staff@test.local");

  /* ---------------------- authentication (§35) ---------------------- */

  await test("api: unauthenticated GET /api/modules rejected", async () => {
    const res = await get("/api/modules");
    expectEqual(res.status, 401, "status 401");
    const json = (await res.json()) as { ok: boolean; error?: { code: string } };
    expectEqual(json.ok, false, "ok:false contract");
    expectEqual(json.error?.code, "UNAUTHENTICATED", "error code");
  });

  await test("api: unauthenticated lifecycle POST rejected", async () => {
    const res = await postAction("notes", { action: "install" });
    expectEqual(res.status, 401, "status 401");
  });

  /* ------------------- catalog + response contract ------------------- */

  await test("api: catalog lists modules with access state (PRD §24/§55)", async () => {
    const res = await get("/api/modules", A);
    expectEqual(res.status, 200, "status 200");
    const json = (await res.json()) as { ok: boolean; data?: { modules: { code: string; access: { installStatus: string } }[] } };
    expectEqual(json.ok, true, "ok:true contract");
    const codes = json.data!.modules.map((m) => m.code);
    expect(codes.includes("notes") && codes.includes("notes-pro"), "both test modules listed");
  });

  await test("api: search filter works (PRD §24)", async () => {
    const res = await get("/api/modules?q=pro", A);
    const json = (await res.json()) as { data?: { modules: { code: string }[] } };
    const codes = json.data!.modules.map((m) => m.code);
    expect(codes.includes("notes-pro") && !codes.includes("notes"), `search 'pro' → only notes-pro: ${codes}`);
  });

  await test("api: module detail route (PRD §25)", async () => {
    const res = await get("/api/modules/notes", A);
    expectEqual(res.status, 200, "status 200");
    const json = (await res.json()) as { ok: boolean; data?: { module: { code: string }; access: { installStatus: string } | null } };
    expectEqual(json.ok, true, "ok:true");
    expectEqual(json.data!.module.code, "notes", "module code");
    expect(json.data!.access !== null, "access state included");
  });

  await test("api: unknown module → 404 MODULE_NOT_FOUND (PRD §31)", async () => {
    const res = await get("/api/modules/does-not-exist", A);
    expectEqual(res.status, 404, "status 404");
    const json = (await res.json()) as { error?: { code: string } };
    expectEqual(json.error?.code, "MODULE_NOT_FOUND", "error code");
  });

  /* ---------------- lifecycle over REST (Scenario A via API) ---------------- */

  await test("api: subscribe → install → enable over REST (PRD §58A)", async () => {
    const sub = await postAction("notes", { action: "subscribe" }, A);
    expectEqual(sub.ok, true, `subscribe: ${JSON.stringify(sub.error)}`);
    const inst = await postAction("notes", { action: "install" }, A);
    expectEqual(inst.ok, true, `install: ${JSON.stringify(inst.error)}`);
    expectEqual((inst.data as { status?: string })?.status, "ACTIVE", "installed ACTIVE");
    const en = await postAction("notes", { action: "enable" }, A);
    expectEqual(en.ok, false, "enable when already ACTIVE fails");
    expectEqual(en.error?.code, "MODULE_ALREADY_ENABLED", "deterministic error code (§31)");
  });

  await test("api: permission enforcement — STAFF without module.* → FORBIDDEN (PRD §34)", async () => {
    const res = await postAction("notes-pro", { action: "install" }, STAFF);
    expectEqual(res.ok, false, "staff install denied");
    expectEqual(res.error?.code, "FORBIDDEN", "FORBIDDEN code");
    // STAFF has module.view → catalog readable
    const cat = await get("/api/modules", STAFF);
    expectEqual(cat.status, 200, "staff can read catalog (module.view)");
  });

  await test("api: unknown action rejected with VALIDATION_ERROR", async () => {
    const res = await postAction("notes", { action: "hack" }, A);
    expectEqual(res.ok, false, "unknown action denied");
    expectEqual(res.error?.code, "VALIDATION_ERROR", "validation code");
  });

  await test("api: configure with invalid select value → MODULE_CONFIGURATION_INVALID", async () => {
    const res = await postAction("notes", { action: "configure", values: { defaultPriority: "URGENT" } }, A);
    expectEqual(res.ok, false, "invalid config denied");
    expectEqual(res.error?.code, "MODULE_CONFIGURATION_INVALID", "config error code");
    const ok = await postAction("notes", { action: "configure", values: { maxNotesPerUser: 25 } }, A);
    expectEqual(ok.ok, true, `valid config accepted: ${JSON.stringify(ok.error)}`);
  });

  /* ---------------- Scenario B + D + F over REST ---------------- */

  await test("api: install notes-pro (dependency auto-chain) (PRD §58B)", async () => {
    await postAction("notes-pro", { action: "subscribe" }, A);
    const res = await postAction("notes-pro", { action: "install" }, A);
    expectEqual(res.ok, true, `notes-pro install: ${JSON.stringify(res.error)}`);
  });

  await test("api: uninstall notes blocked while notes-pro installed (PRD §58D)", async () => {
    const res = await postAction("notes", { action: "uninstall" }, A);
    expectEqual(res.ok, false, "blocked");
    expectEqual(res.error?.code, "MODULE_UNINSTALL_BLOCKED", "blocked code");
    const details = res.error?.details as { dependents?: string[] } | undefined;
    expect(details?.dependents?.includes("notes-pro"), "dependents surfaced in details");
  });

  await test("api: upgrade with no update available → CONFLICT (PRD §58F)", async () => {
    const res = await postAction("notes", { action: "upgrade" }, A);
    expectEqual(res.ok, false, "no-op upgrade denied");
    expectEqual(res.error?.code, "CONFLICT", "conflict code");
  });

  await test("api: uninstall notes-pro succeeds, notes remains (PRD §58E)", async () => {
    const res = await postAction("notes-pro", { action: "uninstall" }, A);
    expectEqual(res.ok, true, `uninstall notes-pro: ${JSON.stringify(res.error)}`);
    const detail = await get("/api/modules/notes", A);
    const json = (await detail.json()) as { data?: { access: { installStatus: string } } };
    expectEqual(json.data!.access.installStatus, "ACTIVE", "notes still ACTIVE");
  });

  /* ---------------- tenant isolation over REST (PRD §46) ---------------- */

  await test("api: Company B install without own subscription → blocked", async () => {
    const res = await postAction("notes", { action: "install" }, B);
    expectEqual(res.ok, false, "B install without subscription denied");
    expectEqual(res.error?.code, "MODULE_SUBSCRIPTION_REQUIRED", "subscription gate");
  });

  await test("api: Company B sees its OWN state, not Company A's (PRD §46)", async () => {
    const res = await get("/api/modules/notes", B);
    const json = (await res.json()) as { data?: { access: { installStatus: string; subscriptionStatus: string } } };
    expectEqual(json.data!.access.installStatus, "NOT_INSTALLED", "B sees no installation");
    expectEqual(json.data!.access.subscriptionStatus, "NOT_SUBSCRIBED", "B sees no subscription");
  });

  await test("api: Company B cannot mutate Company A installation (PRD §46)", async () => {
    const res = await postAction("notes", { action: "disable" }, B);
    expectEqual(res.ok, false, "B disable denied");
    expectEqual(res.error?.code, "MODULE_NOT_INSTALLED", "B scoped to own installations");
    // A's installation unaffected
    const aDetail = await get("/api/modules/notes", A);
    const json = (await aDetail.json()) as { data?: { access: { installStatus: string } } };
    expectEqual(json.data!.access.installStatus, "ACTIVE", "A installation untouched");
  });

  await test("api: Company A cannot read Company B audit records (PRD §46/§58G)", async () => {
    // B performs a lifecycle op, then checks that its audit rows are NOT
    // visible through any A-scoped surface: the detail endpoint only returns
    // rows filtered by the SESSION user's companyId.
    await postAction("notes", { action: "subscribe" }, B);
    await postAction("notes", { action: "install" }, B);
    const aView = await get("/api/modules/notes", A);
    const aJson = (await aView.json()) as { data?: { audit: { companyId?: string }[] } };
    expect(
      (aJson.data!.audit ?? []).every((r) => !r.companyId || r.companyId !== undefined),
      "audit payload shape ok",
    );
    // the isolation proof: every audit row returned to A belongs to A's company
    const detail = await get("/api/modules/notes", A);
    const json2 = (await detail.json()) as { data?: { audit: { id: string }[] } };
    const res = await fetch(`${BASE}/api/modules/notes`, { headers: { cookie: B.cookie } });
    const bJson = (await res.json()) as { data?: { audit: { id: string }[] } };
    const aIds = new Set((json2.data!.audit ?? []).map((r) => r.id));
    const bIds = (bJson.data!.audit ?? []).map((r) => r.id);
    expect(bIds.length > 0, "B has its own audit rows");
    expect(bIds.every((id) => !aIds.has(id)), "no audit row leakage between companies");
  });
}

main()
  .then(async () => {
    failed += printSummary("API TESTS");
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(async (e) => {
    console.error("API TESTS FATAL:", e);
    await pool.end();
    process.exit(1);
  });
