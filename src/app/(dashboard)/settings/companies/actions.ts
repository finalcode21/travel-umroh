"use server";

import { z } from "zod";
import { runAction } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { parseWith } from "@/lib/validation";
import {
  createPlatformCompany,
  setPlatformCompanyStatus,
} from "@/core/tenant/companies";

const createSchema = z.object({
  name: z.string().min(2).max(120).trim(),
  legalName: z.string().max(160).optional(),
  address: z.string().max(400).optional(),
  phone: z.string().max(32).optional(),
  email: z.string().max(120).optional(),
  currency: z.string().min(1).max(8).default("IDR"),
  timezone: z.string().min(1).max(64).default("Asia/Jakarta"),
  status: z.enum(["ACTIVE", "SUSPENDED"]).default("ACTIVE"),
});

export async function createPlatformCompanyAction(input: unknown) {
  return runAction(null, async (user) => {
    if (!user.isPlatformAdmin) {
      throw new AppError("FORBIDDEN", "Khusus platform admin.");
    }
    const data = parseWith(createSchema, input);
    return createPlatformCompany(user.id, data);
  });
}

export async function setCompanyStatusAction(companyId: string, status: "ACTIVE" | "SUSPENDED") {
  return runAction(null, async (user) => {
    if (!user.isPlatformAdmin) {
      throw new AppError("FORBIDDEN", "Khusus platform admin.");
    }
    return setPlatformCompanyStatus(user.id, companyId, status);
  });
}
