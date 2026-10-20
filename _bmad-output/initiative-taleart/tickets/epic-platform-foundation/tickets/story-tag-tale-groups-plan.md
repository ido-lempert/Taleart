---
title: 'Tag tale groups'
type: 'feature'
ticket: '5'
created: '2026-10-20'
status: 'built'
baseline_revision: 'fcd91221d854f8218cdd945cea0359979943a3e5'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-platform-foundation/tickets/story-invite-a-user-to-a-project-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Tale groups cannot be tagged, but tags are what later decides which viewers see a tale group (PRD FR-017). The user decided (2026-10-20) that tags go on tale groups, not tales.

**Approach:** A new `targeting` module owns tags (per project) and the tale-group-to-tag links. In the dashboard a user creates tags, sets the tags of a tale group, and filters a zone's tale groups by tag.

## Boundaries & Constraints

**Always:** A tag belongs to one project (`project_id NOT NULL`, AD-4); its name is trimmed, 1 to 40 characters, unique per project ignoring case. A tale group can carry only tags of its own project, enforced by composite foreign keys like story 3. Setting a group's tags replaces the full set in one transaction. Every route is authorized through story 13's helper (403 for another project, 404 for unknown ids). The targeting module reaches tale groups only through the tales module's public interface; the API composes tags into tale-group responses. Contract first, story 14 design system, `_test` database.

**Never:** Targeting or delivery by tags (targeting epic), AND/OR rules, audiences, renaming or deleting tags, tags on tales, collections (waiting for the user).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create tag | `POST /api/v1/projects/{projectId}/tags {name}` | 201 `{id, projectId, name}` | blank or over 40 → 400 `validation_failed`; same name in the project, any case → 409 `tag_exists` |
| List tags | `GET /api/v1/projects/{projectId}/tags` | 200, the project's tags by name | — |
| Set group tags | `PUT /api/v1/tale-groups/{taleGroupId}/tags {tagIds}` | 200 tale group with `tags` (id and name, by name) | unknown id or a tag of another project → 400 `tag_not_found`; duplicates are ignored |
| Clear | `{tagIds: []}` | 200, no tags | — |
| Group lists | `GET /zones/{zoneId}/tale-groups` | every group has `tags` | — |
| Other project | content manager of A on B's tags or groups | 403 | `forbidden` |
| Kept | set tags, restart the API | lists return the same tags | — |
| Dashboard tags | tale-group row | tag chips after the group name; a "Tags" button opens a drawer with the project's tags as checkboxes and a field to create a new tag | API message in the drawer |
| Dashboard filter | zone page with tagged groups | a row of tag filter chips above the groups; picking one shows only groups with that tag; "All" clears it | — |

</intent-contract>

## Code Map

- `libs/server/` -- add `targeting` like `libs/server/tales` (tag `type:server-module`, alias `@taleart/server-targeting`): migration, `createTag`, `listTags`, `setTaleGroupTags`, `tagsForTaleGroups(ids)`, errors.
- `libs/server/tales/src/index.ts` -- exports `taleGroupProjectId`; the targeting migration may reference `tale_groups (id, project_id)` through the existing unique index `tale_groups_id_project_id_key`, as tales references zones.
- `apps/api/src/db.ts` -- migration order: add `targeting` after `tales`.
- `apps/api/src/http/authorize.ts` -- story 13's helper; use it on every new route.
- `apps/api/src/http/tale-groups.router.ts` -- list and order responses; compose `tags` into each tale group.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- `Tag`, `CreateTagRequest`, `SetTaleGroupTagsRequest`, `TaleGroup.tags`, codes `tag_exists`, `tag_not_found`; regenerate.
- `apps/dashboard/src/app/dashboard.store.ts`, `create-drawer.*`, `pages/zone-detail.*`, `styles.css` -- group rows, drawers and pills from stories 14 and 4.

## Tasks & Acceptance

**Execution:**
- [x] `libs/server/targeting/` -- module, tables, functions, unit tests -- AD-1, AD-4.
- [x] `libs/contract/` -- schemas, paths, codes; regenerate -- AD-3.
- [x] `apps/api/src/` -- migration order, tag routes, group-tags route, composition into tale-group responses, authorization, error mapping; tests for every matrix row.
- [x] `apps/dashboard/src/app/` -- tag chips, tags drawer with create, filter chips; component tests.
- [x] `tsconfig.base.json` -- alias.

**Acceptance Criteria:**
- Given a zone with tale groups, when the user creates tag "summer", adds it to two groups and filters by it, then only those two groups show, and after a reload they still carry the tag.
- Given a tag of project B, when it is set on a tale group of project A through the API, then it is refused with 400 `tag_not_found`.

## Implementation Notes

- Targeting module (`@taleart/server-targeting`, tag `type:server-module`): `tags` (CHECK trimmed, 1 to 40 chars; unique index `tags_project_id_lower_name_key` on `(project_id, lower(name))`; unique `(id, project_id)`), `tale_group_tags` (PK group+tag, `project_id NOT NULL`, composite FKs into `tale_groups (id, project_id)` and `tags (id, project_id)`). `createTag` maps the unique violation to `TagExistsError` (409) and a bad name to `InvalidTagNameError` (400 `validation_failed`); `setTaleGroupTags` reads the group's project through `taleGroupProjectId`, dedupes ids, checks every id is a tag of that project (`TagNotFoundError`, 400) and replaces the set under an advisory lock on the group in one transaction; `tagsForTaleGroups` returns a map with an entry per requested id.
- Tales module: `TaleGroup` now requires `tags`, so tales functions return `StoredTaleGroup` (`Omit<TaleGroup, 'tags'>`); added `getTaleGroup` so the PUT can answer the whole group. The API composes `tags` into list, create (`[]`), order and set-tags responses.
- Contract: `Tag`, `TaleGroupTag` (`{id, name}`), `CreateTagRequest`, `SetTaleGroupTagsRequest`, `TaleGroup.tags`, codes `tag_exists`, `tag_not_found`; `MAX_TAG_NAME_LENGTH`, `normalizeTagName` (counts code points, like `char_length`).
- API: `http/tags.router.ts` (`GET`/`POST /projects/:projectId/tags`, authorized by `authorizeParam('project')`, unknown project 404 `project_not_found`); `PUT /tale-groups/:taleGroupId/tags` in `tale-groups.router.ts` (group 404, then body 400, then tags 400).
- Dashboard: the store loads each project's tags in `refresh()` and has `createTag`, `setTaleGroupTags` (updates only the group's tags); drawer kind `tags` with checkboxes, a "New tag" field with "Add tag" (Enter adds, not saves) and Save; zone page shows tag pills after the group name, a "Tags" button per group, and filter chips (`aria-pressed`, "All" first) built from the tags on the zone's groups. While a filter is on, group reordering (drag handle, move buttons, drop list) is off, because the order request must list every group; a hint says to choose All.

## Plan Change Log

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 4 findings — high 0, medium 0, low 4, false 0, maybe-false 0
- findings:
  - `[low]` `[patch]` A picked tag that vanished from every group kept its id, so the filter silently turned back on when the tag returned — fixed: `activeTag` is a `linkedSignal` that resets to All; new test.
  - `[low]` `[patch]` The advisory lock key used the group id as sent, so case-different ids raced to a 500 — fixed: the id is lowercased before the lock and queries.
  - `[low]` `[patch]` Tags were ordered three different ways — fixed: one `compareTags` used by the store and the zone page.
  - `[low]` `[patch]` A group-order response could put back tags changed meanwhile — fixed: confirming an order takes only positions from the response.

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting` -- expected: all succeed.

**Manual checks (if no CLI):**
- The parent session tags tale groups on the running dev servers and screenshots the zone page with a filter active.

## Auto Run Result

**Summary:** A new `targeting` module owns tags (per project, unique ignoring case) and tale-group tags (composite keys keep both in one project). The API creates and lists a project's tags, replaces a tale group's tags, and returns `tags` on every tale group. The dashboard shows tag chips on each group, a Tags drawer with checkboxes and tag creation, and filter chips on the zone page.

**Files changed:**
- `libs/server/targeting/` — new module: tables, `createTag`, `listTags`, `setTaleGroupTags`, `tagsForTaleGroups`; unit tests.
- `libs/server/tales/` — `StoredTaleGroup`, `getTaleGroup`.
- `libs/contract/` — tag schemas and paths, `TaleGroup.tags`, codes `tag_exists`, `tag_not_found`; regenerated.
- `apps/api/src/` — targeting migration, `tags.router.ts`, group-tags route, tags composed into tale-group responses, authorization, error mapping; tests.
- `apps/dashboard/src/app/` — tag chips, Tags drawer, filter chips, `compareTags`; tests.
- `tsconfig.base.json` — `@taleart/server-targeting`.

**Review:** 4 patches applied (all low), 0 deferred, 0 rejected.

**Follow-up review recommended:** false. No high or medium findings were patched.

**Verification:** `nx run-many -t lint test build` for the eight projects passed before and after the patches (api 126, server-targeting 12, dashboard 56 tests). End to end in Chromium against `taleart_e2e_test`: admin setup, three tale groups, tags "summer" and "promo", filter by "promo"; screenshots of the filtered zone page and the Tags drawer were sent to the user.

**Residual risks:**
- Reordering is off while a filter is on (the order call needs every group).
- Every refresh loads tags once per accessible project.
