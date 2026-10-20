---
title: 'Copy a tale group to another zone'
type: 'feature'
ticket: '16'
created: '2026-10-20'
status: 'built'
baseline_revision: '13bf18a2e1b518be86248b97a694a14a58ae56b8'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-platform-foundation/tickets/story-show-one-tale-group-in-several-zones-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A team tests a tale group in a staging zone and then wants the same content in the production zone, possibly in another project, as an independent copy they can keep editing separately (user decision 2026-10-20, AD-14).

**Approach:** One API call copies a tale group, with its tales, media references and tags, into a target zone in the same project or another project the user can access. The dashboard adds "Copy to zone…" on each tale group.

## Boundaries & Constraints

**Always:**
- `POST /api/v1/tale-groups/{taleGroupId}/copy {zoneId}` → 201 the new group as placed in the target zone (`ZoneTaleGroup`). The caller needs access to the source group's project and to the target zone's project (story 13's helper on both); otherwise 403 `forbidden`; unknown group or zone → 404.
- The copy is a new tale group in the target zone's project, same name, placed at the end of the target zone; its tales are new rows with the same titles, positions, `media_key` and `media_content_type` (files are not duplicated). Tags: for each source tag, a tag with the same name (ignoring case) in the target project is reused, else created; the copy carries those tags. One transaction; the target zone's advisory lock as in story 15.
- Copy and source are independent afterwards: editing, reordering, re-tagging or re-uploading media on one never changes the other.
- Shared media files: replacing or removing a tale's media must not delete a file another tale still references (AD-14/AD-11 assumption). Change story 12's "delete the old file after replace" to delete only when no tale references the key any more.
- Dashboard (story 14 design system): "Copy to zone…" on each group row (zone page) and on the Tale groups page; drawer with a project select (projects the user can access, current one first) and a zone select for that project; success message names the target zone with a link. API message in the drawer.
- Contract first; `_test` database; standard error body.

**Never:** Copying zones, frames or keys; linked placement (story 15 does that); copying across projects the user cannot access; duplicating media files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same project | copy G (2 tales, tag "summer") into zone Z2 of the same project | 201; Z2 lists the copy last with 2 tales in order and tag "summer" (the same tag row) | — |
| Other project | copy into a zone of project B the user can access | 201; copy in B; tag "summer" created in B if missing, reused if present (any case) | — |
| Independent | rename or add a tale to the copy | source unchanged, and vice versa | — |
| Shared media | replace media on the copy's first tale | source tale still shows its media; old file kept while the source uses it | — |
| Last user of a file | replace media on a tale whose key no other tale uses | old file deleted as before | — |
| No access | target zone in a project the user cannot access | 403 `forbidden` | — |
| Unknown | group or zone missing | 404 `tale_group_not_found` / `zone_not_found` | — |
| Dashboard | "Copy to zone…" → project → zone → Copy | success message with a link to the target zone | API message in the drawer |

</intent-contract>

## Code Map

- `libs/server/tales/src/lib/tales.ts` -- placements, `createTaleGroup` lock pattern, tales insert, `setTaleMedia` (returns the previous key); add `copyTaleGroup` and a "is this media key still referenced" check.
- `apps/api/src/http/tales.router.ts` -- media PUT deletes the previous file after replace; make it conditional.
- `libs/server/targeting` -- tags and group tags; add a way to find-or-create tags by name in a project and set them on the copy (through its public interface; the API may compose: tales copies the group, targeting copies tags).
- `apps/api/src/http/tale-groups.router.ts`, `authorize.ts` -- route and access checks for source and target.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- path and request schema; regenerate.
- `apps/dashboard/src/app/` -- `pages/zone-detail.*`, `pages/tale-groups.ts`, `create-drawer.*`, `dashboard.store.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `libs/server/tales/`, `libs/server/targeting/` -- copy, tag find-or-create, media reference check; unit tests -- AD-14.
- [x] `apps/api/src/` -- copy route, conditional media delete; tests for every matrix row.
- [x] `libs/contract/` -- path and schema; regenerate.
- [x] `apps/dashboard/src/app/` -- "Copy to zone…" with project and zone selects; component tests.

**Acceptance Criteria:**
- Given a tale group in a staging zone, when the user copies it to the production zone, then the production zone shows an independent copy with the same tales and tags, and later edits to one leave the other unchanged.
- Given the target is in another project the user can access, when they copy into it, then the copy and its tags appear there.
- Given two tales share a media file, when one tale's media is replaced, then the other still shows its media.

## Implementation Notes

- `copyTaleGroup(db, {taleGroupId, zoneId}, withCopy?)` in the tales module copies the group and its tales in one transaction under the target zone's advisory lock and locks the source tales `FOR SHARE`, so a concurrent media replace sees the copy's tales. The API copies tags in the same transaction through the `withCopy` callback and targeting's `copyTaleGroupTags` (find-or-create by name, `ON CONFLICT DO NOTHING`).
- Media replace deletes the old file only when `isMediaKeyInUse` is false.
- Copying into the source's own zone is allowed and makes a second, independent group.

## Plan Change Log

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 2 findings — high 0, medium 0, low 2, false 0, maybe-false 0
- findings:
  - `[low]` `[reject]` The drawer lists the group's own project first, not the selected project — the zone page shows zones of the selected project, so the two are the same in practice; the group's project is the more precise choice.
  - `[low]` `[patch]` "Choose a zone." stayed after a zone was picked — fixed: picking a zone clears the error.
- Parent's own check in the browser: the success message "Copied Summer sale to Home page" was ambiguous when zone names repeat across projects — fixed: it names the project when the copy went to another one ("… to Home page in Acme production").

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting web-sdk sdk-sample` -- expected: all succeed.

**Manual checks (if no CLI):**
- The parent session copies a group between two projects on the dev servers and screenshots the drawer and the target zone.


## Auto Run Result

**Summary:** `POST /api/v1/tale-groups/{id}/copy {zoneId}` copies a tale group with its tales (media files shared, not duplicated) and tags (matched by name, created if missing) into a zone of the same or another accessible project, as an independent group placed last. Replacing media no longer deletes a file another tale still uses. The dashboard adds "Copy to zone…" with project and zone selects on the zone page and the Tale groups page.

**Files changed:**
- `libs/server/tales/` — `copyTaleGroup`, `isMediaKeyInUse`; tests.
- `libs/server/targeting/` — `copyTaleGroupTags`; tests.
- `libs/contract/` — copy path and request; regenerated.
- `apps/api/src/` — copy route with access checks on source and target; conditional media delete; tests.
- `apps/dashboard/src/app/` — Copy to zone drawer and buttons; tests.

**Review:** 1 patch applied (low) plus one from the parent's browser check, 0 deferred, 1 rejected (low: project order in the drawer).

**Follow-up review recommended:** false.

**Verification:** `nx run-many -t lint test build` for ten projects passed (api 163, server-tales 40, server-targeting 14, dashboard 76 tests). In Chromium against `taleart_e2e_test`: "Summer sale" (3 tales, tag "summer") in "Acme staging" was copied to "Home page" in "Acme production"; the target zone lists it with 3 tales and the tag; screenshots were sent to the user.

**Residual risks:**
- Five actions on a group row wrap on narrow screens; not checked visually at phone width.
