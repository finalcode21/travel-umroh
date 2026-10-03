import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/session";
import { buildNavigation } from "@/core/navigation/build";
import {
  countUnread,
  listNotifications,
} from "@/core/notification/service";
import { AppShell } from "@/components/layout/app-shell";

export default async function DashboardLayout({ children }: { children: ReactNode }) {


  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "ACTIVE") redirect("/login");

  const nav = buildNavigation(user);
  const [notifications, unreadCount] = await Promise.all([
    listNotifications(user.companyId, user.id, 10),
    countUnread(user.companyId, user.id),
  ]);

  return (
    <AppShell
      nav={nav}
      company={user.companyName}
      isPlatformAdmin={user.isPlatformAdmin}
      unreadCount={unreadCount}
      notifications={notifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        type: n.type,
        link: n.link,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      }))}
      searchActions={
        user.isPlatformAdmin
          ? [
              { label: "Apps Marketplace", href: "/apps" },
              { label: "Pengaturan", href: "/settings" },
            ]
          : [
              { label: "Apps Marketplace", href: "/apps" },
              { label: "Pengaturan", href: "/settings" },
            ]
      }
    >
      {children}
    </AppShell>
  );
}
