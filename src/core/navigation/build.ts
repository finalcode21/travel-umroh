import { moduleManifests } from "@/modules/registry";
import type { CurrentUser, NavSection } from "@/types";

/**
 * Build sidebar sections dynamically (PRD §20):
 *   Installed Modules → Active Subscription → User Permission → Navigation
 * Modules that are disabled / paused / uninstalled simply disappear.
 */
export function buildNavigation(user: CurrentUser): NavSection[] {
  const sections: NavSection[] = [
    {
      code: "general",
      items: [{ code: "dashboard", label: "Dashboard", icon: "layout-dashboard", href: "/dashboard" }],
    },
  ];

  if (!user.isPlatformAdmin) {
    const moduleItems = moduleManifests
      .flatMap((manifest) => {
        const access = user.moduleAccess[manifest.code];
        if (!access || access.access !== "ACTIVE") return [];
        return manifest.navigation
          .filter((item) => !item.permission || user.permissions.includes(item.permission))
          .map((item) => ({
            code: item.code,
            label: item.label,
            icon: item.icon,
            href: item.href,
            order: item.order ?? 0,
          }));
      })
      .sort((a, b) => a.order - b.order);

    if (moduleItems.length > 0) {
      sections.push({ code: "modules", label: "Modul", items: moduleItems });
    }
  }

  const systemItems = [
    ...(user.isPlatformAdmin || user.permissions.includes("module.view")
      ? [{ code: "apps", label: "Apps", icon: "layout-grid", href: "/apps" }]
      : []),
    ...((user.isPlatformAdmin ||
      user.permissions.some((p) =>
        [
          "settings.manage",
          "company.manage",
          "branch.manage",
          "user.manage",
          "role.manage",
          "module.manage",
          "subscription.manage",
          "audit.view",
        ].includes(p),
      ))
      ? [
          {
            code: "settings",
            label: "Settings",
            icon: "settings",
            href: "/settings",
          },
        ]
      : []),
  ];
  if (systemItems.length > 0) {
    sections.push({ code: "system", label: "Sistem", items: systemItems });
  }

  return sections;
}
