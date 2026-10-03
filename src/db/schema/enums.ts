import { pgEnum } from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", [
  "ACTIVE",
  "INACTIVE",
  "SUSPENDED",
]);

export const companyStatusEnum = pgEnum("company_status", [
  "ACTIVE",
  "SUSPENDED",
]);

export const branchStatusEnum = pgEnum("branch_status", ["ACTIVE", "INACTIVE"]);

export const moduleInstallStatusEnum = pgEnum("module_install_status", [
  "PENDING",
  "INSTALLING",
  "ACTIVE",
  "DISABLED",
  "PAUSED",
  "ERROR",
  "UNINSTALLED",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "TRIAL",
  "ACTIVE",
  "PAST_DUE",
  "EXPIRED",
  "CANCELLED",
]);

export const billingCycleEnum = pgEnum("billing_cycle", ["MONTHLY", "YEARLY"]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "INFO",
  "SUCCESS",
  "WARNING",
  "ERROR",
]);
