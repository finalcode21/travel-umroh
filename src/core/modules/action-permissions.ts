/**
 * Granular lifecycle permission per module action (PRD §34).
 * The granular permission OR the legacy coarse `module.manage` both grant
 * access — existing seeded roles keep working unchanged (PRD §59).
 */
export const MODULE_ACTION_PERMISSIONS = {
  read: "module.read",
  subscribe: "module.subscribe",
  install: "module.install",
  enable: "module.enable",
  disable: "module.disable",
  upgrade: "module.upgrade",
  uninstall: "module.uninstall",
  configure: "module.configure",
  deleteData: "module.uninstall",
} as const;

export type ModuleAction = keyof typeof MODULE_ACTION_PERMISSIONS;

/** Permission alternatives that authorize a lifecycle action (OR semantics). */
export function moduleActionPermissions(action: ModuleAction): string[] {
  return [MODULE_ACTION_PERMISSIONS[action], "module.manage"];
}

/** Non-throwing check for permission-aware UI. */
export function canPerformModuleAction(
  user: { isPlatformAdmin: boolean; permissions: string[] },
  action: ModuleAction,
): boolean {
  if (user.isPlatformAdmin) return true;
  return moduleActionPermissions(action).some((p) => user.permissions.includes(p));
}
