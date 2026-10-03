import { db } from "@/db";
import { systemSettings } from "@/db/schema";

export const SYSTEM_SETTINGS_DEFAULTS = {
  "app.name": "Travel Umroh ERP",
  "app.locale": "id",
  "app.currency": "IDR",
  "app.timezone": "Asia/Jakarta",
  "app.trialDaysDefault": 14,
} as const;

export type SystemSettingKey = keyof typeof SYSTEM_SETTINGS_DEFAULTS;

export async function getSystemSettings(): Promise<Record<string, unknown>> {
  const rows = await db.select().from(systemSettings);
  const merged: Record<string, unknown> = { ...SYSTEM_SETTINGS_DEFAULTS };
  for (const row of rows) {
    merged[row.key] = row.value;
  }
  return merged;
}

export async function saveSystemSettings(
  values: Record<string, unknown>,
  updatedBy: string,
): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await db
      .insert(systemSettings)
      .values({ key, value: value as never, updatedBy })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: value as never, updatedBy },
      });
  }
}
