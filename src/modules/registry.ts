import type { ModuleManifest } from "@/types";
import { getDependentManifests } from "@/core/modules/dependency";
import { notesManifest } from "./notes/manifest";
import { notesProManifest } from "./notes-pro/manifest";

/**
 * The ONLY import surface from business modules into Core.
 * Business modules are registered here; nothing else of a module is known
 * to the platform until its manifest goes through the Module Engine.
 */
export const moduleManifests: ModuleManifest[] = [
  notesManifest,
  notesProManifest,
];

export function getModuleManifest(code: string): ModuleManifest | undefined {
  return moduleManifests.find((m) => m.code === code);
}

function createPermissionModuleMap(): ReadonlyMap<string, string | null> {
  const map = new Map<string, string | null>();
  for (const manifest of moduleManifests) {
    for (const p of manifest.permissions) map.set(p.code, manifest.code);
  }
  return map;
}

/** permission code → owning module code (null = core) */
export const permissionModuleMap = createPermissionModuleMap();

/** modules that depend on the given module code (delegates to dependency engine) */
export function getDependentsOf(code: string): ModuleManifest[] {
  return getDependentManifests(code, moduleManifests);
}
