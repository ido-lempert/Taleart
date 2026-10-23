---
title: 'Delete a tale'
type: 'feature'
ticket: '20'
created: '2026-10-23'
status: 'built'
baseline_revision: '5e58e15'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-open-a-group-to-show-or-hide-each-tale-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-a-tale-group-in-no-zone-can-get-tales-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-the-tale-drawer-saves-status-at-once-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A tale can only be archived, never removed, so tales left Hidden by a failed upload (8.13), mistakes and copies pile up in a group (at most 100 tales).

**Approach:** Contract first, `DELETE /tales/{taleId}` (204). The tales module deletes the tale with its documents and its `tale_media` / `tale_fonts` rows and renumbers the group in one transaction; the API then forgets the import baseline and imported-media row, and deletes each file the tale referenced only through the AD-14 deletion guard. The group view's tale ⋯ menu (zone page and Tale groups page) offers Delete after Archive, and the tale drawer offers "Delete tale…", both through one confirmation dialog.

## Boundaries & Constraints

**Always:**
- Lock order as the other tale writes: the group row (`FOR UPDATE`), then the tale row (`FOR UPDATE`), the order `createTale`, `orderTales` and `duplicateTale` (target group, then source tale) take; `copyTaleGroup` shares the group row first. A tale never changes group, so the group read before the lock is still its group.
- Files: the keys are the tale's `media_key` and its `tale_media` keys, read under the tale's lock; each is deleted after the commit through `withMediaKeyDeletionGuard`, only when `isMediaKeyInUse` says nothing (another tale, a copy, a cover, a document, the project's uploaded media) references it. Project fonts stay (they are the project's); only the tale's `tale_fonts` rows go.
- Import (AD-7, "a person's deletion wins"): the `import_links` row stays, so a re-import finds the target gone and skips it with "its earlier import was deleted, so it was not imported again"; the `import_records` baseline and `import_media` row go, after the delete commits, in their own statements (no lock cycle with an import updating the tale).
- Analytics (AD-10): events are append-only with no foreign key to tales, so deletion is allowed and recorded events keep the tale's id; there is no events table yet, so nothing is written.
- Access: any member with access to the tale's project (admin or content manager), 403 `forbidden` elsewhere, 404 `tale_not_found` for an unknown tale.
- Dashboard: confirmation names the tale and its group, says it cannot be undone, `alertdialog`, focus on Cancel; after a delete, focus goes to the next card's ⋯ (else the one before, else Add tale) and the view's live region says "<title> deleted from <group>. <count>."; the tale leaves every list at once (zone lists, a group read on its own, confirmed orders, the project list's counts), then everything is read again; a tale order of the group still saving goes first.

**Never:** deleting a tale group; a soft delete or Undo; deleting files inside the transaction; touching `import_links`; a second confirmation component per page.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|---|---|---|
| Delete | Beach with its own media and a project image | 204; group renumbered; own file gone; project media kept |
| Shared | Beach duplicated, both Shown | copy still delivered and its media served; deleting the copy then removes the file, public URL 404 |
| Copy to zone | group copied, then Beach deleted | file kept (the copied group's tale holds it) |
| Fonts | Beach's documents use a project font | its `tale_fonts` rows go; the font stays and can then be deleted |
| Hidden by failed upload | a paused tale without media | 204 |
| Access | content manager, own project / other project | 204 / 403 `forbidden`, tale kept |
| Unknown | deleted id, random UUID, `nope` | 404 `tale_not_found` |
| Race | delete vs duplicate, order, add, save, status, copy to zone, another delete | no 5xx, no deadlock; dense positions; file on disk iff referenced |
| Re-import | imported tale deleted, import run again | not created again, note in the report; link kept, baseline gone |
| Dashboard refusal | API 403 | message in the dialog (`role=alert`), tale kept |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/generated/api.ts` -- `deleteTale`.
- `libs/server/tales/src/lib/tales.ts` -- `deleteTale` (+ `DeletedTale`); `index.ts` exports it wrapped to clear the public media and font caches.
- `libs/server/importer/src/lib/reimport.ts`, `index.ts` -- `forgetImportedTale`.
- `apps/api/src/http/tales.router.ts` -- `DELETE /tales/:taleId`.
- `apps/dashboard/src/app/dashboard.store.ts` -- `deleteTale`, `removeTale`, `taleDeletionRequest`.
- `apps/dashboard/src/app/pages/delete-tale.ts` -- the confirmation; `drawer.ts` -- `dialogRole`, `describedBy`.
- `apps/dashboard/src/app/pages/group-view.{ts,html}` -- Delete menu item, dialog, focus and announcement, `data-tale-id`.
- `apps/dashboard/src/app/create-drawer.{ts,html}` -- "Delete tale…" in the tale drawer.
- Specs: `apps/api/src/app.spec.ts`, `libs/server/tales/src/lib/tales.spec.ts`, `apps/dashboard/src/app/app.spec.ts`, `apps/dashboard-e2e/src/delete-tale.spec.ts`, `apps/dashboard-e2e/src/a11y.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] Contract, tales module `deleteTale`, importer `forgetImportedTale`, API route.
- [x] API tests (matrix above) and tales unit tests (lock order, not found, raced).
- [x] Store, confirmation dialog, group view menu, tale drawer button; dashboard specs.
- [x] e2e (`delete-tale.spec.ts`) with screenshots; a11y state `delete-tale-confirmation`.

**Acceptance Criteria:**
- Given a group that is On with Beach (Shown), its Hidden copy and Pool, when Beach is deleted from the group view, then the view reads "1 of 2 shown", the API lists the copy and Pool at positions 0 and 1, the copy's media still loads, and the test page plays one tale.

## Implementation Notes

- **Deletion semantics:** one transaction deletes the tale row (documents are columns), its `tale_media` and `tale_fonts` rows (FK `ON DELETE CASCADE`) and renumbers the group with `row_number()` (dense, as `removeTaleGroup` does for placements). It answers the keys the tale referenced; the route deletes each file after the commit under the key's exclusive lock, only when unreferenced. Failures of the import cleanup or a file delete are logged, not answered (the tale is gone; the importer's start-up sweeps also clear baselines of missing records).
- **Locking:** group row, then tale row. A duplicate that wins records the copy's `tale_media` rows before the delete reads them, so the guard keeps shared files; one that loses finds no source tale (404). A document save that wins records its keys before the delete reads them; one that loses finds no tale (404). `copyTaleGroup` holds the group `FOR SHARE`, so it and the delete serialize. The import cleanup runs outside the transaction because an import's `updateRecord` takes the record lock before the tale's row; taking them in the opposite order inside the delete could deadlock.
- **Caches:** `deleteTale` is wrapped like the status changes, clearing the public media and font caches, so a key stops being public at once in this process.
- **Dashboard:** the confirmation is one component (`app-delete-tale`, a drawer with `dialogRole="alertdialog"` and `aria-describedby` on its question), rendered by the group view beside its own drawer, as Duplicate is. The tale drawer's "Delete tale…" closes the drawer (focus back to the card) and sets `store.taleDeletionRequest`; the group view showing that tale opens the confirmation from there. The tale drawer only opens from a group view, so the request is always answered. The `Drawer` keeps a static `role="dialog"` beside the binding so the template lint (`interactive-supports-focus`) still sees a dialog.
- **Store:** `deleteTale` waits for the group's tale order queue first (a queued order lists the tale and would be refused), treats 404 as deleted, removes the tale everywhere at once (`removeTale`), closes a drawer open for it, then refreshes.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard docs contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool dashboard-e2e --parallel=2`
- `dashboard-e2e:e2e`, `dashboard-e2e:a11y`, `api:import-scale`

Results (2026-10-23): run-many passes except the known `api:test` "auth > creates the admin, signs them in and stores only the token hash" (`expected 606033 to be 604800`, local Postgres clock behind); API 633/634 (+10), server-tales 288 (+2), dashboard 690 (+5 new, 2 updated). `dashboard-e2e:e2e` 12 passed (new `delete-tale.spec.ts`); `dashboard-e2e:a11y` 28 passed (new state `delete-tale-confirmation`); `api:import-scale` 1 passed.

**Manual checks:**
- Screenshots in `shots-8.20/` (ports 3420/4420, own `_e2e_test` database): the menu with Delete, the confirmation, the view after the delete, the test page with two then one tale, the Tale groups page count.

## Review fixes (2026-10-23)

`autopilot/foundation` had not moved (5e58e15); nothing to merge.

- **Orphan sweep:** `sweepUnusedTaleMediaFiles` (tales module) deletes uploaded tale media files (`tales/<uuid>.<ext>`) older than an hour that nothing references, each under `withMediaKeyDeletionGuard`; imported files (`tales/imported-…`) stay the importer's. `sweepImportMediaOfDeletedTales` (importer) removes `import_media` rows whose tale is gone, checked through `taleExists`. The import worker's start-up sweep runs both, the records before the imported-file sweep so those files can go too. A failed file delete still answers 204 and is logged; the sweep removes the file later (tested).
- **Deletion requests:** `taleDeletionRequest` carries `{ taleId, taleGroupId }`. Group views register the group they show (`groupViewOpened`/`groupViewClosed`); `requestTaleDeletion` refuses when no view shows the group, the request is dropped when the last view of its group closes, and the view drops a request for a tale it no longer holds. The tale drawer shows "Delete tale…" only while a view of the tale's group is open.
- **Tale Studio:** a save or update refused for media the project does not have (`UNKNOWN_MEDIA_REASON`, now shared by the contract and the tales module), such as a deleted tale's file, reads "The tale could not be saved: this <image|video|…|background> uses a media file that no longer exists, perhaps because the tale it came from was deleted. Pick other media for it, or remove it." with the element selected.
- **Import report:** a tale deleted after the run found it is counted skipped (not imported, not `unchanged`), noted "it was deleted during the import, so it was not updated", and its media is not copied (one note only).
- **Tests:** API +6 (failed file delete then swept; archived tale and tale of an archived group; imported file removed when alone and kept when a duplicate shares it; start-up sweep of `import_media` then the file; delete during a running import, held at the tale's import lock). Dashboard +3 (store request bookkeeping; a request for a gone tale or an unshown group; Studio message).
- **Importer unit test** "leaves a record deleted before its update uncounted as changed" now expects the new outcome (skipped with a note, not `unchanged`).
- **Verification:** run-many lint/test/build (14 projects, `--parallel=2`) passes except the known clock test (`expected 606033 to be 604800`) and the importer unit test above, since updated (server-importer 284 passed on rerun); API 638/639, dashboard 693. `dashboard-e2e:e2e`: the first run had `first-run.spec.ts` time out (`Test timeout of 120000ms exceeded`, waiting for "New zone" on a page still showing "Create your first project"); the rerun passed 12/12. `dashboard-e2e:a11y` 28 passed; `api:import-scale` 1 passed.
