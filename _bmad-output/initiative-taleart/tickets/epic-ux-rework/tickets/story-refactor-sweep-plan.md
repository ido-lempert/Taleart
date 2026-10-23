---
title: 'Refactor sweep'
type: 'refactor'
ticket: '18'
created: '2026-10-23'
status: 'built'
baseline_revision: '4f2bfdd'
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

**Problem:** The epic left code that served only stages, several frames per zone, playbooks and zone keys, plus duplicates its reviews deferred to this sweep (the popover code of the ⋯ menu and the visibility tooltip, copies of the transaction helper).

**Approach:** Collect every deferred and follow-up item from the epic's plans and the autopilot report, sort each into cleanup (done here) or behaviour change (listed as a follow-up ticket candidate), and do the cleanups in small commits with no behaviour change.

## Boundaries & Constraints

**Always:** no change a visitor, a dashboard user or an API client can see; tests unchanged in intent (renamed or moved only, each change explained); forward-only migrations stay as they are (`foldStagesIntoZones`, the `zone_keys` drop, the `playbook_key` rename), and `playbook_key` stays the template note's column.

**Never:** behaviour changes from the follow-up list; renaming API or contract names (`frame`, frame types) that clients read.

</intent-contract>

## Classified list

Sources: `tickets/*-plan.md` (Deferred, follow-up, Not done, later) and `autopilot-report.md`.

| # | Item | Source | Class | Outcome |
|---|------|--------|-------|---------|
| 1 | Dedupe the top-layer popover, positioning and outside-close code of `VisibilityIndicator`, `MenuButton` (and the tale layer menu) | 8.3 review item 10 | cleanup | done: `apps/dashboard/src/app/top-layer.ts` |
| 2 | Duplicated transaction helpers: tales module and targeting module copies of `@taleart/server-access` `inTransaction` | sweep brief, 8.8 notes | cleanup | done; the importer's copy stays (it reports an uncertain COMMIT, different behaviour) |
| 3 | `fold.ts` variable names | sweep brief | cleanup | done |
| 4 | Several frames per zone: display reads ordering frames and taking the first | AD-17 leftovers | cleanup | done (`frames.ts`, `zones.ts`: the unique index `frames_zone_id_key` holds one) |
| 5 | Several frames per zone in the Web SDK element (array of views, opener frame id across reloads) | AD-17 leftovers | cleanup | done; SDK 24.37 → 24.22 KB gzipped |
| 6 | Two copies of the legacy-schema helpers in the API fold tests | 8.5 tests | cleanup | done; one shared helper |
| 7 | Sample a11y review fixture named `frames` (one zone per entry) | 8.5/8.7 leftovers | cleanup | done; renamed `displays`, screenshot option `views` |
| 8 | Dashboard store dead code paths | sweep brief | cleanup | checked, none found (every private and public member is used; no stage, multi-frame, playbook or zone-key branch remains) |
| 9 | `playbook`/`stage`/`zone key` mentions | sweep brief | cleanup | checked: what remains is the migrations, tests asserting the removals, the docs page on moving off stages and zone keys, the SDK's one-line `zone-key` warning, and "stage" meaning the tale's 9:16 canvas; all kept on purpose |
| 10 | A per-project cap on tale groups | 8.14 follow-up | behaviour | follow-up ticket candidate |
| 11 | Groups in no zone cannot get tales (group view needs a zone) | 8.14 follow-up | behaviour | follow-up ticket candidate |
| 12 | A zone that opts out of the site key | 8.6 "later option" | behaviour | follow-up ticket candidate |
| 13 | The pinned SDK URL serves only the current build | 8.13 follow-up | behaviour | follow-up ticket candidate |
| 14 | No endpoint to delete a tale (a failed upload's tale stays Hidden) | 8.13 follow-up | behaviour | follow-up ticket candidate |
| 15 | A fold test from the real cf1bf03 migrations | 8.5 "Not done" | test infrastructure | follow-up candidate (needs that release built beside this one) |
| 16 | Follow-up reviews recommended on 8.6, 8.7, 8.13 (`followup_review_recommended: true`) | plans | review | follow-up candidate, not code |
| 17 | A failed per-zone request marks the dashboard API-down; body-parser 413/415 handling | foundation 1.10 deferrals | behaviour, other epic | follow-up candidate (out of this epic) |
| 18 | The Tale groups page offers "Show in another zone" on an archived group | 8.10 known | behaviour | follow-up candidate |

## Code Map

- `apps/dashboard/src/app/top-layer.ts` -- new: show/hide in the top layer, viewport size, placement, outside test, open-time listeners
- `apps/dashboard/src/app/menu-button.ts`, `visibility.ts`, `pages/tale-layer-menu.ts` -- use it
- `libs/server/tales/src/lib/*.ts`, `libs/server/targeting/src/lib/tags.ts` -- import `inTransaction`/`TransactionalDb` from `@taleart/server-access`
- `libs/server/zones/src/lib/fold.ts`, `frames.ts`, `zones.ts` -- names; one-display reads
- `libs/web-sdk/src/lib/taleart-element.ts` -- one display view
- `apps/api/src/app.spec.ts`, `apps/sdk-sample/a11y-review.mjs` -- test helper dedupe and fixture names

## Tasks & Acceptance

**Execution:**
- [x] transaction helper -- one copy (commit 1)
- [x] zones module and fold names, API fold test helpers (commit 2)
- [x] Web SDK one display (commit 3)
- [x] sample review fixture names (commit 4)
- [x] dashboard top-layer helper (commit 5)

**Acceptance Criteria:**
- Given the full suite, when it runs, then it passes as before (only the known clock-skew auth test fails).
- Given the dashboard and the sample page, when used, then they behave as before (e2e, a11y, a11y-review, perf, preview-parity unchanged).

## Implementation Notes

- **Tests changed and why.** `libs/server/tales` specs import `TransactionalDb` from `@taleart/server-access` (the tales module no longer defines it). `apps/api/src/app.spec.ts`: the two fold describes shared one copy of `legacySchema`/frame/stage helpers; the shared `legacySchema(...projectIds)` also clears the slugs (the first describe did that inline) and creates the pre-rework `frames_zone_id_idx`, which the first describe's copy left out; the fold drops it, and those tests check rows, not indexes. `apps/sdk-sample/a11y-review.mjs`: fixture key `frames` → `displays`, `shot` option `frames` → `views`. No assertion changed.
- **SDK focus after a reload.** The element tracked which frame opened the viewer so focus returned to it after a reload; with one display, "the opener, then any frame with the group, then the opener or the first frame" is "the display's item for the group, else its first item", which is what it now does.
- **`@taleart/server-tales` still exports the `TransactionalDb` type** (re-exported from the access module) for its users.
- **Bundle sizes.** Web SDK 24.37 → 24.22 KB gzipped (index.js 82.72 kB raw before). Dashboard initial 394.40 kB before and after; zone-detail 131.34 → 131.33 kB; tale-studio 228.81 → 228.65 kB.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard docs contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool dashboard-e2e --parallel=2` -- expected: all pass except the known clock-skew auth test
- `web-sdk:size`, `web-sdk:types-check`, `sdk-sample:a11y`, `sdk-sample:a11y-review` (2 known landscape failures), `sdk-sample:perf`, `sdk-sample:preview-parity`, `dashboard-e2e:e2e`, `dashboard-e2e:a11y`
