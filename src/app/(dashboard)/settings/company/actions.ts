"use server";

import { runAction } from "@/lib/action";
import { parseWith, companyUpdateSchema } from "@/lib/validation";
import { updateCompany } from "@/core/tenant/companies";

export async function updateCompanyAction(companyId: string, input: unknown) {
  return runAction("company.manage", async (user) => {
    if (!user.isPlatformAdmin && user.companyId !== companyId) {
      throw new Error("Perusahaan tidak sesuai.");
    }
    const data = parseWith(companyUpdateSchema, input);
    return updateCompany(user.id, companyId, data);
  });
}
