import { getCurrentUser } from "@/core/auth/session";
import { listPlatformCompanies } from "@/core/tenant/companies";
import { PlatformCompaniesTable } from "./companies-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Companies" };

export default async function CompaniesPlatformPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!user.isPlatformAdmin) {
    return (
      <p className="text-sm text-muted-foreground">Khusus platform admin.</p>
    );
  }
  const companies = await listPlatformCompanies();
  return <PlatformCompaniesTable rows={companies} />;
}
