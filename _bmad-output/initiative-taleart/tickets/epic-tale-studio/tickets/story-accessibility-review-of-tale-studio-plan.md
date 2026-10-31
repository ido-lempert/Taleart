---
title: 'Accessibility review of Tale Studio and composed tales'
type: 'chore'
ticket: '15'
created: '2026-10-23'
status: 'built'
baseline_revision: 'd41c883'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/a11y-review-8-17.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/a11y-review-3-12.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** R12 and R13 ask that Tale Studio and the tales it composes meet WCAG 2.2 AA: every studio action works without a pointer, the scans of the studio and the sample page report no violations, and a person composes and walks a tale with a keyboard and a screen reader. 7.10 scanned the studio with axe only (one composed tale); nothing proves the studio is operable by keyboard end to end; the sample-page review has carried two landscape failures since the wide-screen deck; and 3.12 left its viewer screen-reader checklist and the scan of the web-zones dashboard screens to this story.

**Approach:** A second `@a11y` spec in `dashboard-e2e` composes a tale with Tab and keys only and scans each studio state on the way with the 8.17 harness (`wcag.ts`), plus the web-zones screens 8.17 did not reach; re-run `sdk-sample:a11y` and `a11y-review`; fix what they find, each with a unit check; write the walk for the person (`a11y-review-7-15.md`), folding in 3.12's viewer checklist. The story stays hitl until the walk is done.

## Boundaries & Constraints

**Always:** reach every studio control by Tab (never click, never focus by script, except to reset between states); scans fail on any finding; each fix gets a unit check; fresh `_e2e_test` database; the run empties the install at the end.

**Never:** mark the story done (hitl); touch `sdk.router.ts` or the SDK perf scripts (7.14); change studio behaviour beyond the findings; exempt a finding without a WCAG reason written beside it.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Compose by keyboard | Empty tale | Text, image (picker), rectangle, emoji (picker), button added by Enter; named and announced | A control not reached in N Tabs fails the test |
| Layer under a picture focused | Text below an image | The focused layer shows above the others while focused | 2.4.11 finding |
| Emoji picker Tab | Grid with roving tabindex | Tab from the grid wraps to Close; Shift+Tab from Close returns to the grid | — |
| Shift+F10 on a Mac | Canvas layer or row | The studio's menu opens (no contextmenu event needed) | — |
| Wide landscape viewer | 844 × 390 | Deck card measured and scanned after its shuffle-in | — |

</intent-contract>

## Code Map

- `apps/dashboard-e2e/src/studio-keyboard.spec.ts` -- new: keyboard operability and the studio scan (22 states)
- `apps/dashboard-e2e/src/session.ts` -- new: DB sign-in and empty install, shared with `studio-a11y.spec.ts`
- `apps/dashboard-e2e/src/wcag.ts` -- focus walk passes through multi-part inputs (datetime-local)
- `apps/dashboard-e2e/src/axe.ts` -- canvas layers exempt from axe `target-size` (2.5.8 "equivalent")
- `apps/dashboard/src/app/drawer.ts` -- Tab trap counts only Tab stops
- `apps/dashboard/src/app/pages/tale-studio.ts` -- focused layer on top; Shift+F10 and ContextMenu keys; emoji spoken names; two-sentence announcements
- `apps/dashboard/src/app/pages/tale-layers.ts` -- `layerSpokenName`
- `apps/dashboard/src/styles.css` -- layer names wrap
- `apps/dashboard/src/app/pages/projects.ts` -- project card wraps its actions below a long name
- `apps/sdk-sample/a11y-review.mjs` -- landscape check waits for the deck card

## Tasks & Acceptance

**Execution:**
- [x] `apps/dashboard-e2e/src/studio-keyboard.spec.ts` -- keyboard walk and scans -- R13 by script
- [x] fixes listed in the review doc, each with a unit check -- R12/R13
- [x] `apps/sdk-sample/a11y-review.mjs` -- landscape: wait for the shuffle-in, expect the deck card on wide screens -- the two known failures
- [x] `_bmad-output/.../epic-tale-studio/a11y-review-7-15.md` -- results and the walk for a person

**Acceptance Criteria:**
- Given `dashboard-e2e:a11y`, when it runs, then the 8.17 states and the 22 studio and web-zones states report no finding and every keyboard step passes.
- Given `sdk-sample:a11y` and `a11y-review`, when they run, then every check passes (217/217).
- Given the walk doc, when a person follows it, then every studio action and every published element is covered.

## Implementation Notes

- Findings and fixes: see `a11y-review-7-15.md` (7 fixes: layer names cut at 320 px; Tab leaving the emoji picker; focus hidden under a higher layer; Shift+F10 needs a contextmenu event Macs never send; emoji names read twice; change and contrast verdict run together in one announcement; project card actions over a long name).
- The two landscape failures were the review measuring the wide-screen deck's card while it shuffled in (scale 0.92, opacity rising): a test timing issue from f752d74, not an SDK fault. The check now waits for the card's animations and expects the deck card (88 % of the height, centred) on wide screens, full height in the phone layout.
- axe's `target-size` flagged overlapping canvas layers; they are exempt under 2.5.8's "equivalent" exception (each has its layers-grid row, ≥ 24 px). The targeted 2.5.8 check of `wcag.ts` still runs on them.
- The focus walk ended early at a `datetime-local` field (its parts keep focus over several Tabs): it now passes through up to ten repeats of one control.
- Merged `autopilot/foundation` at ce14153 (7.14) before the final verification.

## Review Triage Log

Review 1 (coordinator), all patched:
- MUST 1 — in-place text field hidden under a higher layer: `.el-edit { z-index: 99 }`, no inline z-index; CSS check; spec: Enter and F2 on the text wholly under the picture, field on top.
- 2 — raising the focused layer changed its stacking: the ring is now an overlay (`.focus-frame`, the layer's box and rotation, no pointer events, z-index 98 under the guides); the layer is raised only while wholly under higher layers (`hiddenUnder`, nine points by layer order, re-read after each change); spec checks a partly covered layer is not raised and a keyboard reorder keeps its stacking.
- 3 — every `tabTo` target (Shift+Tab paths included) and every control focus lands on is checked on screen and on top.
- 4 — the axe `target-size` exemption needs every related node to be a canvas layer too; the phone state checks the layers grid is on the page.
- 5 — landscape: docs (7.15 and 3.12) say the expectation changed to the deck card at 88 %; the check waits two frames and for finite animations' `finished`, asks for in view, centred, 9:16, ≥ 85 % of the height; reduced-motion variant (220 checks).
- 6 — drawer trap: of a radio group only the checked radio (else the first) is a stop.
- 7 — walk 3.8: one studio menu, never the browser's, for Shift+F10 and the Windows menu key.
- 8 — unused `row.name` removed.
- 9 — walk rows added: edit in place under a picture, Delete, duplicate layer, Shift+Space multi-select and group move, moving a locked layer, H on the canvas, inspector style controls, emoji name and replace, Decorative, reduced motion in the viewer, serving the sample page for part 8, time per platform.
- 10 — spec: no script focus (menus by arrows, rows by the grid), exact live-region text, replay and the preview link asserted, state count `toBe(22)`, movement checked on the canvas style and the fields; walk 3.10 records 2.1.2.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard docs contract server-access server-zones server-tales server-storage server-targeting web-sdk sdk-sample dashboard-e2e --parallel=2` -- expected: pass (bar the known auth clock test)
- `E2E_DATABASE_URL=…_e2e_test E2E_API_PORT=3407 E2E_DASHBOARD_PORT=4407 node_modules/.bin/nx run dashboard-e2e:a11y` -- expected: 0 findings
- `node_modules/.bin/nx run dashboard-e2e:e2e`, `sdk-sample:a11y`, `sdk-sample:a11y-review` -- expected: pass

**Manual checks:**
- The walk in `a11y-review-7-15.md` (hitl).
