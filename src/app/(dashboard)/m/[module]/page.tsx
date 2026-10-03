import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/core/auth/session";
import { assertPermission, checkPermission } from "@/core/acl";
import { getModuleAccessMap } from "@/core/modules/access";
import { moduleUIRegistry } from "@/modules/ui-registry";
import { SetupNotice } from "@/components/setup-notice";

export const dynamic = "force-dynamic";

export default async function ModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module: moduleCode } = await params;
  const Page = moduleUIRegistry[moduleCode];
  if (!Page) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // ACL layers: module must be ACTIVE for this company, then permission check
  const access = user.companyId
    ? (await getModuleAccessMap(user.companyId))[moduleCode]
    : undefined;
  if (!user.isPlatformAdmin && (!access || access.access !== "ACTIVE")) {
    return (
      <SetupNotice
        title="Modul tidak aktif"
        description="Langganan atau instalasi modul ini tidak aktif. Buka halaman Apps untuk mengelola."
        missing={[]}
      />
    );
  }

  // page-level permission comes from the module's navigation entry
  const { moduleManifests } = await import("@/modules/registry");
  const manifest = moduleManifests.find((m) => m.code === moduleCode);
  const navPermission = manifest?.navigation.find(
    (n) => n.href === `/m/${moduleCode}`,
  )?.permission;

  if (navPermission) {
    const decision = checkPermission(user, navPermission);
    if (!decision.allowed) {
      return (
        <SetupNotice
          title="Akses ditolak"
          description={`Permission "${navPermission}" diperlukan. Minta Company Admin memberikan permission ini pada role Anda.`}
          missing={[]}
        />
      );
    }
    assertPermission(user, navPermission);
  }

  return <Page />;
}
