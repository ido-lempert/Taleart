---
title: 'Create a tale group in a zone and add tales to it'
type: 'feature'
ticket: '3'
created: '2026-10-20'
status: 'built'
baseline_revision: 'cf0bbc9ef8d1f0d6c7154d419c7a49f90d7c25bf'
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

**Problem:** A zone has frames but no content. Tales exist only inside tale groups (PRD FR-010, user decision 2026-10-20), and there is no tales module yet.

**Approach:** Add a `tales` server module that owns `tale_groups` and `tales`. A user creates a tale group in a zone and adds titled tales to it from the dashboard; both copy the zone's project (AD-4) and keep the order they were added in.

## Boundaries & Constraints

**Always:** A tale group belongs to one zone and carries that zone's `project_id NOT NULL`; a tale belongs to one tale group and carries its project. Composite foreign keys make a mismatched project impossible, as `frames` does. Each group and tale stores an integer `position` (next after the current maximum within its parent), and lists are ordered by it. A tale group holds at most 100 tales (FR-010). Module rules from story 11: the tales module owns its tables and migration, reaches zones only through `@taleart/server-zones`'s `index.ts`, and is tagged `type:server-module`. Contract first: paths, schemas and error codes go into `openapi.yaml` and are regenerated. Standard error body. Tests only against `taleart_test`.

**Never:** Media, upload or storage (story 12). Reordering or moving (story 4). Status keys, schedules, tags, or linking tale groups to frames. Editing or deleting groups or tales. Changing existing frame or zone behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create group | `POST /api/v1/zones/{zoneId}/tale-groups {name}` | 201 `{id, zoneId, projectId, name, position, tales: []}` | — |
| List groups | `GET /api/v1/zones/{zoneId}/tale-groups` | 200, groups by position, each with its `tales` by position | — |
| Add tale | `POST /api/v1/tale-groups/{taleGroupId}/tales {title}` | 201 `{id, taleGroupId, projectId, title, position}` | — |
| Order kept | two tales added A then B | listed A, B, also after an API restart | — |
| Unknown zone | zone id missing or not a UUID | 404 | `zone_not_found` |
| Unknown group | group id missing or not a UUID | 404 | `tale_group_not_found` |
| Blank name or title | missing or whitespace | 400 | `validation_failed`, message names the field |
| Full group | 100 tales present, add one more | 409 | `tale_group_full` |

</intent-contract>

## Code Map

- `libs/server/zones/src/lib/frames.ts` -- private `zoneProjectId(db, zoneId)` (UUID check, null when missing); export it from `libs/server/zones/src/index.ts` as the way other modules read a zone's project. Do not change frame behavior.
- `libs/server/zones/src/lib/migration.ts` -- pattern to copy: `CREATE TABLE IF NOT EXISTS`, unique `(id, project_id)` index backing a composite FK. Reuse `zones_id_project_id_key` as the FK target for `tale_groups`.
- `libs/server/access` -- exports `Db`; reuse it.
- `apps/api/src/db.ts` -- `migrations` list; add `tales` after `zones`.
- `apps/api/src/http/zones.router.ts` -- route and error pattern (resource check first, then body). Tale-group routes under a zone go here or in a new `tale-groups.router.ts`; tale routes in `tale-groups.router.ts` mounted at `/tale-groups` in `apps/api/src/app.ts`.
- `apps/api/src/http/errors.ts` -- map the new module errors (404, 409).
- `apps/api/src/http/validation.ts` -- `requiredString`.
- `libs/contract/openapi/openapi.yaml`, `libs/contract/src/index.ts` -- add `TaleGroup`, `Tale`, request schemas, codes `tale_group_not_found`, `tale_group_full`; regenerate with `npm exec nx -- run contract:generate`; add to `ErrorCodes`.
- `tsconfig.base.json`, `eslint.config.mjs` -- alias `@taleart/server-tales`; existing tag rules already cover a new `type:server-module`.
- `apps/api/src/app.spec.ts` -- integration tests against `taleart_test`; truncate the new tables in its setup.
- `apps/dashboard/src/app/app.ts`, `app.html`, `app.spec.ts` -- per-zone frame picker pattern from story 6; add tale groups under each zone the same way.

## Tasks & Acceptance

**Execution:**
- [x] `libs/server/tales/` -- generate an Nx library like `libs/server/zones` (tsc, vitest, tag `type:server-module`, `package.json` deps); migration, `createTaleGroup`, `listTaleGroups` (with tales), `createTale`, errors `TaleGroupNotFoundError`, `TaleGroupFullError`; unit tests -- AD-1, AD-4.
- [x] `libs/server/zones/src/` -- export the zone-project lookup -- module boundary.
- [x] `libs/contract/` -- paths, schemas, codes; regenerate -- AD-3.
- [x] `apps/api/src/` -- migration order, routers, error mapping.
- [x] `apps/api/src/app.spec.ts` -- one test per matrix row, including the restart row.
- [x] `apps/dashboard/src/app/` -- under each zone: tale groups listed with their tales, a form to add a group, a form per group to add a tale, the API's error message shown; component tests.

**Acceptance Criteria:**
- Given a zone in the dashboard, when the user creates a tale group and adds tales A then B, then after a page reload the group lists A then B.
- Given the API refuses a request, when the dashboard sent it, then the API's error message is shown next to the form.
- Given a file in `libs/server/tales` that imports a zones file other than its `index.ts`, when lint runs, then it fails.

## Implementation Notes

- `libs/server/tales` was created by copying `libs/server/zones`'s config (project.json, tsconfigs, vitest, eslint, package.json); no npm workspaces, so the alias lives in `tsconfig.base.json` only.
- `createTaleGroup` and `createTale` take a `TransactionalDb` (anything with `query` and `connect()`, such as a pg `Pool`), because the shared `Db` type cannot open a transaction.
- Tale groups are listed with their tales in two queries (groups, then tales `= ANY(ids)`), ordered by `position, id`.
- `MAX_TALES_PER_GROUP = 100` lives in `libs/contract`.
- Dashboard errors for the new forms are per form (`role="alert"` inside the form, linked by `aria-describedby`); the existing global alert is unchanged. Inputs bind `[attr.name]` as well as `[name]`, since `[name]` on an `ngModel` input sets only the directive input.
- Dashboard specs wait with `whenStable()` plus one macrotask, since `refresh()` now chains more awaits than `whenStable()` tracks.

## Plan Change Log

- Tale-group creation serializes on the zone with `pg_advisory_xact_lock(hashtextextended('tale_groups:' || zoneId, 0))` instead of `SELECT ... FOR UPDATE` on `zones`, because the zones table belongs to the zones module (AD-1). Tale creation does lock the parent `tale_groups` row with `FOR UPDATE`, as planned.
- Added a root `no-restricted-imports` rule banning `@taleart/*/**` deep imports: `@nx/enforce-module-boundaries` already fails a relative path into zones, but did not fail `@taleart/server-zones/src/lib/...`, so the third acceptance criterion needed it.

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 5 findings — high 0, medium 0, low 5, false 0, maybe-false 0
- findings:
  - `[low]` `[reject]` The 100-tale limit is written in both `openapi.yaml` (`maxItems`) and `MAX_TALES_PER_GROUP` in the contract index — real, but the limit comes from the PRD and rarely changes; deriving the constant from the document would add generator code.
  - `[low]` `[patch]` Nothing showed AC3 (deep import fails lint) — fixed by demonstration: a temporary `libs/server/tales/src/lib/deep.ts` importing `@taleart/server-zones/src/lib/frames` made `nx lint server-tales` fail with `no-restricted-imports`; the file was removed.
  - `[low]` `[patch]` New inputs pointed `aria-describedby` at an error element that exists only while an error shows — fixed: the attribute is bound only while that error exists.
  - `[low]` `[patch]` The fallback messages for a failure with no error body told the user to fix their input — fixed: "Tale group was not saved. Try again." and "Tale was not saved. Try again."
  - `[low]` `[reject]` The parent is looked up twice per POST (router check, then module) — negligible cost, matches the frames route; removing it changes the 404-before-400 order.

## Design Notes

A tale group is owned by its zone (the story says "in a zone"); the architecture's frame-to-tale-group display link is a later join table and is not built here. `position` is stored now so story 4 can reorder without a migration. Insert position as `COALESCE(MAX(position), -1) + 1` inside a transaction that locks the parent row (`SELECT ... FOR UPDATE`), which also makes the 100-tale check safe under concurrent adds.

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales` -- expected: all succeed.
- `npm exec nx -- test api --output-style=static` -- expected: every matrix row has a passing test.

## Auto Run Result

**Summary:** A new `tales` module owns `tale_groups` and `tales`. In the dashboard a user creates a tale group in a zone and adds titled tales to it; both copy the zone's project through composite foreign keys (AD-4) and keep the order they were added in (`position`). A group holds at most 100 tales (409 `tale_group_full`).

**Files changed:**
- `libs/server/tales/` — new module: migration, list, create group, create tale, errors, unit tests.
- `libs/server/zones/src/` — exports `zoneProjectId`.
- `libs/contract/` — tale-group and tale paths, schemas, two error codes, `MAX_TALES_PER_GROUP`; types regenerated.
- `apps/api/src/` — tales migration after zones, `tale-groups.router.ts`, error mapping, integration tests.
- `apps/dashboard/src/app/` — tale groups and tales under each zone, add forms, API messages, component tests.
- `eslint.config.mjs`, `tsconfig.base.json` — ban deep `@taleart/*/**` imports; `@taleart/server-tales` alias.

**Review:** 3 patches applied (all low), 0 deferred, 2 rejected (low: duplicated limit constant, rare to change; double parent lookup, negligible and keeps the error order).

**Follow-up review recommended:** false. No high or medium findings were patched.

**Verification:** `nx run-many -t lint test build` for api, dashboard, contract, server-access, server-zones and server-tales passed before and after the patches (api 39, server-tales 7, server-zones 10, contract 2, server-access 2, dashboard 7 tests). Clicked through via a screenshot of the running dashboard with a tale group and two tales.

**Residual risks:**
- Group creation is serialized with an advisory lock keyed on the zone id, since the tales module may not lock the zones table (AD-1).
- Dashboard specs wait one extra timer tick after `whenStable()`.
