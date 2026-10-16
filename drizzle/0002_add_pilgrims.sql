-- migrasi incremental: hanya menambahkan tabel pilgrims
-- (jika tabel sudah ada, perintah ini aman)
CREATE TABLE IF NOT EXISTS "pilgrims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "registrant_no" text NOT NULL,
  "full_name" text NOT NULL,
  "identity_no" text,
  "phone" text,
  "email" text,
  "date_of_birth" timestamp with time zone,
  "address" text,
  "pilgrim_status" text DEFAULT 'draft' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- unique constraint per tenant (akan gagal secara aman jika sudah ada)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pilgrims_tenant_registrant_unique') THEN
    ALTER TABLE "pilgrims" ADD CONSTRAINT "pilgrims_tenant_registrant_unique" UNIQUE ("tenant_id", "registrant_no");
  END IF;
END$$;

-- index untuk kueri pilihan (jika belum ada)
CREATE INDEX IF NOT EXISTS "pilgrims_tenant_id_status_idx" ON "pilgrims" ("tenant_id", "pilgrim_status") WHERE "pilgrim_status" IS NOT NULL;
