-- migrasi incremental: hanya menambahkan tabel `packages` + `departures`
-- (Modul Paket Umrah). Aman dijalankan ulang (idempoten); tidak menyentuh
-- tabel lain. Target: Neon Development — verifikasi host *.neon.tech
-- SEBELUM eksekusi.

CREATE TABLE IF NOT EXISTS "packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "price_idr" integer DEFAULT 0 NOT NULL,
  "capacity" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "departures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "package_id" uuid NOT NULL REFERENCES "packages"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "depart_on" timestamp with time zone NOT NULL,
  "return_on" timestamp with time zone,
  "capacity" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT departures_return_after_depart CHECK (return_on IS NULL OR return_on > depart_on)
);

-- unique per tenant (aman dijalankan ulang)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packages_tenant_code_unique') THEN
    ALTER TABLE "packages" ADD CONSTRAINT "packages_tenant_code_unique" UNIQUE ("tenant_id", "code");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departures_tenant_pkg_code_unique') THEN
    ALTER TABLE "departures" ADD CONSTRAINT "departures_tenant_pkg_code_unique" UNIQUE ("tenant_id", "package_id", "code");
  END IF;
END$$;

-- indeks pendukung kueri (jika belum ada)
CREATE INDEX IF NOT EXISTS "packages_tenant_id_status_idx" ON "packages" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "departures_tenant_pkg_idx" ON "departures" ("tenant_id", "package_id");
CREATE INDEX IF NOT EXISTS "departures_depart_on_idx" ON "departures" ("depart_on");
