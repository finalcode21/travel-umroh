"use server";

import { runAction } from "@/lib/action";
import {
  renewSubscriptionSchema,
  parseWith,
  saveSystemSettingsSchema,
} from "@/lib/validation";
import { saveSystemSettings } from "@/core/settings/service";
import { renewSubscription, cancelSubscription } from "@/core/modules/engine";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/core/notification/service";

export async function saveSystemSettingsAction(input: unknown) {
  return runAction("settings.manage", async (user) => {
    const { values } = parseWith(saveSystemSettingsSchema, input);
    await saveSystemSettings(values, user.id);
    return { saved: true };
  });
}

export async function renewSubscriptionAdminAction(input: unknown) {
  return runAction("subscription.manage", async (user) => {
    const { subscriptionId, months } = parseWith(renewSubscriptionSchema, input);
    await renewSubscription(user, subscriptionId, months);
    return { subscriptionId };
  });
}

export async function cancelSubscriptionAdminAction(input: unknown) {
  return runAction("subscription.manage", async (user) => {
    const { subscriptionId } = parseWith(
      renewSubscriptionSchema.pick({ subscriptionId: true }),
      input,
    );
    await cancelSubscription(user, subscriptionId);
    return { subscriptionId };
  });
}

export async function markNotificationReadAction(input: unknown) {
  return runAction(null, async (user) => {
    const { id } = parseWith(
      renewSubscriptionSchema.pick({ subscriptionId: true }).transform((v) => ({ id: v.subscriptionId })),
      input,
    );
    await markNotificationRead(user.companyId, user.id, id);
    return { id };
  });
}

export async function markAllNotificationsReadAction() {
  return runAction(null, async (user) => {
    await markAllNotificationsRead(user.companyId, user.id);
    return { done: true };
  });
}
