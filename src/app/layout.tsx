import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";
import { isClerkConfigured } from "@/core/auth/session";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Travel Umroh ERP",
    template: "%s · Travel Umroh ERP",
  },
  description:
    "Modular ERP platform untuk Travel Agent Umroh — Core System dengan Module Engine, Subscription, dan ACL.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const clerkReady = isClerkConfigured();
  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {clerkReady ? <ClerkProvider>{children}</ClerkProvider> : children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
