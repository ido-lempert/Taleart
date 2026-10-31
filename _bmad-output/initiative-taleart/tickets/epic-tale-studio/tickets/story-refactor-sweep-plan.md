---
title: 'Tale Studio refactor sweep'
type: 'refactor'
ticket: '16'
created: '2026-10-23'
status: 'built'
baseline_revision: '787e999'
route: 'full'
route_source: 'auto'
risk: 'low'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
  - '{project-root}/_bmad-output/initiative-taleart/autopilot-report.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Tale Studio stories left `tale-studio.ts` at 4,001 lines (a 970-line inline template, inline styles, pure view and contrast helpers and key checks inside the page class), small helpers copied across the inspector files, the same test helpers in seven studio specs, and a few exports nothing imports.

**Approach:** Cleanup only, scoped from every story plan's `deferred` list, review logs and "Known limits", and the autopilot report's Tale Studio entries. Each item is classified below; cleanup items are done in small separate commits, behaviour changes are listed as follow-up candidates.

## Boundaries & Constraints

**Always:** no behaviour change in the studio, the preview, the SDK or the API; compiled output of moved code is the same; tests change only in where they import from (each test edit explained in its commit).

**Never:** change copy, rules or timing; touch the SDK bundle or the server; fix behaviour-level inconsistencies found on the way (they are follow-ups).

</intent-contract>

## Classified list (sources: the 16 story plans and `autopilot-report.md`)

Every plan's `deferred` frontmatter is empty except 7.4's two items, both closed by 7.9. Items found:

| # | Item | Source | Class | Done |
|---|------|--------|-------|------|
| 1 | `tale-studio.ts` too large: inline template and styles | ticket 16, code | cleanup | `tale-studio.html`, `tale-studio.css`, `tale-studio-canvas.css` |
| 2 | Canvas view helpers inside the page file | code | cleanup | `tale-canvas-view.ts` |
| 3 | Contrast and sampling glue inside the page class | code (7.10) | cleanup | `tale-contrast.ts` |
| 4 | Key checks inside the page's handlers | code (7.2, 7.15) | cleanup | `isMenuKey`, `isSelectionKey`, `arrowMove` in `tale-layers.ts` |
| 5 | `percent` defined 5 times | code | cleanup | one export in `tale-layers.ts` |
| 6 | Label cleaning duplicated (shapes, media alt) | code | cleanup | `cleanLabel` in `tale-layers.ts` |
| 7 | `settle` and `WAIT_FOR_TEST` copied in 6–7 specs | code | cleanup | `tale-studio.testing.ts` |
| 8 | Exports nothing imports | code | cleanup | 7 constants un-exported |
| 9 | `propValueProblem` / Ajv parity note | 7.8 plan | cleanup | comment names the checked types and the parity test |
| 10 | Element-type naming (`TaleElement['type']` vs `TaleElementType`) | ticket 16 | cleanup | studio uses `TaleElementType`, as the SDK does |
| 11 | Stale page doc comment ("stories 1 to 3") | code | cleanup | updated |
| 12 | Stale "publish" wording | 8.4 | checked | only the API action name (`publish`) and `published` signals remain; no user-facing text |
| 13 | 7.4 deferred: AD-16 studio mounts the SDK renderer; AC1 pixel parity | 7.4 plan | closed by 7.9 | — |
| 14 | Links inspector `cleanLine` folds every whitespace run; media and shapes alt fold only line feeds | code | behaviour | follow-up |
| 15 | Hex field setters (`setHex` ×3, `setBackgroundHex`) and opacity clamp-and-announce duplicated, with different messages | code | behaviour-adjacent (messages differ) | follow-up |
| 16 | Live-region announce differs (`tale-groups` nbsp trick vs studio clear-then-set) | code | behaviour | follow-up |
| 17 | Emoji below a label painted with the browser's emoji font; a verdict changed only by arriving samples is not announced | 7.10 known limits | behaviour | follow-up |
| 18 | A real iOS touch swipe on the swipe-up link is unverified | 7.7 / report | verification | follow-up (device check) |
| 19 | Known flaky autosave-timing test in `tale-studio.spec.ts` under load | report (7.12) | test stability | follow-up (not seen in this run) |
| 20 | Emoji picker is a curated catalog | 7.6 | product | follow-up candidate |
| 21 | Owner walks in `a11y-review-7-15.md` | 7.15 | hitl | waits for owner |
| 22 | Pinned SDK URL serves only the current build; no tale delete endpoint | report (7.9) | behaviour | follow-up (already listed by 8.18) |
| 23 | `doc(n)` helper duplicated in `tale-autosave.spec.ts` and `tale-history.spec.ts` | code | cleanup, left | two small specs of different modules; not worth a shared file |

## Code Map

- `apps/dashboard/src/app/pages/tale-studio.ts` -- the page; 4,001 → 2,543 lines.
- `apps/dashboard/src/app/pages/tale-studio.html`, `tale-studio.css`, `tale-studio-canvas.css` -- template and styles, moved verbatim (dedented).
- `apps/dashboard/src/app/pages/tale-canvas-view.ts`, `tale-contrast.ts` -- moved pure helpers.
- `apps/dashboard/src/app/pages/tale-layers.ts` -- `percent`, `cleanLabel`, key checks.
- `apps/dashboard/src/app/pages/tale-studio.testing.ts` -- shared spec helpers.
- `apps/dashboard-e2e/scripts/dashboard-a11y-css.test.mjs` -- reads the studio's CSS and template files.

## Tasks & Acceptance

**Execution:**
- [x] Template and styles to their own files; styles split in two to stay under the 4 kB component style budget (one file was 13 bytes over).
- [x] Canvas views, contrast glue and key checks out of the page.
- [x] One `percent`, one `cleanLabel`; unused exports dropped.
- [x] Spec helpers shared.
- [x] Comments: page doc, `propValueProblem`; naming `TaleElementType`.

**Acceptance Criteria:**
- Given the full verification, every project lints, tests and builds with the same test counts as the baseline; the studio chunk and the dashboard initial bundle do not grow; the SDK is unchanged.

## Implementation Notes

- Test edits (location only): `tale-element-types.spec.ts`, `tale-links.spec.ts`, `tale-shapes.spec.ts` import `kindName`, `linkView`, `shapeView` from `tale-canvas-view`; seven studio specs import `settle`/`WAIT_FOR_TEST` from `tale-studio.testing` instead of defining them; `dashboard-a11y-css.test.mjs` reads `tale-studio.css`, `tale-studio-canvas.css` and `tale-studio.html` (joined, as they were in one file) instead of `tale-studio.ts`. No assertion changed.
- Style order: the page stylesheet now holds the help, layout, panel, row, selected and textarea rules before the canvas file; no element carries classes of both groups, so the cascade is unchanged.
- The samples signal is read through a lookup function, so `layerRows` still tracks it only for labels over media.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard docs contract server-access server-zones server-tales server-storage server-targeting web-sdk sdk-sample dashboard-e2e --parallel=2` -- expected: pass (bar the known auth clock test)
- `web-sdk:size`, `web-sdk:types-check`, `sdk-sample:a11y`, `sdk-sample:a11y-review`, `sdk-sample:perf`, `sdk-sample:preview-parity`, `dashboard-e2e:e2e`, `dashboard-e2e:a11y`

**Results (2026-10-23, `--skip-nx-cache`):**
- run-many lint/test/build, 14 projects: pass except the known clock-skew auth test ("creates the admin, signs them in and stores only the token hash"). Tests: dashboard 656 (as baseline), api 598 of 599, contract 389, web-sdk 427, server-tales 280, 282, server-zones 60, server-access 33, server-targeting 24, server-storage 16, 18, dashboard-e2e 13 (node test).
- `web-sdk:size` 24.29 KB gzipped (unchanged); `web-sdk:types-check` pass; `sdk-sample:a11y` no violations; `sdk-sample:a11y-review` 220 of 220; `sdk-sample:perf` cold p75 1.28 s, first tale frame p75 64 ms; `sdk-sample:preview-parity` 8 of 8; `dashboard-e2e:e2e` 8 passed; `dashboard-e2e:a11y` 28 passed (run alone: with `e2e` in one run-many Nx refuses the second web server as a recursive invocation).
- Bundles: dashboard initial 394.38 KB (unchanged), studio chunk 231.79 → 231.80 KB raw (56.52 → 56.50 KB transfer).
