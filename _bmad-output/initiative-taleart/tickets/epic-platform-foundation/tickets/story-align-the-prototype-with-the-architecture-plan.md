---
title: 'Align the prototype with the architecture'
type: 'refactor'
ticket: '11'
created: '2026-10-20'
status: 'built'
baseline_revision: '10495ef4285f4685e88cbf7bb5ff4142ab3faa73'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The story 1 prototype serves projects and zones at `/api/...` from one file, returns `{ error: "text" }`, and has no shared contract or module boundaries, so it breaks AD-1, AD-3 and the error convention in the architecture spine.

**Approach:** Move the same project and zone behavior behind `/api/v1`, into two domain modules (`access` for projects, `zones` for zones) under `libs/server`, add `libs/contract` with an OpenAPI 3.1 document and generated TypeScript types, enforce the dependency direction with Nx tags, and return the spine's error body. The dashboard flow from story 1 keeps working.

## Boundaries & Constraints

**Always:** Each module owns its table and its migration; another module reaches it only through the module's `index.ts`. Primary keys stay database-generated UUIDs. Every zone keeps `project_id NOT NULL`. Error body is `{ "error": { "code", "message" } }`. API tests run only against a database whose name ends in `_test`. Use the terminology map names.

**Never:** Add sessions, zone keys, tales or the Delivery API (later stories). Change the dashboard beyond its API base path and error handling. Drop or rename existing table columns. Push or touch `main`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create project | `POST /api/v1/projects {name}` | 201 `{id, name}` | — |
| Create zone | `POST /api/v1/zones {name, projectId}` with an existing project | 201 `{id, name, projectId}` | — |
| Zone without project | `POST /api/v1/zones {name}` | 400 | `{error:{code:"validation_failed", message}}` |
| Zone with unknown project | `projectId` not in `projects` | 400 | `{error:{code:"project_not_found", message}}` |
| Missing name | project or zone without `name` | 400 | `{error:{code:"validation_failed", message}}` |
| Old path | `GET /api/projects` | 404 | standard error body, `code:"not_found"` |
| Restart | data created, API restarted | lists return the same rows | — |

</intent-contract>

## Code Map

- `apps/api/src/app.ts` -- current Express app with all routes; becomes thin wiring of module routers under `/api/v1` plus the error middleware.
- `apps/api/src/db.ts` -- pool creation and a single `migrate()`; becomes a migration runner that calls each module's migration in order (access, then zones).
- `apps/api/src/main.ts` -- startup; keep its shape, call the runner.
- `apps/api/src/app.spec.ts` -- integration tests against `taleart_test` with a `_test` guard; reuse the guard and restart test, update paths and error assertions.
- `apps/dashboard/src/app/app.ts` -- `API_BASE` is `http://localhost:3333/api`; change to `/api/v1`, read `error.message` from the new body.
- `apps/dashboard/src/app/app.spec.ts` -- uses `API_BASE`; keep passing.
- `tsconfig.base.json` -- `paths` holds `@taleart/web-sdk`; add `@taleart/contract`, `@taleart/server-access`, `@taleart/server-zones`.
- `eslint.config.mjs` -- `@nx/enforce-module-boundaries` with a single `*` constraint; replace with tag rules.
- `apps/api/project.json` tags `type:app, scope:api`; `apps/dashboard/project.json` tags empty; `libs/web-sdk` tags `type:sdk, platform:web`.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- create an Nx library: `openapi/openapi.yaml` (OpenAPI 3.1: health, projects list/create, zones list/create, the error schema), types generated with `openapi-typescript` 7.x into `src/generated/api.ts`, an npm script or Nx target to regenerate, `src/index.ts` exporting the types and error codes -- AD-3 source of truth.
- [x] `libs/server/access/` -- Nx library owning the `projects` table: migration, create and list functions, typed with contract types, exported from `src/index.ts` -- AD-1.
- [x] `libs/server/zones/` -- Nx library owning the `zones` table: migration, create and list; checks the project exists through `@taleart/server-access` -- AD-1, AD-4.
- [x] `apps/api/src/` -- wire module routers under `/api/v1`, migration runner, standard error middleware and a 404 handler with the standard body -- spine conventions.
- [x] `tsconfig.base.json`, project tags, `eslint.config.mjs` -- aliases and depConstraints: `scope:api` → `type:server-module`, `type:contract`; `type:server-module` → `type:server-module`, `type:contract`; `scope:dashboard` and `type:sdk` → `type:contract`; `type:contract` → none. Tag the dashboard `type:app, scope:dashboard` -- AD-1 diagram.
- [x] `apps/dashboard/src/app/app.ts` -- base path `/api/v1`, show `error.message` when present.
- [x] `apps/api/src/app.spec.ts` -- cover every I/O matrix row against `taleart_test`.

**Acceptance Criteria:**
- Given the API and dashboard are running, when a user creates a project and then a zone in the dashboard, then both appear in the lists and survive an API restart.
- Given a file in the dashboard imports `@taleart/server-zones`, when `nx lint dashboard` runs, then it fails on module boundaries.
- Given `libs/contract/openapi/openapi.yaml` changes, when the generate target runs, then `src/generated/api.ts` is rewritten from it.

## Implementation Notes

- Libraries generated with `@nx/js:library` (tsc bundler, vitest). `openapi-typescript` 7.13.0 added as a dev dependency; regenerate with `npm exec nx -- run contract:generate` (runs with `--enum-values`, so `ERROR_CODES` comes from the document).
- HTTP routers, input validation and the error/404 middleware live in `apps/api/src/http/` (HTTP adapters belong to `apps/api` per the spine); modules expose plain functions taking a `Db` (pool or client).
- Zones signals an unknown project with `ProjectNotFoundError` (code `project_not_found`); a `projectId` that is not a UUID is treated as unknown instead of reaching Postgres.
- Malformed JSON bodies return 400 `validation_failed`; unhandled errors are logged as one JSON line and return 500 `internal_error`.
- The dashboard imports only `isErrorBody` from `@taleart/contract`; its local `Project`/`Zone` interfaces are unchanged.

## Plan Change Log

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 4 findings — high 0, medium 1, low 3, false 0, maybe-false 0
- findings:
  - `[low]` `[reject]` Body-parser rejections other than malformed JSON (413, 415, other 400s) become 500 `internal_error` — real, but the dashboard never sends oversized or non-UTF-8 bodies, and the fix adds a new branch and error codes; not worth it in everyday use.
  - `[low]` `[patch]` Logs go to stderr and the startup line is plain text, against "Structured JSON to stdout" — fixed: one-line JSON through `console.log` for the error handler, startup, startup failure and server error events.
  - `[low]` `[patch]` Prettier would rewrite the generated `api.ts`, so `contract:generate` would not reproduce the committed file — fixed: `libs/contract/src/generated/` added to `.prettierignore`.
  - `[medium]` `[patch]` Nothing forces regeneration, so committed types can drift from `openapi.yaml` (AD-3) — fixed: the contract's `build` and `test` depend on `generate`.

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones` -- expected: all succeed.
- `npm exec nx -- test api --output-style=static` -- expected: every I/O matrix row has a passing test.

**Manual checks (if no CLI):**
- Temporarily add `import '@taleart/server-zones';` to a dashboard file, run `npm exec nx -- lint dashboard`, confirm a boundary error, then remove it.

## Auto Run Result

**Summary:** Project and zone routes moved to `/api/v1`, behind two domain modules (`access`, `zones`) under `libs/server`, with `libs/contract` holding the OpenAPI 3.1 document and generated types. Nx tags enforce the AD-1 dependency direction. Errors use the standard body. The dashboard uses `/api/v1` and shows the API's error message.

**Files changed:**
- `libs/contract/` — OpenAPI 3.1 document, generated types, `generate` target, error codes and `isErrorBody`.
- `libs/server/access/` — owns `projects`: migration, create, list, exists check.
- `libs/server/zones/` — owns `zones`: migration, create (checks the project through access), list.
- `apps/api/src/app.ts`, `apps/api/src/http/*` — `/api/v1` routers, validation, 404 and error handlers.
- `apps/api/src/db.ts`, `apps/api/src/main.ts` — per-module migration runner; JSON logging.
- `apps/api/src/app.spec.ts` — 11 tests against `taleart_test`, one per matrix row plus health, non-UUID id, blank name, malformed body.
- `apps/dashboard/src/app/app.ts`, `apps/dashboard/project.json` — `/api/v1`, API error messages, tags.
- `eslint.config.mjs`, `tsconfig.base.json`, `nx.json`, `.prettierignore`, `package.json` — boundary rules, aliases, cache defaults, generated-file ignore, `openapi-typescript`.

**Review:** 3 patches applied (1 medium, 2 low), 0 deferred, 1 rejected (low: body-parser 4xx mapping, unlikely in everyday use, fix adds a branch).

**Follow-up review recommended:** false. One medium and no high were patched.

**Verification:** `nx run-many -t lint test build` for api, dashboard, contract, server-access and server-zones passed before and after the patches (api 11, contract 2, server-access 2, server-zones 1 tests; dashboard tests passed). The dashboard boundary violation was confirmed by the implementer to fail lint.

**Residual risks:**
- The dashboard was not clicked through in a browser; the user reviews that.
- `apps/api-e2e` still expects `GET /` to return `Hello API`; it was broken before this story and is untouched.
- Migrations are still `CREATE TABLE IF NOT EXISTS` with no record of which ran.
- The implementer's smoke test wrote a project and a zone to the development database and then deleted them.
