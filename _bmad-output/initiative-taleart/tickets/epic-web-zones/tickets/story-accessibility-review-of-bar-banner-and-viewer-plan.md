---
title: 'Accessibility review of bar, banner and viewer'
type: 'chore'
ticket: '12'
created: '2026-10-21'
status: done
baseline_revision: '27f71e9'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/epic-web-zones.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/a11y-review-3-12.md'
warnings: []
deferred:
  - summary: 'Dashboard screens of this epic not scanned for WCAG 2.2 AA (ticket scope); the review brief covered the SDK only.'
    evidence: 'a11y-review-3-12.md, Open items 1'
    severity: 'medium'
  - summary: 'No caption track or language field on tales: 1.2.2, 1.2.3, 1.2.5 and 3.1.2 cannot be met by the SDK for video tales with speech or text in another language.'
    evidence: 'a11y-review-3-12.md, Open items 2'
    severity: 'medium'
---

<intent-contract>

## Intent

**Problem:** R11 (NFR-007) needs the bar, banner and viewer at WCAG 2.2 AA, verified by an automated scan and a person's keyboard and screen-reader walk. The existing scan covered axe and a few keyboard paths only.

**Approach:** User decision (2026-10-22): an automated and scripted review replaces the person's walk, and the user signs off its report. A new `sdk-sample:a11y-review` target drives the built SDK on the sample page (stubbed API) through axe in every state, a keyboard-only walk, accessibility-tree checks, zoom, text spacing, orientation, target size, pointer cancellation, contrast, motion, forced colours, a dark host, themes and RTL; every failure is fixed in the SDK with tests, and real screen-reader speech is left as a manual checklist.

## Boundaries & Constraints

**Always:** WCAG 2.2 AA criterion-by-criterion results in `a11y-review-3-12.md` with screenshots under `a11y-review-3-12/`; each fix with a unit test and a browser check; bundle within 50 KB gzipped and the 1.5 s first-content budget; untrusted content still reaches the DOM only as text and attributes; no new console output.

**Never:** Dashboard changes (another agent works there); contract or API changes (captions and language are recorded as open items); claiming a screen reader's speech was checked.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Space on Close | focus on Close, Space | viewer closes, focus back on the opener | — |
| Space elsewhere | focus on dialog or a tap zone | pauses or resumes | — |
| Animated cover | no reduced motion | moves, then still on its first frame after 5 s | reduced motion off again: 5 s more |
| Dark host page | host text light on dark | current dot in the host text colour | — |
| Forced colours | `forced-colors: active` | dots, rings, progress, viewer button edges in system colours | — |
| Text spacing | 1.4.12 values | a title that fits on one line still shows in full (two lines max) | — |
| RTL page | `dir="rtl"` | banner moves right; prev on the right; next tale/slide to the left (taps, ArrowLeft, swipe right) | — |
| Mixed text | Hebrew-first line on an LTR page | the line's own direction (`dir="auto"`) | — |

</intent-contract>

## Code Map

- `apps/sdk-sample/a11y-review.mjs` (new) -- the review; `--shots`, `--json`.
- `apps/sdk-sample/a11y-shared.mjs` (new) -- port, sample server, pinned axe, one axe run; used by both scripts.
- `apps/sdk-sample/a11y-scan.mjs` -- uses the shared helpers.
- `apps/sdk-sample/project.json` -- `a11y-review` target.
- `libs/web-sdk/src/lib/viewer.ts` -- Space on Close, RTL mirroring, forced colours, `dir="auto"` name, `isRtl`.
- `libs/web-sdk/src/lib/banner.ts` -- RTL track, sides and swipes; current dot colour; forced colours.
- `libs/web-sdk/src/lib/bar.ts` -- two-line titles, `dir="auto"`, forced-colour rings, `COVER_MOTION_MS`.
- `libs/web-sdk/src/lib/taleart-element.ts` -- stills animated covers after 5 s.
- `libs/web-sdk/src/lib/document/text.ts` -- `dir="auto"` on text elements.

## Tasks & Acceptance

**Execution:**
- [x] `apps/sdk-sample/a11y-review.mjs`, `a11y-shared.mjs`, `project.json` -- the review and its target.
- [x] `libs/web-sdk/src/lib/*` + specs -- the fixes for findings 1 to 9 of the report, each with tests.
- [x] `a11y-review-3-12.md` + screenshots -- the report and the manual checklist.

**Acceptance Criteria:**
- Given the built SDK, when `sdk-sample:a11y-review` runs, then every check passes with 0 axe violations in all states.
- Given the report, when the user has done the manual checklist, then they sign it off (story stays `in-review` until then).

## Implementation Notes

- Findings and fixes: see the report's table. Space on the tap zones stays the pause shortcut (a mouse click leaves focus there); Enter steps. Animated covers reuse the reduced-motion still after 5 s, which is a product change to R12 for WCAG 2.2.2, for sign-off.
- Bar titles now wrap to two lines instead of one truncated line; a name that fits on one line looks as before, so the sample page's reserved bar height and the perf budget hold.
- RTL: tap zones and banner buttons use logical sides; the banner track and swipes read the computed direction at use; the viewer reads it on open (`data-rtl`).
- Chromium's CDP tree omits `aria-current`, so it is read from the DOM; Playwright 1.64 has no `accessibility.snapshot()`, so `ariaSnapshot()` and CDP are used.
- Merged `autopilot/foundation` (fe8c9b6, fast-forward) before verification.

## Verification

**Commands:**
- `NX_DAEMON=false npx nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting web-sdk sdk-sample --skip-nx-cache` -- passed (web-sdk 276 tests).
- `NX_DAEMON=false npx nx run web-sdk:size` -- 14.54 KB gzipped.
- `NX_DAEMON=false npx nx run sdk-sample:a11y` -- no violations, all checks ok.
- `NX_DAEMON=false npx nx run sdk-sample:a11y-review` -- all 123 checks passed, 0 axe violations in 19 states.
- `NX_DAEMON=false npx nx run sdk-sample:perf` -- cold p75 first content 1266 ms (budget 1500).

**Manual checks:**
- The report's manual checklist: real screen readers, Windows High Contrast, real browser zoom, phones.
