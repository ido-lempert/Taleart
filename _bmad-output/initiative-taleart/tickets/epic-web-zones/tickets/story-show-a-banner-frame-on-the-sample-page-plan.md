---
title: 'Show a banner frame on the sample page'
type: 'feature'
ticket: '6'
created: '2026-10-21'
status: 'built'
baseline_revision: '69a48ecb7cd61f0426acdeb459a9e349b748413d'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/tickets/story-edit-bar-settings-in-the-dashboard-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A zone can hold a banner frame, but `banner.schema.json` has no fields, the dashboard offers no settings for it, and the SDK renders only the zone's first bar, so a banner never shows.

**Approach:** Data first: add the R3 fields with defaults to `libs/contract/frame-types/banner.schema.json`; the registry, PATCH validation, the Delivery API's field-by-field cleaning and the dashboard's schema-built Settings drawer from story 5 then work with no new API or form code (the OpenAPI document does not change: `settings` is typed by the frame schema). The SDK renders every frame type it knows in the zone's frame order and gains a banner renderer: an accessible carousel (WAI-ARIA APG pattern) with one slide per delivered tale group, previous/next buttons, swipe, dots and autoplay, whose slides open the shared viewer.

## Boundaries & Constraints

**Always:**
- Banner fields exactly per R3: `aspectRatio` (`16:9` | `3:1` | `1:1`, default `16:9`), `autoplay` (boolean, default true), `intervalSeconds` (integer 3–15, default 5), `showDots` (boolean, default true), `loop` (boolean, default true); `additionalProperties: false`; each with `title` and `description`.
- SDK treats settings and content as untrusted: every setting is whitelisted (enum map to a fixed CSS value, integer range, boolean type) and falls back to its default silently; text goes in via `textContent`/attributes only, never HTML; media URLs only as `src`.
- Only what the Delivery API returns is shown (it already filters status and schedules); a group with no tales has no slide.
- Carousel: region `aria-roledescription="carousel"` named "Banner"; each slide a group `aria-roledescription="slide"` named "N of M", holding one button named by the group that opens the viewer at that group; hidden slides are `inert` and `aria-hidden`; previous/next and a rotation (Pause/Play) button are named, ≥ 44 px; dots are buttons ≥ 24 px named "Show <group>" with `aria-current` on the shown one; visible focus on every control; the slide list is `aria-live="off"` while rotating, `polite` otherwise.
- Autoplay runs only when the setting is on, there are 2+ slides, and the visitor does not prefer reduced motion (checked at render and on change). It stops for good on any interaction (pointer down, focus entering the banner, previous/next, dot, swipe, slide activation) and pauses while the mouse hovers; the rotation button stops or restarts it. Without `loop`, previous/next are `aria-disabled` at the ends, autoplay stops at the last slide and swipes past the ends do nothing.
- Slide transitions are instant under reduced motion. Timers stop when the element re-renders or is removed.
- When the viewer opened from a banner slide closes, the banner shows the slide of the group shown last and focus returns to that slide's button (bar behaviour unchanged).
- No runtime dependency; bundle ≤ 50 KB gzipped; no new console output.

**Never:** Theme fields or colours (story 8), stages (story 7), new dashboard form code, an OpenAPI or DB change, events (epic-analytics), autoplaying video in a slide, subset of groups per frame, changes to zone keys, Delivery CORS or key handling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Schema | `GET /frame-types` | banner with the 5 fields, defaults, `additionalProperties: false` | — |
| Save valid | PATCH banner `{aspectRatio:'3:1', autoplay:true, intervalSeconds:3, showDots:false, loop:false}` | 200; delivered as saved | — |
| Out of range / bad enum / unknown | `intervalSeconds: 2` / `16`, `aspectRatio:'4:3'`, `speed:1` | 400 `invalid_frame_settings` naming the field; nothing stored | — |
| Delivery defaults | banner stored `{}` or junk (`{intervalSeconds:40, stray:1}`) | settings with every default, invalid values replaced | — |
| Dashboard form | open Settings of a banner | select (16:9, 3:1, 1:1), toggles, number 3–15, defaults shown | API error marks field |
| Both frames | zone frames `[bar, banner]` | bar then banner rendered, in frame order; unknown types skipped | — |
| Slides | 3 groups, one with no tales | 2 slides, each the group's first tale media (video: first frame, no autoplay; none: placeholder) | — |
| Settings applied | `3:1`, no dots | 3:1 box, no dots | junk settings → defaults, no log |
| Prev/next/dots | click Next / Previous / dot 2 | shows next / previous / slide 2; loop wraps | no loop: ends `aria-disabled`, no move |
| Swipe | drag ≥ 50 px left / right | next / previous slide; no slide activation | short drag = tap |
| Autoplay | autoplay on, interval 3 | advances every 3 s; wraps with loop; stops at last without loop | — |
| Reduced motion | `prefers-reduced-motion: reduce` | no autoplay, no rotation button, no transition | — |
| Interaction stops | pointer down / focus in / Next | autoplay stops and does not resume (rotation button can restart) | — |
| Hover | mouse over then out | paused while over, resumes after | — |
| Open viewer | activate slide of group B | viewer opens at B; on close focus on B's slide button (or the slide of the group shown last) | — |
| One slide / none | 1 group / 0 groups | no nav, dots or autoplay / banner not rendered | — |
| A11y scan | sample page with bar + banner, stubbed API | axe WCAG 2.2 AA: 0 violations | — |
| Bundle | build | ≤ 50 KB gzipped | target fails above |

</intent-contract>

## Code Map

- `libs/contract/frame-types/banner.schema.json` -- the R3 fields.
- `libs/contract/src/index.ts`, `src/lib/contract.spec.ts` -- `BannerSettings` type and schema test.
- `libs/server/zones/src/lib/frames.spec.ts` -- registry validation and `withDefaults` for banner (code is schema-driven, unchanged).
- `apps/api/src/app.spec.ts` -- PATCH and Delivery rows for banner.
- `apps/dashboard/src/app/settings-form.spec.ts` -- the real banner schema builds the form (no form code change).
- `libs/web-sdk/src/lib/banner.ts` (new) -- `readBannerSettings`, `renderBanner`, `BANNER_STYLES`.
- `libs/web-sdk/src/lib/bar.ts` -- share the cover media helper with the banner.
- `libs/web-sdk/src/lib/viewer.ts` -- export the icon helper for the rotation button.
- `libs/web-sdk/src/lib/taleart-element.ts` -- render known frames in order, one shared viewer, focus return per frame.
- `apps/sdk-sample/a11y-scan.mjs` -- banner in the stubbed zone; scan and drive the banner, reduced-motion context.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- banner schema fields, `BannerSettings`, schema test -- AD-3, AD-5.
- [x] `libs/server/zones/`, `apps/api/` -- tests for validation and Delivery cleaning of banner settings.
- [x] `apps/dashboard/` -- form test from the real banner schema.
- [x] `libs/web-sdk/src/lib/banner.ts` + spec -- carousel per Boundaries; a test per SDK matrix row and a drift test against `banner.schema.json`.
- [x] `libs/web-sdk/src/lib/taleart-element.ts` + spec -- frames in order, banner opens viewer, focus return, cleanup.
- [x] `apps/sdk-sample/a11y-scan.mjs` -- banner scan and behaviour checks incl. reduced motion -- R11.

**Acceptance Criteria:**
- Given a zone with a bar and a banner frame, when the sample page loads, then both render in frame order.
- Given the banner set to 3:1, interval 3 s, no dots in the dashboard, when the sample page reloads, then the banner is 3:1, advances every 3 s and has no dots.
- Given the OS prefers reduced motion, when the sample page loads, then the banner does not autoplay.
- Given the banner, when a slide is clicked, then the viewer opens at that group, and closing returns focus to the banner.
- Given the SDK build, when `web-sdk:size` runs, then it passes.

## Implementation Notes

- Assumptions (not settled by the epic, recorded for review): a slide shows the group's first tale that has media (the same rule as the bar cover; a video shows its first frame and never autoplays; no media shows a neutral placeholder); slides carry no visible caption, the slide button is named by the group; a group with no delivered tale has no slide, and a banner with no slides renders nothing; the carousel is named "Banner"; dots are named "Show <group>"; a hovering mouse pauses autoplay and leaving resumes it (WAI-ARIA carousel pattern), while any other interaction stops it for good until the rotation button restarts it; the rotation button shows only when autoplay can run (setting on, 2+ slides, no reduced motion), sits with the dots in a row below the slides (after them in the tab order, so a keyboard visitor reaches Previous first, which stops autoplay), and focusing it alone does not stop autoplay; the slide transition is 0.35 s and instant under reduced motion; colours are TaleArt defaults until story 8 (dots and controls assume a light host background).
- The SDK now renders every frame type it knows, in the zone's frame order (R1); before, only the first bar rendered. Story 7 (stages, built in parallel) touches the same render loop: with no stage named it renders the frames in order, which this matches; expect a merge in `taleart-element.ts`.
- Built: `banner.ts` (`readBannerSettings`, `renderBanner` returning a `BannerView` with `focus`/`destroy`, `BANNER_STYLES`); `bar.ts` exports `coverMedia` (was private `cover`); `viewer.ts` exports `setIcon`. The element keeps one viewer for all frames and remembers which frame opened it, so focus returns to that frame's item or slide of the group shown last; frame timers stop on reload and removal.
- Untrusted settings: the aspect ratio reaches the DOM only as a `data-ratio` attribute from the three listed values, styled by fixed CSS rules; the interval is a checked integer used only as a timer; names are text/attributes, never HTML.
- No OpenAPI change: frame `settings` is a JSON object typed by the frame schema, so `contract:generate` was not needed. Server code is unchanged (schema-driven validation and Delivery cleaning from story 5); new tests cover the banner fields.
- Dashboard: no form code; a test builds the form from the shipped `banner.schema.json` (JSON import, with a lint exemption for the cross-project relative path in that spec only).
- The a11y scan found a real bug during the build: the transformed slide track painted over the previous/next buttons; fixed with `z-index` on the controls.

## Plan Change Log

## Review Triage Log

### 2026-10-21 — Coordinator review
- verdicts: 7 findings, all patched.
- findings:
  - `[patch]` The swipe flag stayed set when no click followed (touch pan, drag ending elsewhere), swallowing the next keyboard or assistive-technology activation — suppression is now a 300 ms window after the swiping pointerup (`SWIPE_CLICK_WINDOW_MS`) and never applies to clicks with `detail === 0`; tests for Enter/Space after a swipe, a later tap, and the suppressed click.
  - `[patch]` Reduced motion was handled only when it turned on — rotation state is now derived (`sync`) from the setting, a visitor-stop flag, the preference and the last-slide rule, so turning reduced motion off shows the rotation button and resumes autoplay unless the visitor already stopped it; tests both ways.
  - `[patch]` Without loop the rotation button could restart on the last slide and claim to rotate — Start is `aria-disabled` and does nothing there; reaching the last slide updates the button and `aria-live` at once; restart works again after moving back; tests.
  - `[patch]` The rotation button overlapped Next on narrow 3:1 banners — it now sits in a row with the dots below the slide area (static, 44 px); the a11y scan checks a 3:1 banner at 390 px for overlapping controls and 44 px targets, and a unit test checks the structure.
  - `[patch]` Reload restored focus to the first frame with the group — the element remembers the opener's frame id across reloads and restores focus there first, then any frame with the group, then the opener's (or first) frame; test with `[banner, bar]` opened from the bar.
  - `[patch]` SDK-driven focus stopped autoplay and the `focus(null)` fallback jumped to slide 0 — programmatic focus is flagged and ignored by the focusin handler; `focus(null)` focuses the slide shown; tests (unit and element reload).
  - `[patch]` Missing regression test for several bars — a zone with two bar frames renders both, each opens the viewer and takes focus back, and both show the seen ring.

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size` -- expected: passes.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:a11y` -- expected: 0 violations, all checks ok.

## Auto Run Result

**Summary:** `banner.schema.json` now defines the R3 fields (`aspectRatio` 16:9/3:1/1:1, `autoplay`, `intervalSeconds` 3–15, `showDots`, `loop`) with titles and defaults, so the registry, PATCH validation, the Delivery API's per-field cleaning and the dashboard's schema-built Settings drawer from story 5 handle the banner with no new API or form code. The Web SDK renders every known frame in the zone's order and has a banner renderer: an APG-style carousel with one slide per delivered tale group (its first tale's media), previous/next buttons, swipe, dots and autoplay that stops on any interaction or under reduced motion, pauses on hover, and has a rotation button. Activating a slide opens the shared viewer at that group; closing returns focus to the slide of the group shown last. The sample page's automated WCAG 2.2 AA scan now covers the banner.

**Files changed:**
- `libs/contract/` -- `banner.schema.json`, `BannerSettings`, schema test.
- `libs/server/zones/src/lib/frames.spec.ts`, `apps/api/src/app.spec.ts` -- banner validation, PATCH and Delivery tests.
- `apps/dashboard/src/app/settings-form.spec.ts` -- form from the shipped banner schema.
- `libs/web-sdk/src/lib/` -- `banner.ts` and `banner.spec.ts` (new), `taleart-element.ts` (frames in order, shared viewer, focus return, cleanup) and spec, `bar.ts` (`coverMedia` export), `viewer.ts` (`setIcon` export).
- `apps/sdk-sample/a11y-scan.mjs` -- banner scan and behaviour checks, reduced-motion context.

**Verification:**
- `nx run-many -t lint test build` for the 12 projects -- passed (api 239 tests, dashboard 131, web-sdk 127, server-zones 42, contract 21).
- `nx run web-sdk:size` -- passed, 8.70 KB gzipped after review fixes.
- `nx run sdk-sample:a11y` -- 0 violations on bar, viewer, bar with rotating banner, stopped banner, reduced-motion banner and a 3:1 banner at 390 px (no overlapping controls, 44 px targets); checks for autoplay at 3 s, dot, next, stop on interaction, swipe without opening, slide opens the viewer at its group, focus return, 3:1 ratio, no dots, no autoplay under reduced motion.
- Screenshot of the sample page (stubbed API) inspected: bar above a 16:9 banner, controls and dots visible, focus ring visible.

**Residual risks:**
- Not reviewed yet; the dashboard drawer for the banner is covered by unit tests only, not a signed-in browser, and the live API was not run end to end.
- Story 7 (stages) changes the same render loop in `taleart-element.ts`; merge with care.
- Visual choices (no caption, control styling, light-background colours) are assumptions until the theme story and the manual walk (story 12).
