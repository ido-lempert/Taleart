---
title: 'Open a tale group in the full-screen viewer'
type: 'feature'
ticket: '2'
created: '2026-10-20'
status: 'in-review'
baseline_revision: 'fbaf5df2e2d0c96612e460bae80428a32edb84bc'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/epic-web-zones.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The bar from story 1 shows a zone's tale groups, but activating an item does nothing: a visitor cannot watch the tales, and nothing records which groups they have seen.

**Approach:** SDK only; the Delivery response from story 1 already carries every tale and its media, so the API and contract do not change. Activating a bar item opens a full-screen viewer (a modal `<dialog>` in the element's Shadow DOM) that plays the group's tales with progress segments and moves between tales and groups by tap, swipe and keyboard. Viewed group ids go to the host browser's local storage and the bar draws a seen ring for them. An automated axe WCAG 2.2 AA scan of the open viewer runs on the sample page with the Delivery API stubbed.

## Boundaries & Constraints

**Always:**
- Viewer is a `<dialog>` opened with `showModal()` (top layer, so host CSS cannot clip it; background inert), named by the group (`aria-label`), full viewport, black background; scroll does not chain to the page (`overscroll-behavior: contain` on dialog and `::backdrop`). Where `showModal` is missing it falls back to the `open` attribute.
- Contents: progress segments (one per tale: done full, current filling, later empty; `aria-hidden`), the group name, a Pause/Play button and a Close button (named, at least 44 px), Previous tale and Next tale buttons over the left third and right two thirds of the stage, a polite live region "<group>, tale N of M", the media (image `alt` = tale title; video named by the tale title).
- Timing: an image (or a tale without media, or a video that fails) shows for 5 s; a video plays to its `ended` and its segment follows `currentTime`. The timer starts when the tale shows. Pause stops the timer, the segment and the video; resume continues from where it stopped.
- Navigation: next tale; after a group's last tale, the next group's first tale; after the last group, close. Previous tale; before a group's first tale, the previous group's last tale; at the very first tale, restart it. Swipe left / right (horizontal travel ≥ 50 px, more horizontal than vertical) moves to the first tale of the next / previous group (no group before the first: nothing; past the last: close). Groups with no tales are skipped and activating one opens nothing.
- Input: tap the stage's left / right zone = previous / next; press-and-hold (pointer down) pauses until release, and a release after a hold (≥ 250 ms) or a swipe does not also step; ArrowRight / ArrowLeft step; Space toggles pause (and never also activates the focused button); Escape (dialog `cancel`) and Close close.
- On open focus moves into the dialog (the dialog itself, `tabindex=-1`); on close focus returns to the bar item of the group shown last.
- Seen: when a group's tale shows, its id is added to `localStorage['taleart.seen']` (JSON array, newest last, capped at 500 ids); the bar marks seen groups with a grey ring (`#6b7280`, 3:1 against white) and the accessible name "<group>, seen". Storage that throws or holds junk reads as nothing seen and never breaks rendering. Nothing is sent to TaleArt (AD-13).
- Videos: `playsInline`, try with sound, fall back to muted when the browser refuses; pause on close. Long-press shows no context menu or selection on the media.
- No runtime dependency; bundle stays ≤ 50 KB gzipped; no new console output.

**Never:** Theme fields (story 8, colours stay defaults), banner slides opening the viewer (story 6), events or any network call besides media (epic-analytics), captions or a mute control, preloading strategies, changes to the API, contract or key handling, adding npm packages (node_modules is shared; see Implementation Notes).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | click bar item B (2 tales) | dialog open, named B, tale 1 shown, 2 segments, focus in dialog | — |
| Image timing | image tale, 5 s pass | next tale | — |
| Video timing | video tale | plays; `ended` → next tale | play refused → muted retry; media error → 5 s timer |
| Tap / arrows | Next zone or ArrowRight; Prev zone or ArrowLeft | step forward / back within group | — |
| Past last tale | last tale of B, next | first tale of C | — |
| Before first tale | first tale of B, previous | last tale of A | first tale of first group: restart it |
| End | last tale of last group, next (or timer) | viewer closes, focus on that group's item | — |
| Swipe | drag left / right ≥ 50 px | first tale of next / previous group; no step | none before first; past last closes |
| Hold | pointer held ≥ 250 ms then released | paused while held, resumes, no step | — |
| Space | Space key (any focus in dialog) | pause, again resumes; Pause button label flips | button not activated |
| Close | Escape or Close button | dialog closed, video paused, focus on bar item | — |
| Empty group | item of a group with no tales | nothing opens | — |
| Seen | open A, close, re-render (reload) | A's ring is the seen ring, name "A, seen"; B unchanged | storage throws / junk → nothing seen, no error |
| Seen cap | 500 ids stored, a new one seen | oldest dropped | — |
| A11y scan | sample page, stubbed API, viewer open | axe `wcag2a/aa, wcag21a/aa, wcag22aa`: 0 violations | — |
| Bundle | build | ≤ 50 KB gzipped | target fails above |

</intent-contract>

## Code Map

- `libs/web-sdk/src/lib/taleart-element.ts` -- renders the bar; wires item activation to the viewer, passes seen ids, re-marks the bar on close.
- `libs/web-sdk/src/lib/bar.ts` -- bar items; add the seen ring and seen name.
- `libs/web-sdk/src/lib/viewer.ts` (new) -- the viewer dialog: playback, navigation, input, focus.
- `libs/web-sdk/src/lib/seen.ts` (new) -- read and add seen group ids in local storage, failure-safe.
- `libs/web-sdk/src/lib/*.spec.ts` -- jsdom unit tests with fake timers and stubbed media.
- `apps/sdk-sample/` -- `a11y-scan.mjs` (Playwright + axe, stubbed Delivery API and media) and an `a11y` target; `serve.mjs` already serves the page and SDK.
- `libs/contract/src/index.ts` -- `DeliveryZone`, `DeliveryTaleGroup`, `DeliveryTale` types (read only).

## Tasks & Acceptance

**Execution:**
- [x] `libs/web-sdk/src/lib/seen.ts` -- seen store with cap and failure safety -- R4 seen ring, AD-13 local only.
- [x] `libs/web-sdk/src/lib/bar.ts` -- seen ring and name; items keep `data-tale-group-id` -- R4.
- [x] `libs/web-sdk/src/lib/viewer.ts` -- the viewer per Boundaries -- R4, R11.
- [x] `libs/web-sdk/src/lib/taleart-element.ts` -- open on activation, focus return, seen refresh -- R4.
- [x] `libs/web-sdk/src/lib/viewer.spec.ts`, `seen.spec.ts`, `taleart-element.spec.ts` -- a test per matrix row except scan and bundle.
- [x] `apps/sdk-sample/a11y-scan.mjs`, `project.json` -- automated WCAG 2.2 AA scan of the bar and the open viewer -- R11.

**Acceptance Criteria:**
- Given the sample page with a zone of several groups, when a visitor opens a group and steps by tap and arrow keys, pauses with Space, swipes to the next group and back and presses Escape, then each step behaves as in the matrix and focus lands on the bar item.
- Given a group was viewed, when the page reloads in the same browser, then its bar item shows the seen ring and its name says seen.
- Given the viewer is open on the sample page, when the axe WCAG 2.2 AA scan runs, then it reports no violations.
- Given the SDK build, when `web-sdk:size` runs, then the bundle is ≤ 50 KB gzipped.

## Implementation Notes

- Assumptions (not product decisions the epic settles; recorded for review): image duration 5 s; "previous" from a group's first tale goes to the previous group's last tale while a swipe goes to a group's first tale; a group counts as viewed once any of its tales shows; seen is per group in the host origin's local storage under `taleart.seen` (a group with new tales stays seen); focus returns to the item of the group shown last, not necessarily the one first activated; past the last group the viewer closes; groups with no tales are skipped.
- Swipe is a path-based gesture (WCAG 2.5.1); its single-pointer alternative is tapping through the tales, which reaches the next group. Flagged for the manual walk (story 12).
- axe-core is not in the shared node_modules and installing is not allowed here, so the scan script loads a pinned axe-core build (4.10.2) from cdnjs and checks its SHA-384 before injecting it. Moving axe-core to a devDependency is a follow-up for the main session.
- Built: `seen.ts` (`seenGroupIds`, `markGroupSeen`), `viewer.ts` (`TaleViewer`, `VIEWER_STYLES`, constants `IMAGE_DURATION_MS`, `SWIPE_MIN_PX`, `HOLD_MIN_MS`), `bar.ts` (`setItemSeen`, `renderBar(groups, seen)`), element wiring (click delegation on the bar, one viewer per render, closed on reload and disconnect).
- The progress fill keeps animating under reduced motion: it is the only motion in the viewer and it carries information (time left); tale and group changes are instant.
- jsdom has `HTMLDialogElement` without `showModal`, so the viewer falls back to the `open` attribute there (and in old browsers); jsdom tests stub `HTMLMediaElement.play/pause`.
- The scan script also drives the real page (arrows, tap zones, Space, swipe both ways, Escape focus return, seen ring after reload, no console errors), which covers the story's manual verify with a stubbed API.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract web-sdk sdk-sample` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size` -- expected: passes, prints the gzipped size.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:a11y` -- expected: 0 axe violations for the bar and the open viewer (needs network for cdnjs).

**Manual checks (if no CLI):**
- Drive the sample page with Playwright and a stubbed Delivery API: open a group, step, pause, swipe, Escape, reload, see the seen ring.

## Auto Run Result

**Summary:** Activating a bar item opens its tale group in a full-screen modal `<dialog>` viewer in the element's Shadow DOM: images show 5 s and videos play to their end (sound, else muted; failure falls back to 5 s), with progress segments. Tap zones and ArrowLeft/ArrowRight step through tales and across groups (closing after the last), a horizontal swipe moves between groups, press-and-hold or Space (or the Pause button) pauses and resumes, and Escape or Close closes and returns focus to the bar item of the group shown last. Viewed group ids are kept in the host's local storage (`taleart.seen`, capped at 500, failure-safe, never sent), and the bar shows a grey seen ring and "<name>, seen". A Playwright + axe-core scan of the sample page (stubbed API) reports no WCAG 2.2 AA violations for the bar and the open viewer. No API or contract change.

**Files changed:**
- `libs/web-sdk/src/lib/viewer.ts` (new), `seen.ts` (new), `bar.ts`, `taleart-element.ts` -- viewer, seen store, seen ring, wiring.
- `libs/web-sdk/src/lib/viewer.spec.ts` (new, 21 tests), `seen.spec.ts` (new, 6), `taleart-element.spec.ts` (19, 6 new).
- `apps/sdk-sample/a11y-scan.mjs` (new), `apps/sdk-sample/project.json` (`a11y` target).

**Verification:**
- `nx run-many -t lint test build -p api dashboard contract web-sdk sdk-sample` -- passed (web-sdk 46 tests, api 180, dashboard and contract green).
- `nx run web-sdk:size` -- passed, 5.37 KB gzipped (was 1.95 KB).
- `nx run sdk-sample:a11y` -- 0 violations in 4 scans (bar, viewer, viewer paused, bar with seen ring); keyboard, tap, swipe, focus-return and seen-ring checks passed; no console errors.

**Residual risks:**
- axe-core is fetched from cdnjs (hash-pinned) instead of being a devDependency; the `a11y` target needs network and is not part of `run-many -t lint test build`.
- Swipe's single-pointer alternative (WCAG 2.5.1) is tapping through tales; confirm in the manual walk (story 12).
- Video sound autoplay policies differ on iOS Safari; only the muted fallback is unit-tested.

