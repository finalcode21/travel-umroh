"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/password-input";

type AuthMode = "login" | "signup";

interface AuthFormProps {
  mode: AuthMode;
  redirectTo?: string;
  initialName?: string;
  initialEmail?: string;
  initialError?: string;
}

interface AuthResponse {
  ok?: boolean;
  message?: string;
}

function safeRedirect(path: string | undefined): string {
  return path?.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
}

export function AuthForm({
  mode,
  redirectTo,
  initialName = "",
  initialEmail = "",
  initialError,
}: AuthFormProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(initialError ?? "");
  const isSignup = mode === "signup";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as AuthResponse;

      if (!response.ok || !result.ok) {
        setError(result.message ?? (isSignup ? "Gagal mendaftar." : "Gagal masuk."));
        return;
      }

      router.replace(safeRedirect(redirectTo));
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {isSignup && (
        <div className="space-y-2">
          <Label htmlFor="name">Nama lengkap</Label>
          <Input id="name" name="name" required placeholder="Budi Santoso" defaultValue={initialName} />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="nama@perusahaan.id"
          defaultValue={initialEmail}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Kata sandi</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          placeholder={isSignup ? "Minimal 8 karakter" : "Kata sandi"}
          minLength={isSignup ? 8 : undefined}
        />
      </div>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {busy ? "Memproses…" : isSignup ? "Daftar" : "Masuk"}
      </Button>
    </form>
  );
}
