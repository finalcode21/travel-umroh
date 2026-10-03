# Travel Umroh — Modular ERP Platform (Core V1)

Platform ERP modular untuk travel agent umroh, dibangun sebagai **modular monolith**: Core System + Module Engine + Subscription + ACL, siap untuk business modules (CRM, Jamaah, Visa, …) sebagai modul terpisah.

## Stack

- **Next.js 16** (App Router, TypeScript strict, Server Actions)
- **Tailwind CSS v4 + shadcn/ui** — UI dens ala ERP
- **PostgreSQL (Neon)** + **Drizzle ORM**
- **Clerk** — authentication (session, password, protected routes)
- **Vercel** — deployment target

## Setup

```bash
# 1. dependencies
npm install

# 2. environment
cp .env.example .env.local
#   isi DATABASE_URL (Neon pooled), Clerk keys, CLERK_WEBHOOK_SECRET

# 3. migrasi core + seed
npm run db:migrate
npm run db:seed

# 4. jalankan
npm run dev
```

### Clerk webhook (agar signup tersinkron ke database)

Clerk Dashboard → Webhooks → Add endpoint:

- URL: `https://<domain>/api/webhooks/clerk` (dev: pakai `ngrok` / `localtunnel`)
- Events: `user.created`, `user.updated`, `user.deleted`
- Salin signing secret ke `CLERK_WEBHOOK_SECRET`

> Tanpa webhook pun tetap jalan: user disinkronkan otomatis saat login pertama (inline provisioning).

## Arsitektur

```text
src/
├── app/                    # screens + server actions (thin layer)
├── components/             # ui/ (shadcn), layout/, data-table/
├── core/
│   ├── auth/               # session (Clerk→DB sync), provisioning, user admin
│   ├── acl/                # layered permission check (server-side)
│   ├── tenant/             # companies, branches
│   ├── modules/            # MODULE ENGINE: access map, lifecycle, settings
│   ├── navigation/         # dynamic sidebar builder
│   ├── rbac/               # roles & permission matrix
│   ├── notification/ audit/ activity/ settings/
├── modules/                # BUSINESS MODULES (satu-satunya import surface: registry.ts)
│   ├── notes/              #   sample module (manifest, schema, service, actions, views)
│   └── notes-pro/          #   sample dengan dependency ke notes
├── db/                     # drizzle schema + client
└── types/                  # kontrak manifest, ActionResult, ACL types
```

Aturan kunci (PRD): **Core tidak boleh meng-import business module** — Core hanya membaca manifest lewat `src/modules/registry.ts`. Sebaliknya modul bebas memakai Core.

## Module lifecycle (PRD §14–19)

```
AVAILABLE → Subscribe (trial) → Install (deps check → migration → permission → nav) → ACTIVE
ACTIVE → Disable (nav hilang, data tetap) → Enable
ACTIVE → Uninstall (data DIPERTAHANKAN) → UNINSTALLED
Subscription expired → PAUSED (otomatis, data tetap) → Renew → ACTIVE
```

- **Dependency validation**: install `notes-pro` tanpa `notes` gagal; uninstall `notes` saat `notes-pro` aktif ditolak (409).
- **Delete Module Data**: aksi terpisah, konfirmasi + audit log + backup warning.
- **Uninstall policy**: data bisnis selalu dipertahankan.

## Validasi arsitektur (PRD §48)

Login sebagai akun perusahaan → **Apps** → subscribe **Notes** → Install → menu **Catatan** muncul di sidebar → Settings → Modul → Disable → menu hilang → Enable → uninstall → install **Notes Pro** (buktikan dependency) → coba uninstall Notes (ditolak) → periksa **Audit Log**.

## Scripts

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `typecheck` | Build / strict typecheck |
| `npm run db:generate` | Generate migration dari schema |
| `npm run db:migrate` | Jalankan migration core |
| `npm run db:seed` | Seed permission, role platform, registry modul |
| `npm run db:studio` | Drizzle Studio |

## Multi-tenant

Shared database dengan isolasi `company_id` / `branch_id`. User pertama = **Super Admin platform** (buat company via Settings → Companies). Signup berikutnya otomatis mendapat perusahaan + cabang HQ + role Company Admin (self-serve tenant).
