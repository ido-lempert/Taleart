---
title: 'Import 1,000 tales within 30 minutes'
type: 'feature'
ticket: '10'
created: '2026-10-21'
status: 'in-review'
baseline_revision: '4dc1fb5'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-storyly-importer/epic-storyly-importer.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The worker reads Storyly and copies media one request at a time. One 429 or 5xx from Storyly fails the whole job, and a transient media error leaves a tale without media. Nothing measures whether 1,000 tales import within 30 minutes (epic R6, NFR-006), and the report does not show how long the import took.

**Approach:** Measure first. The fake server gains a generated "Scale shop" app of 1,000 tales, with realistic media sizes, a latency and bandwidth profile and occasional 429/500 replies. An Nx target (`api:import-scale`) runs a real import of it against the `_test` database and fails over a threshold scaled to the profile's time factor. Then optimise what it shows:
- Retries with backoff for 429 and 5xx, both for Storyly calls and media downloads.
- Bounded concurrency: a media pool with a per-host limit, and story lists read ahead.
- Report effects applied in reading order, so the report is the one a sequential run writes.
- The per-job media budget made safe for concurrent downloads.
- The report records the elapsed time.

## Boundaries & Constraints

**Always:**
- Storyly client: 429 and 5xx (and only those) are retried up to 5 attempts in all. The wait is exponential backoff with jitter (0.5 s base, 30 s cap) or the reply's `Retry-After`, capped at 60 s. A 429 pauses every request of that client until it passes. 401/403 and other 4xx keep today's behaviour. Once retries run out, the job fails with today's "Storyly answered N" message.
- Media: a download answered 429 or 5xx is retried the same way within the per-download deadline and the job budget; then it is `httpError` as today. 404 and the guard's failures are not retried. Every attempt and every redirect goes through the same guard (story 5); no URL is ever logged or reported.
- Concurrency: at most 8 media copies at once, at most 6 per media host, and story lists of up to 4 groups read ahead. All are options of `ImportRunOptions`, so tests and the scale target can use 1. The pool holds back once 32 tales wait for their report effects, which bounds memory. Bodies are streamed as before.
- Report: every order-sensitive report write (differences, notes, the difference budget) runs in reading order. A tale's media outcome lands where a sequential run puts it, so a run with concurrency 1 and one with 8 store equal reports. Story lists are checked as they arrive against a snapshot of the budget, and the budget is drawn when the list is listed, in order. Counts may rise out of order, so progress keeps rising.
- Per-record transactions and the locks of story 7 are unchanged. Media writes keep their own transaction under the tale's import lock. No two tasks touch the same tale.
- Budget: bytes are taken from the job's media budget as they are read, so concurrent downloads cannot overshoot it together. The 5 GB / 60 min defaults stay (a safety cap, not the target).
- Failure: when a task fails (database or storage) or the claim is lost, new tasks stop, in-flight downloads are aborted and awaited, and then the job fails or stops as before.
- Resume: a job re-queued after a worker stops runs again from the start. Links make it create nothing twice, and media already copied is not downloaded again (AD-7).
- Elapsed time: `import_jobs.first_started_at` is set on the first claim and kept through recovery. The finished report gets `elapsedSeconds` from that time, and the job page shows "Took …".

**Never:** Changing per-record transaction or lock order; dropping the SSRF guard or budgets; retrying writes; parallel writes into one tale group's order; product decisions the epic leaves open; touching the tales module's or SDK's code (Tale Studio runs in parallel); tests that reach the internet.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Throughput | Scale shop, 1,000 tales with media, profile latency, 429/500 sprinkled | done; 1,000 tales and media imported; scaled time under threshold; `elapsedSeconds` set | — |
| Storyly 429 | list answers 429 `Retry-After` once | waits, retries, imports; other requests wait too | retries exhausted: job failed "answered 429" |
| Storyly 5xx | 500/503 once | retried with backoff | persistent: job failed |
| Storyly 4xx | 401/403/404 | not retried; as before | token invalid / failed |
| Media 429/5xx | first attempt 503 | retried, imported | persistent: `httpError` difference |
| Media 404 / guard | 404, private redirect on a retry | no retry; same reason as before | — |
| Order | media finishing out of order, failures and notes | report equal to a concurrency-1 run | — |
| Budget full | more differences than the cap, concurrent | first N in reading order stored, rest omitted | — |
| Byte budget | concurrent downloads past bytes left | `jobBudgetExceeded`; nothing stored past the budget | — |
| Task fails | storage put rejects mid-run | in-flight aborted and awaited, job failed with the generic message | — |
| Restart | worker stops mid-run, job recovered | resumed; no duplicate records; copied media not re-downloaded | — |
| Re-run | same app again | counts unchanged; no media downloads | — |
| Memory | scale run | peak RSS under the target's limit | — |

</intent-contract>

## Code Map

- `apps/fake-storyly/src/fake-storyly.mjs`, `scale.mjs` (new), `main.mjs`, `fixtures/scale-profile.json` (new) -- generated Scale shop, latency/bandwidth profile, failure injection, synthetic media, counters.
- `libs/server/importer/src/lib/retry.ts` (new) -- backoff, `Retry-After`, abortable sleep, limiters.
- `libs/server/importer/src/lib/in-order.ts` (new) -- ordered report effects with back-pressure and failure.
- `libs/server/importer/src/lib/storyly-client.ts` -- retries, 429 pause, read-ahead, snapshot-checked lists.
- `libs/server/importer/src/lib/media-fetch.ts`, `media-copy.ts` -- status on `httpError`, retry, incremental budget, abort signal.
- `libs/server/importer/src/lib/worker.ts` -- media pool, ordered effects, read-ahead, concurrency options, drain on failure.
- `libs/server/importer/src/lib/jobs.ts`, `migration.ts` -- `first_started_at`, `elapsedSeconds`.
- `libs/contract/openapi/openapi.yaml` -- `ImportReport.elapsedSeconds`; regenerated.
- `apps/dashboard/src/app/pages/import-job.ts`, `import-shared.ts` -- "Took …" line.
- `apps/api/src/import-scale.scale.ts` (new), `apps/api/vitest.scale.config.mts` (new), `apps/api/project.json` -- the `import-scale` target.
- `apps/api/src/http/imports.router.ts` -- interactive retry policy for Find apps and preview.
- `apps/api/src/app.spec.ts` -- integration tests (retries, order, per-host limit, restart).

## Tasks & Acceptance

**Execution:**
- [x] `apps/fake-storyly/` -- Scale shop, profile, failures, counters; tests.
- [x] `apps/api/` -- scale target; baseline measured before changing the worker.
- [x] `libs/server/importer/` -- retry, limiter, ordered effects, pool, read-ahead, budget, elapsed; unit tests per matrix row.
- [x] `libs/contract/`, `apps/dashboard/` -- `elapsedSeconds` and its line; component test.
- [x] `apps/api/src/app.spec.ts` -- integration tests: retries, equal reports at concurrency 1 and 8, per-host limit, restart resume.

**Acceptance Criteria:**
- Given the Scale shop with 429/500 replies, when `api:import-scale` runs, then the import is done with 1,000 tales and media imported, and the extrapolated real-latency time is under 30 minutes.
- Given an import done, when the job page opens, then it shows how long the import took.

## Implementation Notes

- Assumptions (technical, none blocked the build):
  - **The latency profile is assumed.** Story 3 (the real run) has not recorded the live API, so `scale-profile.json` holds assumed figures: API 200–600 ms, media 50–250 ms to first byte at 2 MB/s per connection, images 150 KB–1 MB with 15 % videos of 2–8 MB (1.2 GB per 1,000 tales), 3 % API 429, 2 % API 500, 1 % media 429, 1 % media 503, `Retry-After: 1`. Replace them with the recorded figures after story 3.
  - **Retry policy and concurrency are technical defaults**: 5 attempts, 0.5 s base doubling to 30 s, `Retry-After` honoured up to 60 s; 8 copies, 6 per host (a browser's per-host limit), 4 lists ahead, 32 tales waiting. Only 429 and 5xx are retried (the story's words); connection errors fail as before.
  - **Interactive reads retry once.** "Find apps" and the preview run inside a person's request, so they use `INTERACTIVE_RETRY_POLICY` (2 attempts, `Retry-After` up to 2 s).
  - **Budgets kept (reconciling 5 GB / 60 min with the target).** They are safety caps against a hostile or huge account, not the throughput target. The 60 minutes are wall-clock time for the import's media as a whole, so concurrency raises what fits in them. At the profile, 1,000 tales copy 1.2 GB in about 2 minutes. If a cap binds, the rest is listed as `jobBudgetExceeded` and a re-run picks it up (story 5).
  - **Elapsed time** runs from the first claim to the end, over every run of a recovered job, in whole seconds (`elapsedSeconds`). Reports made before it have none, and the page then shows no "Took" line.
  - **A resumed run reports from its own view.** Records the stopped run created count as `unchanged` in `changes`; `imported` is unaffected.
  - **A failing copy now fails a job whose later tales may already exist.** A storage or database failure is known only when that copy ends, and later tales may be created meanwhile. The job fails as before, and a re-run completes it without duplicates.
- Ordering: `InOrder` chains report effects behind the copies they wait for. An effect added while nothing waits, or from inside a running effect, runs at once, so imports without media behave exactly as before. Story lists from `StorylyClient` with `chargeOnListing` are checked against a copy of the budget and marked `uncharged`; `addList` draws on the real budget when it lists them, which gives the same stored/omitted split as a sequential run (unit test at budget 9).
- Byte budget: each chunk is taken from `bytesLeft` as it is read. Once a download is refused for the budget, `bytesLeft` is set to at most 0, so the rest is not requested.
- Failure handling: the first failed copy calls `onFailure` at once, which aborts the job's `AbortController`. Queued copies then do not start, running downloads abort, and `importContent` awaits every running copy (`settle`) before it rethrows, so nothing writes after the job ends.
- Not optimised, by measurement: database work. At SCALE_FACTOR 0.01 (network nearly free), 1,000 tales take about 10 s locally, against a 30-minute target. So there is no batching across records: story 7's per-record transactions and lock order stay as they were. The per-record heartbeat also stays.
- The scale target lives in `api` because it needs every module's migrations (`apps/api/src/db.ts`). `*.scale.ts` is excluded from the app build and from `api:test`. `claimNextJob` is now exported for it.
- The fake's `stats.maxMediaOpen` counts a media request from its arrival to the end of its answer.
- Merged `autopilot/foundation` 52287b8 (Tale Studio 7.1) before committing. It merged with no conflicts, and the contract was regenerated with no change.
- Measurements (`api:import-scale`, 1,000 tales, SCALE_FACTOR 0.1; the machine was shared, so expect ±20 %):

| Run | Before (4dc1fb5) | After |
|-----|------------------|-------|
| Profile with 429/500 replies | failed after 2–7 s: "Storyly answered 429 when listing story groups" | 25.3 s, done; upper bound 4.2 min |
| Profile without failures | 107.7 s; upper bound 18.0 min | 15.8 s; upper bound 2.6 min |
| Re-run (nothing new) | 14.9 s | 4.6 s |
| SCALE_FACTOR 0.01, no failures (≈ CPU and database) | 53.7 s | 10.3 s |
| Most media requests open at once | 1 | 6 |
| Peak RSS | 184 MB | 192 MB |

  Extrapolation: measured / factor is an upper bound at real latency (only the network part scales; `Retry-After` and backoff are not scaled). A two-point estimate, t(0.01) + (t(0.1) − t(0.01)) / 0.1, gives about 2.7 min after (with failures) and 9.9 min before (without failures).

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --skip-nx-cache` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run api:import-scale --skip-nx-cache` -- expected: passes and prints measured and extrapolated times.

## Auto Run Result

**Summary:** The importer now meets the 1,000-tale target with a large margin, and the margin is measured. The fake server serves a generated Scale shop: 1,000 stories, 1.2 GB of media, assumed latency and bandwidth, and occasional 429/500/503 replies. `nx run api:import-scale` imports it into the `_test` database, then imports it again. It fails over the 30-minute target scaled by the time factor, or over 1 GB of peak memory. The worker now:
- retries 429 and 5xx with backoff and `Retry-After`, for Storyly and for media;
- copies media 8 at once, at most 6 per host;
- reads story lists ahead;
- keeps the report identical to a sequential run's, in reading order with the same budget split;
- shares the byte budget safely between downloads;
- stops and awaits its copies when it fails.

A job resumed after a worker stops creates nothing twice and downloads no media again. Each report records `elapsedSeconds`, which the job page shows as "Took …".

**Files changed:**
- `apps/fake-storyly/`: `scale.mjs`, `fixtures/scale-profile.json` (new), Scale shop control and stats, `FAKE_STORYLY_SCALE`; 4 tests.
- `libs/server/importer/`: `retry.ts`, `in-order.ts` (new); client retries, 429 pause, read-ahead, `chargeOnListing`; media retry, incremental budget, abort; worker pool and ordered effects; `first_started_at`, `elapsedSeconds`; `concurrency.spec.ts` (13 tests) and 15 more tests in `importer.spec.ts` and `media-copy.spec.ts`.
- `libs/contract/`: `ImportReport.elapsedSeconds`; regenerated.
- `apps/api/`: `import-scale` target (`import-scale.scale.ts`, `vitest.scale.config.mts`); interactive retry policy on the import routes; 4 integration tests; elapsed-time expectations.
- `apps/dashboard/`: "Took" line and `importDurationText`; 2 tests.
- `.env.example`: `FAKE_STORYLY_SCALE`, budget note.

**Review:** none yet (unreviewed).

**Verification:** after merging `autopilot/foundation` 52287b8, the run-many command passed for all 12 projects against `taleart_w2_test`: api 379, server-importer 257, web-sdk 262, contract 106, server-tales 96, server-zones 67, fake-storyly 18 tests. The only warning is the dashboard bundle budget warning, which was already there. `api:import-scale` passed: 25.3 s at factor 0.1 with 27 injected failures, an upper bound of 4.2 min, 1,000/1,000 tales and media, and a peak RSS of 192 MB.

**Residual risks:**
- The latency and failure profile is assumed until story 3 records the live API. Media hosts much slower than 2 MB/s per connection, or long `Retry-After` values, change the numbers.
- The timing assertions in the fake's and the API's tests (pacing, Retry-After of 1 s, at most 6 open) may be sensitive on a heavily loaded CI machine.
- With a storage or database failure, tales after the failing one may already exist. The job fails and a re-run completes it.
- The generated contract file (`api.ts`) may conflict with other contract changes when merged.
