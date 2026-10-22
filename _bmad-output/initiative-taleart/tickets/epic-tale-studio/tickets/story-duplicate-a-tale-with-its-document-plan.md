---
title: 'Duplicate a tale with its document'
type: 'feature'
ticket: '12'
created: '2026-10-22'
status: 'built'
baseline_revision: 'cf1bf03'
route: 'full'
route_source: 'auto'
risk: 'low'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-tracer-turning-a-group-on-shows-its-tales-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-tale-studio-says-update-tale-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A content manager who wants a variant of a tale (another group, another text) has to rebuild it by hand; the only copy paths are a whole group (Copy to zone) and the studio's keep-as-copy after a stale save (epic Tale Studio R11, PRD FR-012).

**Approach:** One server function and route, `POST /tales/{taleId}/duplicate` with an optional `taleGroupId` of the tale's project, copies the tale row with both documents under new element ids, sharing every storage key (AD-14), stored Hidden. The dashboard offers Duplicate on the tale card and in Tale Studio, through one lazily loaded drawer with the group picker.

## Boundaries & Constraints

**Always:**
- The copy is stored `paused` (Hidden, owner decision 2026-10-22), titled "<title> (copy)", keeps the start and end time, media key, R16 media state (`document_media_key`, `document_created_by_migration`); it is created now, a new tale (review decision), so it does not inherit a pre-step tale's legacy delivery.
- Documents: the original's published document becomes the copy's published document and its draft the copy's draft, each at revision 1 (0 when null), so a pending change stays pending and "Update tale" means the same on both. Every element gets a new UUID, the same new id for the same element in both documents.
- Media and fonts are never copied: the copy's `tale_media` and `tale_fonts` rows are recorded in the same transaction, so `isMediaKeyInUse` and the font deletion guard see the copy; the original's row and its fonts are share-locked meanwhile.
- Placement: in the original's group, right after it (the later tales move one on); in another group, last. The target group row is locked `FOR UPDATE`, so `MAX_TALES_PER_GROUP` (409 `tale_group_full`) and positions hold under concurrent adds and duplicates.
- Access: `authorizeParam('tale')` on the route (403); the target group must be of the tale's project: else 400 `tale_group_not_found`, as placing a group in a zone answers for a body's group (a group of a project the caller cannot see is not told apart from none).
- UI never says "Publish"; the result is announced in the page's live region; the drawer is part of the lazy page chunks (initial bundle unchanged).

**Never:** copying files; a new table or column; tags (they belong to groups); changing keep-as-copy or group copy; zones, frames or stages code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same group | `{}` on tale at position 1 of 3 | 201, copy at 2, old 2 moves to 3; `paused` | — |
| Other group | `{ taleGroupId }` of the project | 201, copy last there; source group unchanged | — |
| Other project | group of another project, unknown or malformed id | nothing created | 400 `tale_group_not_found` |
| Bad body | `taleGroupId: 7` | nothing created | 400 `validation_failed` |
| No access | caller without the tale's project | nothing created | 403 `forbidden` |
| Full | target group at 100 | nothing created | 409 `tale_group_full` |
| Concurrent | five duplicates at once | positions 0..n-1, each copy right after its original | — |
| Original changed | media replaced, archived, or row gone | copy's media still stored and served | — |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/lib/core.ts` -- `duplicateTale` operation, `DuplicateTaleRequest`; generated `api.ts`.
- `libs/server/tales/src/lib/tales.ts`, `src/index.ts` -- `duplicateTale`, `withNewElementIds`; `TaleGroupNotInProjectError` takes the owner's wording.
- `apps/api/src/http/tales.router.ts` -- the route.
- `apps/dashboard/src/app/pages/duplicate-tale.ts` -- the drawer (picker, "n / 100", full groups disabled, own group first) and the call.
- `apps/dashboard/src/app/pages/zone-detail.{ts,html}` -- the card's Duplicate button (icon, top row) and the announcement.
- `apps/dashboard/src/app/pages/tale-studio.ts` -- Duplicate in the update bar: saves first, then the drawer; notice with "Open the copy".

## Tasks & Acceptance

**Execution:**
- [x] contract: OpenAPI path and schema, generated types, exported request type.
- [x] server-tales: `duplicateTale` with locks, placement, documents, references.
- [x] api: route; HTTP tests (same group, other group, other project and bad input refused, 403, cap, new ids and same keys, paused, media kept after replace/archive/row removal, concurrency).
- [x] dashboard: drawer, card button, studio action; component tests (card flow with announcement and Hidden card, refusals and focus return, studio save-first and link, save failure).

**Acceptance Criteria:**
- Given a styled tale duplicated into another group, when the copy's text is edited in the studio, then the original's documents are unchanged.
- Given both shown and updated, then the Delivery API serves both with their media; given the original archived, then the copy's media still loads.

## Implementation Notes

- Element ids: one map for both documents, so the draft and published copies of an element share a new id; non-object entries are left as they are (the stored documents passed the checks).
- `deliverable` for the copy's published `tale_media`/`tale_fonts` rows uses the same check as group copy (`isCheckedDocument`); the copy is paused, so nothing becomes public until it is shown (no public cache clearing needed).
- The HTTP call lives in the lazy drawer, not the root store, so the initial bundle stays 494.95 kB; the card button's icon is inline SVG for the same reason.
- Tale Studio flushes autosave before opening the drawer (the copy is made from what is saved); a failed save shows "…so the tale was not duplicated" and opens nothing.
- Browser check (Playwright, virtual WebAuthn passkey, API 3386 / dashboard 4286 / sample 4386, own database): duplicated a styled tale (tale media, project image, styled text) from its card into another group (announced, card Hidden), edited the copy's text in the studio (original documents byte-identical, element ids all new), showed and updated both (Delivery serves both, every media URL 200), archived the original (copy's media URLs 200, sample page renders it), duplicated from the studio (notice and link). Screenshots in the scratchpad `shots-7.12/`.
- Verification (2026-10-22, `--skip-nx-cache`, `taleart_w12_test`): `run-many -t lint test build` on the 12 projects passes (api 539, dashboard 411, web-sdk 335, server-importer 276, contract 266, server-tales 230 tests; api:build re-run after a type fix in the route); `web-sdk:size` 21.69 KB gzipped; `web-sdk:types-check` passes; dashboard initial bundle 494.95 kB.

## Plan Change Log

- 2026-10-22, review of 7.12 (coordinator): a duplicate is a new tale, created now; it no longer inherits the original's creation time, so a copy of a tale from before the shown-status step with nothing published reads "not updated yet" until Update tale (supersedes "keeps … creation time" above). KEEP: shared keys with the copy's own `tale_media`/`tale_fonts` rows, lock order (target group, then source row, then fonts), both documents with one id map, status codes.

## Review Triage Log

### 2026-10-22 — Coordinator review
- **Verdicts:** no must-fix; 7 findings patched, none deferred. Tenancy, lock order and shared-key guards confirmed.
- **Findings:**
  1. `[patch]` `created_at` is now `now()`. Tests: a pre-step source with nothing published gives a copy "not updated yet" once shown; one with a published document gives a visible copy.
  2. `[patch]` Tale Studio ignores undo/redo shortcuts while the Duplicate drawer, a picker, or any dialog has the key. Test.
  3. `[patch]` The drawer chooses the first group with room (own group first), keeps the person's pick while it has room, and says so and disables Duplicate when no group has room. Tests, including the fallback when the project's groups are not read (own group from the zone list).
  4. `[patch]` Refusals in plain words (`duplicateRefusal`): group gone, group full (named), tale gone, no access, no connection, else a generic line. Tests.
  5. `[patch]` The drawer closes and announces as soon as the copy exists; then only the project's groups (project list and its zones' lists) are read again in the background, no full reload, also from the studio. Tests.
  6. `[patch]` Duplicating an archived tale gives a Hidden copy. Test.
  7. `[patch]` Duplicate while Update tale runs says "Wait until the tale is updated, then duplicate it." Test.
- Added tests: the copy's `tale_fonts` rows for draft and published, and 409 `font_in_use` when only the copy uses a font; an out-of-step original gives an out-of-step copy delivered with the media composed under the copy's own id and merged by the media migration; `document_media_key`/`document_created_by_migration` carried; duplicates racing a reorder, an add, a status change and a save on the same groups (no 5xx, positions 0..n-1, the cap holds: two of three adds into a group with two places); studio POST failure, full group, focus return.

## Design Notes

- Ordering: "right after the original" only in its own group; another group gets the copy last, as the ticket says.
- A second duplicate of a copy is titled "… (copy) (copy)"; kept simple, as keep-as-copy does.
- There is no route that deletes a tale; "deleting the original" is covered by media replace (deletion guard), archive (public route) and, in the test, removing the row directly (references cascade; the copy's own rows keep the keys in use).

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w12_test node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --skip-nx-cache` -- all succeed.
- `web-sdk:size`, `web-sdk:types-check` -- pass.
