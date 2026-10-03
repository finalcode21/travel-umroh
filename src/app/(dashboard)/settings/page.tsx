import { getCurrentUser } from "@/core/auth/session";
import { getSystemSettings } from "@/core/settings/service";
import { getCompany } from "@/core/tenant/companies";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SystemSettingsForm } from "./system-settings-form";
import { CompanyPreferencesForm } from "./company-preferences-form";

export const dynamic = "force-dynamic";

export default async function GeneralSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const settings = user.isPlatformAdmin ? await getSystemSettings() : null;
  const company = user.companyId ? await getCompany(user.companyId) : null;

  if (!user.isPlatformAdmin && !company) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
          <CardDescription>Akun platform admin tidak memiliki pengaturan perusahaan.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {settings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Settings</CardTitle>
            <CardDescription>Default nilai platform (key-value store).</CardDescription>
          </CardHeader>
          <CardContent>
            <SystemSettingsForm initial={settings as Record<string, string | number>} />
          </CardContent>
        </Card>
      )}
      {company && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preferensi Perusahaan</CardTitle>
            <CardDescription>Lokalisasi, mata uang, dan zona waktu.</CardDescription>
          </CardHeader>
          <CardContent>
            <CompanyPreferencesForm
              companyId={company.id}
              initial={{
                currency: company.currency,
                timezone: company.timezone,
                locale: company.locale,
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
