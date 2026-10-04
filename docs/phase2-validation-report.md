# PHASE 2 VALIDATION REPORT

**Project:** Travel Umroh ERP — Module Engine & Apps Marketplace Hardening
**Date:** 2026-10-04 · **Base:** commit `8e8931e` · **PRD:** Phase 2 (§1–§62)

---

## Per-Area Results

| Area | Result | Evidence |
|---|---|---|
| Module Registry | **PASS** | `syncModuleRegistry()` validates all manifests before sync; duplicate technical name rejected; metadata synced; registry row tests (unit + integration) |
| Manifest | **PASS** | `src/core/modules/manifest.ts` — zod schema + 12 structured checks (`{module, field, error_code, message}`); 10 unit tests incl. duplicate code/permission/navigation, invalid version, unknown dep, bad constraint |
| Dependency Engine | **PASS** | Topological install order (auto-chain `notes-pro` → `notes`), circular detection with chain `A → B → C → A`, version constraints (`>=1.0.0 <2.0.0` on notes-pro) validated at install/enable/upgrade |
| Subscription | **PASS** | Install/enable gated on live subscription (`MODULE_SUBSCRIPTION_REQUIRED`); per-company scope verified |
| Installation | **PASS** | Single `db.transaction` + `SELECT … FOR UPDATE`; migrations inside the tx (atomic rollback proven by broken-module test); idempotent re-install = 1 row; `INSTALLING`/`INSTALL_FAILED` persisted |
| Enable | **PASS** | Validates installation, subscription, dependency ACTIVE state (`MODULE_DEPENDENCY_DISABLED`), dependency version compat; `MODULE_ALREADY_ENABLED` deterministic |
| Disable | **PASS** | Data/config/installation preserved; navigation removal verified via `buildNavigation`; `MODULE_ALREADY_DISABLED` deterministic |
| Uninstall | **PASS** | Blocked by ANY installed dependent (incl. disabled) with "Required by" surfaced; attempt audited (§58D); deterministic re-uninstall rejection |
| Data Retention | **PASS** | Manifest `uninstallPolicy`: KEEP_DATA (default, proven — business rows survive uninstall), ARCHIVE_DATA (archiveSql in tx), DELETE_DATA (requires `confirmDataLoss` + destructive-confirmation UI; deletion verified) |
| Navigation | **PASS** | Hidden on disable, visible on enable, permission-filtered; `/m/[module]` guards unchanged |
| Permission Registration | **PASS** | Module permissions auto-registered with module ownership; cross-module duplicate rejected (`MODULE_PERMISSION_CONFLICT`) |
| Marketplace | **PASS** | Search (name/description), 6 filters with counts, state-aware buttons from backend state, update-available badge, cards render (browser-verified) |
| Configuration | **PASS** | Type-validated against manifest defs (`MODULE_CONFIGURATION_INVALID`); company-scoped; audited (`MODULE_CONFIGURATION_UPDATED`) |
| Versioning | **PASS** | `availableVersion` vs `installedVersion` tracked; `updateAvailable` computed; upgrade/downgrade detection |
| Upgrade | **PASS** | Full engine: detect → subscription/dependency/dependents compat → pending migrations (minVersion) in tx → version bump; UPGRADING/UPGRADE_FAILED persisted; previous version preserved on rollback; audited with from→to |
| Error Handling | **PASS** | 19 new MODULE_* codes in `ERROR_CODES` with HTTP mapping; structured log (§53); failures persisted with `last_error` |
| Audit Trail | **PASS** | MODULE_* actions incl. `*_STARTED`/`*_FAILED` with error codes; audit preserved across uninstall; module detail page shows the trail |
| Multi Tenant Isolation | **PASS** | Company A/B via API: B sees own state only, cannot mutate A's installation, audit rows never leak (§46 — direct HTTP, not UI) |
| Concurrency | **PASS** | Parallel installs → exactly 1 row (row lock + unique constraint); conflicting ops rejected during transient states with 5-min stale reclaim |
| Integration Tests | **PASS** | 20 unit + 29 integration + 18 API = **67/67**; PRD §58 scenarios A–G all green |
| Build | **PASS** | `tsc --noEmit` ✅ · `eslint src scripts` ✅ · `next build` ✅ · migration 0003 applied ✅ |

## Critical Issues

None.

## Non Critical Issues

1. **Pre-existing hydration mismatch in `SidebarInset`** (Phase 1 shell component, `src/components/ui/sidebar.tsx`): dev-mode React warning `hydration-mismatch` on `<main data-slot="sidebar-inset">`. Unrelated to Phase 2; does not occur as a functional error and pages render correctly. Recommend fixing separately.
2. **`audit_logs.companyId` cascades on company delete** (Phase 1 design): uninstall preserves audit history (verified), but deleting a whole company deletes its audit rows. Consider `set null`-style archival if company deletion ever becomes user-facing.
3. **INSTALLED vs ENABLED are one DB state** (`ACTIVE`): documented mapping per PRD §48 reuse rule; persisted lifecycle covers the full §5 graph via INSTALLING/UPGRADING/UNINSTALLING/INSTALL_FAILED/UPGRADE_FAILED.
4. **Free modules always require a subscription**: current gate is uniform; acceptable for Phase 2 (all marketplace modules priced). Revisit if free modules arrive.

## Database Changes

- **Migration `drizzle/0003_phase2_lifecycle.sql`** (applied ✅):
  - `ALTER TYPE module_install_status ADD VALUE` × 4: `UNINSTALLING`, `UPGRADING`, `INSTALL_FAILED`, `UPGRADE_FAILED`
  - `module_installations.last_error text` (actionable admin error, §30)
  - `roles`: replaced manually-patched global `UNIQUE(code)` with multi-tenant-correct `UNIQUE(company_id, code)` (`roles_company_code_unique`) — global constraint would have broken `createDefaultRolesForCompany` for a second tenant
- **Schema** (`src/db/schema/*`): enum extended, `lastError` column, roles unique constraint declared

## Migration Status

`npx drizzle-kit check` ✅ · `db:migrate` applied ✅ · enum values + column + constraint verified in live Neon DB ✅ · backward-safe (idempotent DO-block, no destructive changes)

## Test Artifacts

- `scripts/phase2/unit-tests.ts` — 20/20 (semver, dependency graph, manifest validation)
- `scripts/phase2/integration-tests.ts` — 29/29 (lifecycle matrix §45, scenarios A–G §58, rollback, concurrency, retention)
- `scripts/phase2/api-tests.ts` — 18/18 (auth, permission enforcement, tenant isolation over REST §46)
- `scripts/phase2/ui-smoke.ts` — /apps, /apps/notes, /apps/notes-pro, /dashboard, /m/notes → 200, no error boundaries
- `docs/phase2-gap-analysis.md` — 20-gap analysis (G1–G20) mapped to implementations

## Files Changed

**New:** `src/lib/semver.ts` · `src/core/modules/manifest.ts` · `src/core/modules/dependency.ts` · `src/core/modules/action-permissions.ts` · `src/app/api/modules/*` (3 routes) · `src/app/(dashboard)/apps/marketplace.tsx` · `drizzle/0003_phase2_lifecycle.sql` · `scripts/phase2/*` (7 test/support files) · `docs/phase2-*.md`
**Hardened:** `src/core/modules/engine.ts` (transactional lifecycle + upgrade engine) · `src/core/modules/access.ts` (version tracking) · `src/lib/errors.ts` (MODULE_* codes) · `src/types/index.ts` (dependency specs, retention policy, lifecycle states) · `src/core/permissions.ts` (granular module.*) · `src/lib/action.ts` (multi-permission) · `src/proxy.ts` (401 JSON for unauthenticated API) · marketplace UI pages/actions

## API Surface (new, §35/§46/§55)

- `GET /api/modules?q=&category=&status=` — catalog with per-company state
- `GET /api/modules/[code]` — detail + access + dependents + settings + audit
- `POST /api/modules/[code]/actions` — `{action: subscribe|install|enable|disable|upgrade|uninstall|configure|deleteData, confirmDataLoss?, values?}`
- Contract: `ActionResult` — `{ok:true,data}` / `{ok:false,error:{code,message,details}}`

---

## FINAL STATUS:

# PHASE 2 READY
