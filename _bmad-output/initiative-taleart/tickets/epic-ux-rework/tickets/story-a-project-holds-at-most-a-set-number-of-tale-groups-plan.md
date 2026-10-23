---
title: 'A project holds at most a set number of tale groups'
type: 'feature'
ticket: '22'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-zones-list-and-tale-groups-page-show-status-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-another tool-importer/tickets/story-import-tale-groups-and-tales-in-source-order-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A project can hold any number of tale groups; since 8.14 a group can be created in no zone, which makes unbounded growth easy (follow-up from 8.14, R14).

**Approach:** A contract constant `MAX_TALE_GROUPS_PER_PROJECT = 500` and a 409 `tale_group_limit_reached` error. The tales module checks the project's group count under a per-project advisory lock in each of its three group inserts (create in a zone, create in no zone, copy into a zone); the importer and the dashboard read the refusal.

## Boundaries & Constraints

**Always:**
- Archived groups do not count (coordinator's decision at review; the owner may change it): the cap is on groups that are not archived. Archiving frees a place; restoring takes one, so a restore is checked under the same lock. The messages say so.
- One lock, `pg_advisory_xact_lock(hashtextextended('project_tale_groups:' || projectId, 0))`, taken first in the transaction: project → zone → source group (row, tales, fonts) / link on creates and copies; project → group row on a status change to anything but archived.
- Refused creates write nothing (no group, no placement, no link, no tags).
- Copy counts against the target zone's project.
- The importer skips a new group it cannot create, with a report note, and goes on; groups it already imported (found by link) update as before.
- Dashboard: the API refusal shows in the create and copy drawers as a plain message; no other dashboard change (8.19 owns the Tale groups page).

**Never:** a configurable cap per project; disabling buttons at the cap; changing what Archive does.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Under the cap | 499 groups | create, project create or copy succeeds (500) | — |
| At the cap | 500 groups not archived (plus archived ones) | each path refused | 409 `tale_group_limit_reached`, nothing created |
| Archive at the cap | archive one group | a create succeeds again | — |
| Restore at the cap | restore an archived group | refused, stays archived | 409 `tale_group_limit_reached`, restore message |
| Concurrent creates | 498 groups, 10 creates at once over the three paths | exactly 2 succeed; count 500 | the others 409 |
| Import at the cap | 496 groups, import of 6 new | 4 imported, 2 skipped, a note each, job done | note `Tale group "<name>": the project already has 500 tale groups that are not archived` |
| Re-import at the cap | the 4 imported groups exist | updated; the 2 still skipped with the note | — |
| Dashboard | create or copy refused | drawer shows the server's message | client wording only if the message is missing |

</intent-contract>

## Code Map

- `libs/contract/src/lib/core.ts`, `openapi/openapi.yaml` -- constant, error code, 409 on the three routes.
- `libs/server/tales/src/lib/tales.ts` -- `TaleGroupLimitError`, `lockProjectGroups` + count in `createTaleGroup`, `createProjectTaleGroup`, `copyTaleGroup`.
- `apps/api/src/http/errors.ts` -- 409.
- `libs/server/importer/src/lib/worker.ts` -- skip with a note.
- `apps/dashboard/src/app/dashboard.store.ts` -- message for the refusal on create and copy.

## Tasks & Acceptance

**Execution:**
- [x] Contract constant, error code, OpenAPI.
- [x] Tales module check under the project lock; unit tests (lock first, count, refusal writes nothing).
- [x] API mapping; API tests per path at the cap, archived counted, concurrency.
- [x] Importer note; API import tests (first run and re-run at the cap).
- [x] Dashboard message; specs; screenshot.

**Acceptance Criteria:**
- Given a project at the cap, when New tale group (zone or project), Copy to zone or an import of a new group runs, then it is refused with the message and nothing is created.
- Given concurrent creates near the cap, then the project never holds more than the cap.

## Implementation Notes

- **Contract:** `MAX_TALE_GROUPS_PER_PROJECT = 500`, `ErrorCodes.taleGroupLimitReached` (`tale_group_limit_reached`, 409) on `POST /zones/{id}/tale-groups`, `POST /projects/{id}/tale-groups` and `POST /tale-groups/{id}/copy`; API message "A project holds at most 500 tale groups, archived ones included, and this one is full."
- **Where it is enforced:** the tales module's three group inserts, the only ones there are: `createTaleGroup` (dashboard create in a zone, and the importer's create), `createProjectTaleGroup` (create in no zone; it now runs in a transaction) and `copyTaleGroup` (counts against the target zone's project). There is no Duplicate of a group; the stage/frame migration copies placements, not groups. `TaleGroupLimitError` maps to 409 in `errors.ts`.
- **Lock:** `lockProjectGroups` takes `project_tale_groups:<projectId>` first in the transaction, then the zone lock, then (copy) the source row share lock or (importer) the link lock; the count runs under both. Nothing else takes it, so no existing lock order is crossed. The importer test that played "another import" holding the link lock then created its group through the API had to create that group before taking the link lock: a real import creates under the project lock first, so the order the test used cannot occur.
- **Archived groups count.** No group is ever deleted, so the cap is a total over the project's life: archiving frees no place and restoring is never refused. The dashboard says so.
- **Importer:** a new group the project cannot take is skipped with the note `Tale group "<name>": the project already holds 500 tale groups` (its stories counted skipped); the job goes on and ends `done`; groups found by link update as before, so a re-import at the cap updates what it brought and notes the rest again.
- **Dashboard:** `dashboard.store.ts` maps the code to "<Project> already has 500 tale groups, the most a project can hold. Archived tale groups count too, so archiving one does not make room." in New tale group (zone and no zone) and Copy to zone (naming the target project). No other dashboard change.
- **Tests:** tales unit (lock order, count before insert, refusal writes nothing and rolls back, copy counts the target project), importer unit (skip with note, re-run), API on a real database: each path refused at the cap with half the fillers archived, copy between a full and a roomy project, last place then refused, restoring not refused, 12 concurrent creates over all paths from 498 give exactly 2 created (with the lock disabled the same test created 5 to 6), and the import report (first run and re-run). Dashboard specs for the three drawers. The cap is reached by inserting filler rows with SQL, not by injecting a smaller cap, so the tests exercise the real constant.

## Verification results

- `run-many -t lint test build` (15 projects, `--parallel=2`): all pass except `api:test` "auth > creates the admin, signs them in and stores only the token hash" (known Postgres clock skew).
- `api:import-scale`: pass.
- Browser (`shots-8.22/`, ports 3422/4422, own `_test` DB): 6 checks passed; the message in New tale group on the zone page, on the Tale groups page (no zone), and Copy to zone at 390 px with no horizontal scroll; still 500 groups after.

## Review fixes (2026-10-23)

- **Archived groups do not count** (supersedes the note above that they count; the owner may revisit). `checkGroupLimit` counts `status <> 'archived'`. `setTaleGroupStatus` to anything but `archived` reads the group's project, takes `lockProjectGroups`, then the row's `FOR UPDATE`; from `archived` it checks the cap (`TaleGroupLimitError` with reason `restore`). Archiving takes no project lock.
- **Messages** (API, shown as is by the dashboard): create "This project already has 500 tale groups that are not archived, the most it can hold. Archive a tale group to make room."; copy "The project of that zone already has … Archive a tale group there to make room."; restore "This project already has … Restoring a tale group needs a free place: archive another tale group first." Importer note: `Tale group "<name>": the project already has 500 tale groups that are not archived`.
- **Dashboard** shows the server's message (`taleGroupCreateMessage`); the client constant is only the wording when the 409 carries no message. The project-name lookup is gone.
- **Importer race:** `importLinked` re-reads the link on `TaleGroupLimitError`; when another import linked the same record meanwhile (taking the last place), it uses that record instead of skipping.
- **Index:** `tale_groups_project_id_idx ON tale_groups (project_id)` in `migrateTales` (forward only).
- **Tests added:** restore refused at the cap and stays archived, archiving frees a place, restore allowed after archiving another; a concurrent mix of creates, copies and restores (3 places, 15 requests: exactly 3 succeed; with the lock disabled 8 did); an import racing dashboard creates for the last 5 places (never over the cap, imported + created = 5); the importer link re-read on the limit (unit); the project lock first in a copy, before the zone lock, the source row and tales share locks and the font locks (unit); restore lock order and count (unit). The import race test also passes with the lock disabled (the import's creates are sequential and the timing rarely overlaps); it guards the invariant, the 15-request test proves the lock.
- **Reordered test's comment** (`rolls back a tale group another import linked first`) now says the case it once covered is theoretical.

## Plan Change Log

- Review 1: archived groups no longer count (Boundaries, I/O matrix amended); restore checked under the project lock; server message shown by the dashboard. Avoids a cap that archiving cannot relieve. KEEP: lock taken first in every transaction that adds to the count.

## Review Triage Log

- Review 1 (coordinator): no deadlock or bypass found. 6 items, all patched: archived decision (1), importer limit race (2), project_id index (3), test comment (4), concurrency and lock-order tests (5), server message in the dashboard (6).

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard docs contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool dashboard-e2e --parallel=2` -- pass (except the known auth clock test).
- `node_modules/.bin/nx run api:import-scale` -- pass.

**Manual checks:**
- Screenshot of the dashboard message at the cap (`shots-8.22/`).
