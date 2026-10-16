import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: "Travel Umroh — ERP Operasional",
  description: "Platform operasional travel umroh.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body className="min-h-screen bg-background antialiased"><AppShell>{children}</AppShell></body></html>;
}
