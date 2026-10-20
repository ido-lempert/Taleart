---
title: 'Show one tale group in several zones'
type: 'feature'
ticket: '15'
created: '2026-10-20'
status: 'built'
baseline_revision: 'be909804f298c3c5692c0035cfc0e10b72384f41'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A tale group belongs to one zone (`tale_groups.zone_id`, `position`), so the same content cannot run in two zones, and a change must be made twice. The user decided (2026-10-20, AD-14): a tale group belongs to its project; zones place groups, each zone with its own order; edits show everywhere.

**Approach:** The tales module adds zone placements (zone, tale group, project, position) and migrates every existing group to one placement in its old zone at its old position. Everything that reads "a zone's groups" (zone page, reordering, Delivery API) reads placements. The dashboard adds "Add to zone…", "Remove from this zone", an "Also in: …" line, and a project-level tale groups list.

## Boundaries & Constraints

**Always:**
- Table `zone_tale_groups (zone_id, tale_group_id, project_id, position, created_at)`, primary key `(zone_id, tale_group_id)`, composite foreign keys `(zone_id, project_id) → zones (id, project_id)` and `(tale_group_id, project_id) → tale_groups (id, project_id)` so a placement can never cross projects (AD-4).
- Migration is idempotent and runs on start like the others: create the table, copy `(zone_id, id, project_id, position)` from `tale_groups` for groups not yet placed, then drop `tale_groups.zone_id` and `tale_groups.position` (and their index). Existing data keeps its zone and order; verify against the test database and against a copy of rows made by stories 1.3–1.5.
- Creating a tale group in a zone (existing route) creates the group in the zone's project and one placement at the end of that zone. Reordering a zone (story 1.4's route and lock) rewrites placement positions for that zone only.
- `TaleGroup` in the contract loses `zoneId`/`position` as group fields; zone lists return each group with its `position` in that zone and `zoneIds` (every zone it is placed in). Contract first; regenerate.
- New routes, all authorized with story 13's helper:
  - `PUT /api/v1/zones/{zoneId}/tale-groups/{taleGroupId}` — place an existing group of the same project at the end of the zone; 201 the placed group; already placed → 200 unchanged; other project → 400 `tale_group_not_found`.
  - `DELETE /api/v1/zones/{zoneId}/tale-groups/{taleGroupId}` — remove that placement only; 204; not placed → 404 `tale_group_not_found`. Positions of the remaining placements stay dense (0..n-1).
  - `GET /api/v1/projects/{projectId}/tale-groups` — every group of the project with tales count and `zoneIds`, by name.
- Tags, tales, media and covers stay on the group, so they show in every zone.
- The Delivery API zone response lists the groups placed in the zone, in that zone's order (AD-2 as amended).
- Dashboard (story 14 design system): on each tale-group row in a zone, a menu or buttons for "Add to zone…" (drawer listing the project's other zones not yet holding the group) and "Remove from this zone" (confirm in a drawer; say the group stays in the project); an "Also in: Home page, Product page" line when placed elsewhere (zone names link to those zones); a "Tale groups" page in the rail listing the project's groups with their zones, including groups placed in no zone, each with "Add to zone…".
- `_test` database only; standard error body.

**Never:** Copying groups (story 16), moving groups across projects, per-zone overrides of group content, deleting groups or tales.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Migration | groups A (pos 0), B (pos 1) in zone Z before the change | after start: Z lists A, B; tables have no `zone_id`/`position` on `tale_groups` | runs twice without change |
| Place | `PUT /zones/Z2/tale-groups/A` | 201; Z2 lists A last; A's `zoneIds` = [Z, Z2] | other project → 400; unknown zone → 404 |
| Place again | same request | 200, no duplicate | — |
| Shared edit | add a tale to A via Z | Z and Z2 both list the tale; Delivery for Z2 includes it | — |
| Own order | reorder Z | Z2's order unchanged | — |
| Remove | `DELETE /zones/Z/tale-groups/A` | 204; Z no longer lists A; Z2 does; Z positions dense | not placed → 404 |
| Orphan | remove from every zone | group still in `GET /projects/P/tale-groups` with `zoneIds: []` | — |
| Access | content manager of another project | 403 `forbidden` on every new route | — |
| Dashboard | zone page group row | "Add to zone…", "Remove from this zone", "Also in: …"; rail "Tale groups" page | API message in the drawer |

</intent-contract>

## Code Map

- `libs/server/tales/src/lib/migration.ts`, `tales.ts` -- `tale_groups (zone_id, position)`, `createTaleGroup` (zone advisory lock), `orderTaleGroups` (zone lock, full-list check), `listTaleGroups`, `listDeliveryTaleGroups`, `getTaleGroup`, `taleGroupProjectId`; switch zone reads/writes to placements; keep the zone advisory lock for create, place, remove and order.
- `libs/server/targeting` -- tags on groups; unaffected except where it joins through `zone_id` (check).
- `apps/api/src/http/tale-groups.router.ts`, `delivery.router.ts`, `authorize.ts` -- routes and composition of tags into groups.
- `apps/api/src/app.spec.ts` -- all existing tale-group, order, tag and delivery tests must keep passing after the model change; add tests for every matrix row, including a migration test that builds the old schema, inserts rows, runs the migration and checks placements.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- `TaleGroup`, new paths and schemas; regenerate.
- `apps/dashboard/src/app/` -- `dashboard.store.ts` (zone groups, order queue from story 1.4), `pages/zone-detail.*`, `create-drawer.*`, `app.routes.ts`, `app.html` (rail), a new `pages/tale-groups.ts`.
- The importer epic's story 2 will create groups with one placement; nothing to do here.

## Tasks & Acceptance

**Execution:**
- [ ] `libs/server/tales/` -- placements table, migration, place, remove, project list; zone reads, create and order on placements; unit tests -- AD-4, AD-14.
- [ ] `libs/contract/` -- schemas and paths; regenerate -- AD-3.
- [ ] `apps/api/src/` -- new routes, delivery through placements, error mapping; tests for every matrix row, migration test.
- [ ] `apps/dashboard/src/app/` -- group actions, "Also in", Tale groups page; component tests.

**Acceptance Criteria:**
- Given a group in zone Z, when the user adds it to zone Z2 in the dashboard, then Z2 shows it and it shows "Also in: Z"; renaming it or adding a tale in one zone shows in both after a reload.
- Given groups made before this change, when the API starts, then they sit in their old zone at their old position.
- Given the group is removed from every zone, when the user opens the Tale groups page, then the group is still listed with no zones.

## Implementation Notes

## Plan Change Log

- 2026-10-20, review: the ticket's verify and AC 1 rename a group, but no rename existed. Added `PATCH /api/v1/tale-groups/{taleGroupId} {name}` and a "Rename" action on the zone page, so a rename in one zone shows in every zone. KEEP: placements, migration and locking as built.

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 3 findings — high 0, medium 1, low 2, false 0, maybe-false 0
- findings:
  - `[medium]` `[patch]` AC 1 renames a group but no rename existed — fixed: `PATCH /tale-groups/{id}`, tales `renameTaleGroup`, "Rename" drawer; API and component tests (rename shows in both zones and in Delivery).
  - `[low]` `[patch]` "Add to zone…" showed when the group was already in every zone and could only fail — fixed: hidden, "In every zone" shown, as on the Tale groups page.
  - `[low]` `[reject]` A picked zone could carry over if a second drawer opened over the first — drawers close before another opens and on navigation; same pattern as the tags drawer.

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting web-sdk sdk-sample` -- expected: all succeed.

**Manual checks (if no CLI):**
- The parent session places one group in two zones on the dev servers and screenshots both zone pages and the Tale groups page.

## Auto Run Result

**Summary:** Tale groups belong to their project; zones place them through `zone_tale_groups` with their own order (AD-14). Existing groups migrated to one placement in their old zone at their old position. Zone lists, create, reorder and the Delivery API read placements. New routes place, remove and rename groups and list a project's groups; the dashboard adds "Add to zone…", "Remove from this zone", "Rename", "Also in: …" and a "Tale groups" page.

**Files changed:**
- `libs/server/tales/` — placements table and migration, place, remove, rename, project list; zone reads and order on placements; tests.
- `libs/contract/` — `TaleGroup.zoneIds`, `ZoneTaleGroup`, `ProjectTaleGroup`, new paths; regenerated.
- `apps/api/src/` — routes, Delivery through placements, CORS PATCH; tests including a migration test.
- `apps/dashboard/src/app/` — group actions and drawers, "Also in", Tale groups page and rail item; tests.

**Review:** 2 patches applied (1 medium, 1 low), 0 deferred, 1 rejected (low: stale picked zone across drawers).

**Follow-up review recommended:** false. One medium and no high were patched.

**Verification:** `nx run-many -t lint test build` for ten projects passed before and after the patches (api 156, server-tales 35, dashboard 73 tests). The migration was run twice on a copy of the dev database: the existing group stayed in its zone at position 0. In Chromium against `taleart_e2e_test`, "Summer sale" was added to a second zone and showed "Also in: Home page"; screenshots were sent to the user.

**Residual risks:**
- A saved tale order reaches the group's other zones once the API confirms it; a zone with its own pending order requests shows the new tales in its pending view.
