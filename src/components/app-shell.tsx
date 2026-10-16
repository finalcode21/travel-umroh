"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";

const navigation = [
  { href: "/", label: "Dashboard", mark: "D" },
  { href: "/jamaah", label: "Jamaah", mark: "J" },
  { href: "/paket", label: "Paket Umrah", mark: "P" },
  { href: "/reservasi", label: "Reservasi", mark: "R" },
  { href: "/pembayaran", label: "Pembayaran", mark: "B" },
  { href: "/dokumen", label: "Dokumen", mark: "K" },
  { href: "/laporan", label: "Laporan", mark: "L" },
  { href: "/pengaturan", label: "Pengaturan", mark: "G" },
];

function isActive(pathname: string, href: string) { return href === "/" ? pathname === "/" : pathname.startsWith(href); }

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data: session, isPending } = authClient.useSession();
  const isLogin = pathname === "/login";
  useEffect(() => { if (!isLogin && !isPending && !session) router.replace("/login"); }, [isLogin, isPending, router, session]);
  if (isLogin) return <>{children}</>;
  if (isPending || !session) return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><div className="rounded-xl border bg-white px-5 py-4 text-sm text-slate-600 shadow-sm" role="status">Memeriksa sesi Anda…</div></main>;
  async function signOut() { await authClient.signOut(); router.replace("/login"); }
  const sidebar = <aside className="flex h-full w-72 flex-col border-r border-emerald-950/10 bg-[#063d35] p-4 text-emerald-50 shadow-xl">
    <Link href="/" className="mb-8 flex items-center gap-3 rounded-lg px-2 py-2" aria-label="Travel Umroh ERP"><span className="grid size-10 place-items-center rounded-xl bg-amber-400 font-serif text-xl font-bold text-emerald-950">T</span><span><span className="block text-base font-semibold tracking-tight">Travel Umroh</span><span className="block text-xs text-emerald-200">ERP Operasional</span></span></Link>
    <nav className="space-y-1" aria-label="Navigasi utama">{navigation.map((item) => { const active = isActive(pathname, item.href); return <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${active ? "bg-emerald-700 text-white shadow-sm" : "text-emerald-100 hover:bg-emerald-900/70"}`} aria-current={active ? "page" : undefined}><span className="grid size-6 place-items-center rounded bg-white/10 text-xs font-semibold">{item.mark}</span>{item.label}</Link>; })}</nav>
    <div className="mt-auto rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-emerald-100"><p className="font-medium text-white">{session.user.name || session.user.email}</p><p className="mt-1 truncate text-emerald-200">{session.user.email}</p><button type="button" onClick={() => void signOut()} className="mt-3 rounded-md border border-white/20 px-2.5 py-1.5 font-medium hover:bg-white/10">Keluar</button></div>
  </aside>;
  return <div className="min-h-screen bg-slate-50 text-slate-900"><div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</div>{open && <button aria-label="Tutup navigasi" className="fixed inset-0 z-40 bg-slate-950/45 lg:hidden" onClick={() => setOpen(false)} />}<div className={`fixed inset-y-0 left-0 z-50 transition-transform lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}>{sidebar}</div><div className="lg:pl-72"><header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6"><div className="flex items-center gap-3"><button type="button" className="rounded-md border border-slate-200 p-2 lg:hidden" aria-label="Buka navigasi" onClick={() => setOpen(true)}>☰</button><div><p className="text-sm font-semibold">{navigation.find((item) => isActive(pathname, item.href))?.label ?? "Travel Umroh"}</p><p className="text-xs text-slate-500">Pusat operasional perjalanan ibadah</p></div></div><span className="hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 sm:inline">Sesi aktif</span></header><main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">{children}</main></div></div>;
}
