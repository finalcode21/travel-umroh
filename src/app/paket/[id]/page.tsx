"use client";

/**
 * Halaman detail/edit Paket Umrah + daftar keberangkatan.
 * - GET    /api/tenant/paket/[id]?tenantId=…  → detail + departures.
 * - PATCH  /api/tenant/paket/[id]             → ubah data paket.
 * - POST   /api/tenant/paket/[id]/departures  → tambah keberangkatan.
 * - PATCH  /api/tenant/paket/[id]/departures/[depId] → ubah keberangkatan.
 *
 * State hanya di-set SETELAH await di dalam efek (aturan react-hooks
 * set-state-in-effect); pembaruan data setelah aksi memakai `reloadKey`.
 */
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

interface Departure {
  id: string;
  code: string;
  departOn: string;
  returnOn: string | null;
  capacity: number;
  status: string;
  notes: string | null;
}

interface PaketDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceIdr: number;
  capacity: number;
  status: string;
  departures: Departure[];
}

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(new Date(iso));
}

export default function PaketDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const paketId = params.id;
  const tenantId = searchParams.get("tenantId") ?? "";

  const [paket, setPaket] = useState<PaketDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Form edit paket
  const [fName, setFName] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fPrice, setFPrice] = useState("");
  const [fCapacity, setFCapacity] = useState("");
  const [fStatus, setFStatus] = useState("draft");

  // Form tambah keberangkatan
  const [dCode, setDCode] = useState("");
  const [dDepartOn, setDDepartOn] = useState("");
  const [dReturnOn, setDReturnOn] = useState("");
  const [dCapacity, setDCapacity] = useState("");

  useEffect(() => {
    if (!tenantId || !paketId) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/tenant/paket/${paketId}?tenantId=${tenantId}`);
      if (cancelled) return;
      const data = await res.json();
      if (res.ok) {
        const p = data.paket as PaketDetail;
        setPaket(p);
        setFName(p.name);
        setFDescription(p.description ?? "");
        setFPrice(String(p.priceIdr));
        setFCapacity(String(p.capacity));
        setFStatus(p.status);
        setError("");
      } else {
        setError(`${res.status}: ${data.error ?? ""}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, paketId, reloadKey]);

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!paket) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/tenant/paket/${paket.id}?tenantId=${tenantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fName,
          description: fDescription,
          priceIdr: Number(fPrice),
          capacity: Number(fCapacity),
          status: fStatus,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setNotice("Perubahan disimpan.");
        setReloadKey((k) => k + 1);
      } else {
        setError(`${res.status}: ${data.error ?? data.message ?? "gagal menyimpan"}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleAddDeparture(e: React.FormEvent) {
    e.preventDefault();
    if (!paket) return;
    setError("");
    setNotice("");
    const payload: Record<string, unknown> = {
      code: dCode,
      departOn: dDepartOn,
      capacity: dCapacity === "" ? 0 : Number(dCapacity),
    };
    if (dReturnOn) payload.returnOn = dReturnOn;
    const res = await fetch(
      `/api/tenant/paket/${paket.id}/departures?tenantId=${tenantId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const data = await res.json();
    if (res.status === 201) {
      setNotice("Keberangkatan ditambahkan.");
      setDCode("");
      setDDepartOn("");
      setDReturnOn("");
      setDCapacity("");
      setReloadKey((k) => k + 1);
    } else {
      setError(`${res.status}: ${data.error ?? data.message ?? "gagal menambah keberangkatan"}`);
    }
  }

  async function toggleDepartureStatus(dep: Departure) {
    if (!paket) return;
    setError("");
    const next = dep.status === "open" ? "closed" : "open";
    const res = await fetch(
      `/api/tenant/paket/${paket.id}/departures/${dep.id}?tenantId=${tenantId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      },
    );
    const data = await res.json();
    if (res.ok) {
      setReloadKey((k) => k + 1);
    } else {
      setError(`${res.status}: ${data.error ?? data.message ?? "gagal mengubah status"}`);
    }
  }

  if (!tenantId) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-muted-foreground">
          tenantId wajib di URL.{" "}
          <Link href="/paket" className="underline">
            Kembali ke daftar paket
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <Link href={`/paket?tenantId=${tenantId}`} className="text-sm underline">
        ← Daftar paket
      </Link>

      <h1 className="text-2xl font-semibold">{paket?.name ?? "Paket"}</h1>

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

      <form onSubmit={handleEdit} className="space-y-3 rounded border p-4">
        <h2 className="font-medium">Edit paket {paket && `· ${paket.code}`}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Nama
            <input
              className="mt-1 w-full rounded border p-2"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            Status
            <select
              className="mt-1 w-full rounded border p-2"
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
            >
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="closed">closed</option>
              <option value="archived">archived</option>
            </select>
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
          <label className="text-sm sm:col-span-2">
            Deskripsi
            <textarea
              className="mt-1 w-full rounded border p-2"
              rows={2}
              value={fDescription}
              onChange={(e) => setFDescription(e.target.value)}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          Simpan perubahan
        </button>
      </form>

      <section className="space-y-3">
        <h2 className="font-medium">Keberangkatan</h2>
        {paket && (
          <ul className="space-y-2">
            {paket.departures.map((d) => (
              <li key={d.id} className="rounded border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{d.code}</span>
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => void toggleDepartureStatus(d)}
                  >
                    {d.status === "open" ? "Tutup" : "Buka"}
                  </button>
                </div>
                <div className="text-sm text-muted-foreground">
                  Berangkat {fmtDate(d.departOn)} · pulang {fmtDate(d.returnOn)} · kapasitas{" "}
                  {d.capacity} · {d.status}
                </div>
              </li>
            ))}
            {paket.departures.length === 0 && (
              <li className="text-sm text-muted-foreground">Belum ada keberangkatan.</li>
            )}
          </ul>
        )}

        <form onSubmit={handleAddDeparture} className="space-y-3 rounded border p-4">
          <h3 className="font-medium">Tambah keberangkatan</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Code
              <input
                className="mt-1 w-full rounded border p-2"
                value={dCode}
                onChange={(e) => setDCode(e.target.value)}
                required
                maxLength={32}
              />
            </label>
            <label className="text-sm">
              Kapasitas
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded border p-2"
                value={dCapacity}
                onChange={(e) => setDCapacity(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Tanggal keberangkatan
              <input
                type="date"
                className="mt-1 w-full rounded border p-2"
                value={dDepartOn}
                onChange={(e) => setDDepartOn(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              Tanggal kepulangan
              <input
                type="date"
                className="mt-1 w-full rounded border p-2"
                value={dReturnOn}
                onChange={(e) => setDReturnOn(e.target.value)}
              />
            </label>
          </div>
          <button type="submit" className="rounded bg-primary px-4 py-2 text-primary-foreground">
            Tambah
          </button>
        </form>
      </section>
    </main>
  );
}
