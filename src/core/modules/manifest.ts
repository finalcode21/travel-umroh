import { z } from "zod";
import type { ErrorCode } from "@/lib/errors";
import { AppError } from "@/lib/errors";
import { isValidConstraint } from "@/lib/semver";
import type { ModuleManifest } from "@/types";
import { normalizeDependencies } from "./dependency";

/* ------------------------- structured issues (§8) ------------------------- */

export interface ManifestIssue {
  module: string;
  field: string;
  errorCode: ErrorCode;
  message: string;
}

export class ManifestValidationError extends AppError {
  readonly issues: ManifestIssue[];
  constructor(issues: ManifestIssue[]) {
    super("MODULE_INVALID_MANIFEST", "Manifest modul tidak valid.", issues);
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

function issue(
  module: string,
  field: string,
  errorCode: ErrorCode,
  message: string,
): ManifestIssue {
  return { module, field, errorCode, message };
}

/* --------------------------- zod schema (§7) --------------------------- */

const technicalNameSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Technical name harus kebab-case lowercase (contoh: notes-pro)",
  );

const versionSchema = z
  .string()
  .regex(/^\d+\.\d+(\.\d+)?$/, "Versi harus semver MAJOR.MINOR[.PATCH] (contoh: 1.0.0)");

const dependencySchema = z.union([
  technicalNameSchema,
  z.object({
    module: technicalNameSchema,
    version: z.string().min(1).max(60).optional(),
  }),
]);

const permissionSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/, "Permission code format: module.action"),
  name: z.string().min(2).max(120),
  description: z.string().max(400).optional(),
});

const navigationSchema = z
  .object({
    code: z.string().min(2).max(80),
    label: z.string().min(1).max(80),
    icon: z.string().max(60).optional(),
    href: z.string().startsWith("/").max(200),
    permission: z.string().max(120).optional(),
    order: z.number().int().optional(),
  })
  .refine((n) => !n.permission || !n.permission.endsWith(".") || n.permission.length > 3, {
    message: "Permission reference tidak valid",
  });

const settingSchema = z
  .object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    type: z.enum(["text", "number", "boolean", "select"]),
    description: z.string().max(400).optional(),
    options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .refine((s) => s.type !== "select" || (s.options?.length ?? 0) > 0, {
    message: "Setting select wajib punya options",
  });

const migrationSchema = z.object({
  version: versionSchema,
  name: z.string().min(1).max(120),
  sql: z.string().min(1),
});

export const moduleManifestSchema = z.object({
  code: technicalNameSchema,
  name: z.string().min(2).max(120),
  version: versionSchema,
  description: z.string().min(1).max(600),
  category: z.enum([
    "CORE",
    "CRM",
    "SALES",
    "OPERATIONS",
    "FINANCE",
    "COLLABORATION",
    "AI",
    "EXTENSION",
  ]),
  author: z.string().max(120).optional(),
  priceMonthly: z.number().int().min(0).optional(),
  billingCycle: z.enum(["MONTHLY", "YEARLY"]).optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  dependencies: z.array(dependencySchema).max(50).optional(),
  permissions: z.array(permissionSchema).max(100),
  navigation: z.array(navigationSchema).max(50),
  settings: z.array(settingSchema).max(100).optional(),
  uninstallPolicy: z.enum(["KEEP_DATA", "ARCHIVE_DATA", "DELETE_DATA"]).optional(),
  archiveSql: z.string().max(8000).optional(),
  migrations: z.array(migrationSchema).max(200).optional(),
  deleteDataSql: z.string().max(8000).optional(),
});

/* --------------------- full-registry validation (§8) --------------------- */

/**
 * Validate the whole manifest registry (PRD §8). Returns structured issues
 * with {module, field, error_code, message}. Empty array = valid.
 */
export function validateModuleManifests(
  manifests: ModuleManifest[],
): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const seenCodes = new Set<string>();
  const permissionOwners = new Map<string, string>();

  for (const manifest of manifests) {
    const code = manifest.code ?? "<unknown>";

    // schema-level (required fields, formats)
    const parsed = moduleManifestSchema.safeParse(manifest);
    if (!parsed.success) {
      for (const p of parsed.error.issues) {
        issues.push(
          issue(
            code,
            p.path.join(".") || "(root)",
            "MODULE_INVALID_MANIFEST",
            p.message,
          ),
        );
      }
      continue; // deeper checks need a structurally valid manifest
    }

    // duplicate technical name (PRD §6)
    if (seenCodes.has(manifest.code)) {
      issues.push(
        issue(
          manifest.code,
          "code",
          "CONFLICT",
          `Duplicate technical name "${manifest.code}" dalam registry`,
        ),
      );
    }
    seenCodes.add(manifest.code);

    // version constraints format (PRD §27)
    for (const dep of normalizeDependencies(manifest)) {
      if (dep.version && !isValidConstraint(dep.version)) {
        issues.push(
          issue(
            manifest.code,
            `dependencies[${dep.module}].version`,
            "MODULE_INVALID_DEPENDENCY",
            `Constraint versi "${dep.version}" tidak valid`,
          ),
        );
      }
      if (dep.module === manifest.code) {
        issues.push(
          issue(
            manifest.code,
            "dependencies",
            "MODULE_CIRCULAR_DEPENDENCY",
            "Modul tidak boleh menjadi dependensinya sendiri",
          ),
        );
      }
    }

    // duplicate permissions (within module)
    const localPerms = new Set<string>();
    for (const p of manifest.permissions) {
      if (localPerms.has(p.code)) {
        issues.push(
          issue(
            manifest.code,
            "permissions",
            "MODULE_PERMISSION_CONFLICT",
            `Permission "${p.code}" dideklarasikan dua kali`,
          ),
        );
      }
      localPerms.add(p.code);

      // duplicate across modules (PRD §22: duplicate permission harus ditolak)
      const owner = permissionOwners.get(p.code);
      if (owner && owner !== manifest.code) {
        issues.push(
          issue(
            manifest.code,
            "permissions",
            "MODULE_PERMISSION_CONFLICT",
            `Permission "${p.code}" sudah dimiliki modul "${owner}"`,
          ),
        );
      } else {
        permissionOwners.set(p.code, manifest.code);
      }
    }

    // duplicate navigation (within module)
    const localNav = new Set<string>();
    for (const n of manifest.navigation) {
      if (localNav.has(n.code)) {
        issues.push(
          issue(
            manifest.code,
            "navigation",
            "MODULE_INVALID_MANIFEST",
            `Navigation code "${n.code}" dideklarasikan dua kali`,
          ),
        );
      }
      localNav.add(n.code);
    }

    // duplicate settings keys
    const localSettings = new Set<string>();
    for (const s of manifest.settings ?? []) {
      if (localSettings.has(s.key)) {
        issues.push(
          issue(
            manifest.code,
            "settings",
            "MODULE_CONFIGURATION_INVALID",
            `Setting key "${s.key}" dideklarasikan dua kali`,
          ),
        );
      }
      localSettings.add(s.key);
    }
  }

  // unknown dependency references (PRD §8: invalid dependency)
  for (const manifest of manifests) {
    for (const dep of normalizeDependencies(manifest)) {
      if (!seenCodes.has(dep.module)) {
        issues.push(
          issue(
            manifest.code,
            "dependencies",
            "NOT_FOUND",
            `Modul ${manifest.code} depends on unknown module ${dep.module}`,
          ),
        );
      }
    }
  }

  // circular dependency across the registry (PRD §10)
  const cycle = detectCycle(manifests);
  if (cycle) {
    issues.push(
      issue(
        cycle[0],
        "dependencies",
        "MODULE_CIRCULAR_DEPENDENCY",
        `Circular dependency: ${cycle.join(" → ")}`,
      ),
    );
  }

  return issues;
}

function detectCycle(manifests: ModuleManifest[]): string[] | null {
  const graph = new Map<string, string[]>();
  for (const m of manifests) {
    graph.set(
      m.code,
      normalizeDependencies(m).map((d) => d.module),
    );
  }
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  const visit = (code: string): string[] | null => {
    const s = state.get(code);
    if (s === "done") return null;
    if (s === "visiting") {
      const start = path.indexOf(code);
      return [...path.slice(start), code];
    }
    state.set(code, "visiting");
    path.push(code);
    for (const dep of graph.get(code) ?? []) {
      const found = visit(dep);
      if (found) return found;
    }
    path.pop();
    state.set(code, "done");
    return null;
  };

  for (const code of graph.keys()) {
    const cycle = visit(code);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Validate and throw MODULE_INVALID_MANIFEST when the registry is invalid.
 * Called from syncModuleRegistry so a broken manifest fails loudly.
 */
export function assertManifestsValid(manifests: ModuleManifest[]): void {
  const issues = validateModuleManifests(manifests);
  if (issues.length > 0) {
    throw new ManifestValidationError(issues);
  }
}
