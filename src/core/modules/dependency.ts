import type {
  ModuleDependencyDef,
  ModuleDependencySpec,
  ModuleManifest,
} from "@/types";
import { isValidConstraint, satisfies } from "@/lib/semver";

/** Normalizes a manifest dependency spec ("notes" | {module, version}). */
export function normalizeDependency(spec: ModuleDependencySpec): ModuleDependencyDef {
  return typeof spec === "string" ? { module: spec } : spec;
}

export function normalizeDependencies(
  manifest: Pick<ModuleManifest, "dependencies">,
): ModuleDependencyDef[] {
  return (manifest.dependencies ?? []).map(normalizeDependency);
}

/** code → direct dependency codes */
export function buildDependencyGraph(
  manifests: ModuleManifest[],
): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const m of manifests) {
    graph.set(
      m.code,
      normalizeDependencies(m).map((d) => d.module),
    );
  }
  return graph;
}

/**
 * Detect a circular dependency (PRD §10). Returns the offending chain
 * (e.g. ["a", "b", "c", "a"]) or null when the graph is acyclic.
 */
export function detectCircularDependency(
  manifests: ModuleManifest[],
): string[] | null {
  const graph = buildDependencyGraph(manifests);
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
      const cycle = visit(dep);
      if (cycle) return cycle;
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

/** All transitive dependencies of `code` (excluding itself). */
export function collectTransitiveDependencies(
  code: string,
  manifests: ModuleManifest[],
): string[] {
  const graph = buildDependencyGraph(manifests);
  const seen = new Set<string>();
  const stack = [...(graph.get(code) ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(graph.get(cur) ?? []));
  }
  return [...seen];
}

/**
 * Install order for `code` and its dependency chain (PRD §9):
 * dependencies first, the module itself last. Returns null on a cycle.
 */
export function resolveInstallOrder(
  code: string,
  manifests: ModuleManifest[],
): string[] | null {
  const cycle = detectCircularDependency(manifests);
  if (cycle) return null;
  const order: string[] = [];
  const visited = new Set<string>();

  const visit = (c: string) => {
    if (visited.has(c)) return;
    visited.add(c);
    const manifest = manifests.find((m) => m.code === c);
    for (const dep of manifest ? normalizeDependencies(manifest) : []) {
      visit(dep.module);
    }
    order.push(c);
  };
  visit(code);
  return order;
}

/** Manifests that directly depend on `code`. */
export function getDependentManifests(
  code: string,
  manifests: ModuleManifest[],
): ModuleManifest[] {
  return manifests.filter((m) =>
    normalizeDependencies(m).some((d) => d.module === code),
  );
}

export interface VersionCompatIssue {
  module: string;
  constraint: string | undefined;
  actualVersion: string | undefined;
}

/**
 * Validate dependency version constraints (PRD §27).
 * `resolveVersion` returns the currently-installed/available version of a
 * dependency, or undefined when unknown/missing.
 */
export function checkVersionCompatibility(
  deps: ModuleDependencyDef[],
  resolveVersion: (moduleCode: string) => string | undefined | null,
): VersionCompatIssue[] {
  const issues: VersionCompatIssue[] = [];
  for (const dep of deps) {
    if (dep.version && !isValidConstraint(dep.version)) {
      issues.push({
        module: dep.module,
        constraint: dep.version,
        actualVersion: resolveVersion(dep.module) ?? undefined,
      });
      continue;
    }
    const actual = resolveVersion(dep.module);
    if (actual === undefined || actual === null) {
      issues.push({
        module: dep.module,
        constraint: dep.version,
        actualVersion: undefined,
      });
      continue;
    }
    if (dep.version && satisfies(actual, dep.version) === false) {
      issues.push({
        module: dep.module,
        constraint: dep.version,
        actualVersion: actual,
      });
    }
  }
  return issues;
}
