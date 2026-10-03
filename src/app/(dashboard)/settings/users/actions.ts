"use server";

import { z } from "zod";
import { runAction } from "@/lib/action";
import { parseWith, createUserSchema, updateUserSchema } from "@/lib/validation";
import {
  createUserWithLocal,
  resetUserPassword,
  updateUser,
} from "@/core/auth/users-admin";

const resetSchema = z.object({ userId: z.string().uuid() });

export async function createUserAction(input: unknown) {
  return runAction("user.manage", async (user) => {
    const data = parseWith(createUserSchema, input);
    return createUserWithLocal(user, data);
  });
}

export async function updateUserAction(userId: string, input: unknown) {
  return runAction("user.manage", async (user) => {
    const data = parseWith(updateUserSchema, input);
    await updateUser(user, userId, data);
    return { userId };
  });
}

export async function resetUserPasswordAction(input: unknown) {
  return runAction("user.manage", async (user) => {
    const { userId } = parseWith(resetSchema, input);
    return resetUserPassword(user, userId);
  });
}
