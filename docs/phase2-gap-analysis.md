# Phase 2 Gap Analysis — Module Engine & Apps Marketplace

Date: 2026-10-04 · Basis: PRD Phase 2 (§1–§62) vs Phase 1 implementation at commit `8e8931e`.

## 1. What Phase 1 already provides (REUSE — no rewrite)

| Area | Implementation | Status |
|---|---|---|
| Module registry sync | `syncModuleRegistry()` upserts `modules`, `module_dependencies`, `permissions` from manifests | ✅ reuse |
| Subscription engine | subscribe (trial) / renew / cancel / `expireDueSubscriptions()` sweep | ✅ reuse |
| Installation | subscription check → dependency check → installation row → `module_migrations` | ⚠️ harden (not transactional) |
| Enable / Disable | `setModuleEnabled()` validates installation + subscription | ⚠️ add dependency-enabled check |
| Uninstall | blocks active dependents, data retained | ⚠️ broaden blocking scope |
| Delete data | separate explicit `deleteModuleData` + UI confirmation | ✅ reuse (harden input) |
| Module settings | per-company `module_settings` + manifest defs | ⚠️ add type validation |
| Access computation | `computeModuleAccess` / `getModuleAccessMap` | ✅ reuse |
| Marketplace UI | cards, detail page, state-aware actions | ⚠️ extend (search/filter/upgrade) |
| Dynamic navigation | `buildNavigation()` = module ACTIVE + permission | ✅ reuse |
| Audit / Activity | `recordAudit` / `recordActivity` on lifecycle ops | ⚠️ rename actions to MODULE_* + started/failed |
| Auth & ACL | session → layered `checkPermission` (user→company→subscription→permission) | ✅ reuse |
| Response contract | `ActionResult = { ok, data } \| { ok, error: { code, message, details } }` | ✅ reuse (§55: no second standard) |
| DB constraints | unique `modules.code`, unique `(company_id, module_id)`, FKs, indexes | ✅ reuse |

## 2. Gaps to implement in Phase 2

| # | PRD | Gap | Fix |
|---|---|---|---|
| G1 | §7–8 | No runtime manifest validation | zod manifest schema + structured issues `{module, field, error_code, message}`; run at registry sync; unit tests |
| G2 | §9, §27 | Dependencies are plain `string[]`, no version constraints | `dependencies: (string \| {module, version})[]` + semver `satisfies` check at install/enable/upgrade; notes-pro gets `>=1.0.0` |
| G3 | §10 | No circular dependency detection | DFS cycle detection with chain in error (`A → B → C → A`); checked at sync + install |
| G4 | §9, §45 | No dependency install ordering / auto-chain | topological resolution; subscribed-but-uninstalled deps install first in order; unsubscribed dep → `MODULE_DEPENDENCY_MISSING` |
| G5 | §11 | Uninstall only blocked by ACTIVE/PAUSED dependents | block when any dependent installation ≠ UNINSTALLED (incl. DISABLED); UI "Required by" section + error details |
| G6 | §5, §48 | Install-status enum lacks UPGRADING, UNINSTALLING, INSTALL_FAILED, UPGRADE_FAILED | migration 0003 `ALTER TYPE ... ADD VALUE` (4 states) + `module_installations.last_error` column |
| G7 | §14–15, §52 | Install not atomic; failure can leave inconsistent row | single `db.transaction` with `SELECT ... FOR UPDATE`; migrations inside the tx; all-or-nothing |
| G8 | §37 | No concurrency protection beyond unique constraint | row locking + transient status claim with 5-min stale reclaim; conflicting ops rejected while in-flight |
| G9 | §19–20 | No explicit retention policies | manifest `uninstallPolicy`: KEEP_DATA (default) / ARCHIVE_DATA / DELETE_DATA; DELETE_DATA requires `confirm: true` + UI impact dialog |
| G10 | §26–30 | **Upgrade engine missing entirely** | `upgradeModule()`: detect update → compat check → ordered pending migrations in tx → version update; UPGRADING/UPGRADE_FAILED persisted; previous version preserved on failure |
| G11 | §31 | Error codes too coarse | add MODULE_NOT_FOUND, MODULE_ALREADY_INSTALLED, MODULE_ALREADY_ENABLED, MODULE_NOT_INSTALLED, MODULE_DEPENDENCY_MISSING, MODULE_DEPENDENCY_DISABLED, MODULE_DEPENDENCY_VERSION_MISMATCH, MODULE_CIRCULAR_DEPENDENCY, MODULE_SUBSCRIPTION_REQUIRED, MODULE_INSTALL_FAILED, MODULE_UPGRADE_FAILED, MODULE_UNINSTALL_BLOCKED, MODULE_INVALID_MANIFEST, MODULE_PERMISSION_CONFLICT, MODULE_CONFIGURATION_INVALID (existing codes kept for compatibility) |
| G12 | §32 | Audit actions `INSTALL`/`ENABLE`…, no started/failed records | MODULE_INSTALLED, MODULE_ENABLED, … + `*_STARTED` / `*_FAILED` with error code/message in metadata |
| G13 | §34 | Only coarse `module.manage` | granular `module.install/enable/disable/upgrade/uninstall/configure` registered as core permissions; legacy `module.manage` still accepted (backward compatible with seeded roles) |
| G14 | §46, §35, §55 | No REST surface for module ops (tests must use API directly) | `GET /api/modules`, `GET /api/modules/[code]`, `POST /api/modules/[code]/actions` — same auth stack (session → assertPermission → zod → engine), same ActionResult contract |
| G15 | §24 | No search / filters / update-available on /apps | client-side search (name+description) + filter tabs (All/Installed/Not Installed/Enabled/Disabled/Updates Available) |
| G16 | §26, §41–42 | No installed-vs-available version display | registry version vs `installedVersion` comparison, "Update available" badge, Upgrade button, versions/activity info on detail page |
| G17 | §40 | Disable & Upgrade lack confirmation dialogs | AlertDialogs for disable/upgrade/uninstall/delete-data with impact copy |
| G18 | §45–46, §58 | No tests at all | unit harness (semver/manifest/dependency), integration tests via tsx against engine (companies A/B, scenarios A–G), API authorization tests via dev server |
| G19 | §36 | `roles_code_unique` missing from migrations (patched manually in live DB) | migration 0003 with `DO $$ IF NOT EXISTS … $$` guard |
| G20 | §53 | Failures not logged with lifecycle context | structured console log: company/user/module/operation/current→target/error code |

## 3. Deliberate non-changes (PRD §48/§55/§59 compliance)

1. **INSTALLED vs ENABLED as separate DB states**: the existing model uses `ACTIVE` (= INSTALLED+ENABLED) and `DISABLED` (= INSTALLED, not enabled). Splitting them would rewrite access computation across session/ACL/navigation for zero behavioral gain → reuse (PRD §48: "Reuse existing tables … jangan membuat duplicate functionality"). Persisted lifecycle now covers the full §5 graph via the new transient/failed states.
2. **Response contract**: keep `ActionResult` everywhere including new API routes (§55 forbids a second standard).
3. **Permissions catalog is global** (unique `permissions.code`, no company scope): roles are per-company, so `unique(company + permission)` (§36) is satisfied structurally by `role_permissions` (unique role+permission) — documented, no schema change.
4. **No business modules** (§61): only notes/notes-pro used as integration fixtures.
