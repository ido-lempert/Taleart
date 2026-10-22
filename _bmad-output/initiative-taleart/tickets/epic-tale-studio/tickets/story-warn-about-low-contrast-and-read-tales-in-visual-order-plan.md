---
title: 'Warn about low contrast and read tales in visual order'
type: 'feature'
ticket: '10'
created: '2026-10-23'
status: 'built'
baseline_revision: '4d80e8d'
route: 'full'
route_source: 'pinned'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Tale Studio already checks a text's or link label's contrast against the canvas colour and an opaque rectangle below it (stories 7.4, 7.6, 7.7), but any media below the label makes the check give up, the warning shows only in the inspector and the layer row (not on the element on the canvas), the SDK's reading order compares raw box corners (a few pixels' difference splits a visual row, a rotated box or the pinned swipe-up link is placed by a box it does not show), not every rendered node is named or hidden, and no automated scan covers a composed tale or the studio.

**Approach:** Sample what lies behind a label over media in the studio: paint the layers below it (canvas colour, background media, media, shapes, buttons, emoji) on an offscreen canvas and read its pixels, then judge the label against those samples in the contract's `textContrast`. Mark low contrast on the canvas element too. Make the contract's `readingOrder` the one visual-order rule (visual bounds, rows with a tolerance, left to right or right to left by the host's direction) and have the SDK use it. Name or hide every node, keep the document still under reduced motion, and add a composed-tale scan to `sdk-sample:a11y` and a new `sdk-sample:a11y-studio` scan of Tale Studio.

## Boundaries & Constraints

**Always:** contrast is a warning only, never a block (user decision 2026-10-21); 4.5:1, or 3:1 for large text (existing `isLargeText`); one contrast routine in `libs/contract` shared by inspector, layer row and canvas; a pixel read that fails (tainted canvas, load error) degrades to "can't be checked" and never throws; visual order lives only in the contract's `readingOrder`; SDK stays ≤ 50 KB gz, sets text as text nodes and styles via CSSOM (AD-16).

**Never:** sampling from the preview's DOM; blocking publish on contrast; changing z-order or the document schema; new runtime dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Light grey on white | text `#cccccc` on canvas `#ffffff` | warning on inspector, layer row and canvas element | none |
| Darken | colour → `#333333` | all three warnings clear | none |
| Large text | ratio 3.2, size ≥ 24 px at 540 px canvas | ok (3:1) | none |
| Translucent text/box | `#RRGGBBAA` colour or box | composited over what lies behind | none |
| Over media | text over a photo, no opaque box | ratio from sampled pixels (10th percentile), against "the media behind it" | unreadable or not loaded → "can't be checked" |
| Opaque rectangle over media | rectangle covers text | rectangle's colour, no sampling | none |
| Same visual row | tops differ by < 2 % of canvas height | left to right (right to left on an RTL host) | none |
| Exactly the same place | equal bounds | z-order, bottom first | none |
| Swipe-up link | any stored box | read where it is drawn (bottom safe area) | none |
| Reduced motion | GIF / WebP / PNG, video, any CSS animation in the canvas | still first frame; no animation | none |

</intent-contract>

## Code Map

- `libs/contract/src/lib/text-style.ts` -- `TextBackdrop`, `textContrast`, `textBackdropAt`: add sampled colours and the media percentile.
- `libs/contract/src/lib/tale-document.ts` -- `readingOrder`: visual rule.
- `libs/web-sdk/src/lib/document/{renderer,media}.ts` -- order, names, reduced motion.
- `libs/web-sdk/src/lib/viewer.ts`, `preview.ts` -- pass the host direction.
- `apps/dashboard/src/app/pages/tale-backdrop.ts` (new) -- offscreen painter and pixel sampler.
- `apps/dashboard/src/app/pages/tale-studio.ts` -- samples signal, canvas warning badge.
- `apps/dashboard/src/app/pages/tale-text-style.ts` -- "against the media" wording.
- `apps/sdk-sample/a11y-scan.mjs` -- composed-tale scan; `apps/dashboard-e2e/src/studio-a11y.spec.ts` (new) -- studio scan.

## Tasks & Acceptance

**Execution:**
- [x] contract -- samples in `textContrast`, `readingOrder` rule, specs (math, alpha, large text, samples, rows, ties, RTL, swipe-up, rotation)
- [x] web-sdk -- direction option, names-or-hidden, reduced-motion CSS guard, specs
- [x] dashboard -- painter + sampler, studio wiring, canvas badge, specs (backdrop resolution incl. overlapping layers, warning on element and row, clears on fix)
- [x] sdk-sample -- composed tale in `a11y` (axe, reading order, Tab order); `a11y-studio` target
- [x] Playwright verify with screenshots

**Acceptance Criteria:**
- Given light grey text on white, when the studio shows it, then the canvas element and its layer row show "Low contrast", and both clear when the colour darkens.
- Given a composed tale on the sample page, when a screen reader walks it, then text, alt text and button come in visual order.
- Given the sample page and the studio, when scanned with axe (WCAG 2.2 AA tags), then no violations.

## Implementation Notes

- Base 4d80e8d, fast-forwarded to `autopilot/foundation` 83cdc08 (8.13) before verification. 8.13 brought `apps/dashboard-e2e` with axe and its own API and dashboard servers, so the studio scan lives there (`studio-a11y.spec.ts`) instead of the new sdk-sample target the plan named. It signs in with a session written to the database, so it does not depend on the first-run test's passkey setup.
- Contract: `TextBackdrop.samples` (left out = not read yet, null = cannot be read); `textContrast` takes the 10th-percentile ratio over the samples (`MEDIA_CONTRAST_PERCENTILE`), with a translucent box or highlight drawn over each sample, `against: 'media'`. `readingOrder(elements, direction)`: elements are placed by their shown bounds (a rotated box by its upright bounds, the swipe-up link at `SWIPE_UP_BOX`). Rows are anchored on their highest element and take elements within `READING_ROW_TOLERANCE` 0.02 of it. Within a row, left edges ascend (`ltr`) or right edges descend (`rtl`). Ties keep z-order, lowest first.
- Dashboard: `tale-backdrop.ts` (`TaleBackdropSampler`) paints the stage black, then the canvas colour, the background image and the layers below the label on a 180 × 320 `OffscreenCanvas`. Layers are media (with fit, radius, opacity and rotation), shapes, buttons and emoji; texts are skipped, as in `textBackdropAt`. It reads at most 4,096 pixels behind the label. Media of another origin is requested with CORS. A load failure, an 8 s timeout or a tainted canvas gives null, shown as "can't be checked", and the sampler never throws. The studio keys samples by `backdropKey` (the canvas background, the label's bounds and the layers below), so restyling a label does not read them again. The inspector says "Checking…" while samples load. A badge on the canvas element now marks low contrast too. It is aria-hidden, because the element is already described by its layer state.
- SDK: the viewer passes its RTL state (the one that mirrors taps) as `direction`. A picture or video with no name is hidden from assistive technology. A reduced-motion CSS guard stops any animation or transition in the canvas; GIF, WebP and APNG were already drawn still, and videos already stayed on their first frame.
- Known limits: emoji below a label are painted with the browser's emoji font, which may not match the SDK's rendering exactly. A label whose verdict changes only when its samples arrive (a move over media) is not announced in the live region; the badge and the layer row show it.
- Verification (2026-10-23):
  - run-many lint/test/build on the 12 projects passes, except the known api clock-skew test ("creates the admin, signs them in and stores only the token hash").
  - Tests: contract 377, web-sdk 419, dashboard 609, api 590 of 591.
  - `web-sdk:size`: 24.04 KB gzipped. `types-check` passes.
  - `sdk-sample:a11y`: no violations, including the composed tale in LTR, in RTL and under reduced motion.
  - `a11y-review`: 215 of 217 checks pass; the 2 failures are the known landscape ones.
  - `perf`: cold p75 1,273 ms.
  - `preview-parity`: 8 of 8.
  - `dashboard-e2e:e2e`: 7 passed, 3 of them new.
  - Dashboard initial bundle: 393.22 KB.

## Plan Change Log

## Review Triage Log

## Design Notes

Media percentile: the ratio reported over media is the one that 90 % of the sampled pixels behind the label meet (`MEDIA_CONTRAST_PERCENTILE = 0.1`, a starting value): the worst single pixel would flag nearly every photo; the average would hide a bright band right behind the words.

Row tolerance: `READING_ROW_TOLERANCE = 0.02` of the canvas height (about 11 px on the 540 px reference canvas). A row is anchored on its first (highest) element, so the grouping does not chain down the canvas.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --parallel=2` -- all pass (one known clock-skew auth test)
- `web-sdk:size`, `web-sdk:types-check`, `sdk-sample:a11y`, `sdk-sample:a11y-review`, `sdk-sample:perf`, `sdk-sample:preview-parity`, `dashboard-e2e:e2e` -- pass
