import { notFound } from "next/navigation";

const sections: Record<string, { title: string; description: string }> = {
  reservasi: { title: "Reservasi", description: "Modul reservasi belum terhubung karena endpoint dan skema reservasi belum tersedia di proyek ini." },
  pembayaran: { title: "Pembayaran", description: "Modul pembayaran belum terhubung karena endpoint dan skema pembayaran belum tersedia di proyek ini." },
  dokumen: { title: "Dokumen", description: "Modul dokumen belum terhubung karena endpoint dan penyimpanan dokumen belum tersedia di proyek ini." },
  laporan: { title: "Laporan", description: "Modul laporan belum terhubung karena sumber data dan endpoint laporan belum tersedia di proyek ini." },
  pengaturan: { title: "Pengaturan", description: "Pengaturan tenant belum tersedia sebagai endpoint aplikasi. Data tidak diubah dari halaman ini." },
};

export default async function PlaceholderPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = sections[section];
  if (!item) notFound();
  return <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-medium text-amber-700">Belum tersedia</p><h1 className="mt-1 text-2xl font-semibold">{item.title}</h1><p className="mt-3 leading-7 text-slate-600">{item.description}</p></div>;
}
