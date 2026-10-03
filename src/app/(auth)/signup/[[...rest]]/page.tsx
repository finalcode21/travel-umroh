import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthForm } from "../../auth-form";

export const metadata = { title: "Daftar" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; name?: string; email?: string }>;
}) {
  const resolvedParams = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">Travel Umroh</CardTitle>
          <CardDescription>Buat akun baru</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthForm
            mode="signup"
            redirectTo={resolvedParams.redirect}
            initialName={resolvedParams.name}
            initialEmail={resolvedParams.email}
          />
          <div className="mt-4 text-center text-xs text-muted-foreground">
            <p>
              Sudah punya akun?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Masuk
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
