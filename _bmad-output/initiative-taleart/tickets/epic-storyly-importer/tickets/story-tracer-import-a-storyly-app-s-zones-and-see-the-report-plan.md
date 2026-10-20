---
title: 'Tracer: import a Storyly app''s zones and see the report'
type: 'feature'
ticket: '1'
created: '2026-10-20'
status: 'in-progress'
baseline_revision: 'be909804f298c3c5692c0035cfc0e10b72384f41'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-storyly-importer/import-mapping.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Teams moving from Storyly have no way to bring their content into TaleArt. The importer epic starts with a tracer: one app's instances imported as zones, through the job, worker, import links and report that every later importer story extends.

**Approach:** A new `importer` server module (AD-1) owns import jobs and import links. An admin opens "Import from Storyly" for a project, pastes a Storyly API token, picks an app, and starts. The API stores a job and returns at once (AD-8); an in-process worker claims queued jobs from Postgres, reads the app's instances through a Storyly client, creates a zone per instance through the zones module, records import links (AD-7) and a report. A fake Storyly server with fixtures stands in for the real API in tests and reviews.

## Boundaries & Constraints

**Always:**
- Tables (importer module): `import_jobs (id, project_id, created_by, source_app_id, source_app_name, status queued|running|done|failed, token_ciphertext nullable, report jsonb, error text, created_at, started_at, finished_at)` and `import_links (project_id, source_system 'storyly', source_type, source_id, target_type, target_id uuid, created_at, unique (project_id, source_system, source_type, source_id))`. `project_id NOT NULL` everywhere (AD-4).
- Token: encrypted with AES-256-GCM using env `IMPORT_TOKEN_KEY` (32 bytes, base64); stored only on the job while it is queued or running; set to NULL when the job ends (done or failed). The token never appears in logs, responses or the report. Without `IMPORT_TOKEN_KEY` the import routes answer 503 `importer_not_configured` and the API still starts.
- Storyly client: base URL from env `STORYLY_API_URL` (default the real `https://api.storyly.io/external`), bearer token with fallback to the `token` query parameter (epic decision). Read-only calls: list apps, list instances. Every response shape is checked before use; an unexpected shape fails the job with a clear message (deeper per-record checks are story 6).
- Worker (AD-8): runs inside the API process, polls every 2 s, claims one job with `SELECT … FOR UPDATE SKIP LOCKED`, marks it `running`, and on restart re-queues jobs left `running` by a crashed process. Creates zones through `@taleart/server-zones` (`createZone`) in the job's project, with no frame (epic decision); writes one import link per instance; a zone already linked for that instance is not created again (counts as imported, so a re-run does not duplicate).
- Report (jsonb): `{zones: {source, imported, skipped}, notes: ["frame type unknown" per zone]}`.
- API (all admin-only; story 13's `requireAdmin` and project authorization; content managers get 403 `forbidden`):
  - `POST /api/v1/projects/{projectId}/imports/storyly/apps {token}` — calls Storyly to list apps for the token; 200 `[{id, name}]`; a token Storyly refuses → 400 `storyly_token_invalid` (no job created, token not stored).
  - `POST /api/v1/projects/{projectId}/imports {token, appId}` — 202 `{id, status: "queued"}`.
  - `GET /api/v1/projects/{projectId}/imports/{importId}` — `{id, status, sourceAppName, report, error, createdAt, finishedAt}`.
- Fake Storyly server: `apps/fake-storyly/` (plain Node, no dependencies), port 4400, Nx serve target; accepts only the test token `fake-storyly-token`; fixtures for one app "Demo shop" with three instances, hand-made from the shapes in `import-mapping.md` and the research digests. Integration tests start it in-process on a free port.
- Dashboard: an "Import from Storyly" entry on each project card for admins only (hidden for content managers), opening `/projects/{projectId}/import`: token field (password-type), "Find apps", an app select, "Start import"; then a status panel that polls every 2 s while queued or running and shows the report row "Zones: <source> source / <imported> imported" and the notes; failure shows the job's error. Story 14 design system.
- `.env.example`: `IMPORT_TOKEN_KEY`, `STORYLY_API_URL`.
- Contract first; `_test` database; standard error body. The word "Storyly" appears only as the import source.

**Never:** Importing tale groups, tales, media, tags, statuses or user lists (later stories); progress percentages or history list (story 4); selecting what to import (story 9); calling the real Storyly API in tests; any write to Storyly.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Find apps | admin, valid fake token | 200 `[{id, name: "Demo shop"}]` | — |
| Bad token | wrong token | 400 `storyly_token_invalid`; no job | — |
| Start | admin, token, appId | 202 queued; worker runs it to `done`; 3 zones in the project; 3 import links; report zones 3/3/0 | — |
| Re-run | same app again | done; no new zones; report imported 3 (already linked) | — |
| Token removed | job finished (done or failed) | `token_ciphertext` is NULL | — |
| Source failure | fake server returns 500 or an unexpected shape for instances | job `failed` with a message; no partial secrets in it | — |
| Content manager | any import route | 403 `forbidden` | — |
| Not configured | no `IMPORT_TOKEN_KEY` | 503 `importer_not_configured` | API still starts |
| Crash recovery | a job left `running` at start | re-queued and finished | — |
| Dashboard | admin on Projects | "Import from Storyly" → token → app → start → status → report | API message in the form |

</intent-contract>

## Code Map

- `libs/server/` -- new `importer` library like `libs/server/targeting` (tag `type:server-module`, alias `@taleart/server-importer`): migration, jobs, links, crypto, Storyly client, worker loop (exported start/stop functions the API calls).
- `libs/server/zones/src/index.ts` -- `createZone`; use it, do not write `zones` directly.
- `libs/server/access` -- `TransactionalDb`, token helpers pattern (`tokens.ts`).
- `apps/api/src/db.ts`, `main.ts`, `app.ts` -- migration list (importer last), start the worker after migrations and stop it on shutdown; mount routes.
- `apps/api/src/http/authorize.ts` -- `requireAdmin`, `authorizeParam`.
- `apps/api/src/app.spec.ts` -- tests; set `IMPORT_TOKEN_KEY` and `STORYLY_API_URL` to the in-process fake; truncate the new tables.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- paths, `ImportJob`, `StorylyApp`, codes `storyly_token_invalid`, `importer_not_configured`; regenerate.
- `apps/dashboard/src/app/` -- `pages/projects.ts` (card actions, admin-only pattern from story 13), routes, a new `pages/import.ts`, `dashboard.store.ts` or a small import service.
- `_bmad-output/initiative-taleart/research-storyly-competitive-teardown/digests/` -- field names for fixtures (read only).

## Tasks & Acceptance

**Execution:**
- [x] `libs/server/importer/` -- tables, crypto, client, worker, links, report; unit tests -- AD-1, AD-4, AD-7, AD-8.
- [x] `apps/fake-storyly/` -- fake server, fixtures, serve target.
- [x] `libs/contract/` -- paths, schemas, codes; regenerate -- AD-3.
- [x] `apps/api/src/` -- routes, worker wiring, env config; tests for every matrix row.
- [x] `apps/dashboard/src/app/` -- import page and project card entry; component tests.
- [x] `.env.example`, `tsconfig.base.json` alias.

**Acceptance Criteria:**
- Given the dashboard pointed at the fake Storyly server, when an admin pastes the test token, picks "Demo shop" and starts, then the page shows running, then done, the report reads Zones 3 source / 3 imported, and the three zones appear on the Zones page.
- Given a wrong token, when the admin presses "Find apps", then an error shows and no job exists.
- Given a finished job, when its row is read, then the stored token is gone.

## Implementation Notes

- Storyly paths are assumed from the digests' naming (`GET /app`, `GET /instance?app_id=`), and a list response may be a bare array or `{data: [...]}`. Each record needs an `id` (number or string) and a string `title`. Story 3's real run confirms or corrects these assumptions.
- Added error code `storyly_unavailable` (502), which the plan did not list. It covers Storyly being unreachable, answering a non-2xx status other than 401/403, or answering an unexpected shape when "Find apps" calls it. The plan's two codes did not cover these cases.
- `POST /imports` does not call Storyly; this keeps the request instant (AD-8). The worker reads the app list, and `source_app_name` stays nullable until the worker reads it. A token that cannot read the app fails the job with a message.
- Import routes check in this order: `requireAdmin` (403), project access (403), configured importer (503), project exists (404), body (400). An unknown import id answers 404 `not_found`.
- `POST /imports` wakes the worker, so a job starts at once rather than at the next 2 s poll. The worker polls every 2 s when idle. It stops on SIGINT/SIGTERM after finishing the job in progress.
- A DB CHECK constraint enforces "token only while queued or running": `status IN ('queued','running') OR token_ciphertext IS NULL`.
- The API integration tests load the fake server with a runtime `import()` of `apps/fake-storyly/src/fake-storyly.mjs` by path. A static import of another app would break the module-boundary lint. Tests switch failure modes through `control.failInstances`.
- Review fixes:
  - **Claim ownership:** jobs carry `locked_by`, `heartbeat_at` and `attempts`. The runner refreshes its heartbeat every 15 s and before each instance. On every poll, running jobs with no heartbeat for 2 min are re-queued; a job that has already been claimed 3 times fails instead and its token is cleared. Writes to a job only apply when its id, `status='running'` and `locked_by` match.
  - **Duplicate-safe imports:** each instance takes a `pg_advisory_xact_lock` on its source key, and links are inserted with `ON CONFLICT DO NOTHING`. A link whose zone was deleted is not re-pointed; that instance counts as skipped, with a note.
  - **Failure handling:** if recording a failure itself fails, the error is logged and the stale-job recovery picks the job up later. Unknown errors are logged with the token removed from their message and stack.
  - **Shutdown:** the HTTP server closes first, then the worker gets a 20 s deadline to finish.
- `ShellData.create` and `createLabel` are now optional, so the import page shows no "New …" button.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer fake-storyly` -- expected: all succeed.

**Manual checks (if no CLI):**
- The parent session runs an import against the fake server on the dev servers and screenshots the import page with the report.
