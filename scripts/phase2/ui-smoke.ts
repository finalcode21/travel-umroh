/** UI smoke: marketplace pages render for a company session (Phase 2 §24/§42). */
import "../load-env";
import { ensureTestTenants, TEST_PASSWORD, pool } from "./test-tenants";

async function main() {
  await ensureTestTenants();
  const base = process.argv[2] ?? "http://localhost:54451";
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "a-admin@test.local", password: TEST_PASSWORD }),
  });
  const cookie = (/tu_session=([^;]+)/.exec(login.headers.get("set-cookie") ?? "") ?? [])[1];
  if (!cookie) throw new Error("no session cookie");

  for (const path of ["/apps", "/apps/notes", "/apps/notes-pro", "/dashboard", "/m/notes"]) {
    const res = await fetch(`${base}${path}`, {
      headers: { cookie: `tu_session=${cookie}` },
      redirect: "follow",
    });
    const html = await res.text();
    const hasError = html.includes("Application error") || html.includes("Internal Server Error");
    console.log(
      `${res.status === 200 && !hasError ? "OK  " : "FAIL"} ${path} → ${res.status}${hasError ? " (error boundary)" : ""}`,
    );
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
