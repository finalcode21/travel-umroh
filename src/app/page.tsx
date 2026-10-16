"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Tenant = { tenantId: string; tenantName: string };
type Departure = { id: string; code: string; departOn: string; status: string };
type PackageRow = { id: string; name: string; code: string; priceIdr: number; capacity: number; status: string };

const dateFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });

export default function DashboardPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [jamaahCount, setJamaahCount] = useState<number | null>(null);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [departures, setDepartures] = useState<(Departure & { packageName: string })[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mine = await fetch("/api/tenant/mine");
        const mineData = await mine.json();
        if (!mine.ok) throw new Error(mineData.error ?? "Tidak dapat mengambil tenant aktif.");
        const activeTenant = mineData.rows?.[0] as Tenant | undefined;
        if (!activeTenant) { if (!cancelled) setError("Akun ini belum terhubung ke tenant aktif. Data operasional belum dapat ditampilkan."); return; }
        if (cancelled) return;
        setTenant(activeTenant);
        const query = `tenantId=${encodeURIComponent(activeTenant.tenantId)}`;
        const [jamaahRes, paketRes] = await Promise.all([fetch(`/api/tenant/jamaah?${query}`), fetch(`/api/tenant/paket?${query}`)]);
        const jamaahData = await jamaahRes.json();
        const paketData = await paketRes.json();
        if (!jamaahRes.ok) throw new Error(`Jamaah: ${jamaahData.error ?? "gagal dimuat"}`);
        if (!paketRes.ok) throw new Error(`Paket: ${paketData.error ?? "gagal dimuat"}`);
        const paketRows = (paketData.rows ?? []) as PackageRow[];
        const details = await Promise.all(paketRows.map(async (item) => {
          const res = await fetch(`/api/tenant/paket/${item.id}?${query}`);
          if (!res.ok) return [] as (Departure & { packageName: string })[];
          const data = await res.json();
          return ((data.paket?.departures ?? []) as Departure[]).map((departure) => ({ ...departure, packageName: item.name }));
        }));
        if (!cancelled) {
          setJamaahCount((jamaahData.rows ?? []).length);
          setPackages(paketRows);
          setDepartures(details.flat().filter((item) => item.status === "open" && new Date(item.departOn) >= new Date()).sort((a, b) => +new Date(a.departOn) - +new Date(b.departOn)).slice(0, 5));
        }
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "Data dashboard gagal dimuat."); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  return <div className="space-y-6"><section className="rounded-2xl bg-gradient-to-br from-emerald-950 to-emerald-800 px-6 py-7 text-white shadow-sm sm:px-8"><p className="text-sm text-emerald-200">{tenant ? tenant.tenantName : "Operasional Travel Umroh"}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard operasional</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-100">Pantau jamaah, paket, dan jadwal keberangkatan dari data tenant yang sedang aktif.</p></section>{error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}<section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy={loading}><Metric label="Total jamaah" value={jamaahCount} note="Dari data yang diizinkan untuk akun ini" href="/jamaah" /><Metric label="Paket Umrah" value={packages.length} note="Seluruh paket pada tenant aktif" href="/paket" /><Metric label="Keberangkatan mendatang" value={departures.length} note="Jadwal berstatus buka yang akan datang" href="/paket" /></section><section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-semibold">Keberangkatan mendatang</h2><p className="mt-1 text-sm text-slate-500">Hanya jadwal aktif dari paket yang dapat diakses.</p></div><Link href="/paket" className="text-sm font-medium text-emerald-700 hover:underline">Kelola paket</Link></div><div className="divide-y divide-slate-100">{loading && <p className="p-5 text-sm text-slate-500" role="status">Memuat data dashboard…</p>}{!loading && !error && departures.length === 0 && <p className="p-5 text-sm text-slate-500">Belum ada keberangkatan mendatang yang berstatus buka.</p>}{departures.map((item) => <div key={item.id} className="flex flex-col gap-1 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-slate-900">{item.packageName}</p><p className="text-sm text-slate-500">{item.code}</p></div><p className="text-sm font-medium text-emerald-700">{dateFormat.format(new Date(item.departOn))}</p></div>)}</div></section></div>;
}

function Metric({ label, value, note, href }: { label: string; value: number | null; note: string; href: string }) { return <Link href={href} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow"><p className="text-sm font-medium text-slate-600">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value === null ? "—" : value}</p><p className="mt-2 text-xs leading-5 text-slate-500">{note}</p></Link>; }
