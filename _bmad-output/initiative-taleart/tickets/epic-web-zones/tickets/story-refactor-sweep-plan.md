---
title: 'Refactor sweep'
type: 'refactor'
ticket: '13'
created: '2026-10-21'
status: 'built'
baseline_revision: '901ba7e'
route: 'full'
route_source: 'auto'
risk: 'low'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 1
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The web zones epic left cleanup behind in the Web SDK: its Vite config still uses the deprecated `nxViteTsPaths` and `nxCopyAssetsPlugin` (two deprecation warnings on every SDK lint, test and build), its published `.d.ts` files import types from `@taleart/contract`, which is neither a declared nor a published dependency (3.1 `[defer]`, foundation sweep `deferred:`), and the reduced-motion media query is spelled out in four places.

**Approach:** Cleanup only, no behaviour change: Vite's built-in `resolve.tsconfigPaths` like the other projects, a few lines of inline plugin in place of the package-file copy steps, public types of the SDK's own (kept equal to the contract's by a type-level test) with only the public API's declarations published and a build-output check, and one shared reduced-motion query.

## Boundaries & Constraints

**Always:** Same behaviour of the bundle (ES and UMD), same `README.md` and `package.json` in `dist/libs/web-sdk`, same public names; test counts do not drop; `.prettierrc` printWidth 120 and untouched code is not reformatted; no new dependencies.

**Never:** Visual, API or behaviour changes (everything in "Left out"); edits in `pages/tale-studio*`, `tale-autosave*`, `tale-history*`, `tale-layers*` or the tales module document/draft code (parallel Tale Studio 7.3); `npm install`.

</intent-contract>

## Code Map

- `libs/web-sdk/vite.config.mts` -- deprecated Nx Vite plugins, per-file `.d.ts` emission of every module, scaffold comments.
- `libs/web-sdk/src/lib/taleart-element.ts`, `theme.ts` -- the public `Theme` type, taken from the contract (`components['schemas']['Theme']`).
- `libs/web-sdk/eslint.config.mjs` -- ignores `@taleart/contract` in the dependency check; its comment explains why.
- `libs/web-sdk/src/lib/bar.ts` -- `prefersReducedMotion()`; `banner.ts`, `viewer.ts`, `taleart-element.ts` -- the same media query repeated.

## Tasks & Acceptance

**Execution:**
- [x] `libs/web-sdk/vite.config.mts` -- `resolve: { tsconfigPaths: true }` for `nxViteTsPaths()`; a small inline plugin (writeBundle, `node:fs`) copies `package.json` (which `nxViteTsPaths` copied) and `README.md` (which `nxCopyAssetsPlugin(['*.md'])` copied); dts `include` limited to the public API (`index.ts`, `taleart-element.ts`, `public-types.ts`); vitest `typecheck` for `*.spec-d.ts` with `tsconfig.typetest.json`; scaffold comments dropped -- removes the deprecation warnings and the unpublished type import.
- [x] `libs/web-sdk/src/lib/public-types.ts` (new) + `public-types.spec-d.ts` (new) -- `Theme` and `RingStyle` spelled out; `expectTypeOf(...).toEqualTypeOf<...>()` against the contract's `Theme` keeps them equal; `taleart-element.ts` and `theme.ts` use them.
- [x] `libs/web-sdk/scripts/check-types.mjs` (new) + `project.json` `types-check` target (after build) -- fails if a `dist/libs/web-sdk/**/*.d.ts` names `@taleart/` or `components[`, and type-checks a small consumer that imports the package from the dist folder (`tsc`, strict, outside the workspace).
- [x] `libs/web-sdk/eslint.config.mjs` -- comment says which contract runtime values are bundled and that the public declarations use the SDK's own types; `*.spec-d.ts` ignored by the dependency check (test files); `tsconfig.lib.json` excludes them.
- [x] `libs/web-sdk/src/lib/bar.ts`, `banner.ts`, `viewer.ts`, `taleart-element.ts` -- one exported `REDUCED_MOTION_QUERY`; the viewer calls `prefersReducedMotion()` instead of repeating it -- same query, same checks.

**Acceptance Criteria:**
- Given a web-sdk build, then `dist/libs/web-sdk` holds `index.js`, `index.umd.cjs`, `README.md`, `package.json` and the declarations of the public API only (`index.d.ts`, `lib/taleart-element.d.ts`, `lib/public-types.d.ts`), none naming `@taleart/` or an OpenAPI schema; `web-sdk:types-check` passes; no Nx Vite deprecation warning prints.
- Given the contract's `Theme` changes, then `web-sdk:test` fails on the type-level drift test.
- Given the full suite, then every project passes with the same test count as before; size, a11y, a11y-review and perf pass.

## Implementation Notes

- Scope came from every web-zones plan (`deferred:`, `[defer]` triage rows, residual risks), the foundation sweep's `deferred:` items that touch web zones, and the 3.12 accessibility report.
- First pass rolled the declarations into one `index.d.ts` with API Extractor in a vite-plugin-dts `afterBuild` hook (vite-plugin-dts' own `rollupTypes` reads the entry from `package.json` `types` against the source folder). Review replaced it: it imported an undeclared package and published the contract's whole OpenAPI `components` interface (about 900 lines). Now the SDK owns its public types (`public-types.ts`), only the public API's declarations are emitted, and `web-sdk:types-check` checks the output.
- The public API's declarations reached the contract only through `Theme` (`taleart-element.d.ts`); internal modules' declarations (bar, banner, viewer, delivery client, document renderer) pointed at Delivery schema types and are no longer published. The public names are unchanged (`configureZone`, `defineTaleartElement`, `TaleartElement`, `TALEART_ELEMENT_TAG`, `ZoneOptions`).
- Drift test: `vitest --typecheck` runs `*.spec-d.ts` with `tsconfig.typetest.json` (only the type tests, so the existing type errors in the runtime specs, which no target type-checks, do not count). Checked by widening `ringWidth` to `number | string`: the test failed, then passed when restored. `types-check` was checked against a copied dist with an added `@taleart/contract` import (fails, names the line) and with `ringWidth: string` (the consumer fails to type-check).
- `nxViteTsPaths` also copied `package.json` into the dist folder at writeBundle (found by building with and without it); `nx-release-publish` publishes from there, so the copy plugin keeps it. `README.md` and `package.json` in the dist folder are byte-identical to the baseline build.
- The bundle bytes are not identical to the baseline: sharing the reduced-motion query changes the minified output (`index.js` 48,584 -> 48,466 bytes, 14.54 -> 14.53 KB gzipped; `index.umd.cjs` 41,373 -> 41,259 bytes). Behaviour is identical: the same media query string is evaluated at the same points, and the viewer's check is the same expression `prefersReducedMotion()` returns.
- Prettier flags untouched spots in `banner.ts`, `viewer.ts`, `taleart-element.ts`, `theme.ts` and `project.json` that predate this story; left as they are (no reformatting of untouched code).
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

### 2026-10-21 — Review pass 1 (coordinator)
- verdicts: 5 findings — 5 patched, 0 deferred, 0 rejected.
  - `[patch]` The `afterBuild` hook imported `@microsoft/api-extractor`, which is not a declared dependency -- hook and import removed; the SDK's public types are its own (`public-types.ts`), kept equal to the contract by a type-level drift test (`public-types.spec-d.ts`, `vitest --typecheck`); emitted declarations do not import `@taleart/contract`.
  - `[patch]` No check failed when published declarations named a workspace package -- new `web-sdk:types-check` (after build): greps the dist `.d.ts` files for `@taleart/` and `components[`, and type-checks a consumer importing the package from the dist folder; both failure modes checked on a broken copy.
  - `[patch]` The rolled-up `index.d.ts` published the contract's internal OpenAPI schemas (`components`) -- only the public API's declarations are emitted (dts `include`); `Theme` no longer points into `components`.
  - `[patch]` The plan said the bundles were byte-identical, but the reduced-motion refactor changes the minified output -- corrected; sizes re-measured on the final build (14.53 KB gzipped) and behaviour stated as identical.
  - `[patch]` The ESLint comment said the SDK imports only types from the contract -- it now names the bundled runtime values (`cleanText`, `ELEMENT_TEXT_RULE`, `TEXT_ELEMENT_STYLE`, `readingOrder`).

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool --skip-nx-cache` -- expected: all pass, test counts unchanged.
- `npm exec nx -- run web-sdk:types-check`, `web-sdk:size`, `sdk-sample:a11y`, `sdk-sample:a11y-review`, `sdk-sample:perf` -- expected: pass.

**Results (after review fixes, on the foundation tip 901ba7e, `--skip-nx-cache`):**
- lint, test, build: 12 projects pass. Tests before -> after: api 396 -> 396, dashboard 305 -> 305, contract 109 -> 109, server-access 29 -> 29, server-zones 67 -> 67, server-tales 105 -> 105, server-storage 16 -> 16, server-targeting 24 -> 24, server-importer 276 -> 276, web-sdk 276 -> 278 (+2 type-level drift tests, no type errors), fake-another tool 18 -> 18 (sdk-sample has no unit tests). Nx Vite deprecation warnings: 4 -> 0.
- `web-sdk:types-check`: 3 declaration files, none naming `@taleart/` or `components[`; the consumer type-checks. `web-sdk:size` 14.53 KB gzipped (budget 50 KB). `sdk-sample:a11y` no violations; `sdk-sample:a11y-review` all 123 checks passed; `sdk-sample:perf` cold p75 first content 1255 ms (<= 1500 ms).
