---
title: 'Show first zone content within 1.5 s on Fast 4G'
type: 'feature'
ticket: '11'
created: '2026-10-21'
status: 'built'
baseline_revision: '596ffbcfb580cabd5169840e1e8300b74099665d'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/epic-web-zones.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Nothing measures NFR-006's first-content target (≤ 1.5 s at p75, mid-tier mobile, Fast 4G, animated covers included, R10), and nothing keeps it: every cover and every banner slide loads at once, so on Fast 4G the bar's covers share the network with full-size slide pictures.

**Approach:** A repeatable Nx target, `sdk-sample:perf`, starts the built API on the test database, seeds a realistic zone through the Management API, and loads the sample page in throttled headless Chromium many times, reading a `taleart:first-content` performance mark the SDK sets. Then change only what it shows: load the first frame's covers in view first, hold or lazy-load the rest, and let the Delivery zone revalidate cheaply.

## Boundaries & Constraints

**Always:**
- Profile: Chrome DevTools' Fast 4G (latency 60 × 2.75 = 165 ms, 9 Mbps × 0.9 down, 1.5 Mbps × 0.9 up) through CDP `Network.emulateNetworkConditions`, CPU 4× slower (`Emulation.setCPUThrottlingRate`, DevTools' mid-tier mobile), a 412 × 823 phone screen at DPR 1.75, mobile and touch. Every run a fresh context (cold), then a reload (warm).
- First content = the element's first rendered frame is on the page and the covers of its items in view have loaded (image decoded, video first frame, canvas drawn; a failure counts as settled), at the next animation frame. Marked once per element with User Timing; `taleart:zone` marks the zone's arrival.
- Pass/fail: cold p75 ≤ 1500 ms (`PERF_BUDGET_MS`), SDK ≤ 50 KB gzipped; prints every run, p50/p75/max, warm numbers, layout shift and seeded media sizes.
- Seed: a bar and a banner frame; eight live groups of three live 1080 × 1920 JPEG tales (~320 KB); group 1 an animated WebM cover recorded as the dashboard records it (160 px, 15 fps, 400 kbit/s, 3 s), group 3 no cover, the rest 320 px JPEG still covers. Media made in the browser (no server transcoding, AD-11).
- Only the test database (`database`, as pg parses it, ends `_test`); seeded rows, temp media dir and child processes removed at the end, also on SIGINT/SIGTERM.
- Delivery `GET /zone`: `Cache-Control: private, no-cache`, `Vary: Authorization`, Express's ETag, 304 on a match. Key check runs first, so a refused key never gets a 304.
- SDK stays dependency-free and ≤ 50 KB gzipped; no new console output.

**Never:** Changes to zone keys, the Delivery API's key handling or CORS (no `Access-Control-Max-Age`), public media rules or their `public, no-cache` revalidation, server transcoding or renditions, a zone-key cache or CDN (architecture defers caching until measured; the measurement shows server time is not the bottleneck), lazy-loading the viewer (the bundle is 12 KB gzipped), product decisions on covers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mark | zone renders | `taleart:zone` then `taleart:first-content`, once per element; not again on a reload | User Timing missing or throwing: nothing marked, no error |
| Refused key | 401 | no marks | — |
| Covers in view | first frame laid out | covers inside frame box and window, with a size | frame below the window: none, mark at once |
| First covers | in view | `src` set, `fetchpriority="high"`, eager | — |
| Rest held | other frames, covers out of view | no URL until first covers settle, then released | first cover never settles: released after 3 s, no mark |
| Settling | image / video / canvas / placeholder | decode or load; `loadeddata`; `data-ready` + `load`; at once | error settles |
| Lazy covers | bar `<img>` covers | `loading="lazy"` set before `src`, `decoding="async"` | — |
| Banner slides | 5 slides | shown slide eager; neighbours (with loop) eager once it has its picture; rest lazy; moving warms the new neighbours | — |
| Delivery revalidation | same key, `If-None-Match` | 304 empty, CORS `*`; after a change 200 | revoked key + ETag → 401 |
| Perf target | `nx run sdk-sample:perf` | cold p75 ≤ 1500 ms and bundle ≤ 50 KB → exit 0 | over → exit 1 with the reason |

</intent-contract>

## Code Map

- `libs/web-sdk/src/lib/first-content.ts` (new) -- marks, covers in view, settling, hold/release, prioritising.
- `libs/web-sdk/src/lib/taleart-element.ts` -- builds frames under the hold, prioritises and releases after render, marks.
- `libs/web-sdk/src/lib/bar.ts` -- covers lazy, URL through `setSource`, canvas ready signal.
- `libs/web-sdk/src/lib/banner.ts` -- slide warming.
- `apps/api/src/http/delivery.router.ts` -- cache headers; `apps/api/src/app.spec.ts`.
- `libs/contract/openapi/openapi.yaml` -- 304 and caching documented; regenerated.
- `apps/sdk-sample/perf.mjs` (new), `project.json` (`perf`), `serve.mjs` (gzip), `index.html` (hints, reserved height).
- `libs/web-sdk/README.md` -- "Fast first content" for hosts, and the measurement.

## Tasks & Acceptance

**Execution:**
- [x] `apps/sdk-sample/perf.mjs`, `project.json` -- measurement and Nx target -- R10.
- [x] `libs/web-sdk/src/lib/first-content.ts` + spec -- marks, hold, priority -- R10.
- [x] `libs/web-sdk/src/lib/taleart-element.ts`, `bar.ts`, `banner.ts` + specs -- first content first -- R10, R12.
- [x] `apps/api/src/http/delivery.router.ts` + spec; contract -- revalidation -- R10, AD-3.
- [x] `apps/sdk-sample/serve.mjs`, `index.html`, `libs/web-sdk/README.md` -- host hints, docs.

**Acceptance Criteria:**
- Given the built API and SDK and a `_test` database, when `nx run sdk-sample:perf` runs, then it reports cold p75 first content ≤ 1.5 s, the bundle ≤ 50 KB gzipped, and exits 0.
- Given the sample page, when `nx run sdk-sample:a11y` runs, then it reports no WCAG 2.2 AA violations and every behaviour check passes.

## Implementation Notes

- Assumptions (not product decisions): "mid-tier mobile" = DevTools' 4× CPU slowdown and Lighthouse's 412 × 823 phone; "first content" = the first frame with its covers in view loaded (stricter than "first item painted", so the animated cover in group 1 counts, as the ticket note asks); p75 is over cold loads (warm reported, not gated); the seed's sizes are typical, not worst case; nearest-rank percentile; 10 runs by default.
- Baseline (before any change, 6 runs): cold p75 3412 ms, warm 1119 ms. Every banner slide (8 × ~320 KB) and every bar cover loaded at once. After lazy covers, high-priority first covers and banner warming: 1917 ms. After holding every picture outside the first content: 1287 ms. `serve.mjs` gzip, the hints and the Delivery headers changed little locally (CDP throttling does not model DNS/TCP/TLS, so preconnect cannot show here).
- The remaining critical path: page 170 ms, SDK 190–380 ms, zone ~560 ms (CORS preflight plus GET), then the in-view covers, where the group without a cover costs a 320 KB tale image (~640 ms).
- Zone-key in-memory cache (~60 s, from the epic lane notes): not built. The zone request is ~15 ms of server time over the 165 ms latency; the architecture defers caching until measured, and the Delivery API p95 target (300 ms at 50 req/s) is another story's measurement.
- `Access-Control-Max-Age` would save the preflight on repeat visits, but the epic forbids changing Delivery CORS; left for a decision.
- The perf seed signs an admin in by inserting a user and a session row (as the API tests do), then uses only the Management API.

## Plan Change Log

## Review Triage Log

### 2026-10-21 — Coordinator review
- verdicts: 12 findings, all patched. Merged `autopilot/foundation` (0f3401f, importer 2.9) first; no conflicts.
- findings:
  - `[patch]` A render's first-content work outlived it and released the whole shadow root — `loadFirstContent` takes the render's AbortSignal and its own container; `load()` and `disconnectedCallback` abort it (3 s timer cleared, cover listeners removed); a removed element starts no downloads; tests: a key change within 3 s leaves the new render's pictures held past the old timer; removal starts nothing.
  - `[patch]` `marked` was set before the mark fired — set in the callback that marks, only for a render still on the page; an aborted render never marks and a later one may; tested.
  - `[patch]` `taleart:zone` repeated when a render returned early — its own `zoneMarked` flag; tested with an unknown stage.
  - `[patch]` Reduced-motion canvas covers loaded their image directly — `setCanvasSource` holds it, releases it at once as first content or lazily (IntersectionObserver, 1250 px) otherwise; tested.
  - `[patch]` `applyCoverMotion` bypassed the hold — `replaceCover` keeps held/first-content state (`data-first`) and the first content follows the replacement; tested.
  - `[patch]` A still video cover could wait for `loadeddata` a metadata-only browser never fires — it also settles 1 s (`STILL_VIDEO_MAX_MS`) after `loadedmetadata`; documented; tested.
  - `[patch]` Banner `goTo` added listeners per step — one settled promise per slide.
  - `[patch]` perf.mjs could orphan children or the temp dir — children tracked before start resolves and killed on timeout; temp dir and browser inside the try; one cleanup also on SIGINT/SIGTERM (Playwright's own signal handlers turned off, which had exited first); checked by interrupting a run.
  - `[patch]` `_test` guard read only the URL path — parsed with `pg-connection-string` (as pg does), `database` and any `?db=` must end in `_test`; same check in `app.spec.ts`.
  - `[patch]` Seeded rows stayed in the database — removed at the end (project with zone, frames, groups, tales, placements, key; the admin with session); README says what is added and that SIGKILL leaves them.
  - `[patch]` `bar.spec.ts` line over 120 — wrapped (and two new lines of this story).
  - `[patch]` `serve.mjs` threw on a malformed escape — 400.

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w3_test npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size` -- expected: ≤ 50 KB gzipped.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:a11y` -- expected: 0 violations.
- `NX_DAEMON=false TEST_DATABASE_URL=… npm exec nx -- run sdk-sample:perf` -- expected: PASS, cold p75 ≤ 1500 ms.

## Auto Run Result

**Summary:** `nx run sdk-sample:perf` (named in the web-sdk README) measures first zone content on the sample page: it starts the built API on the `_test` database, seeds a bar + banner zone of eight groups (animated WebM cover first, one group without a cover, still covers, 1080 × 1920 JPEG tales) through the Management API, and loads the page in headless Chromium at DevTools' Fast 4G, 4× CPU and a 412 × 823 phone, reading the SDK's `taleart:first-content` mark; it fails when cold p75 > 1.5 s or the SDK > 50 KB gzipped. The SDK now loads the first frame's covers in view first (eager, `fetchpriority="high"`), holds every other picture until they settle (at most 3 s), starts bar covers lazy, and warms banner slides only around the one shown. The Delivery zone is `private, no-cache`, `Vary: Authorization`, with ETag revalidation (304). The sample page has the host hints (modulepreload, two preconnects, reserved height) and its server gzips text; the README documents them.

**Files changed:**
- `apps/sdk-sample/perf.mjs` (new), `project.json` (`perf` target), `serve.mjs` (gzip), `index.html` (hints, reserved height).
- `libs/web-sdk/src/lib/first-content.ts` (new) and spec; `taleart-element.ts`, `bar.ts`, `banner.ts` and their specs; `README.md`.
- `apps/api/src/http/delivery.router.ts`, `apps/api/src/app.spec.ts` -- cache headers and revalidation test.
- `libs/contract/openapi/openapi.yaml`, `src/generated/api.ts` -- 304 and caching documented.

**Review:** coordinator review, 12 findings, all patched (see Review Triage Log).

**Follow-up review recommended:** true. The SDK's loading order changed for every frame (held URLs, lazy covers, banner warming), and the Delivery API gained cache headers on a keyed response.

**Verification (after review fixes and the merge of 0f3401f):**
- `nx run-many -t lint test build` for the twelve projects passed against `taleart_w3_test` (api 342, web-sdk 246, server-importer 193, contract 95 tests).
- `nx run web-sdk:size`: 12.37 KB gzipped.
- `nx run sdk-sample:a11y`: no WCAG 2.2 AA violations.
- `nx run sdk-sample:perf`, three runs of 10 loads: cold p75 1253, 1258, 1255 ms (max 1268); warm p75 754–768 ms. Seeded rows, temp dir and child processes are gone after each run, and after an interrupted (SIGINT) run.

**Verification (first build, before review):**
- `nx run-many -t lint test build` for the twelve projects passed against `taleart_w3_test` (api 331, web-sdk 235, server-importer 171, contract 95 tests).
- `nx run web-sdk:size`: 11.78 KB gzipped (was 11.49 KB).
- `nx run sdk-sample:a11y`: no WCAG 2.2 AA violations, every behaviour check passed.
- `nx run sdk-sample:perf`, three runs of 10 loads: cold p75 1251, 1255, 1251 ms (p50 ~1250, max 1264); warm p75 ~754 ms; layout shift 0. Baseline before the changes: cold p75 3412 ms, warm 1119 ms.

**Residual risks:**
- CDP throttling adds latency per request but does not model DNS, TCP or TLS setup to the API origin; on a real network the first connection costs more, which the documented preconnect hints offset.
- A group without a cover puts its first tale's full image in the bar; a zone of large uncovered tales (1 MB each) in view would miss the budget. No server rendition exists by design (AD-11).
- Cold loads pay a CORS preflight for the Delivery call; `Access-Control-Max-Age` would help repeat visits but changes Delivery CORS, which the epic forbids without a decision.
- Pictures out of the first content wait up to 3 s if a first cover stalls.
