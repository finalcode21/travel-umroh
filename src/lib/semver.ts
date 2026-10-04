/**
 * Minimal semantic versioning utilities (PRD §26–27).
 *
 * Supports `MAJOR.MINOR.PATCH` (patch optional), prerelease ignored for
 * ordering, and constraint expressions used by module manifests:
 *
 *   "1.2.3"        exact
 *   ">=1.0.0"      comparison operators: > >= < <= =
 *   "^1.2.3"       same major, >= 1.2.3
 *   "~1.2.3"       same major+minor, >= 1.2.3
 *   ">=1.0.0 <2.0.0"  space-separated AND range
 *   "1.x" / "1.2.x"   wildcard ranges
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_RE = /^(\d+)\.(\d+)(?:\.(\d+))?$/;

export function parseVersion(input: string): SemVer | null {
  const m = SEMVER_RE.exec(input.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3] ?? 0),
  };
}

export function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** -1 if a < b, 0 if equal, 1 if a > b. Null inputs are not comparable. */
export function compare(a: string, b: string): number | null {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return null;
  return compareVersions(va, vb);
}

export function gt(a: string, b: string): boolean {
  return (compare(a, b) ?? -1) > 0;
}

/** True when `available` is a newer version than `installed`. */
export function isUpdateAvailable(
  installed: string | null | undefined,
  available: string,
): boolean {
  if (!installed) return false;
  return gt(available, installed);
}

function satisfiesOne(version: SemVer, raw: string): boolean {
  const constraint = raw.trim();
  if (constraint === "" || constraint === "*" || constraint === "x") return true;

  // wildcard ranges: 1.x / 1.2.x / 1.2
  if (/^\d+(\.(x|\*))?(\.(x|\*))?$/.test(constraint)) {
    const parts = constraint.split(".").map((p) => (p === "x" || p === "*" ? null : Number(p)));
    if (version.major !== parts[0]) return false;
    if (parts[1] !== null && parts[1] !== undefined && version.minor !== parts[1]) return false;
    if (parts[2] !== null && parts[2] !== undefined && version.patch !== parts[2]) return false;
    return true;
  }

  const cmpMatch = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(constraint);
  if (!cmpMatch) return false;
  const op = cmpMatch[1] ?? "=";
  const target = parseVersion(cmpMatch[2]);
  if (!target) return false;
  const c = compareVersions(version, target);

  switch (op) {
    case ">":
      return c > 0;
    case ">=":
      return c >= 0;
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    case "=":
      return c === 0;
    case "^":
      // same major, at least target
      return version.major === target.major && c >= 0;
    case "~":
      return version.major === target.major && version.minor === target.minor && c >= 0;
    default:
      return false;
  }
}

/**
 * Check `version` against a constraint expression.
 * Space-separated constraints are ANDed (e.g. ">=1.0.0 <2.0.0").
 * Returns null when the constraint itself is unparsable (invalid format).
 */
export function satisfies(version: string, constraint: string): boolean | null {
  const v = parseVersion(version);
  if (!v) return null;
  const parts = constraint.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return true;
  for (const part of parts) {
    if (!satisfiesOne(v, part)) return false;
  }
  return true;
}

/** True when the constraint string has a recognized format. */
export function isValidConstraint(constraint: string): boolean {
  const parts = constraint.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) =>
    /^(\*|x|>=|<=|>|<|=|\^|~)?\s*(\d+\.\d+(\.\d+)?|\d+(\.(x|\*)){1,2}|\*|x)$/.test(p),
  );
}
