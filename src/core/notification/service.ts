import { and, count, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";

export interface NotifyInput {
  companyId: string | null;
  /** null → company-wide broadcast */
  userId?: string | null;
  title: string;
  body?: string;
  type?: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  link?: string;
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    await db.insert(notifications).values({
      companyId: input.companyId,
      userId: input.userId ?? null,
      title: input.title,
      body: input.body,
      type: input.type ?? "INFO",
      link: input.link,
    });
  } catch (e) {
    console.error("[notification] failed", e);
  }
}

function visibleTo(companyId: string | null, userId: string) {
  return and(
    companyId ? eq(notifications.companyId, companyId) : isNull(notifications.companyId),
    or(eq(notifications.userId, userId), isNull(notifications.userId)),
  );
}

export async function listNotifications(
  companyId: string | null,
  userId: string,
  limit = 20,
) {
  return db
    .select()
    .from(notifications)
    .where(visibleTo(companyId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function countUnread(companyId: string | null, userId: string) {
  const [{ total }] = await db
    .select({ total: count() })
    .from(notifications)
    .where(and(visibleTo(companyId, userId), isNull(notifications.readAt)));
  return Number(total);
}

export async function markNotificationRead(
  companyId: string | null,
  userId: string,
  id: string,
) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        visibleTo(companyId, userId),
        isNull(notifications.readAt),
      ),
    );
}

export async function markAllNotificationsRead(
  companyId: string | null,
  userId: string,
) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(visibleTo(companyId, userId), isNull(notifications.readAt)));
}
