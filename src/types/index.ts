import type { ErrorCode } from "@/lib/errors";

/* ----------------------------- Results ----------------------------- */

export interface ActionResultError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: ActionResultError };

/* ------------------------- Module contract ------------------------- */

export type ModuleCategory =
  | "CORE"
  | "CRM"
  | "SALES"
  | "OPERATIONS"
  | "FINANCE"
  | "COLLABORATION"
  | "AI"
  | "EXTENSION";

export interface ModulePermissionDef {
  code: string;
  name: string;
  description?: string;
}

export interface NavigationItemDef {
  code: string;
  label: string;
  /** lucide icon name, resolved client-side */
  icon?: string;
  href: string;
  /** required permission to see this item */
  permission?: string;
  order?: number;
}

export interface ModuleSettingDef {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "select";
  description?: string;
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean;
}

export interface ModuleMigrationDef {
  version: string;
  name: string;
  sql: string;
}

/**
 * Every business module must export a manifest satisfying this contract.
 * Core never imports business logic from modules — only these manifests
 * (via src/modules/registry.ts) are consumed by the Module Engine.
 */
export interface ModuleManifest {
  code: string;
  name: string;
  version: string;
  description: string;
  category: ModuleCategory;
  author?: string;
  /** price in IDR per month; 0/undefined = free */
  priceMonthly?: number;
  billingCycle?: "MONTHLY" | "YEARLY";
  trialDays?: number;
  dependencies?: string[];
  permissions: ModulePermissionDef[];
  navigation: NavigationItemDef[];
  settings?: ModuleSettingDef[];
  migrations?: ModuleMigrationDef[];
  /** SQL executed by the explicit (dangerous) "Delete Module Data" action. */
  deleteDataSql?: string;
}

/* --------------------------- Navigation --------------------------- */

export interface NavItem {
  code: string;
  label: string;
  icon?: string;
  href: string;
}

export interface NavSection {
  code: string;
  label?: string;
  items: NavItem[];
}

/* ---------------------------- ACL types ---------------------------- */

export type ModuleAccessState =
  | "NOT_SUBSCRIBED"
  | "SUBSCRIBED" // subscribed but not installed
  | "ACTIVE"
  | "DISABLED"
  | "PAUSED" // subscription expired
  | "UNINSTALLED";

export interface ModuleAccess {
  moduleCode: string;
  subscriptionStatus:
    | "TRIAL"
    | "ACTIVE"
    | "PAST_DUE"
    | "EXPIRED"
    | "CANCELLED"
    | "NOT_SUBSCRIBED";
  subscriptionExpiresAt: string | null;
  installStatus:
    | "PENDING"
    | "INSTALLING"
    | "ACTIVE"
    | "DISABLED"
    | "PAUSED"
    | "ERROR"
    | "UNINSTALLED"
    | "NOT_INSTALLED";
  /** effective access used by ACL + navigation */
  access: ModuleAccessState;
}

export interface CompanySummary {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  currency: string;
  timezone: string;
  locale: string;
}

export interface CurrentUser {
  id: string;
  externalId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  isPlatformAdmin: boolean;
  companyId: string | null;
  companyName: string | null;
  companyStatus: CompanySummary["status"] | null;
  branchId: string | null;
  allBranches: boolean;
  /** primary + extra granted branches, for branch-scoped access checks */
  accessibleBranchIds: string[];
  roles: { id: string; code: string; name: string }[];
  /** flattened permission codes across the user's roles */
  permissions: string[];
  /** module access map for the user's company (empty for platform admins) */
  moduleAccess: Record<string, ModuleAccess>;
}
