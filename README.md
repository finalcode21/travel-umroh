# Travel Umroh — Core System

Modular monolith Next.js 16 ERP untuk Travel Agent Umroh (Core System: module engine,
subscription, ACL/role-permission, local auth).

```
Travel Umroh Core System
├── Module Engine      (manifest, install, subscribe, billing)
├── Subscription       (plans, trial, expiry, cancellation)
├── Access Control     (roles, permissions, audit log, activity log)
├── Local Auth         (self-hosted email+password, bcryptjs, tu_session cookie)
├── Tenant / Branches  (per-company data isolation)
└── System Settings    (locale, currency, timezone, notifications)
```

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

### Dev

```bash
npm run dev        # http://localhost:3000
npm run build      # type-safe production build
npm run start      # production server
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

---

## Database

### Migrations

```bash
npm run db:migrate        # run core migrations from ./drizzle
npm run db:generate       # generate a new migration (drizzle-kit)
npm run db:studio         # Drizzle Studio (local DB GUI)
```

### Seed

```bash
npm run db:seed           # bootstrap Super Admin + modules + system settings
```

Seed does:
1. Core permissions (15 rows)
2. Platform `SUPER_ADMIN` role (`company_id = NULL`)
3. Role-permission bindings
4. **Super Admin bootstrap** (local email + password auth)
5. Module registry (notes, notes-pro) + permissions
6. System settings defaults

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

## Project Structure

```
src/
├── app/                # Next.js App Router (pages, routes, layouts)
├── components/
│   ├── layout/         # app-shell, account dropdown, notifications
│   └── ui/             # shadcn/ui re-exports + radix column compat
├── core/               # domain: auth, rbac, permissions, modules, audit, activity
├── db/                 # drizzle schema + migrations + pool
├── lib/                # utils (cn, radix-ui, prisma, auth, errors, api, validations)
├── modules/            # business modules (notes, notes-pro) + registry
├── proxy.ts            # global auth middleware
└── types/              # global TS types + path aliases
scripts/                # db:migrate / db:seed / env bootstrap (load-env.ts first)
drizzle/                # Drizzle migrations + snapshots
```

---

## README Sections

This README covers:
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Database](#database)
- [Auth (Self-Hosted)](#auth-self-hosted---clerk-removed)
- [Project Structure](#project-structure)
- [Deployment (Vercel)](#deployment-vercel)

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

---

## License

Proprietary — owned by finalcode21.
