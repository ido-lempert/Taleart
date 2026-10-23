---
title: 'Keep the Web SDK within budget with the document renderer'
type: 'feature'
ticket: '14'
created: '2026-10-23'
status: 'built'
baseline_revision: '4f2bfdd'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-upload-a-project-font-and-use-it-in-a-tale-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** R15 sets the SDK's budgets with the document renderer (50 KB gzipped, p75 first content 1.5 s, p75 first tale frame 1 s for a 20-element tale with a project font, fonts after the first frame and only when needed, a viewer chunk past 40 KB). Story 7.17 already extended `sdk-sample:perf` with a 20-text tale, but the size check reports one file and knows nothing of the 40 KB split, the tale is texts only, nothing checks that the font swaps in after the frame, and the SDK as the API serves it (`/sdk/v1/taleart.js`, 8.13) is neither measured nor compressed.

**Approach:** One shared size-budget module judges every ES chunk (50 KB all, 40 KB for the page's chunk) and, while the SDK is one chunk, estimates what the AD-16 split would move from a module report the build writes. The perf target uses it, composes its tale from 20 mixed elements, asserts the font swaps in after the first frame, and also loads the zone from the API's test page. The API sends the bundle gzipped. Tuned values go to the epic notes.

## Boundaries & Constraints

**Always:** budgets stay starting values from the epic unless measurement argues otherwise; perf rows are deleted at the end; fonts load only when a tale that uses them opens; the module report is never inside the published package folder.

**Never:** split the bundle now (24.4 KB, under 40 KB); change the SDK's font loading (it already starts on open and never blocks the frame); touch dashboard code (8.18 runs in parallel).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| One chunk under 40 KB | `index.js` only | per-chunk line, total, split estimate | exit 0 |
| One chunk past 40 KB | `index.js` 40.01 KB | asks to move the viewer to a chunk loaded on first open | exit 1 |
| Split SDK | `index.js` + viewer chunk | both chunks reported | exit 1 if entry > 40 KB or all > 50 KB |
| No module report | report file missing | sizes reported, no estimate | exit 0 |
| Client accepts gzip | `Accept-Encoding: gzip` | gzipped body, `Vary`, `-gz` ETag | 304 on matching ETag |
| Client without gzip | no or `identity` | body as is | — |

</intent-contract>

## Code Map

- `libs/web-sdk/scripts/size-budget.mjs` -- new: limits, chunk reading, split estimate, judgement.
- `libs/web-sdk/scripts/check-size.mjs` -- `web-sdk:size`, now per chunk.
- `libs/web-sdk/vite.config.mts` -- plugin writing `dist/libs/web-sdk-modules.json` (ES modules with rendered code).
- `libs/web-sdk/project.json` -- build outputs include the module report; size reads the folder.
- `apps/sdk-sample/perf.mjs` -- composed tale, font-after-frame check, API-served measurement, shared size judgement.
- `apps/api/src/http/sdk.router.ts` -- gzip for the bundle routes.

## Tasks & Acceptance

**Execution:**
- [x] `libs/web-sdk/scripts/size-budget.mjs`, `check-size.mjs` -- per-chunk budget and split estimate.
- [x] `libs/web-sdk/tests/size-budget.spec.mjs` -- unit tests for the matrix's size rows.
- [x] `libs/web-sdk/vite.config.mts`, `project.json` -- module report as a build output.
- [x] `apps/sdk-sample/perf.mjs` -- 20 mixed elements; font after frame; `/sdk/v1` test page with gzip asserted.
- [x] `apps/api/src/http/sdk.router.ts` + spec -- gzip and per-encoding ETag.
- [x] `libs/web-sdk/README.md` -- Budgets table and Measuring; epic notes with tuned values.

**Acceptance Criteria:**
- Given the built SDK, when `web-sdk:size` runs, then it reports each chunk, the total, and the would-be split, and passes at 24.4 KB.
- Given the seeded zones, when `sdk-sample:perf` runs, then it passes with p75 first content ≤ 1.5 s (sample page and API test page), p75 first tale frame ≤ 1 s for the 20-element tale with a project font, the font in use after the first frame in every run, and no font request on the page without project fonts.

## Implementation Notes

- Rolldown's `//#region` comments misattribute modules (the renderer lands inside `text.ts`, the banner inside `viewer.ts`), so the estimate uses the build's own module list instead.
- The API sent the SDK uncompressed: 80.8 KB, cold p75 about 1.37 s from its test page; gzipped 24.4 KB, about 1.31 s.
- Measured (5 to 10 runs): first content p75 ~1.27 s; first tale frame p75 ~70 ms (73 ms with 60 elements, a throwaway run); font in use ~240 ms after the tap.

## Verification

**Commands:**
- `node_modules/.bin/nx run web-sdk:size` -- per-chunk report, exit 0
- `TEST_DATABASE_URL=… node_modules/.bin/nx run sdk-sample:perf` -- PASS line
- `node_modules/.bin/nx run-many -t lint test build -p … --parallel=2` -- green except the known auth clock test

## Review Triage Log

- Pass 1 (coordinator): no must-fix; the API gzip change is accepted in this story. Patched: font-after-frame proved by holding the font response 1.5 s (`page.route`) and checking no font face is loaded at the frame; frame counted on the open card only (`.frame > .ta-area > .ta-canvas > .ta-el`, after 8.18); gate margins printed; router uses `res.vary`, gzips only the bundle, lazily, one in-flight compression per file (`gzipCache`), 304 without Content-Encoding; router tests for `gzip;q=0`, `*`, HEAD length, pinned, cross-encoding validators, test page untouched, regzip after rebuild; sizes at gzip levels 9 and 6 (judged on the larger); split estimate stated as a lower bound; the module report is deleted once per build (`configResolved`; `buildStart` runs per output format and deleted the ES report).
