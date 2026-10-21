---
title: 'Refactor sweep'
type: 'refactor'
ticket: '10'
created: '2026-10-21'
status: 'in-review'
baseline_revision: '27f71e92eb041b2953f693212df5f1f2896ce1d7'
route: 'full'
route_source: 'auto'
risk: 'low'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      One failed per-zone request in refresh() still marks the whole dashboard as API-down.
    evidence: |-
      Fixing it changes what users see (partial data instead of the API-down notice), so it is a behaviour change, out of scope for a no-behaviour-change sweep. The per-item loads now go through one helper, loadEach(), so the fix is a one-place change.
    location: >-
      apps/dashboard/src/app/dashboard.store.ts
    severity: low
  - summary: >-
      Web SDK .d.ts files reference the unpublished @taleart/contract package; the web-sdk Vite config still uses nxViteTsPaths and nxCopyAssetsPlugin.
    evidence: |-
      The web SDK is being edited by the parallel web-zones accessibility review; bundling the types (vite-plugin-dts bundleTypes with the installed api-extractor) and replacing the README copy step belong in libs/web-sdk/vite.config.mts.
    location: >-
      libs/web-sdk/vite.config.mts
    severity: low
---

<intent-contract>

## Intent

**Problem:** The foundation stories left cleanup behind: Nx deprecation warnings on every test and lint run (`nxViteTsPaths`, `nxCopyAssetsPlugin`, the `@nx/eslint:lint` executor), a dashboard initial bundle over its 500 KB budget (638 KB), and a `refresh()` that repeats the same per-zone/per-project load six times.

**Approach:** Cleanup only, no behaviour change: Vite's native `resolve.tsconfigPaths` in the vitest configs, the inferred ESLint target for dashboard and docs, lazy-loaded dashboard pages, and one load helper in the dashboard store.

## Boundaries & Constraints

**Always:** Same requests, same results and same errors as before; test counts do not drop; `.prettierrc` printWidth 120 and untouched code is not reformatted; no new dependencies.

**Never:** Behaviour changes (the API-down handling, body-parser 413/415 mapping); edits in the web SDK, the sample page, `pages/tale-studio*`, `tale-layers*` or the tales module document code (parallel work); raising the bundle budget.

</intent-contract>

## Code Map

- `apps/api/vitest*.mts`, `libs/contract/vitest.config.mts`, `libs/server/*/vitest.config.mts` -- test configs using the deprecated Nx Vite plugins.
- `apps/dashboard/project.json`, `apps/docs/project.json`, `nx.json` -- explicit `@nx/eslint:lint` targets and their target default.
- `apps/dashboard/src/app/app.routes.ts` -- every page imported eagerly except Tale Studio.
- `apps/dashboard/src/app/dashboard.store.ts` -- `refresh()` per-item loads.

## Tasks & Acceptance

**Execution:**
- [x] vitest configs (9 files) -- replace `nxViteTsPaths()` with `resolve: { tsconfigPaths: true }`; drop `nxCopyAssetsPlugin(['*.md'])` (these projects have no `.md` files and vitest never writes a bundle) -- removes the deprecation warnings.
- [x] `apps/dashboard/project.json`, `apps/docs/project.json`, `nx.json` -- remove the explicit `@nx/eslint:lint` targets so `@nx/eslint/plugin` infers `lint` (`eslint .` in the project); drop the now-unused target default.
- [x] `apps/dashboard/src/app/app.routes.ts` -- `loadComponent` for setup, invite, zone detail, tale groups, projects, theme, import and import job; zones and sign-in (the two landing pages) stay eager.
- [x] `apps/dashboard/src/app/dashboard.store.ts` -- private `loadEach()` for the six parallel per-zone/per-project GETs in `refresh()`; same URLs (including which ids are encoded), same order, same all-or-nothing failure.

**Acceptance Criteria:**
- Given the verification run, then no `nxViteTsPaths`, `nxCopyAssetsPlugin` or `@nx/eslint:lint` deprecation warning prints except from `web-sdk` (deferred), and the dashboard initial bundle is under 500 KB.
- Given the full suite, then every project passes with the same test count as before.

## Implementation Notes

- Scope came from every foundation plan (`deferred:`, `[defer]` triage rows, residual risks) and the autopilot report follow-ups.
- Left out on purpose:
  - API-down on one failed per-zone request -- behaviour change; deferred above, now a one-place fix in `loadEach()`.
  - body-parser 413/415 mapping -- changes status codes; behaviour change.
  - SDK `.d.ts` referencing `@taleart/contract`, and `web-sdk`'s Vite deprecations -- web SDK is in parallel work; deferred above.
  - `apps/api-e2e` (expects `GET /` → `Hello API` on port 3000) -- stale scaffold; running it needs `api:serve` on a port this run may not use, so a fix could not be verified.
  - Double zone lookup on frame POST, CREATE TABLE IF NOT EXISTS migrations, rate limits, in-memory uploads, `MEDIA_DIR` default, per-project tag loads -- not cleanup, or they change behaviour or performance characteristics.
  - Duplicated tale limit constant -- already shared (`MAX_TALES_PER_GROUP` from the contract).
- `resolve.tsconfigPaths` is marked experimental in Vite 8.1; no `@taleart/*` packages exist in `node_modules`, so a resolution failure would fail the tests rather than fall back silently.
- The lazy routes leave about 7 KB of headroom (492.66 KB initial).

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --skip-nx-cache` -- expected: all pass, test counts unchanged.
- `npm exec nx -- run web-sdk:size`, `npm exec nx -- run sdk-sample:a11y` -- expected: pass.
