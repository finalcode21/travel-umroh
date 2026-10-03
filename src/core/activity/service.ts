import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, users } from "@/db/schema";

export interface ActivityInput {
  companyId: string | null;
  userId: string | null;
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export async function recordActivity(input: ActivityInput): Promise<void> {
  try {
    await db.insert(activityLogs).values({
      companyId: input.companyId,
      userId: input.userId,
      type: input.type,
      message: input.message,
      metadata: input.metadata,
    });
  } catch (e) {
    // activity log must never break the main flow
    console.error("[activity] failed to record", e);
  }
}

export async function listRecentActivities(companyId: string, limit = 8) {
  return db
    .select({
      id: activityLogs.id,
      type: activityLogs.type,
      message: activityLogs.message,
      createdAt: activityLogs.createdAt,
      userName: users.name,
    })
    .from(activityLogs)
    .leftJoin(users, eq(users.id, activityLogs.userId))
    .where(eq(activityLogs.companyId, companyId))
    .orderBy(desc(activityLogs.createdAt))
    .limit(limit);
}

export async function listPlatformActivities(limit = 8) {
  return db
    .select({
      id: activityLogs.id,
      type: activityLogs.type,
      message: activityLogs.message,
      createdAt: activityLogs.createdAt,
      userName: users.name,
    })
    .from(activityLogs)
    .leftJoin(users, eq(users.id, activityLogs.userId))
    .orderBy(desc(activityLogs.createdAt))
    .limit(limit);
}
