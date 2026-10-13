import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Travel Umroh — Layanan Perjalanan Umroh Terpercaya",
  description:
    "Platform travel umroh: paket perjalanan, jadwal keberangkatan, dan reservasi jamaah.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-background antialiased">{children}</body>
    </html>
  );
}
