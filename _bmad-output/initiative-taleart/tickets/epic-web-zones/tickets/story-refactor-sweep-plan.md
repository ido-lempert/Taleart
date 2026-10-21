---
title: 'Refactor sweep'
type: 'refactor'
ticket: '13'
created: '2026-10-21'
status: 'in-review'
baseline_revision: '901ba7e'
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
deferred: []
---

<intent-contract>

## Intent

**Problem:** The web zones epic left cleanup behind in the Web SDK: its Vite config still uses the deprecated `nxViteTsPaths` and `nxCopyAssetsPlugin` (two deprecation warnings on every SDK lint, test and build), its published `.d.ts` files import types from `@taleart/contract`, which is neither a declared nor a published dependency (3.1 `[defer]`, foundation sweep `deferred:`), and the reduced-motion media query is spelled out in four places.

**Approach:** Cleanup only, no behaviour change: Vite's built-in `resolve.tsconfigPaths` like the other projects, a few lines of inline plugin in place of the package-file copy steps, one rolled-up `index.d.ts` with the contract types inlined (the API Extractor that vite-plugin-dts installs), and one shared reduced-motion query.

## Boundaries & Constraints

**Always:** Same bundle code (ES and UMD), same `README.md` and `package.json` in `dist/libs/web-sdk`, same public type names; test counts do not drop; `.prettierrc` printWidth 120 and untouched code is not reformatted; no new dependencies.

**Never:** Visual, API or behaviour changes (everything in "Left out"); edits in `pages/tale-studio*`, `tale-autosave*`, `tale-history*`, `tale-layers*` or the tales module document/draft code (parallel Tale Studio 7.3); `npm install`.

</intent-contract>

## Code Map

- `libs/web-sdk/vite.config.mts` -- deprecated Nx Vite plugins, per-file `.d.ts` emission, scaffold comments.
- `libs/web-sdk/eslint.config.mjs` -- ignores `@taleart/contract` in the dependency check; its comment explains why.
- `libs/web-sdk/src/lib/bar.ts` -- `prefersReducedMotion()`; `banner.ts`, `viewer.ts`, `taleart-element.ts` -- the same media query repeated.

## Tasks & Acceptance

**Execution:**
- [x] `libs/web-sdk/vite.config.mts` -- `resolve: { tsconfigPaths: true }` for `nxViteTsPaths()`; a small inline plugin (writeBundle, `node:fs`) copies `package.json` (which `nxViteTsPaths` copied) and `README.md` (which `nxCopyAssetsPlugin(['*.md'])` copied); a vite-plugin-dts `afterBuild` hook rolls the declarations into one `index.d.ts` with API Extractor, `bundledPackages: ['@taleart/contract']`, and removes the per-file ones; scaffold comments dropped -- removes the deprecation warnings and the unpublished type import.
- [x] `libs/web-sdk/eslint.config.mjs` -- comment says the types are inlined into `index.d.ts` at build.
- [x] `libs/web-sdk/src/lib/bar.ts`, `banner.ts`, `viewer.ts`, `taleart-element.ts` -- one exported `REDUCED_MOTION_QUERY`; the viewer calls `prefersReducedMotion()` instead of repeating it -- same query, same checks.

**Acceptance Criteria:**
- Given a web-sdk build, then `dist/libs/web-sdk` holds `index.js`, `index.umd.cjs` (byte-identical to before), `README.md`, `package.json` and one `index.d.ts` that does not mention `@taleart/contract`, and no Nx Vite deprecation warning prints.
- Given the full suite, then every project passes with the same test count as before; size, a11y, a11y-review and perf pass.

## Implementation Notes

- Scope came from every web-zones plan (`deferred:`, `[defer]` triage rows, residual risks), the foundation sweep's `deferred:` items that touch web zones, and the 3.12 accessibility report.
- vite-plugin-dts' own `rollupTypes` could not be used: it takes the entry from `package.json` `types` resolved against the source folder (`libs/web-sdk/index.d.ts`, which never exists), since that manifest describes the dist folder. Changing `types` would change the published manifest, so the `afterBuild` hook calls API Extractor directly. API Extractor is not a root devDependency; it is a direct dependency of vite-plugin-dts (7.59.4, hoisted), and the dependency check ignores the Vite config. It analyses with its bundled TypeScript 5.9.3 and prints a one-line notice that the project uses 6.0.3; the rolled-up file type-checks on its own (`tsc --noEmit --strict` on `dist/libs/web-sdk/index.d.ts`) and exports the same five names as `src/index.ts`.
- `nxViteTsPaths` also copied `package.json` into the dist folder at writeBundle (found by building with and without it); `nx-release-publish` publishes from there, so the copy plugin keeps it.
- `index.js`, `index.umd.cjs`, `README.md` and `package.json` in the dist folder are byte-identical to the baseline build.
- Prettier flags two untouched spots in `banner.ts` and `viewer.ts` (and one in `taleart-element.ts`) that predate this story; left as they are (no reformatting of untouched code).
- Left out on purpose:
  - Dashboard screens not scanned for WCAG 2.2 AA (3.12 open item 1) -- needs a signed-in scan or e2e target; new verification work, not cleanup. Still deferred in the 3.12 plan.
  - Captions and language on tales (3.12 open item 2; 1.2.2, 1.2.3, 1.2.5, 3.1.2) -- product decision and API change; signed off as post-MVP.
  - 3.12 observations: visible bar scroll buttons, live-region verbosity, real Windows High Contrast check -- visual or behaviour changes, or manual checks.
  - axe-core loaded from cdnjs (hash-pinned) instead of a devDependency (3.2) -- needs a new dependency.
  - Zone-key cache, `Access-Control-Max-Age`, server renditions (3.11) -- behaviour or performance changes the epic forbids without a decision.
  - One Delivery request per `<taleart-view>` on a page with several stages (3.7) -- changing it changes request behaviour.
  - `configureZone` module state per SDK copy (3.9), theme contrast checks (3.8, 3.9) -- behaviour changes.
  - One failed per-zone request marking the dashboard API-down (foundation `deferred:`) -- behaviour change, and not web zones code.
  - Exported-but-unused-elsewhere SDK types (`TaleViewerOptions`, `DocumentRenderOptions`, `ElementRenderer`) -- they type exported signatures; unexporting gains nothing.
  - Pre-existing Prettier drift in untouched SDK lines -- the story forbids reformatting untouched code.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --skip-nx-cache` -- expected: all pass, test counts unchanged.
- `npm exec nx -- run web-sdk:size`, `sdk-sample:a11y`, `sdk-sample:a11y-review`, `sdk-sample:perf` -- expected: pass.

**Results (on the merged foundation tip 901ba7e):**
- lint, test, build: 12 projects pass (35 tasks). Tests before -> after: api 396 -> 396, dashboard 305 -> 305, contract 109 -> 109, server-access 29 -> 29, server-zones 67 -> 67, server-tales 105 -> 105, server-storage 16 -> 16, server-targeting 24 -> 24, server-importer 276 -> 276, web-sdk 276 -> 276, fake-storyly 18 -> 18 (sdk-sample has no unit tests). Nx Vite deprecation warnings: 4 -> 0.
- `web-sdk:size` 14.53 KB gzipped (budget 50 KB); `sdk-sample:a11y` no violations; `sdk-sample:a11y-review` all 123 checks passed; `sdk-sample:perf` cold p75 first content 1260 ms (<= 1500 ms).
