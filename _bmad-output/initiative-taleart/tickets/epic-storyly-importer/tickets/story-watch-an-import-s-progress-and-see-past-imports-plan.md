---
title: 'Watch an import''s progress and see past imports'
type: 'feature'
ticket: '4'
created: '2026-10-21'
status: 'built'
baseline_revision: '9adf4bebe0788c49cb92403673b5ee94442dbf13'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'none'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-storyly-importer/epic-storyly-importer.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** While an import runs, the page shows only Queued/Running until the report arrives, and the job lives only in the page's memory: a reload loses it, and earlier runs cannot be found again (epic R5).

**Approach:** The worker stores per-entity progress (read from the source so far, written to TaleArt so far) on the job row as it goes; the API exposes it with the job's start time and adds a list of the project's imports. The dashboard gives each import its own URL that polls the job (no new infrastructure), and the Import from Storyly page lists past runs, each opening its job page.

## Boundaries & Constraints

**Always:**
- `import_jobs` gains `progress jsonb` (nullable, forward-only `ALTER … ADD COLUMN IF NOT EXISTS`). Shape `{zones, taleGroups, tales}`, each `{read, written}`: `read` = source records listed so far (the running report's `source`), `written` = records in TaleArt so far (its `imported`, which on a re-run includes already-linked ones).
- The worker writes progress on every heartbeat it already takes before each record, guarded by the claim (`id`, `running`, `locked_by`), and the final progress with the report when the job ends; a failed job stores how far it got. A claim (first or after recovery) resets progress to null.
- Contract first: `ImportJob` gains `startedAt` (date-time or null) and `progress` (`ImportProgress` or null). New `GET /projects/{projectId}/imports` answers `ImportJobSummary[]` (`id, status, sourceAppName, error, createdAt, startedAt, finishedAt`; no report), newest first, at most 50.
- Same guards as story 1 on the new route: admin (403 `forbidden`), project access (403), configured importer (503), project exists (404). A list only ever holds the project's own jobs. The token is never read by these queries, logged or returned.
- Dashboard (story 14 design system): `/projects/:projectId/import` shows the start form and a "Past imports" list (state pill, app, started and finished time, failure reason, a link "View report" or "View progress"); `/projects/:projectId/import/:importId` shows one job: state, progress rows "Zones: r read / w written" while queued or running (polled every 2 s), the report when done, the error when failed. Starting an import navigates to the job's URL, so a reload keeps following it.
- Fake Storyly server: `control.delayMs` slows every answer; `main.mjs` reads `FAKE_STORYLY_DELAY_MS` and `FAKE_STORYLY_FAIL` (`instances`, `story-groups` or `stories`) for manual reviews.

**Never:** Server push (SSE, websockets) or a new queue; percentages or ETA (the source total is unknown until read); cancelling or deleting imports; showing imports to content managers (the importer is admin-only, epic decision); history pagination beyond the newest 50; depending on story 3's real Storyly shapes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Progress mid-run | slow fake, job running | `GET` job shows `status: running`, `startedAt` set, progress with read ≥ written, rising between polls | — |
| Progress at end | job done | progress zones 3/3, taleGroups 6/6, tales 15/15 (read/written), equal to report source/imported | — |
| Failed run | fake fails stories | `failed`, `error` message, progress as far as it got, token NULL | — |
| Queued | job not yet claimed | `startedAt` null, `progress` null | — |
| Re-claimed | job recovered after a crash | progress reset at claim, then rises again | — |
| History | project with 2 runs | `GET /imports` lists both, newest first, with state, times, error; no report, no token | — |
| Other project | jobs in project B | not in project A's list | — |
| Empty history | no runs | `[]` | — |
| Content manager | member of the project | 403 `forbidden` on the list | — |
| Not configured / unknown project | no key / random id | 503 `importer_not_configured` / 404 `project_not_found` | — |
| Dashboard reload | open `/projects/p1/import/j1` while running | page reads the job and keeps polling to done | read error shown, poll retried |
| Dashboard history | form page | lists runs; a failed one shows its reason; each row opens its job page | list error shown |

</intent-contract>

## Code Map

- `libs/server/importer/src/lib/migration.ts` -- add `progress` column.
- `libs/server/importer/src/lib/jobs.ts` -- job columns (`startedAt`, `progress`), `listImportJobs`, heartbeat with progress, claim resets progress, finish writes final progress.
- `libs/server/importer/src/lib/worker.ts` -- `importContent`'s `beforeEach` receives the running report; `runImportJob` turns it into progress on the heartbeat.
- `libs/server/importer/src/index.ts`, `importer.spec.ts` -- export, unit tests.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- list path, `ImportProgress`, `ImportProgressCount`, `ImportJobSummary`, `ImportJob` fields; regenerate.
- `apps/api/src/http/imports.router.ts`, `apps/api/src/app.spec.ts` -- list route; integration tests.
- `apps/fake-storyly/src/fake-storyly.mjs`, `main.mjs`, spec -- delay and failure switches.
- `apps/dashboard/src/app/import.service.ts`, `pages/import.ts`, `app.routes.ts`, `app.spec.ts` -- list call, job route, progress and history views; tests.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- schemas and path; regenerate -- AD-3, contract first.
- [x] `libs/server/importer/` -- progress column and writes, list query; unit tests for progress (rising, final, failed keeps, reset at claim) -- AD-8.
- [x] `apps/fake-storyly/` -- `delayMs`, env switches; test.
- [x] `apps/api/src/` -- list route; tests for every API matrix row incl. access control.
- [x] `apps/dashboard/src/app/` -- job route and page, history list, progress rows; tests for reload, progress, history, failed reason.

**Acceptance Criteria:**
- Given the fake server answering slowly, when an admin starts an import, then the page's progress rows rise without a reload, and reloading the job's URL mid-run continues to show progress up to done.
- Given finished runs, when the admin opens Import from Storyly, then the list shows each run's state, start and end times, and a failed run's reason, and each row opens its report.
- Given any job, when it is read or listed, then no token or ciphertext is in the answer.

## Implementation Notes

- Progress is derived from the running report: `read` = its `source`, `written` = its `imported` (`progressOf`). On a re-run, `written` therefore counts records already linked from an earlier run, as the report's `imported` does. Read counts appear entity by entity as lists are read, so there is no total and no percentage (the source total is unknown until every list is read).
- Progress is written with the heartbeat `importContent` already takes before each record, so the stored value can lag by one record; the final progress is written with the report, and a failed job stores the running report's progress at the moment of failure (`failImportJob(…, progress)`, `COALESCE` keeps the stored one when the job failed before reading content). The 15 s interval heartbeat does not write progress.
- `importContent`'s `beforeEach` now receives the running report (same object), which is how the runner knows how far a failed job got.
- `GET /projects/{projectId}/imports` answers summaries (no report, no progress) capped at the newest 50 (`IMPORT_LIST_LIMIT`). The epic does not ask for paging; 50 is a technical bound, not a product decision, and is easy to change.
- Access: the list uses story 1's guards. Imports remain admin-only (epic decision "only an admin can start an import" and story 1's admin-only page); a content manager who is a member of the project gets 403, and admins see only the requested project's jobs. If content managers should see import history, that is a product decision for the epic.
- Dashboard: the form page and the job page are two components (`pages/import.ts`, `pages/import-job.ts`) sharing `pages/import-shared.ts`. Starting navigates to `/projects/:projectId/import/:importId`, which reads the job at once and polls every 2 s while queued or running; a failed read while following retries at the next poll, an unreadable job (such as 404) is not retried. Opening a done job refreshes the dashboard store so imported zones appear (also when opened from the history; one extra refresh).
- The history list is read once when the form page opens; it does not poll. A running row links to "View progress", which polls.
- `startedAt` is when a worker last claimed the job (a recovered job's start moves). `ImportJob` gained required-nullable `startedAt` and `progress`.
- Fake server: `control.delayMs` (reset to 0 by `reset()`), and `main.mjs` reads `FAKE_STORYLY_DELAY_MS` and `FAKE_STORYLY_FAIL=instances|story-groups|stories`; documented in `.env.example`.
- The dashboard build prints the existing "bundle initial exceeded maximum budget" warning (543 kB of 500 kB); it predates this story (the main checkout's build was already over), this story adds about 7 kB.

## Plan Change Log

## Review Triage Log

### 2026-10-21 — Coordinator review
- verdicts: 4 findings, all patched
- findings:
  - `[patch]` `recoverStaleJobs` re-queued a job without clearing `progress`, so a recovered job read queued, `startedAt` null and stale progress. Fixed: the re-queue also sets `progress = NULL`. Added an integration test for the "Re-claimed" row: the recovered job reads progress null, and progress counts again from the start after the next claim. `recoverStaleJobs` is now exported for that test.
  - `[patch]` The job page never polled again after a failed first read. Fixed: a failed read is retried at the next poll unless the API answered 403 or 404. `ImportResult` failures now carry the HTTP status, or 0 when no answer came. Component tests: a 500 on the first read is retried, and 403 and 404 are not.
  - `[patch]` The job page ignored a change of `:importId`, since the router reuses the component. Fixed: an effect on the `importId` input clears the job and error, cancels the poll and follows the new import; a response for the previous id is ignored. Component test.
  - `[patch]` The matrix "Re-claimed" row had no integration test. Covered by the test added for the first finding.

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all succeed.

**Manual checks (if no CLI):**
- Run the fake server with `FAKE_STORYLY_DELAY_MS=300`, start an import, watch the progress rows rise, reload mid-run.

## Auto Run Result

**Summary:** An import's progress is now visible while it runs and survives a reload, and a project's past imports are listed. The worker stores per-entity progress (read from the source so far, written to TaleArt so far) on the job row with each heartbeat, the final progress with the report, and how far a failed run got. The API adds `startedAt` and `progress` to the job and `GET /projects/{projectId}/imports` (newest 50, no reports or tokens). The dashboard gives each import its own page that polls every 2 s, and the Import from Storyly page lists past runs with state, start and end time and failure reason, each opening its report. The fake Storyly server can answer slowly or fail a list, for reviews.

**Files changed:**
- `libs/contract/openapi/openapi.yaml`, `src/index.ts`, `src/generated/api.ts`: `listImports`, `ImportJobSummary`, `ImportProgress`, `ImportProgressCount`, `ImportJob.startedAt` and `.progress`.
- `libs/server/importer/src/lib/migration.ts`, `jobs.ts`, `worker.ts`, `index.ts`, `importer.spec.ts`: progress column and writes, `listImportJobs`, `progressOf`; unit tests.
- `apps/api/src/http/imports.router.ts`, `app.spec.ts`: list route; integration tests (queued, rising progress under latency, final progress, failed run, list order/limit/isolation, 403/404/503).
- `apps/dashboard/src/app/pages/import.ts`, `pages/import-job.ts` (new), `pages/import-shared.ts` (new), `import.service.ts`, `app.routes.ts`, `app.spec.ts`: job page with progress, history list; tests.
- `apps/fake-storyly/src/fake-storyly.mjs`, `main.mjs`, `fake-storyly.spec.mjs`, `.env.example`: delay and failure switches.

**Review:** coordinator review, 4 findings, all patched (see Review Triage Log).

**Follow-up review recommended:** true. The dashboard flow changed shape (two routes instead of one in-memory state), and progress writes share the heartbeat's claim guard.

**Verification (review fixes):** `nx run-many -t lint test build -p api dashboard contract server-importer fake-storyly` passed: api 210, dashboard 101, server-importer 38, contract 14, fake-storyly 9 tests.

**Verification (build):** `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` passed for all 12 projects against `taleart_w3_test`: api 209, dashboard 98, server-importer 38, fake-storyly 9 tests; no lint warnings (only the pre-existing dashboard bundle budget warning). The fake server was started on a free port with `FAKE_STORYLY_DELAY_MS=300 FAKE_STORYLY_FAIL=stories` and answered slowly with a 500 on the story list, then stopped.

**Residual risks:**
- Progress lags by up to one record, and during a long single source request (slow list) nothing moves until the next record.
- The history does not refresh by itself while a run in it is active.
- No browser screenshot was taken in this run (passkey sign-in); the flow is covered by component tests.
