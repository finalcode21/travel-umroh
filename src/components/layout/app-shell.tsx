"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { Bell, Check, Search, Zap } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { NavIcon } from "./icon";
import type { NavSection } from "@/types";
import { formatRelative } from "@/lib/format";

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
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [bellOpen, setBellOpen] = React.useState(false);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const navEntries = React.useMemo(
    () => nav.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label ?? "Umum" }))),
    [nav],
  );

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));

  const searchCommand = (
    <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
      <CommandInput placeholder="Cari halaman atau aksi…" />
      <CommandList>
        <CommandEmpty>Tidak ditemukan.</CommandEmpty>          {searchActions.length > 0 && (
            <CommandGroup heading="Aksi cepat">
              {searchActions.map((a) => (
                <CommandItem key={a.href} onSelect={() => { setSearchOpen(false); location.href = a.href; }}>
                  <Zap className="mr-2 h-4 w-4" /> {a.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        <CommandSeparator />
        <CommandGroup heading="Navigasi">
          {navEntries.map((item) => (
            <CommandItem key={item.code} value={`${item.label} ${item.section}`} onSelect={() => { setSearchOpen(false); location.href = item.href; }}>
              <NavIcon name={item.icon} className="mr-2 h-4 w-4" /> {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );

  const bell = (
    <Popover open={bellOpen} onOpenChange={setBellOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifikasi">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
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
      </PopoverContent>
    </Popover>
  );

  return (
    <SidebarProvider>
      {searchCommand}
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
            <div className="pl-1">
              <UserButton />
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
