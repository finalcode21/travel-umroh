import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/core/auth/session";
import { cn } from "@/lib/utils";

export const metadata = { title: "Settings" };

const NAV = [
  { href: "/settings", label: "General", perm: "settings.manage" },
  { href: "/settings/company", label: "Perusahaan", perm: "company.manage" },
  { href: "/settings/companies", label: "Companies (Platform)", perm: "platform" },
  { href: "/settings/branches", label: "Cabang", perm: "branch.view" },
  { href: "/settings/users", label: "Pengguna", perm: "user.view" },
  { href: "/settings/roles", label: "Role & Permission", perm: "role.view" },
  { href: "/settings/modules", label: "Modul", perm: "module.view" },
  { href: "/settings/subscriptions", label: "Langganan", perm: "subscription.view" },
  { href: "/settings/notifications", label: "Notifikasi", perm: "notification.view" },
  { href: "/settings/audit-log", label: "Audit Log", perm: "audit.view" },
];

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const visible = NAV.filter((item) => {
    if (item.perm === "platform") return user.isPlatformAdmin;
    if (user.isPlatformAdmin) return true;
    return user.permissions.includes(item.perm);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Konfigurasi {user.companyName ?? "platform"}.
        </p>
      </div>
      <nav className="flex flex-wrap gap-1.5">
        {visible.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
              "border border-transparent hover:border-border",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div>{children}</div>
    </div>
  );
}
