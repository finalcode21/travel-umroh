/**
 * Phase 2 UNIT tests (PRD §45): semver, manifest validation, dependency graph.
 * Pure functions — no DB required. Run: npx tsx scripts/phase2/unit-tests.ts
 */
import "../load-env";
import { expect, expectEqual, printSummary, test } from "./harness";
import {
  compare,
  isUpdateAvailable,
  isValidConstraint,
  parseVersion,
  satisfies,
} from "../../src/lib/semver";
import {
  checkVersionCompatibility,
  detectCircularDependency,
  getDependentManifests,
  normalizeDependency,
  resolveInstallOrder,
} from "../../src/core/modules/dependency";
import { validateModuleManifests } from "../../src/core/modules/manifest";
import { moduleManifests } from "../../src/modules/registry";
import type { ModuleManifest } from "../../src/types";

let failed = 0;

async function main() {
/* ------------------------------- semver ------------------------------- */

await test("semver: parseVersion handles 2-part and 3-part versions", () => {
  expectEqual(parseVersion("1.0.0")?.patch, 0, "patch");
  expectEqual(parseVersion("1.2")?.minor, 2, "minor");
  expect(parseVersion("abc") === null, "invalid should be null");
});

await test("semver: compare orders versions (PRD §26)", () => {
  expectEqual(compare("1.0.0", "1.0.1"), -1, "patch");
  expectEqual(compare("1.2.0", "1.1.9"), 1, "minor");
  expectEqual(compare("2.0.0", "1.9.9"), 1, "major");
  expectEqual(compare("1.0.0", "1.0.0"), 0, "equal");
});

await test("semver: satisfies supports operators, ranges, caret, tilde, wildcard", () => {
  expectEqual(satisfies("1.2.0", ">=1.0.0 <2.0.0"), true, "range in");
  expectEqual(satisfies("2.0.0", ">=1.0.0 <2.0.0"), false, "range out");
  expectEqual(satisfies("1.5.0", "^1.2.3"), true, "caret same major");
  expectEqual(satisfies("2.0.0", "^1.2.3"), false, "caret next major");
  expectEqual(satisfies("1.2.9", "~1.2.3"), true, "tilde same minor");
  expectEqual(satisfies("1.3.0", "~1.2.3"), false, "tilde next minor");
  expectEqual(satisfies("1.4.2", "1.x"), true, "wildcard major");
  expectEqual(satisfies("1.2.3", "1.2.3"), true, "exact");
});

await test("semver: isUpdateAvailable detects newer available version (PRD §26)", () => {
  expectEqual(isUpdateAvailable("1.0.0", "1.1.0"), true, "update available");
  expectEqual(isUpdateAvailable("1.1.0", "1.1.0"), false, "same version");
  expectEqual(isUpdateAvailable("1.2.0", "1.1.0"), false, "installed newer");
  expectEqual(isUpdateAvailable(null, "1.1.0"), false, "nothing installed");
});

await test("semver: isValidConstraint rejects malformed constraints", () => {
  expectEqual(isValidConstraint(">=1.0.0 <2.0.0"), true, "range");
  expectEqual(isValidConstraint("^1.2.3"), true, "caret");
  expectEqual(isValidConstraint("latest"), false, "garbage");
  expectEqual(isValidConstraint(""), false, "empty");
});

/* --------------------------- dependency engine --------------------------- */

function makeManifest(code: string, deps: string[] = [], version = "1.0.0"): ModuleManifest {
  return {
    code,
    name: code,
    version,
    description: `${code} test module`,
    category: "EXTENSION",
    permissions: [{ code: `${code}.view`, name: "view" }],
    navigation: [],
    dependencies: deps,
  };
}

await test("dependency: normalizeDependency accepts string and object specs (PRD §9)", () => {
  const fromString = normalizeDependency("notes");
  expectEqual(fromString.module, "notes", "string spec module");
  expectEqual(fromString.version, undefined, "string spec has no constraint");
  const fromObject = normalizeDependency({ module: "notes", version: ">=1.0.0" });
  expectEqual(fromObject.module, "notes", "object spec module");
  expectEqual(fromObject.version, ">=1.0.0", "object spec constraint");
});

await test("dependency: resolveInstallOrder puts dependencies first (PRD §9)", () => {
  const manifests = [makeManifest("a"), makeManifest("b", ["a"]), makeManifest("c", ["b"])];
  const order = resolveInstallOrder("c", manifests);
  expect(order !== null, "order resolves");
  expect(order!.indexOf("a") < order!.indexOf("b") && order!.indexOf("b") < order!.indexOf("c"),
    `expected a,b,c got ${order!.join(",")}`);
  expect(order!.includes("c"), "self included last");
});

await test("dependency: circular dependency detected with chain (PRD §10)", () => {
  const manifests = [
    makeManifest("a", ["b"]),
    makeManifest("b", ["c"]),
    makeManifest("c", ["a"]),
  ];
  const cycle = detectCircularDependency(manifests);
  expect(cycle !== null, "cycle detected");
  expect(cycle![0] === cycle![cycle!.length - 1], `chain closes: ${cycle!.join(" → ")}`);
});

await test("dependency: acyclic graph returns null cycle", () => {
  const manifests = [makeManifest("a"), makeManifest("b", ["a"])];
  expectEqual(detectCircularDependency(manifests), null, "no cycle");
});

await test("dependency: getDependentManifests finds direct consumers (PRD §11)", () => {
  const manifests = [makeManifest("notes"), makeManifest("notes-pro", ["notes"])];
  const deps = getDependentManifests("notes", manifests);
  expectEqual(deps.length, 1, "one dependent");
  expectEqual(deps[0].code, "notes-pro", "dependent is notes-pro");
});

await test("dependency: version compatibility check (PRD §27)", () => {
  const issues = checkVersionCompatibility(
    [{ module: "notes", version: ">=1.0.0 <2.0.0" }],
    () => "1.1.0",
  );
  expectEqual(issues.length, 0, "1.1.0 satisfies constraint");

  const mismatch = checkVersionCompatibility(
    [{ module: "notes", version: ">=1.0.0 <2.0.0" }],
    () => "2.1.0",
  );
  expectEqual(mismatch.length, 1, "2.1.0 rejected");
  expectEqual(mismatch[0].module, "notes", "issue names module");

  const missing = checkVersionCompatibility([{ module: "notes" }], () => undefined);
  expectEqual(missing.length, 1, "missing version flagged");
});

/* ------------------------- manifest validation ------------------------- */

await test("manifest: production registry is valid (notes + notes-pro)", () => {
  const issues = validateModuleManifests(moduleManifests);
  expectEqual(issues.length, 0, `registry issues: ${JSON.stringify(issues)}`);
});

await test("manifest: duplicate technical name rejected (PRD §6)", () => {
  const manifests = [makeManifest("dup"), makeManifest("dup")];
  const issues = validateModuleManifests(manifests);
  expect(issues.some((i) => i.field === "code" && i.message.includes("Duplicate")), "duplicate flagged");
});

await test("manifest: invalid version rejected (PRD §8)", () => {
  const manifests = [makeManifest("v-bad", [], "not-a-version")];
  const issues = validateModuleManifests(manifests);
  expect(issues.some((i) => i.field === "version"), "version flagged");
});

await test("manifest: unknown dependency rejected (PRD §8)", () => {
  const manifests = [makeManifest("x", ["ghost-module"])];
  const issues = validateModuleManifests(manifests);
  expect(issues.some((i) => i.message.includes("ghost-module")), "unknown dep flagged");
});

await test("manifest: duplicate permission within module rejected (PRD §8/§22)", () => {
  const m = makeManifest("p-dup");
  m.permissions.push({ code: "p-dup.view", name: "view 2" });
  const issues = validateModuleManifests([m]);
  expect(issues.some((i) => i.errorCode === "MODULE_PERMISSION_CONFLICT"), "perm conflict flagged");
});

await test("manifest: permission owned by two modules rejected (PRD §22)", () => {
  const a = makeManifest("pa");
  const b = makeManifest("pb");
  b.permissions = [{ code: "pa.view", name: "stolen" }];
  const issues = validateModuleManifests([a, b]);
  expect(issues.some((i) => i.message.includes("pa.view")), "cross-module perm flagged");
});

await test("manifest: duplicate navigation code rejected (PRD §8)", () => {
  const m = makeManifest("nav-dup");
  m.navigation = [
    { code: "n1", label: "One", href: "/m/nav-dup" },
    { code: "n1", label: "Two", href: "/m/nav-dup" },
  ];
  const issues = validateModuleManifests([m]);
  expect(issues.some((i) => i.message.includes("n1")), "nav dup flagged");
});

await test("manifest: invalid dependency version constraint rejected (PRD §27)", () => {
  const m = makeManifest("bad-constraint", [{ module: "alpha", version: "latest" } as never]);
  const issues = validateModuleManifests([makeManifest("alpha"), m]);
  expect(
    issues.some((i) => i.field.includes("dependencies") && i.message.includes("latest")),
    `bad constraint flagged: ${JSON.stringify(issues)}`,
  );
});

await test("manifest: malformed structure (missing required field) rejected (PRD §7)", () => {
  const broken = { code: "broken", name: "Broken" } as unknown as ModuleManifest;
  const issues = validateModuleManifests([broken]);
  expect(issues.length > 0, "broken manifest flagged");
  expect(issues.every((i) => i.module === "broken"), "issues carry module name");
  expect(issues.every((i) => typeof i.errorCode === "string" && i.errorCode.length > 0), "issues carry error_code");
});

}

main().then(() => {
  failed += printSummary("UNIT TESTS");
  process.exit(failed > 0 ? 1 : 0);
});
