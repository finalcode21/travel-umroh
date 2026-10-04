ALTER TYPE "public"."module_install_status" ADD VALUE 'UNINSTALLING' BEFORE 'UNINSTALLED';--> statement-breakpoint
ALTER TYPE "public"."module_install_status" ADD VALUE 'UPGRADING' BEFORE 'UNINSTALLED';--> statement-breakpoint
ALTER TYPE "public"."module_install_status" ADD VALUE 'INSTALL_FAILED' BEFORE 'UNINSTALLED';--> statement-breakpoint
ALTER TYPE "public"."module_install_status" ADD VALUE 'UPGRADE_FAILED' BEFORE 'UNINSTALLED';--> statement-breakpoint
ALTER TABLE "module_installations" ADD COLUMN "last_error" text;

-- Phase 2 (PRD §36/§13): role codes must be unique per company, not globally.
-- A global UNIQUE(code) would break multi-tenant provisioning
-- (createDefaultRolesForCompany inserts COMPANY_ADMIN/BRANCH_MANAGER/STAFF
-- for every company). The global constraint existed only as a manual live-DB
-- patch and was never part of a migration; replace it with the composite one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'roles_code_unique'
  ) THEN
    ALTER TABLE "roles" DROP CONSTRAINT "roles_code_unique";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'roles_company_code_unique'
  ) THEN
    ALTER TABLE "roles" ADD CONSTRAINT "roles_company_code_unique" UNIQUE ("company_id", "code");
  END IF;
END
$$;