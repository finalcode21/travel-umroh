import { getCurrentUser } from "@/core/auth/session";
import { listNotifications } from "@/core/notification/service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationsList } from "./notifications-list";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifikasi" };

export default async function NotificationsSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const rows = await listNotifications(user.companyId, user.id, 50);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notifikasi</CardTitle>
        <CardDescription>
          Channel in-app bawaan Core. Provider email/WhatsApp/push menjadi modul ekstensi.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <NotificationsList
          rows={rows.map((n) => ({
            id: n.id,
            title: n.title,
            body: n.body,
            type: n.type,
            link: n.link,
            readAt: n.readAt?.toISOString() ?? null,
            createdAt: n.createdAt.toISOString(),
          }))}
        />
      </CardContent>
    </Card>
  );
}
