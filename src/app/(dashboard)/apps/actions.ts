"use server";

import { runAction } from "@/lib/action";
import {
  cancelSubscription,
  deleteModuleData,
  getModuleSettingsMap,
  installModule,
  renewSubscription,
  saveModuleSettings,
  setModuleEnabled,
  subscribeModule,
  uninstallModule,
} from "@/core/modules/engine";
import {
  renewSubscriptionSchema,
  moduleActionSchema,
  saveModuleSettingsSchema,
  parseWith,
} from "@/lib/validation";

export async function subscribeModuleAction(input: unknown) {
  return runAction("module.manage", async (user) => {
    const { moduleCode } = parseWith(moduleActionSchema, input);
    await subscribeModule(user, moduleCode);
    return { moduleCode };
  });
}

export async function installModuleAction(input: unknown) {
  return runAction("module.manage", async (user) => {
    const { moduleCode } = parseWith(moduleActionSchema, input);
    return installModule(user, moduleCode);
  });
}

export async function enableModuleAction(input: unknown) {
  return runAction("module.manage", async (user) => {
    const { moduleCode } = parseWith(moduleActionSchema, input);
    await setModuleEnabled(user, moduleCode, true);
    return { moduleCode };
  });
}

export async function disableModuleAction(input: unknown) {
  return runAction("module.manage", async (user) => {
    const { moduleCode } = parseWith(moduleActionSchema, input);
    await setModuleEnabled(user, moduleCode, false);
    return { moduleCode };
  });
}

export async function uninstallModuleAction(input: unknown) {
  return runAction("module.manage", async (user) => {
    const { moduleCode } = parseWith(moduleActionSchema, input);
    return uninstallModule(user, moduleCode);
  });
}

export async function deleteModuleDataAction(input: unknown) {
  return runAction("module.manage", async (user) => {
    const { moduleCode } = parseWith(moduleActionSchema, input);
    await deleteModuleData(user, moduleCode);
    return { moduleCode };
  });
}

export async function renewSubscriptionAction(input: unknown) {
  return runAction("subscription.manage", async (user) => {
    const { subscriptionId, months } = parseWith(renewSubscriptionSchema, input);
    await renewSubscription(user, subscriptionId, months);
    return { subscriptionId };
  });
}

export async function cancelSubscriptionAction(input: unknown) {
  return runAction("subscription.manage", async (user) => {
    const { subscriptionId } = parseWith(
      renewSubscriptionSchema.pick({ subscriptionId: true }),
      input,
    );
    await cancelSubscription(user, subscriptionId);
    return { subscriptionId };
  });
}

export async function saveModuleSettingsAction(input: unknown) {
  return runAction("module.manage", async (user) => {
    const { moduleCode, values } = parseWith(saveModuleSettingsSchema, input);
    await saveModuleSettings(user, moduleCode, values);
    return { moduleCode };
  });
}

export async function getModuleSettingsAction(moduleCode: string) {
  return runAction(null, async (user) => {
    if (!user.companyId) throw new Error("Perusahaan tidak ditemukan");
    return getModuleSettingsMap(user.companyId, moduleCode);
  });
}
