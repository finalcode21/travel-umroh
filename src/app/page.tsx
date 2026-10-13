import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          Scaffolding siap
        </span>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Travel Umroh
        </h1>
        <p className="max-w-md text-balance text-muted-foreground">
          Platform perjalanan ibadah — paket umroh, jadwal keberangkatan, dan
          reservasi jamaah. Halaman ini adalah tampilan awal sebelum fitur
          bisnis diimplementasikan.
        </p>
      </div>
      <div className="flex gap-3">
        <Button>Lihat Paket</Button>
        <Button variant="outline">Hubungi Kami</Button>
      </div>
    </main>
  );
}
