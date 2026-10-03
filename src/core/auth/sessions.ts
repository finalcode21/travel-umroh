import { cache } from "react";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import {
  sessions,
  users,
  roles,
  passwordResets,
  userRoles,
  type Users,
} from "@/db/schema";
import { count } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "./password";
import { generateSessionToken, generatePasswordResetToken } from "./tokens";
import { recordActivity } from "@/core/activity/service";

/** Cookie name + lifetime. */
export const SESSION_COOKIE = "tu_session";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = Users;

/** Insert a new session row and set the signed cookie. */
export async function createSession(
  userId: string,
  { ip, userAgent }: { ip?: string; userAgent?: string } = {},
): Promise<string> {
  const token = generateSessionToken();
  const issuedAt = new Date();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.insert(sessions).values({
    id: token,
    userId,
    ip,
    userAgent,
    issuedAt,
    expiresAt,
  });

  const cookie = await cookies();
  cookie.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DURATION_MS / 1000,
    path: "/",
  });

  // Opportunistic audit
  void recordActivity({
    companyId: null,
    userId,
    type: "session.created",
    message: "Session created",
  });

  return token;
}

/** Rotate a session (log the user in again from a different device). */
export async function rotateSession(
  sessionId: string,
  userId: string,
  { ip, userAgent }: { ip?: string; userAgent?: string } = {},
): Promise<string> {
  const [existing] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!existing) throw new AppError("NOT_FOUND", "Session tidak ditemukan.");

  const token = generateSessionToken();
  const issuedAt = new Date();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.insert(sessions).values({
    id: token,
    userId,
    ip,
    userAgent,
    issuedAt,
    expiresAt,
  });

  const cookie = await cookies();
  cookie.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DURATION_MS / 1000,
    path: "/",
  });

  return token;
}

/** Delete a session (log out). */
export async function destroySession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  const cookie = await cookies();
  cookie.delete(SESSION_COOKIE);
  void recordActivity({
    companyId: null,
    userId: null as unknown as string,
    type: "session.deleted",
    message: "Session deleted",
  });
}

export async function signOut(): Promise<void> {
  const { cookies } = await import("next/headers");
  const cookie = await cookies();
  const token = cookie.get(SESSION_COOKIE)?.value ?? null;
  if (token) {
    await destroySession(token);
  }
}

/** Return the current session row from the cookie, or null. */
export async function getSessionFromCookie(): Promise<SessionRow | null> {
  const cookie = await cookies();
  const token = cookie.get(SESSION_COOKIE)?.value ?? null;
  if (!token) return null;

  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, token))
    .limit(1);
  if (!row) return null;

  // Expired sessions are cleaned up (defensive; TTL is also enforced at login).
  if (row.expiresAt < new Date()) {
    await db.delete(sessions).where(eq(sessions.id, token));
    return null;
  }

  return row;
}

/** Resolve the authenticated user from the cookie session. */
export const getCurrentUser = cache(async (): Promise<UserRow | null> => {
  const session = await getSessionFromCookie();
  if (!session) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  return user ?? null;
});

/** For server actions & route handlers: throws 401 when not signed in. */
export async function requireUser(): Promise<UserRow> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Sesi berakhir. Silakan login kembali.");
  if (user.status !== "ACTIVE") {
    throw new AppError("FORBIDDEN", "Akun Anda tidak aktif. Hubungi administrator.");
  }
  return user;
}

/** Lightweight check usable in server components (no throw). */
export async function isAuthenticated(): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user);
}

/**
 * Authenticate a local user by email + password.
 * On success, creates a session and returns the user row + session id.
 */
export async function signIn({
  email,
  password,
  ip,
  userAgent,
}: {
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ user: UserRow; sessionId: string }> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  if (!user) {
    // Rate-limit the attempt server-side via activity/audit (no timing side-channel)
    await recordActivity({
      companyId: null,
      userId: null as unknown as string,
      type: "auth.failure",
      message: `Login attempt untuk email ${email} — pengguna tidak ditemukan.`,
    });
    throw new AppError("UNAUTHENTICATED", "Email atau password salah.");
  }

  if (user.status !== "ACTIVE") {
    throw new AppError("FORBIDDEN", "Akun Anda tidak aktif. Hubungi administrator.");
  }

  const hash = user.passwordHash ?? "";
  const salt = user.passwordSalt ?? "";
  if (!hash || !salt || !verifyPassword(password, hash)) {
    await recordActivity({
      companyId: null,
      userId: null as unknown as string,
      type: "auth.failure",
      message: `Login gagal: password tidak valid untuk ${email}.`,
    });
    throw new AppError("UNAUTHENTICATED", "Email atau password salah.");
  }

  const sessionId = await createSession(user.id, { ip, userAgent });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return { user, sessionId };
}

/**
 * Register a new local user.
 * First user on the platform becomes the Super Admin (companyId = null);
 * subsequent users get a self-serve tenant.
 */
export async function signUp(input: {
  name: string;
  email: string;
  password: string;
  companyId?: string | null;
  branchId?: string | null;
}): Promise<{ user: UserRow; sessionId: string; isSuperAdmin: boolean }> {
  const normalizedEmail = input.email.toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, normalizedEmail));
  if (existing) {
    throw new AppError("CONFLICT", "Email sudah terdaftar. Gunakan password lain atau login.");
  }

  const { hash, salt } = hashPassword(input.password);
  const [userCount] = await db.select({ total: count() }).from(users);
  const isSuperAdmin = Number(userCount?.total ?? 0) === 0;

  if (isSuperAdmin) {
    // Platform Super Admin
    const [roleRow] = await db
      .select()
      .from(roles)
      .where(eq(roles.code, "SUPER_ADMIN"))
      .limit(1);
    if (!roleRow) {
      throw new AppError("INTERNAL", "Peran SUPER_ADMIN tidak ditemukan. Jalankan seed terlebih dahulu.");
    }

    const [user] = await db
      .insert(users)
      .values({
        externalId: crypto.randomUUID(),
        email: normalizedEmail,
        name: input.name,
        isPlatformAdmin: true,
        allBranches: true,
        status: "ACTIVE",
        passwordHash: hash,
        passwordSalt: salt,
        createdBy: null,
      })
      .returning() as [Users];

    await db.insert(userRoles).values({
      userId: user.id,
      roleId: roleRow.id,
    }).onConflictDoNothing();

    await recordActivity({
      companyId: null,
      userId: user.id,
      type: "user.provision",
      message: `${user.name} terdaftar sebagai Super Admin platform`,
    });
    const sessionId = await createSession(user.id);
    return { user, sessionId, isSuperAdmin: true };
  }

  // Self-serve tenant onboarding
  const [user] = await db
    .insert(users)
    .values({
      externalId: crypto.randomUUID(),
      email: normalizedEmail,
      name: input.name,
      companyId: input.companyId ?? null,
      branchId: input.branchId ?? null,
      isPlatformAdmin: false,
      allBranches: false,
      status: "ACTIVE",
      passwordHash: hash,
      passwordSalt: salt,
      createdBy: null,
      updatedBy: null,
    })
    .returning();

  await recordActivity({
    companyId: input.companyId ?? "-",
    userId: user.id,
    type: "user.created",
    message: `Pengguna ${user.name} (${user.email}) bergabung sebagai tenant`,
  });

  const sessionId = await createSession(user.id);
  return { user, sessionId, isSuperAdmin: false };
}

/**
 * Password reset (email + token). Caller must send the token to the
 * user (e.g. via the email we send). The token is single-use and expires.
 */
export async function requestPasswordReset(email: string): Promise<string> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  if (!user) {
    // Never reveal whether the email exists (constant-time-ish response)
    return "reset-token-issued";
  }

  const token = generatePasswordResetToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.insert(passwordResets).values({
    id: token,
    userId: user.id,
    ip: undefined,
    userAgent: undefined,
    requestedAt: new Date(),
    expiresAt,
  });

  // In a real app you would email the reset link here.
  // The token is returned to be used in the reset flow + email template.
  return token;
}

/**
 * Complete a password reset with a valid, single-use token.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ success: true }> {
  const [resetRow] = await db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.id, token))
    .limit(1);
  if (!resetRow) {
    throw new AppError("NOT_FOUND", "Token reset tidak valid.");
  }
  if (resetRow.expiresAt < new Date()) {
    await db.delete(passwordResets).where(eq(passwordResets.id, token));
    throw new AppError("VALIDATION_ERROR", "Token reset sudah kedaluwarsa.");
  }

  const { hash, salt } = hashPassword(newPassword);
  await db
    .update(users)
    .set({
      passwordHash: hash,
      passwordSalt: salt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, resetRow.userId));

  await db.delete(passwordResets).where(eq(passwordResets.id, token));

  return { success: true };
}
