import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { isClerkConfigured, getCurrentUser } from "@/core/auth/session";
import { SetupNotice } from "@/components/setup-notice";

export const metadata = { title: "Daftar" };

export default async function SignupPage() {
  if (!isClerkConfigured()) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
        <SetupNotice
          title="Registrasi belum tersedia"
          description="Konfigurasi Clerk keys untuk mengaktifkan autentikasi."
          missing={["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]}
        />
      </main>
    );
  }
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <SignUp signInUrl="/login" fallbackRedirectUrl="/dashboard" />
    </main>
  );
}
