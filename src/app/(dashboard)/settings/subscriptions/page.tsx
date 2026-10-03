import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/core/auth/session";
import { db } from "@/db";
import { moduleSubscriptions, modules } from "@/db/schema";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SubscriptionsTable } from "./subscriptions-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Langganan" };

export default async function SubscriptionsSettingsPage() {
  const user = await getCurrentUser();
  if (!user || !user.companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Langganan</CardTitle>
          <CardDescription>
            Langganan berlaku per perusahaan — kelola dari akun perusahaan.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const rows = await db
    .select({
      id: moduleSubscriptions.id,
      moduleCode: modules.code,
      moduleName: modules.name,
      planName: moduleSubscriptions.planName,
      priceMonthly: moduleSubscriptions.priceMonthly,
      status: moduleSubscriptions.status,
      startedAt: moduleSubscriptions.startedAt,
      expiresAt: moduleSubscriptions.expiresAt,
      cancelledAt: moduleSubscriptions.cancelledAt,
    })
    .from(moduleSubscriptions)
    .innerJoin(modules, eq(modules.id, moduleSubscriptions.moduleId))
    .where(eq(moduleSubscriptions.companyId, user.companyId))
    .orderBy(desc(moduleSubscriptions.createdAt));

  return (
    <SubscriptionsTable
      rows={rows.map((r) => ({
        ...r,
        startedAt: r.startedAt.toISOString(),
        expiresAt: r.expiresAt?.toISOString() ?? null,
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
      }))}
      canManage={user.permissions.includes("subscription.manage") || user.isPlatformAdmin}
    />
  );
}
