import { getCurrentUser } from "@/core/auth/session";
import { getCompany } from "@/core/tenant/companies";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CompanyProfileForm } from "./company-profile-form";
import { hasPermission } from "@/core/auth/session-helpers";

export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  const user = await getCurrentUser();
  if (!user || !user.companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Perusahaan</CardTitle>
          <CardDescription>
            Platform admin dikelola di menu Companies.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const company = await getCompany(user.companyId);
  if (!company) return null;
  const canManage = hasPermission(user, "company.manage");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profil Perusahaan</CardTitle>
        <CardDescription>
          Identitas tenant — semua data bisnis terikat ke perusahaan ini.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CompanyProfileForm
          company={company}
          disabled={!canManage}
        />
      </CardContent>
    </Card>
  );
}
