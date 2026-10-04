# Travel Umroh — Core System

Modular monolith Next.js 16 ERP untuk Travel Agent Umroh (Core System: module engine,
subscription, ACL/role-permission, local auth).

```
Travel Umroh Core System
├── Module Engine      (manifest, dependency graph, install, subscribe, billing)
├── Module Lifecycle   (enable/disable/uninstall, data retention, upgrade)
├── Subscription       (plans, trial, expiry, cancellation)
├── Access Control     (roles, permissions, audit log, activity log)
├── Local Auth         (self-hosted email+password, bcryptjs, tu_session cookie)
├── Tenant / Branches  (per-company data isolation)
└── System Settings    (locale, currency, timezone, notifications)
```

---

## Contents

- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Database & Migrations](#database--migrations)
- [Auth (Self-Hosted — Clerk removed)](#auth-self-hosted---clerk-removed)
- [Module Engine (Phase 2)](#module-engine-phase-2)
- [Marketplace (Apps)](#marketplace-apps)
- [Project Structure](#project-structure)
- [Development Workflow (Phase 2 tests)](#development-workflow-phase-2-tests)
- [Deployment (Vercel)](#deployment-vercel)
- [API Endpoints](#api-endpoints)
- [License](#license)

---

## Tech Stack

| Area | Choice |
|---|---|
| Framework | Next.js 16.3.8 (App Router, Turbopack) |
| Language | TypeScript 5.x (strict) |
| Styling | Tailwind CSS v4 + shadcn/ui (Radix UI) |
| ORM / DB | Drizzle 0.45.3 + Neon PostgreSQL (`ep-morning-sun-b4lgyjs8`) |
| Auth | Self-hosted node-ormacAuth (bcryptjs, `tu_session` cookie, 7-day session) |
| UI | shadcn/ui + Radix UI 1.6.7, lucide-react, sonner, cmdk |
| Icons / UI utils | lucide-react, class-variance-authority, clsx, tailwind-merge |
| Validation | Zod 4.x |

---

## Getting Started

### Prerequisites

- Node.js 18+ (recommended 20/22 LTS)
- pnpm / npm / yarn

### Install

```bash
npm install
```

### Env

Copy `.env.example` to `.env.local` and fill in your Neon connection string(s):

```bash
cp .env.example .env.local
```

Essential variables:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Pooled Neon PostgreSQL connection string |
| `DATABASE_URL_UNPOOLED` | ✅ | Unpooled Neon connection string (serverless / drizzle-kit) |
| `NEON_BRANCH` | ✅ | Neon branch name (`production` in CI/production) |
| `AUTH_SECRET` | ✅ | Secret for local JWT/session signing (generate e.g. `openssl rand -base64 32`) |

> `.env.local` and `.env` are git-ignored. `DATABASE_URL` is never committed.

### Dev / build / typecheck

```bash
npm run dev        # http://localhost:3000
npm run build      # type-safe production build
npm run start      # production server
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

---

## Module Engine (Phase 2)

Platform infrastructure — the module engine treats business modules as **contracts**
(manifests) consumed by the platform. Business modules contain **no engine logic**.

### Module lifecycle (persisted state, not UI-derived)

```
DISCOVERED → AVAILABLE → INSTALLING → INSTALLED → ENABLED → DISABLED → UNINSTALLING → UNINSTALLED
                                                     ↘ INSTALL_FAILED / UPGRADE_FAILED (transient)
```

`ACTIVE` = installed + enabled, `DISABLED` = installed but not enabled. The full graph
(including `INSTALLING` / `UPGRADING` / `UNINSTALLING` / `*_FAILED` states) is written
to the database and read back for UI state — no client-side state derivation.

### Manifest contract (`Manifest`)

Every module exports a manifest with: `code` (unique kebab-case), `name`, `version`
(semver), `description`, `category`, `permissions[]`, `navigation[]`, `dependencies`
(version constraints, e.g. `{ module: "notes", version: ">=1.0.0 <2.0.0" }`),
`settings[]`, `migrations[]`, `uninstallPolicy` (`KEEP_DATA|ARCHIVE_DATA|DELETE_DATA`,
default `KEEP_DATA`), `deleteDataSql` / `archiveSql`.

**Manifest validation** (`src/core/modules/manifest.ts`) runs at registry sync:
required fields, technical name, version format, dependency format + constraint syntax,
duplicate permissions across modules, duplicate navigation/settings, unknown dependencies,
circular dependency detection (`A → B → C → A` with the chain in the error), module/field/
error_code/message structured errors (`MODULE_INVALID_MANIFEST`).

### Dependency engine (`src/core/modules/dependency.ts`)

- Topological install order resolution (dependencies first)
- Circular dependency detection with chain (`A → B → C → A`)
- Version compatibility check (constraint satisfaction) at install/enable/upgrade
- Dependents lookup for uninstall protection (`MODULE_UNINSTALL_BLOCKED` + "Required by")

### Installation (`INSTALLING → ACTIVE`)

Single `db.transaction` with `SELECT ... FOR UPDATE` row locking:

1. validate manifest
2. subscription must be live (trial/active)
3. dependency chain in install order (subscribed deps auto-installed first, recursive)
4. migrations run **inside** the transaction
5. commit — all-or-nothing (partial install can never be left on disk)

Idempotent: re-install at the same version is a deterministic no-op (exactly one
installation row via the unique `(company_id, module_id)` constraint + row lock).
Version compatibility validated for every dependency level. `INSTALL_FAILED`
persisted on migration failure with `last_error`, previous state preserved.

### Enable / Disable

- Enable: requires live subscription, all dependency modules `ACTIVE` (else
  `MODULE_DEPENDENCY_DISABLED`) and version-compatible.
- Disable: preserves data, settings, installation record, permissions, audit history.
- Deterministic rejects: `MODULE_ALREADY_ENABLED` / `MODULE_ALREADY_DISABLED`,
  `MODULE_NOT_INSTALLED`, `MODULE_SUBSCRIPTION_REQUIRED`.

### Uninstall & data retention (`UNINSTALLING → UNINSTALLED`)

- Blocks when any dependent module is installed (any state), showing "Required by".
- The attempted operation is always audited (§58D).
- `KEEP_DATA` (default): nothing destroyed — verified: business rows survive uninstall.
- `ARCHIVE_DATA`: archive SQL executed in the same transaction before uninstall.
- `DELETE_DATA`: requires explicit `confirmDataLoss` + separate irreversible UI
  confirmation, then the module's `deleteDataSql` runs within the transaction.

### Versioning & Upgrade

- `modules.version` (registry) vs `module_installations.installedVersion`; update
  available when `available > installed` (semver, §26).
- Upgrade flow: detect update → subscription + dependency + dependent-compat checks
  → transactional pending migrations (only versions > installed) → version bump,
  previous state kept. `UPGRADING` / `UPGRADE_FAILED` persisted; rollback preserves
  prior version + data (§28–30).

### Permissions

Granular `module.install/enable/disable/upgrade/uninstall/configure` registered as
core permissions; legacy `module.manage` still grants them (seeded roles untouched).
Client-side UI hiding is never the security boundary — server-side
`checkPermission` layers (user → company → module subscription → permission).

### Registry query

`GET /api/modules` (search/filter), `GET /api/modules/[code]`, `POST /api/modules/[code]/actions`
(single entry point for all lifecycle ops, same auth + ActionResult contract, §35/§55).

---

## Marketplace (Apps)

Admin internal marketplace (`/apps`):

- **Search** by module name + description, **filters**: All / Installed / Not Installed /
  Enabled / Disabled / Updates Available (client-side, server data computed once).
- **State-aware actions** from backend state (§38): Subscribe → Install → Upgrade (when
  update available) → Disable → Enable → Uninstall (with policy + dependents dialogs).
- **Module detail** (`/apps/[code]`): overview, dependencies + "Required by", permissions,
  settings, versions (installed vs available), lifecycle activity (audit trail), danger zone.
- Framework: Odoo-like cards and confirmations; server actions + REST entry point.

---

## Database & Migrations

```bash
npm run db:migrate        # run core migrations from ./drizzle
npm run db:generate       # generate a new migration (drizzle-kit)
npm run db:studio         # Drizzle Studio (local DB GUI)
```

Key tables (Drizzle → snake_case):

| Table | Notes |
|---|---|
| `modules` | registry (unique `code`, version, category, uninstall policy snapshot) |
| `module_dependencies` | edges (unique module+dep), `requiredVersion` |
| `module_installations` | per-company install state (`PENDING/INSTALLING/ACTIVE/DISABLED/PAUSED/ERROR/UNINSTALLING/UPGRADING/INSTALL_FAILED/UPGRADE_FAILED/UNINSTALLED`), `installedVersion`, `last_error` |
| `module_subscriptions` | trial/active/past-due/expired/cancelled, expires_at per company |
| `module_settings` | company-scoped config, unique company+module+key |
| `module_migrations` | applied module migrations |
| `permissions` / `role_permissions` / `roles` | RBAC; role codes unique per company |

Lifecycle enum values and `last_error` come from migration `drizzle/0003_phase2_lifecycle.sql`
(applied + verified; the previously-manually-patched global `roles UNIQUE(code)` was
replaced with the multi-tenant-correct `UNIQUE(company_id, code)`).

---

## Auth (Self-Hosted — Clerk removed)

Local email + password authentication, no third-party SDK.

| Setting | Value |
|---|---|
| Cookie name | `tu_session` |
| Lifetime | 7 days |
| Session store | `sessions` table (token → `user_id`) |
| Password hashing | `bcryptjs` (cost 12), `passwordHash` / `passwordSalt` columns |
| Session middleware | `src/proxy.ts` — unauthenticated → `/login?redirect=...` |
| Routes | `/api/auth/login`, `/api/auth/signup`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/forgot-password`, `/api/auth/reset-password` |

### Default Super Admin (from `scripts/seed.ts`)

| Email | Password |
|---|---|
| `admin@demo.com` | `admin12345` |

> The seed writes a bcrypt hash; the plaintext is only known at bootstrap time.

---

## Development Workflow (Phase 2)

### Validation matrix (run before every PR)

```bash
npm run typecheck  # tsc --noEmit
npm run lint       # eslint src
npm run build      # next build
npm run db:migrate # apply drizzle migrations
npx tsx scripts/phase2/unit-tests.ts      # 20 unit tests (semver, manifest, dependency)
npx tsx scripts/phase2/integration-tests.ts # 29 integration tests (lifecycle + scenarios A–G)
npx tsx scripts/phase2/api-tests.ts http://localhost:PORT # 18 API tests (§46 tenant isolation)
```

### Phase 2 test modules (fixtures)

`notes` + `notes-pro` (dependency: notes → notes-pro ≥1.0.0 <2.0.0) act as the integration
fixtures for every lifecycle scenario. Schemas/plain-SQL helpers live in the test scripts.

---

## Project Structure

```
src/
├── app/                # Next.js App Router (pages, routes, layouts)
├── components/
│   ├── layout/         # app-shell, account dropdown, notifications
│   └── ui/             # shadcn/ui re-exports + radix column compat
├── core/
│   ├── auth/           # sessions, loadUserProfile, provisioning
│   ├── acl/            # layered checkPermission (user→company→subscription→permission)
│   ├── audit/          # audit log service (action/module/resource + limit queries)
│   ├── activity/       # user-facing activity log
│   ├── modules/        # **module engine** (registry, dependency, manifest,
│   │                   #  manifest validation, installation, lifecycle,
│   │                   #  subscription, versioning, upgrade, configuration, permissions)
│   │                   #  + module action permissions
│   ├── permissions/    # core permission catalog + default roles
│   └── navigation/     # dynamic sidebar from manifest (state + permission filtered)
├── db/
│   ├── schema/         # drizzle schema + enums + relations
│   └── index.ts        # pooled postgres, ssl config
├── lib/                # utils (cn, radix, auth, errors, semver, validation)
├── modules/            # business modules (notes, notes-pro) + registry
├── proxy.ts            # global auth middleware (401 JSON on API surface)
└── types/              # global TS types + path aliases
scripts/
├── phase2/             # **Phase 2 validation suites** (unit, integration, API, helpers)
├── seed.ts             # bootstrap (Super Admin + roles + modules + settings)
└── load-env.ts         # env bootstrap (must be first import)
drizzle/                # Drizzle migrations + snapshots (0000..0003)
```

---

## Deployment (Vercel)

This app is configured for Vercel (Next.js 16).

1. **Link repo:** <https://github.com/finalcode21/travel-umroh> → Vercel
2. **Build command:** `npm run build`
3. **Install command:** `npm install`
4. **Environment variables (required):**
   - `DATABASE_URL` — Neon pooled connection string
   - `AUTH_SECRET` — random secret for session/JWT signing
   - `NEON_BRANCH` — `production`

`.env.local` / `.env` are git-ignored and are **not** committed. Enter real values in the Vercel dashboard.

> Service runs on the live URL <https://travel-umroh-one.vercel.app>. Login e2e verified.

---

## API Endpoints

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Local login (email + password) |
| POST | `/api/auth/signup` | Self-serve tenant registration |
| POST | `/api/auth/logout` | Invalidate session |
| GET | `/api/auth/me` | Current user profile |
| POST | `/api/auth/forgot-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password |

### Modules (Module Engine, Phase 2)

| Method | Path | Description |
|---|---|---|
| GET | `/api/modules` | Catalog with per-company access state (search/filter) |
| GET | `/api/modules/[code]` | Module detail + access + dependents + settings + audit |
| POST | `/api/modules/[code]/actions` | Single entry point: `{action: subscribe\|install\|enable\|disable\|upgrade\|uninstall\|configure\|deleteData, confirmDataLoss?, values?}` |

Response contract: `{ ok: true, data }` / `{ ok: false, error: { code, message, details } }`
(`MODULE_*` structured codes, §31/§55).

### Core

| Method | Path | Description |
|---|---|---|
| GET | `/api/auth/me` | Current user profile (full module access map) |
| GET | `/api/settings` | — |
| … | (see `src/app/api/`) | other domain endpoints |

---

## License

Proprietary — owned by finalcode21.
