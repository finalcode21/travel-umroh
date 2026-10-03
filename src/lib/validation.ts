import { z } from "zod";
import { AppError } from "@/lib/errors";

const optionalText = (max = 255) =>
  z
    .string()
    .max(max)
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const companySchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter").max(120).trim(),
  legalName: optionalText(160),
  address: optionalText(400),
  phone: optionalText(32),
  email: z
    .union([z.literal(""), z.string().email("Email tidak valid")])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  website: optionalText(160),
  logoUrl: optionalText(400),
  taxInfo: optionalText(160),
  currency: z.string().min(1).max(8).default("IDR"),
  timezone: z.string().min(1).max(64).default("Asia/Jakarta"),
  locale: z.enum(["id", "en"]).default("id"),
});

export const companyUpdateSchema = companySchema.partial();

export const companyAdminSchema = companySchema.omit({ locale: true }).extend({
  status: z.enum(["ACTIVE", "SUSPENDED"]).default("ACTIVE"),
});

export const companyAdminUpdateSchema = companyAdminSchema.partial();

export const branchSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter").max(120).trim(),
  code: z
    .string()
    .min(2, "Kode minimal 2 karakter")
    .max(16)
    .trim()
    .toUpperCase(),
  address: optionalText(400),
  phone: optionalText(32),
  email: optionalText(120),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

export const branchUpdateSchema = branchSchema.partial();

export const createUserSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter").max(120).trim(),
  email: z.string().email("Email tidak valid").trim().toLowerCase(),
  password: z.string().min(8, "Password minimal 8 karakter").max(72),
  companyId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional().nullable(),
  roleIds: z.array(z.string().uuid()).default([]),
  sendInvite: z.boolean().default(false),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(120).trim().optional(),
  branchId: z.string().uuid().nullable().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
});

export const roleSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter").max(80).trim(),
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, "Kode harus HURUF_BESERTA_UNDERSCORE")
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  description: optionalText(200),
});

export const roleUpdateSchema = z.object({
  name: z.string().min(2).max(80).trim().optional(),
  description: optionalText(200),
  permissionCodes: z.array(z.string()).optional(),
});

export const setRolePermissionsSchema = z.object({
  roleId: z.string().uuid(),
  permissionCodes: z.array(z.string()),
});

export const assignUserRolesSchema = z.object({
  userId: z.string().uuid(),
  roleIds: z.array(z.string().uuid()),
});

export const listQuerySchema = z.object({
  q: z.string().max(120).optional(),
  status: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const moduleActionSchema = z.object({
  moduleCode: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/),
});

export const renewSubscriptionSchema = z.object({
  subscriptionId: z.string().uuid(),
  /** renew for N months (extends expires_at) */
  months: z.coerce.number().int().min(1).max(24).default(1),
});

export const moduleSettingValueSchema = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const saveModuleSettingsSchema = z.object({
  moduleCode: z.string().min(2).max(60),
  values: z.record(z.string(), moduleSettingValueSchema),
});

export const systemSettingSchema = z.object({
  key: z.string().min(1).max(80),
  value: z.unknown(),
});

export const saveSystemSettingsSchema = z.object({
  values: z.record(z.string(), z.unknown()),
});

export const auditFilterSchema = z.object({
  q: z.string().max(120).optional(),
  action: z.string().max(20).optional(),
  module: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

/** Parses input with a schema, converting ZodError into an AppError. */
export function parseWith<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AppError(
      "VALIDATION_ERROR",
      `${first?.path?.join(".") || "data"}: ${first?.message ?? "tidak valid"}`,
      result.error.flatten(),
    );
  }
  return result.data;
}
