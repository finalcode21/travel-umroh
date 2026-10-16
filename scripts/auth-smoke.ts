/**
 * Smoke test Better Auth — travel-umroh (HANYA Neon Development).
 *
 * Yang diuji: signUpEmail, signInEmail, getSession, signOut, kasus negatif
 * (password salah, email duplikat), lalu bersih-bersih data uji.
 * Output tidak pernah menampilkan password, token, cookie, atau connection string.
 *
 * Jalankan: npx -y tsx scripts/auth-smoke.ts
 */import "./load-env";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";

import { auth } from "@/auth";

const TAG = `umroh-smoke-${Date.now().toString(36)}`;
const EMAIL = `${TAG}@example.test`;
const PASSWORD_OK = "C0rrect-Passw0rd!x";
const PASSWORD_BAD = "salah-total-1234";


let failures = 0;
function ok(name: string) {
  console.log(`PASS  ${name}`);
}
function fail(name: string, err?: unknown) {
  failures++;
  const msg = err instanceof Error ? err.message.replace(/[^\x20-\x7E]/g, "").slice(0, 200) : String(err);
  console.log(`FAIL  ${name} :: ${err ? msg : "(tanpa detail)"}`);
}

async function main() {
  // --- 1. Registrasi akun uji -------------------------------------------
  let cookie = "";
  try {
    const res = await auth.api.signUpEmail({
      body: { email: EMAIL, password: PASSWORD_OK, name: `Smoke ${TAG}` },
      returnHeaders: true,
    });
    cookie = [...res.headers.getSetCookie()].join("; ");
    if (res.response.user.email !== EMAIL) throw new Error("email registrasi tidak sesuai");
    ok("signUpEmail membuat akun uji");
  } catch (e) {
    fail("signUpEmail membuat akun uji", e);
    throw e;
  }

  // --- 2. Baris benchmark di DB (tidak menampilkan isi kolom sensitif) ---
  try {
    const [u] = await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, EMAIL));
    if (!u) throw new Error("auth_users tidak berisikan baris baru");
    const creds = await db.select().from(schema.authAccounts).where(eq(schema.authAccounts.userId, u.id));
    if (creds.length !== 1 || creds[0].providerId !== "credential" || !creds[0].password) {
      throw new Error(`baris credential tidak wajar (count=${creds.length})`);
    }
    ok("auth_users + auth_accounts (credential, password ter-hash) tersimpan");
  } catch (e) {
    fail("auth_users + auth_accounts tersimpan", e);
  }

  // --- 3. Registrasi duplikat harus gagal -------------------------------
  try {
    await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD_OK, name: "dup" } });
    fail("signUpEmail duplikat harus gagal", "malah berhasil");
  } catch {
    ok("signUpEmail duplikat ditolak");
  }

  // --- 4. Login password salah harus gagal ------------------------------
  try {
    await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD_BAD } });
    fail("signInEmail password salah harus gagal", "malah berhasil");
  } catch {
    ok("signInEmail password salah ditolak");
  }

  // --- 5. Login benar → cookie session ---------------------------------
  try {
    const res = await auth.api.signInEmail({
      body: { email: EMAIL, password: PASSWORD_OK },
      returnHeaders: true,
    });
    cookie = [...res.headers.getSetCookie()].join("; ");
    if (!cookie.toLowerCase().includes("better-auth")) throw new Error("cookie session tidak di-yield");
    ok("signInEmail password benar memberi cookie session");
  } catch (e) {
    fail("signInEmail password benar", e);
  }

  // --- 6. getSession valid ---------------------------------------------
  let sessionValid = false;
  try {
    const s = await auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!s || s.user.email !== EMAIL) throw new Error("session/getSession tidak valid");
    sessionValid = true;
    ok("getSession mengenali session aktif");
  } catch (e) {
    fail("getSession session aktif", e);
  }

  // --- 7. getSession tanpa cookie harus null/tertolak -------------------
  try {
    const s = await auth.api.getSession({ headers: new Headers({}) });
    if (s) {
      fail("getSession tanpa cookie harus kosong", "malah bersesi");
    } else {
      ok("getSession tanpa cookie → null");
    }
  } catch {
    ok("getSession tanpa cookie ditolak/null");
  }

  // --- 8. signOut lalu session mati ------------------------------------
  try {
    const res = await auth.api.signOut({ headers: new Headers({ cookie }), returnHeaders: true });
    cookie = [...res.headers.getSetCookie()].join("; ");
    const s = await auth.api.getSession({ headers: new Headers({ cookie }) });
    if (sessionValid && s) throw new Error("session masih hidup setelah signOut");
    ok("signOut mematikan session");
  } catch (e) {
    fail("signOut mematikan session", e);
  }

  // --- 9. Bersih-bersih data uji ---------------------------------------
  try {
    const [u] = await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, EMAIL));
    if (u) {
      await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, u.id));
      await db.delete(schema.authAccounts).where(eq(schema.authAccounts.userId, u.id));
      await db
        .delete(schema.authVerifications)
        .where(and(eq(schema.authVerifications.identifier, EMAIL)));
      await db.delete(schema.authUsers).where(eq(schema.authUsers.id, u.id));
    }
    const left = await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, EMAIL));
    if (left.length !== 0) throw new Error("sisa data uji masih ada");
    ok("pembersihan data uji (auth_users/sessions/accounts/verifications)");
  } catch (e) {
    fail("pembersihan data uji", e);
  }

  console.log(failures === 0 ? "=== SEMUA TES LULUS ===" : `=== ${failures} TES GAGAL ===`);
}

main()
  .catch(() => process.exitCode = 1)
  .finally(async () => {
    // src/db tidak mengekspor pool; ambil via $client.
    const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
    if (client?.end) await client.end();
  });
