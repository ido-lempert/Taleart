---
title: 'Pinned SDK URLs keep working after a release'
type: 'feature'
ticket: '21'
created: '2026-10-23'
status: 'built'
baseline_revision: '60eaff8'
route: 'full'
route_source: 'auto'
risk: 'low'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-install-tab-copy-the-snippet-and-open-a-test-page-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-keep-the-web-sdk-within-budget-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Since 8.13 the API serves the SDK pinned to its content at `/sdk/v1/taleart.<hash>.js`, but only the current build: the next release turns every pinned URL into a 404, so a page that pins the SDK with SRI breaks on each deploy, and the pinned URL and integrity are only readable from the raw `GET /api/v1/install` JSON (follow-up from 8.13, epic R13).

**Approach:** The API keeps the last N content-hashed builds (default 5, `SDK_BUILDS_KEPT`) in a builds folder (`SDK_BUILDS_DIR`, default `.data/sdk-builds`, outside `dist` so a rebuild does not wipe it): each build it serves (at start and whenever `WEB_SDK_FILE` changes) is written there as `taleart.<hash>.js`, and older ones beyond N are deleted. A pinned URL is served from the current build or from that folder, exactly as written, immutable, gzip and ETags as for the stable URL; any other hash 404s. The Install tab shows the current pinned URL and integrity with Copy buttons and a copyable pinned script tag.

## Boundaries & Constraints

**Always:**
- A pinned file's bytes are exactly the build's bytes, checked against the hash in its name when read (a corrupted or renamed file 404s), so the `sha384` integrity the tab gave stays valid.
- Writes are atomic (temporary file and rename), so a second API process sharing the folder never reads half a file; a write or prune failure is logged and never stops the current bundle being served.
- Ordering is by modification time: a build seen again (a restart, a redeploy of an older build) is touched and counts as newest. The current build is never pruned.
- `SDK_BUILDS_KEPT` a whole number 1–100, else the API stops at start; `SDK_BUILDS_DIR=off` keeps only the current build (as before).
- Only names matching `taleart.<16 base64url>.js` are read or deleted in the folder; request input never forms another path. A missing hash is not cached (no memory growth from probing).
- Dashboard initial bundle under 500 kB; the Install tab stays in the lazy zone page. No contract (OpenAPI) change: `InstallInfo` already carries `sdkPinnedUrl` and `sdkIntegrity`.

**Never:** a build step that copies hashed files (the API owns its history); serving a hash it has not seen; mutable caching on a pinned URL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Current pinned | `taleart.<current>.js` | 200, `public, max-age=31536000, immutable`, gzip when accepted, ETag per encoding | |
| Old pinned | an earlier build within N, after a rebuild or a restart | 200, its own bytes, same headers | |
| Evicted | N+1 builds ago | 404 | |
| Unknown hash | never seen | 404, nothing cached | |
| Tampered file | folder file whose bytes do not match its name | 404 | |
| Folder unwritable | | current build still served (stable and pinned); a warning logged | logged |
| No bundle | | stable and pinned 404; tab says there is no pinned URL | |
| Install tab | bundle present | pinned URL, integrity, Copy URL / Copy integrity / Copy pinned tag, how many builds stay | copy failure says to select and copy |

</intent-contract>

## Code Map

- `apps/api/src/http/sdk.router.ts` -- `sdkBuilds` (record, prune, read by hash), `sdkSource`, router reads pinned through it; `sdkBuildsFromEnv`
- `apps/api/src/app.ts`, `main.ts` -- wiring, env, start-up record, log
- `apps/api/src/http/sdk.router.spec.ts` -- builds, eviction, restart, 404s, headers, gzip, ETags
- `libs/contract/src/lib/core.ts` -- `DEFAULT_SDK_BUILDS_KEPT`, `pinnedSdkScriptTag`
- `apps/dashboard/src/app/pages/pinned-sdk.ts` (new), `site-key-card.ts` -- Install tab section
- `apps/docs/src/app/pages/install.ts`, `docs-content.ts`, `docs-terms.spec.ts`, `libs/web-sdk/README.md`, `.env.example` -- docs
- `apps/dashboard-e2e/scripts/start-api.mjs`, `scripts/e2e-sdk.mjs` (new), `src/pinned-sdk.spec.ts` (new) -- e2e

## Tasks & Acceptance

**Execution:**
- [x] API builds folder, pinned serving, env; router and app specs
- [x] Contract constant and pinned tag helper; spec
- [x] Install tab pinned section; spec
- [x] Docs page, README, `.env.example`; docs check
- [x] Playwright: pin, rebuild, restart, pinned page loads with SRI

**Acceptance Criteria:**
- Given a page pinned to build A with SRI, when the SDK is rebuilt and the API restarted with build B, then the page still loads A, the stable URL serves B, and the Install tab shows B's pinned URL and integrity.
- Given N+1 builds since A, then A's pinned URL answers 404.

## Implementation Notes

- **Where builds live.** `sdkBuilds(dir, keep, warn)` in `sdk.router.ts`: `record(file)` writes `taleart.<hash>.js` through a temporary file (`.taleart.<hash>.<pid>.<random>.tmp`, `wx`), sets an mtime that only grows within the process, renames, then prunes to the newest `keep` (the current one always kept; stale temporary files over 10 minutes old removed). Records run one at a time. `read(hash)` serves only a name matching the pinned pattern, through `servedFile` (so a replaced file is read again), and only when the bytes hash to that name; a reader is cached only while its file exists.
- **Source.** `sdkSource(bundleFile, builds)` replaces the bare `servedFile` for the bundle: `current()` records each new `ServedFile` once (awaited, so a rebuilt build is in the folder before its first answer), `pinned(hash)` gives the current build or a kept one. `createApp` reads it once at start, so a build is kept even if no page asks for it. `toServedFile` factors out the ETag, hash and integrity.
- **Config.** `SDK_BUILDS_DIR` (default `.data/sdk-builds` from the start folder, `off` for none) and `SDK_BUILDS_KEPT` (1–100, default `DEFAULT_SDK_BUILDS_KEPT` = 5 in the contract) via `sdkBuildsFromEnv`; main logs where builds are kept; `.env.example` documents both. `createApp` without them keeps no history (tests, as before). `sdk-sample:perf` runs with `SDK_BUILDS_DIR=off`.
- **No contract change** to `InstallInfo`; the contract gains `DEFAULT_SDK_BUILDS_KEPT` and `pinnedSdkScriptTag`. The tab says the default count ("unless your server sets another number"): the server's actual `SDK_BUILDS_KEPT` is not sent (avoids an OpenAPI change beside 8.19/8.22).
- **Install tab.** New `pages/pinned-sdk.ts` ("Pin this SDK version (optional)") under the Snippet card, for everyone: read-only Pinned URL and Integrity fields with Copy URL / Copy integrity, Copy pinned script tag, a status line; without a bundle it says there is no pinned URL. Lazy zone page only.
- **E2E.** `start-api.mjs` serves a copy of the API build's SDK from `dist/.playwright/apps/dashboard-e2e/sdk` (`scripts/e2e-sdk.mjs`) with its own builds folder. `pinned-sdk.spec.ts`: reads the tab, copies, loads a 127.0.0.1 page with the copied pinned tag (and refuses a wrong digest), rebuilds the SDK under the running API (the tab shows the new URL), starts a second API process on the changed SDK and the same folder (the restart): the first build's pinned page still loads with SRI, the stable URL and the new pinned URL serve the rebuilt one, an unknown hash 404s.

## Plan Change Log

- **Review fixes (2026-10-23).** Contract first: `InstallInfo.sdkBuildsKept` (integer ≥ 1; 1 when `SDK_BUILDS_DIR` is off); the card, docs and README use it and say "SDK builds this server served", never "releases"; with 1 the card says the URL stops working at the next SDK build. `servedFile` stats before and after each read and keeps a read only when size, mtime and length agree (three tries, else the last whole read); a build is recorded only once its file has held still for 1 s (`SDK_STABLE_MS`, a timer records it later), and `current()` no longer awaits the record. Pinned 404s are `no-store`. `SDK_BUILDS_DIR` off values `off`/`false`/`none`/`no`/`0` in any case; empty means the default. `SDK_BUILDS_KEPT` is 2–100 with a folder (two processes during a rolling deploy). The readers map is capped at `keep` (least recently read out) and drops misses. Production start warns when the folder holds no build (`hasKeptBuilds`). Card copies are announced after 100 ms so the same copy is announced again; the integrity field is described by the hint. Docs/README/`.env.example`: volume, shared folder, clock sync, atomic deploys (write elsewhere, rename). New tests: encoded and traversal names, 15/17-character hashes, trailing slash, symlinks (404 unless the bytes match), stale vs fresh temporary files, two instances pruning at once, short and concurrently rewritten reads, deferred recording, pinned 404 headers, env off/min, card with 12, 2, 1 and missing.
- **Results.** Full run: only the known clock test fails (api 617 of 618); dashboard 662, docs 28, contract 391. `api:check-sdk-assets` pass; `web-sdk:size` 24.30 KB; `sdk-sample:perf` PASS (cold p75 1269 ms, API-served 1340 ms); dashboard initial 394.57 kB; `dashboard-e2e:e2e` 10 passed.

## Review Triage Log

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard docs contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool dashboard-e2e --parallel=2` -- pass but the known clock test
- `web-sdk:size`, `api:check-sdk-assets`, `sdk-sample:perf`, `dashboard-e2e:e2e` -- pass

**Results (2026-10-23):** lint, test and build pass for all 14 projects except the known clock test "creates the admin, signs them in and stores only the token hash" (api 608 of 609; dashboard 659, contract 391, docs 28). `web-sdk:size` 24.30 KB gzipped; `api:check-sdk-assets` pass; `sdk-sample:perf` PASS (cold p75 1271 ms, API-served 1327 ms); dashboard initial 394.57 kB; `dashboard-e2e:e2e` 10 passed (first run in 15 actions, both pinned-SDK tests).

**Manual checks:**
- Screenshots in `shots-8.21/` (scratchpad): `01-install-tab-pinned-first-build`, `01b-install-tab-pinned-phone`, `02-pinned-page-first-build`, `03-install-tab-pinned-after-rebuild`, `04-pinned-page-after-restart`, `05-new-pinned-page-after-restart`.
