"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LogOut, Search, Zap, Bell, Check, ChevronsUpDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { NavIcon } from "./icon";
import type { NavSection } from "@/types";
import { formatRelative } from "@/lib/format";

/**
 * Logs out via the API route, then returns to the login screen. This must stay
 * client-side — importing the session store would pull the DB driver into the
 * browser bundle.
 */
async function signOut(router: ReturnType<typeof useRouter>) {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    router.replace("/login");
    router.refresh();
  }
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  type: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface AppShellProps {
  nav: NavSection[];
  company: string | null;
  isPlatformAdmin: boolean;
  unreadCount: number;
  notifications: NotificationItem[];
  searchActions?: { label: string; href: string }[];
  children: React.ReactNode;
}

export function AppShell({
  nav,
  company,
  isPlatformAdmin,
  unreadCount,
  notifications,
  searchActions = [],
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [bellOpen, setBellOpen] = React.useState(false);
  const [accountOpen, setAccountOpen] = React.useState(false);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setBellOpen(false);
        setAccountOpen(false);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));

  const searchCommand = (
    <div className="absolute inset-0 z-50 flex items-start mx-auto max-w-2xl rounded-md border bg-background p-4">
      <div className="flex-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            className="w-full rounded border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Cari halaman atau aksi…"
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearchOpen(false);
              if (e.key === "Enter" && pathname !== "/dashboard") {
                setSearchOpen(false);
                router.push("/dashboard");
              }
            }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {searchActions.map((a) => (
            <Button
              key={a.href}
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchOpen(false);
                router.push(a.href);
              }}
            >
              <Zap className="mr-2 h-4 w-4" /> {a.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );

  const bell = (
    <DropdownMenu open={bellOpen} onOpenChange={setBellOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifikasi">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifikasi</span>
          <form action="/api/notifications/mark-all" method="post">
            <Button type="submit" variant="ghost" size="sm" className="h-7 gap-1 text-xs">
              <Check className="h-3 w-3" /> Tandai dibaca
            </Button>
          </form>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Belum ada notifikasi.
            </p>
          )}
          {notifications.map((n) => (
            <Link
              key={n.id}
              href={n.link ?? "#"}
              className="block border-b px-3 py-2 last:border-0 hover:bg-accent"
              onClick={() => setBellOpen(false)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{n.title}</span>
                {!n.readAt && <Badge variant="secondary" className="h-1.5 w-1.5 rounded-full p-0" />}
              </div>
              {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
              <p className="text-[11px] text-muted-foreground">{formatRelative(n.createdAt)}</p>
            </Link>
          ))}
        </div>
        <Separator />
        <div className="px-3 py-2">
          <Link href="/settings/notifications" className="text-xs text-muted-foreground hover:underline">
            Lihat semua notifikasi
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SidebarProvider>
        {searchOpen && searchCommand}
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenuButton size="lg" asChild tooltip="Travel Umroh ERP">
              <Link href="/dashboard">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary font-bold text-primary-foreground">
                  TU
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="font-semibold">Travel Umroh</span>
                  <span className="text-xs text-muted-foreground line-clamp-1">
                    {company ?? "Platform Admin"}
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarHeader>
          <SidebarContent>
            {nav.map((section) => (
              <SidebarGroup key={section.code}>
                {section.label && <SidebarGroupLabel>{section.label}</SidebarGroupLabel>}
                <SidebarGroupContent>
                  {section.items.map((item) => (
                    <SidebarMenuItem key={item.code}>
                      <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.label}>
                        <Link href={item.href}>
                          <NavIcon name={item.icon} />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background px-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            {isPlatformAdmin && (
              <Badge variant="outline" className="hidden sm:inline-flex">
                Platform Admin
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              className="ml-1 h-8 w-40 justify-start gap-2 text-muted-foreground md:w-64"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Cari…</span>
              <kbd className="ml-auto hidden rounded border px-1 font-mono text-[10px] md:inline">
                ⌘K
              </kbd>
            </Button>
            <div className="ml-auto flex items-center gap-1">
              {bell}
              <DropdownMenu open={accountOpen} onOpenChange={setAccountOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 px-2 py-1 h-8">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                      {company?.[0] ?? "A"}
                    </div>
                    <span className="text-sm font-medium">{company ?? "Platform Admin"}</span>
                    <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64" align="end" forceMount>
                  <div className="flex items-center gap-3 px-3 py-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
                      {company?.[0] ?? "A"}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{company ?? "Platform Admin"}</p>
                      <p className="text-xs text-muted-foreground">{company ?? "platform@umroh.id"}</p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600"
                    onSelect={() => {
                      setAccountOpen(false);
                      void signOut(router);
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" /> Keluar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
