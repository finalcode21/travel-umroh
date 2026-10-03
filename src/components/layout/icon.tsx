"use client";

import {
  LayoutDashboard,
  LayoutGrid,
  Settings,
  StickyNote,
  Sparkles,
  Building2,
  Users,
  ShieldCheck,
  KeyRound,
  Package,
  CreditCard,
  Bell,
  ScrollText,
  Globe,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  "layout-grid": LayoutGrid,
  settings: Settings,
  "sticky-note": StickyNote,
  sparkles: Sparkles,
  "building-2": Building2,
  users: Users,
  "shield-check": ShieldCheck,
  "key-round": KeyRound,
  package: Package,
  "credit-card": CreditCard,
  bell: Bell,
  "scroll-text": ScrollText,
  globe: Globe,
};

export function NavIcon({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  const Icon = (name && ICONS[name]) || Package;
  return <Icon className={className} />;
}
