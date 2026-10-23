---
title: 'Accessibility review of the reworked dashboard (WCAG 2.2 AA)'
type: 'chore'
ticket: '17'
created: '2026-10-23'
status: 'built'
baseline_revision: '83cdc08'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'thorough'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 1
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/epic-ux-rework.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/a11y-review-3-12.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/a11y-review-8-17.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epic R18 asks that every reworked screen meets WCAG 2.2 AA, verified by an automated scan of the zones list, zone page (each tab), group and tale drawers, Tale groups page and Tale Studio status bar, and by a person completing the first-run path with only a keyboard and a screen reader. No scan of the dashboard exists (3.12 covered the SDK only), and 8.13's e2e checks axe on three states.

**Approach:** A repeatable `dashboard-e2e:a11y` Nx target that seeds a fresh install through the UI and the API, then scans 25 screens and states with axe-core (wcag2a/2aa/21a/21aa/22aa) plus targeted checks for 2.4.7, 2.4.11, 2.5.8, 1.4.10 (320 px) and 1.4.12; fix what it finds; write the walk checklist for the person (`a11y-review-8-17.md`). The story stays hitl until the walk is done.

## Boundaries & Constraints

**Always:** reuse the e2e harness (own API on an `_e2e_test` database, dashboard with `--excludeTaskDependencies`, virtual passkey); every state reported, the run fails on any finding; fixes targeted and CSS-only where possible; dashboard initial bundle under 500 kB.

**Never:** change Tale Studio's canvas internals beyond the focus ring (story 7.10 is changing contrast and visual order); mark the story done; run the scan inside `dashboard-e2e:e2e` (it has its own target).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Scan passes | fixed dashboard | 27 states, 0 findings, keyboard checks pass, exit 0 | — |
| Regression | a later change breaks a criterion | the state and finding listed, screenshot of the moment when `E2E_SCREENSHOTS` is set, exit 1 | the other states still scanned |
| Control in a card | link whose ring is drawn on its card | counts as visible focus (ancestors compared) | — |
| Modal open | drawer or menu | walk cycles inside the dialog; menus scanned without the walk (Tab closes them) | — |

</intent-contract>

## Code Map

- `apps/dashboard-e2e/src/a11y.spec.ts` (new) -- seeds data, visits each screen and state, reports and judges
- `apps/dashboard-e2e/src/wcag.ts` (new) -- focus walk (2.4.7, 2.4.11), target size, reflow, text spacing, `scan()`
- `apps/dashboard-e2e/src/media.ts` (new) -- the drawn PNGs, shared with `first-run.spec.ts`
- `apps/dashboard-e2e/project.json` -- `a11y` target; `e2e` runs `--grep-invert @a11y`; `test` adds the CSS checks
- `apps/dashboard-e2e/scripts/dashboard-a11y-css.test.mjs` (new) -- unit checks of the fixes
- `apps/dashboard/src/styles.css`, `src/app/app.css`, `src/app/pages/tale-studio.ts` -- the fixes

## Tasks & Acceptance

**Execution:**
- [x] `apps/dashboard-e2e/src/wcag.ts`, `a11y.spec.ts`, `media.ts`, `project.json` -- the scan target -- repeatable by later stories
- [x] `apps/dashboard/src/app/app.css` -- top bar wraps under 375 px -- 1.4.10 at 320 px
- [x] `apps/dashboard/src/styles.css` -- scroll padding for the sticky top bar and phone bottom bar; template description colour -- 2.4.11, 1.4.3
- [x] `apps/dashboard/src/app/pages/tale-studio.ts` -- inner focus ring on canvas elements -- 2.4.7
- [x] `apps/dashboard/src/app/create-drawer.ts` -- focus on the refused zone field -- 3.3.1
- [x] `apps/dashboard-e2e/scripts/dashboard-a11y-css.test.mjs` -- one check per fix
- [x] `_bmad-output/.../epic-ux-rework/a11y-review-8-17.md` -- results and the walk checklist

**Acceptance Criteria:**
- Given a fresh `_e2e_test` database, when `nx run dashboard-e2e:a11y` runs, then all 27 states report no finding and the keyboard and announcement checks pass.
- Given the walk checklist, when a person completes it with only a keyboard and VoiceOver or NVDA, then each step's result is recorded and findings become fixes (hitl, open).

## Implementation Notes

- Findings before the fixes (15 of 25 states): top bar 325–329 px wide at 320 px on every shell page (1.4.10); the chosen template's description 4.4:1 (axe color-contrast); the last group's indicator scrolled under the phone bottom bar by Tab (2.4.11); an image filling the Tale Studio canvas had its ring cut off by the canvas edge (2.4.7).
- Wrap breakpoint 375 px, not 400: at 390 px the bar fits on one line and wrapping it there cost a row on common phones.
- The canvas ring is a `::after` overlay: an inset box-shadow on the button paints under its image.
- The focus check compares pixels of the control and its three nearest ancestors focused vs blurred; the first version (control only) flagged the zones list's card link, whose ring is on the card.
- Pages are walked from the top (a temporary `tabindex=-1` mark at the start of the body); dialogs from the current focus until it cycles.
- 2.5.8 found nothing in any state (controls under 24 px meet the spacing exception).
- Scan run time about 2 minutes.
- Review pass (2026-10-23):
  - Added: a long project name in the seed; keyboard and announcement tests; a walk at 320 × 640; a form-error state.
    27 states now.
  - Checks made stricter:
    - 2.4.7 needs a changed line along a side; an ancestor counts only if its ring styles changed.
    - Reflow checks the left edge and boxes that newly cut content.
    - Text spacing runs at 320 px too and catches new overlaps of line boxes, matched by node, within one layer.
    - 2.5.8 covers more roles, nested shadow roots and float tolerance, and skips covered controls.
    - A walk that hits its limit is a finding.
    - Waits use `settle()` (animations done, two frames) instead of sleeps.
    - axe is read from `node_modules`, else from a SHA-checked local cache in `dist/.cache`. It is not committed:
      0.5 MB of minified third-party code, and no dependency can be installed here.
  - The stricter checks, run on the dashboard without the CSS fixes, report every original finding plus focus
    under the top bar at 320 px.
  - New fixes:
    - the switcher shrinks with a long project name;
    - focus goes to the refused zone field;
    - the canvas ring overlay is at `z-index: 0` and thinner on tiny elements (`isTiny`: w < 0.1 or h < 0.06 of the
      canvas);
    - after merging `autopilot/foundation` at b316037 (8.16 docs, Tale Studio 7.10), 7.10's `.el__warn` badge was
      raised to `z-index: 2`, explicitly above the ring, and the CSS test checks it.
  - A container query for "tiny" was rejected: `container-type` on `.el` would change what the elements' `cqh`
    units refer to.

## Plan Change Log

## Review Triage Log

- Pass 1 (coordinator review, 2026-10-23): 1 must, 4 should, 9 nice; all patched.
  - Must, 3.8 tale reorder in the walk: the walk doc has steps 3.8 and 3.9, and the a11y spec covers it (focus
    moves to Earlier when Later becomes disabled and hidden).
  - Should:
    - keyboard and announcement tests, with R18 mapped to them in the review doc;
    - 2.4.7 side-line and ancestor-style rule;
    - long project name: switcher shrinks;
    - reflow rules (scroll areas only, cut boxes, left edge).
  - Nice:
    - text-spacing overlaps at 320 px, by node;
    - walk limit is a finding;
    - zone page walked at 320 px; `focusShot` asserts on top;
    - inner ring under badges and thinner on tiny elements;
    - 2.5.8 roles, shadow roots, tolerance;
    - walk doc: form-error step, throwaway-database commands, "2 files" wording;
    - `settle()` instead of sleeps; local axe; 300 s timeouts;
    - whitespace-insensitive CSS test.

## Verification

**Commands:**
- `E2E_DATABASE_URL=postgres://…/taleart_w817_e2e_test node_modules/.bin/nx run dashboard-e2e:a11y` -- expected: 9 tests pass, 27 states, 0 findings
- `node_modules/.bin/nx run dashboard-e2e:e2e` -- expected: the 4 first-run tests pass
- `node_modules/.bin/nx run-many -t lint test build -p … --parallel=2` -- expected: green but the known clock-skew API auth test

**Manual checks (if no CLI):**
- The keyboard and screen-reader walk in `a11y-review-8-17.md` (hitl).
