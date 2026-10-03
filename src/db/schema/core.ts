import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  billingCycleEnum,
  branchStatusEnum,
  companyStatusEnum,
  moduleInstallStatusEnum,
  notificationTypeEnum,
  subscriptionStatusEnum,
  userStatusEnum,
} from "./enums";

/**
 * Tenancy root. Every business record carries a companyId (and optional
 * branchId) so data stays isolated per company (shared-database model).
 */
export const companies = pgTable(
  "companies",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    legalName: text(),
    slug: text().notNull(),
    address: text(),
    phone: text(),
    email: text(),
    website: text(),
    logoUrl: text(),
    taxInfo: text(),
    currency: text().notNull().default("IDR"),
    timezone: text().notNull().default("Asia/Jakarta"),
    locale: text().notNull().default("id"),
    status: companyStatusEnum().notNull().default("ACTIVE"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (t) => [unique("companies_slug_unique").on(t.slug)],
);

export const branches = pgTable(
  "branches",
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text().notNull(),
    code: text().notNull(),
    address: text(),
    phone: text(),
    email: text(),
    managerId: uuid(),
    status: branchStatusEnum().notNull().default("ACTIVE"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (t) => [
    unique("branches_company_code_unique").on(t.companyId, t.code),
    index("branches_company_idx").on(t.companyId),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    externalId: text().notNull(), // local user id (UUID v4)
    email: text().notNull(),
    passwordHash: text(), // bcrypt hash
    passwordSalt: text(), // bcrypt salt
    name: text().notNull(),
    avatarUrl: text(),
    companyId: uuid().references(() => companies.id, { onDelete: "set null" }),
    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),
    allBranches: boolean().notNull().default(false),
    isPlatformAdmin: boolean().notNull().default(false),
    status: userStatusEnum().notNull().default("ACTIVE"),
    metadata: jsonb().$type<Record<string, unknown>>(),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (t) => [
    unique("users_external_id_unique").on(t.externalId),
    unique("users_email_unique").on(t.email),
    index("users_company_idx").on(t.companyId),
  ],
);

/** Extra branch grants beyond the user's primary branch. */
export const userBranches = pgTable(
  "user_branches",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("user_branches_unique").on(t.userId, t.branchId),
    index("user_branches_user_idx").on(t.userId),
  ],
);

/* ------------------------------ RBAC ------------------------------ */

export const roles = pgTable(
  "roles",
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid().references(() => companies.id, { onDelete: "cascade" }),
    code: text().notNull(),
    name: text().notNull(),
    description: text(),
    isSystem: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (t) => [index("roles_company_idx").on(t.companyId)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull(),
    name: text().notNull(),
    description: text(),
    moduleCode: text(), // null => core permission
    isSystem: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("permissions_code_unique").on(t.code),
    index("permissions_module_idx").on(t.moduleCode),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("role_permissions_unique").on(t.roleId, t.permissionId),
    index("role_permissions_role_idx").on(t.roleId),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("user_roles_unique").on(t.userId, t.roleId),
    index("user_roles_user_idx").on(t.userId),
  ],
);

/* --------------------------- Module Engine --------------------------- */

export const modules = pgTable(
  "modules",
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull(),
    name: text().notNull(),
    version: text().notNull(),
    description: text(),
    category: text(),
    author: text(),
    isCore: boolean().notNull().default(false),
    priceMonthly: integer(), // IDR, null => free
    billingCycle: billingCycleEnum().notNull().default("MONTHLY"),
    trialDays: integer(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("modules_code_unique").on(t.code)],
);

export const moduleDependencies = pgTable(
  "module_dependencies",
  {
    id: uuid().primaryKey().defaultRandom(),
    moduleCode: text()
      .notNull()
      .references(() => modules.code, { onDelete: "cascade" }),
    dependsOnCode: text()
      .notNull()
      .references(() => modules.code, { onDelete: "cascade" }),
    requiredVersion: text(),
  },
  (t) => [unique("module_dependencies_unique").on(t.moduleCode, t.dependsOnCode)],
);

export const moduleInstallations = pgTable(
  "module_installations",
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    moduleId: uuid()
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    status: moduleInstallStatusEnum().notNull().default("PENDING"),
    installedVersion: text(),
    config: jsonb().$type<Record<string, unknown>>(),
    installedAt: timestamp({ withTimezone: true }),
    uninstalledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("module_installations_unique").on(t.companyId, t.moduleId),
    index("module_installations_company_idx").on(t.companyId),
    index("module_installations_module_idx").on(t.moduleId),
    index("module_installations_status_idx").on(t.status),
  ],
);

export const moduleSubscriptions = pgTable(
  "module_subscriptions",
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    moduleId: uuid()
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    planId: text().notNull(),
    planName: text().notNull(),
    priceMonthly: integer(),
    billingCycle: billingCycleEnum().notNull().default("MONTHLY"),
    status: subscriptionStatusEnum().notNull().default("TRIAL"),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("module_subscriptions_company_module_idx").on(
      t.companyId,
      t.moduleId,
    ),
    index("module_subscriptions_status_idx").on(t.status),
    index("module_subscriptions_expires_idx").on(t.expiresAt),
  ],
);

export const moduleSettings = pgTable(
  "module_settings",
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    moduleId: uuid()
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    key: text().notNull(),
    value: jsonb(),
    updatedBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("module_settings_unique").on(t.companyId, t.moduleId, t.key)],
);

/** Tracks which module migration files have been applied (global, shared DB). */
export const moduleMigrations = pgTable(
  "module_migrations",
  {
    id: uuid().primaryKey().defaultRandom(),
    moduleCode: text().notNull(),
    version: text().notNull(),
    name: text().notNull(),
    appliedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("module_migrations_unique").on(t.moduleCode, t.version, t.name)],
);

/* ----------------------------- System ----------------------------- */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid().references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "cascade" }), // null => company broadcast
    title: text().notNull(),
    body: text(),
    type: notificationTypeEnum().notNull().default("INFO"),
    link: text(),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId),
    index("notifications_company_idx").on(t.companyId, t.createdAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    companyId: uuid().references(() => companies.id, { onDelete: "cascade" }),
    action: text().notNull(), // CREATE | UPDATE | DELETE | ...
    module: text().notNull(), // module code, e.g. "core"
    resource: text().notNull(), // resource type, e.g. "user"
    resourceId: text(),
    oldValues: jsonb().$type<Record<string, unknown> | null>(),
    newValues: jsonb().$type<Record<string, unknown> | null>(),
    ip: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_company_created_idx").on(t.companyId, t.createdAt),
    index("audit_logs_resource_idx").on(t.resource, t.resourceId),
    index("audit_logs_user_idx").on(t.userId),
  ],
);

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    companyId: uuid().references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    type: text().notNull(), // e.g. "user.login", "module.install"
    message: text().notNull(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_logs_company_created_idx").on(t.companyId, t.createdAt),
  ],
);

export const systemSettings = pgTable("system_settings", {
  key: text().primaryKey(),
  value: jsonb(),
  updatedBy: uuid(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/* ------------------------------ Sessions ----------------------------- */
export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(), // session token
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ip: text(),
    userAgent: text(),
    issuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

/* ------------------------- Password resets ------------------------- */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ip: text(),
    userAgent: text(),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    index("password_resets_user_idx").on(t.userId),
    index("password_resets_expires_idx").on(t.expiresAt),
  ],
);

/* ----------------------------- Relations ----------------------------- */

export const companyRelations = relations(companies, ({ many }) => ({
  branches: many(branches),
  users: many(users),
}));

export const branchRelations = relations(branches, ({ one, many }) => ({
  company: one(companies, {
    fields: [branches.companyId],
    references: [companies.id],
  }),
  users: many(users),
}));

export const userRelations = relations(users, ({ one, many }) => ({
  company: one(companies, {
    fields: [users.companyId],
    references: [companies.id],
  }),
  branch: one(branches, {
    fields: [users.branchId],
    references: [branches.id],
  }),
  roles: many(userRoles),
  branches: many(userBranches),
}));

export const userRoleRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const userBranchRelations = relations(userBranches, ({ one }) => ({
  user: one(users, { fields: [userBranches.userId], references: [users.id] }),
  branch: one(branches, {
    fields: [userBranches.branchId],
    references: [branches.id],
  }),
}));

export const roleRelations = relations(roles, ({ one, many }) => ({
  company: one(companies, {
    fields: [roles.companyId],
    references: [companies.id],
  }),
  permissions: many(rolePermissions),
  users: many(userRoles),
}));

export const rolePermissionRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const moduleRelations = relations(modules, ({ many }) => ({
  installations: many(moduleInstallations),
  subscriptions: many(moduleSubscriptions),
  dependencies: many(moduleDependencies),
}));

export const moduleInstallationRelations = relations(
  moduleInstallations,
  ({ one }) => ({
    company: one(companies, {
      fields: [moduleInstallations.companyId],
      references: [companies.id],
    }),
    module: one(modules, {
      fields: [moduleInstallations.moduleId],
      references: [modules.id],
    }),
  }),
);

export const moduleSubscriptionRelations = relations(
  moduleSubscriptions,
  ({ one }) => ({
    company: one(companies, {
      fields: [moduleSubscriptions.companyId],
      references: [companies.id],
    }),
    module: one(modules, {
      fields: [moduleSubscriptions.moduleId],
      references: [modules.id],
    }),
  }),
);
