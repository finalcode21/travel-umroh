/**
 * Skema database Drizzle untuk travel-umroh.
 *
 * Semua tabel yang ada di database (Neon Development) didefinisikan di sini
 * agar:
 *  - `drizzle-orm` bisa query/mutasikan dengan type-safe.
 *  - `@better-auth/drizzle-adapter` bisa melakukan introspeksi schema
 *    (findDrizzleSchemaProblems) dan memvalidasi bahwa tabel auth ada.
 *  - `scripts/*-smoke.ts` dan `scripts/*-verify.ts` bisa membaca/menghapus
 *    data untuk isolasi test.
 *
 * Tabel auth (*_users/sessions/accounts/verifications) memakai nama fisik
 * `auth_*` karena konfigurasi `modelName` di src/auth.ts.
 *
 * Kolom & tipe mengikuti migrasi `drizzle/0000_quiet_dragon_lord.sql`
 * yang sudah dioper ke database.
 */

import { pgTable, text, uuid, boolean, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

// ------------------------------------------------------------------
// Tabel pembantu (enum-like). Dipakai sebagai tip saja; nilai enum
// sudah ada di DB dari migrasi.
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Tabel inti aplikasi
// ------------------------------------------------------------------

export const pilgrimStatusEnum = text("pilgrim_status").notNull().default("draft");

// ------------------------------------------------------------------
// Modul Paket Umrah — tabel `packages` (paket) + `departures` (keberangkatan).
// Migrasi: drizzle/0003_add_packages.sql (incremental, idempoten).
// Harga memakai integer IDR (rupiah utuh); status paket/keberangkatan
// divalidasi di layer aplikasi (Zod) untuk menghindari enum DDL.
// ------------------------------------------------------------------

export const packages = pgTable("packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  priceIdr: integer("price_idr").notNull().default(0),
  capacity: integer("capacity").notNull().default(0),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const departures = pgTable("departures", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  packageId: uuid("package_id")
    .notNull()
    .references(() => packages.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  departOn: timestamp("depart_on", { withTimezone: true }).notNull(),
  returnOn: timestamp("return_on", { withTimezone: true }),
  capacity: integer("capacity").notNull().default(0),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const pilgrims = pgTable("pilgrims", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  registrantNo: text("registrant_no").notNull(),
  fullName: text("full_name").notNull(),
  identityNo: text("identity_no"),
  phone: text("phone"),
  email: text("email"),
  dateOfBirth: timestamp("date_of_birth", { withTimezone: true }),
  address: text("address"),
  status: pilgrimStatusEnum.notNull().default("draft"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ------------------------------------------------------------------

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  contactName: text("contact_name").notNull(),
  phone: text("phone"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  actorLabel: text("actor_label"),
  tenantId: uuid("tenant_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const installations = pgTable("installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().unique(),
  name: text("name").notNull(),
  status: text("status").notNull().default("pending"),
  installedAt: timestamp("installed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull(),
  code: text("code").notNull().unique(),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const platformRoleAssignments = pgTable("platform_role_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  roleId: uuid("role_id").notNull(),
  scope: text("scope").notNull().default("platform"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  assignedBy: text("assigned_by"),
});

export const rolePermissions = pgTable("role_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleId: uuid("role_id").notNull(),
  permissionId: uuid("permission_id").notNull(),
  scope: text("scope").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull(),
  tenantId: uuid("tenant_id"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tenantRoleAssignments = pgTable("tenant_role_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  roleId: uuid("role_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  assignedBy: text("assigned_by"),
});

export const tenantUsers = pgTable("tenant_users", {
  userId: text("user_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  jobTitle: text("job_title"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ------------------------------------------------------------------
// Tabel auth (Better Auth) — nama fisik `auth_*` sesuai modelName
// di src/auth.ts.
// ------------------------------------------------------------------

export const authUsers = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  platformAccountId: uuid("platform_account_id"),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authAccounts = pgTable("auth_accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authVerifications = pgTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

