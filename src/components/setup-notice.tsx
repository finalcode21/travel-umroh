import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SetupNotice({
  missing,
  title = "Setup diperlukan",
  description = "Environment variables berikut belum dikonfigurasi.",
}: {
  missing: string[];
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2 text-sm">
            {missing.map((m) => (
              <li key={m} className="rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">
                {m}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Salin <code className="rounded bg-muted px-1">.env.example</code> ke{" "}
            <code className="rounded bg-muted px-1">.env.local</code>, isi nilainya,
            lalu jalankan <code className="rounded bg-muted px-1">npm run db:migrate</code>{" "}
            dan <code className="rounded bg-muted px-1">npm run db:seed</code>. Restart
            dev server setelahnya.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
