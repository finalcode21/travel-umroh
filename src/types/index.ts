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

/** Versioned dependency entry (PRD §9, §27). */
export interface ModuleDependencyDef {
  module: string;
  /** semver constraint, e.g. ">=1.0.0 <2.0.0", "^1.2.3", "1.x"; undefined = any */
  version?: string;
}

export type ModuleDependencySpec = string | ModuleDependencyDef;

/** What happens to the module's business data on uninstall (PRD §19). */
export type ModuleUninstallPolicy = "KEEP_DATA" | "ARCHIVE_DATA" | "DELETE_DATA";

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
  dependencies?: ModuleDependencySpec[];
  permissions: ModulePermissionDef[];
  navigation: NavigationItemDef[];
  settings?: ModuleSettingDef[];
  migrations?: ModuleMigrationDef[];
  /**
   * Uninstall data retention policy (PRD §19). Default KEEP_DATA —
   * uninstall NEVER destroys business data unless explicitly declared.
   */
  uninstallPolicy?: ModuleUninstallPolicy;
  /**
   * SQL executed before uninstall when policy = ARCHIVE_DATA.
   * `$1` is substituted with the company id (server-side, UUID-validated).
   */
  archiveSql?: string;
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

/**
 * Persisted installation lifecycle states (PRD §5, §48).
 * Mapping from the recommended lifecycle: INSTALLED+ENABLED = ACTIVE,
 * INSTALLED (not enabled) = DISABLED. INSTALLING / UPGRADING / UNINSTALLING
 * are transient in-flight states; *_FAILED are terminal-until-retried.
 */
export type ModuleInstallStatus =
  | "PENDING"
  | "INSTALLING"
  | "ACTIVE"
  | "DISABLED"
  | "PAUSED"
  | "ERROR"
  | "UNINSTALLING"
  | "UPGRADING"
  | "INSTALL_FAILED"
  | "UPGRADE_FAILED"
  | "UNINSTALLED"
  | "NOT_INSTALLED"; // derived (no row)

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
  installStatus: ModuleInstallStatus;
  /** effective access used by ACL + navigation */
  access: ModuleAccessState;
  /** version recorded in the registry (latest available) */
  availableVersion?: string;
  /** version installed by this company, when an installation row exists */
  installedVersion?: string | null;
  /** true when availableVersion > installedVersion (PRD §26) */
  updateAvailable?: boolean;
  /** modules that depend on this module and are installed by this company */
  dependents?: string[];
  /** last lifecycle failure, for actionable admin display (PRD §30) */
  lastError?: string | null;
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
