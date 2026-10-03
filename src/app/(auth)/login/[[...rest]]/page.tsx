import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthForm } from "../../auth-form";

export const metadata = { title: "Login" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string; email?: string }>;
}) {
  const resolvedParams = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">Travel Umroh</CardTitle>
          <CardDescription>Masuk ke dashboard</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthForm
            mode="login"
            redirectTo={resolvedParams.redirect}
            initialEmail={resolvedParams.email}
            initialError={resolvedParams.error}
          />

          <div className="mt-4 text-center text-xs text-muted-foreground">
            <p>
              Tidak punya akun?{" "}
              <Link href="/signup" className="text-primary hover:underline">
                Daftar
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
