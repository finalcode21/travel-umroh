"use client";

/**
 * Halaman daftar Paket Umrah.
 * - URL: /paket?tenantId=<uuid> (fallback: ambil dari /api/tenant/mine).
 * - Daftar/pencarian/filter status via GET /api/tenant/paket.
 * - Tambah paket via POST /api/tenant/paket.
 * - Cursor pagination memakai nextCursor dari server.
 *
 * Catatan pattern: state hanya di-set SETELAH await di dalam efek
 * (aturan react-hooks set-state-in-effect); refresh setelah aksi memakai
 * `reloadKey` yang dinaikkan oleh event handler.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface PaketRow {
  id: string;
  code: string;
  name: string;
  priceIdr: number;
  capacity: number;
  status: string;
}

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export default function PaketListPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [rows, setRows] = useState<PaketRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // Form tambah
  const [fCode, setFCode] = useState("");
  const [fName, setFName] = useState("");
  const [fPrice, setFPrice] = useState("");
  const [fCapacity, setFCapacity] = useState("");

  // Temukan tenantId dari URL atau daftar tenant milik sesi.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = new URL(window.location.href);
      let tid = url.searchParams.get("tenantId") ?? "";
      if (!tid) {
        const mine = await fetch("/api/tenant/mine");
        if (mine.status === 401) {
          router.replace("/");
          return;
        }
        const mineData = await mine.json();
        tid = mineData.rows?.[0]?.tenantId ?? "";
        if (tid) {
          router.replace(`/paket?tenantId=${tid}`);
        }
      }
      if (!cancelled) setTenantId(tid);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Muat ulang halaman pertama saat tenantId / pencarian / filter berubah.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams({ tenantId });
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      params.set("limit", "20");
      const res = await fetch(`/api/tenant/paket?${params.toString()}`);
      if (cancelled) return;
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows as PaketRow[]);
        setNextCursor((data.nextCursor as string | null) ?? null);
        setError("");
      } else {
        setError(`${res.status}: ${data.error ?? data.message ?? "gagal memuat"}`);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, search, status, reloadKey]);

  async function handleLoadMore() {
    if (!tenantId || !nextCursor) return;
    const params = new URLSearchParams({ tenantId, limit: "20", cursor: nextCursor });
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    const res = await fetch(`/api/tenant/paket?${params.toString()}`);
    const data = await res.json();
    if (res.ok) {
      setRows((prev) => [...prev, ...(data.rows as PaketRow[])]);
      setNextCursor((data.nextCursor as string | null) ?? null);
    } else {
      setError(`${res.status}: ${data.error ?? data.message ?? "gagal memuat"}`);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const payload = {
      code: fCode,
      name: fName,
      priceIdr: fPrice === "" ? 0 : Number(fPrice),
      capacity: fCapacity === "" ? 0 : Number(fCapacity),
    };
    const res = await fetch(`/api/tenant/paket?tenantId=${tenantId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.status === 201) {
      setNotice("Paket dibuat.");
      setFCode("");
      setFName("");
      setFPrice("");
      setFCapacity("");
      setReloadKey((k) => k + 1);
    } else {
      setError(`${res.status}: ${data.error ?? data.message ?? "gagal membuat paket"}`);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Paket Umrah</h1>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700">
          {notice}
        </p>
      )}

      <section className="flex flex-wrap items-center gap-3">
        <input
          className="flex-1 min-w-48 rounded border p-2"
          placeholder="Cari nama / code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Pencarian paket"
        />
        <select
          className="rounded border p-2"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter status"
        >
          <option value="">Semua status</option>
          <option value="draft">draft</option>
          <option value="published">published</option>
          <option value="closed">closed</option>
          <option value="archived">archived</option>
        </select>
      </section>

      <section className="space-y-2" aria-busy={loading}>
        {rows.map((p) => (
          <Link
            key={p.id}
            href={`/paket/${p.id}?tenantId=${tenantId}`}
            className="block rounded border p-3 hover:bg-muted/50"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{p.name}</span>
              <span className="text-sm text-muted-foreground">{p.code}</span>
            </div>
            <div className="text-sm text-muted-foreground">
              {rupiah.format(p.priceIdr)} · kapasitas {p.capacity} · status {p.status}
            </div>
          </Link>
        ))}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada paket.</p>
        )}
        {nextCursor && (
          <button
            type="button"
            className="rounded border p-2 text-sm"
            onClick={() => void handleLoadMore()}
          >
            Muat lebih banyak
          </button>
        )}
      </section>

      <form onSubmit={handleCreate} className="space-y-3 rounded border p-4">
        <h2 className="font-medium">Tambah paket</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Code
            <input
              className="mt-1 w-full rounded border p-2"
              value={fCode}
              onChange={(e) => setFCode(e.target.value)}
              required
              maxLength={32}
            />
          </label>
          <label className="text-sm">
            Nama paket
            <input
              className="mt-1 w-full rounded border p-2"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label className="text-sm">
            Harga (IDR)
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded border p-2"
              value={fPrice}
              onChange={(e) => setFPrice(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Kapasitas
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded border p-2"
              value={fCapacity}
              onChange={(e) => setFCapacity(e.target.value)}
            />
          </label>
        </div>
        <button type="submit" className="rounded bg-primary px-4 py-2 text-primary-foreground">
          Simpan paket
        </button>
      </form>
    </main>
  );
}
