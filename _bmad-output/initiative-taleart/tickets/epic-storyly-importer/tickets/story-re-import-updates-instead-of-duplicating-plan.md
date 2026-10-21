---
title: 'Re-import updates instead of duplicating'
type: 'feature'
ticket: '7'
created: '2026-10-21'
status: 'in-review'
baseline_revision: '596ffbcfb580cabd5169840e1e8300b74099665d'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-storyly-importer/import-mapping.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A re-import finds linked records (AD-7) but leaves them as they were: a title, order, media or label changed at the source never reaches TaleArt, and the report cannot tell what changed (epic R4, AD-7 "re-running an import updates the linked records").

**Approach:** The importer keeps, per imported record, what it last wrote (an importer-owned baseline keyed by the TaleArt id). A re-run does a three-way merge per field: source value, last-imported value, current TaleArt value. A field nobody changed in TaleArt takes the source's value; a field a person changed in TaleArt is kept. Writes go through the owning module's public interface with the current value checked under the module's lock. Records gone from the source are kept and reported. The report gains per-entity created / updated / unchanged / kept-local-edit / removed-at-source counts, and differences for each kept edit and each removal.

## Boundaries & Constraints

**Always:**
- Baseline: importer table `import_records (target_type, target_id uuid, project_id NOT NULL, fields jsonb, updated_at)`, PK `(target_type, target_id)`. Fields hold TaleArt values only: zone `{name, order}`, tale group `{name, tags, order}`, tale `{title}`; no source ids (AD-7). Written in the same transaction as the record's creation (link callback) and as each update.
- Merge per field (name/title): current = source → nothing to write; current = baseline → write source (updated); else a local edit → kept (counted kept-local-edit only when the source changed since the baseline). No baseline (records imported before this story) and current ≠ source → kept as a local edit (conservative), baseline set to the source.
- Order (zone placements of imported groups; a group's imported tales): the same rule on the relative order of the imported records; records not imported this run (added in TaleArt, removed at the source) keep their slots. A person's re-order is kept.
- Tags: added when new at the source since the baseline (all of them without a baseline, as story 8). A tag a person removed is not re-added. Nothing is removed: a label gone from the source is a `removedAtSource` difference.
- Media: `import_media` gains `source_digest` (SHA-256 of the story's media URL and type; the URL is never stored). Same digest → nothing downloaded. Changed or unknown digest → download; same bytes → unchanged; else replaced, only while the tale still holds the import's key (conditional update in the tales module). Media set in TaleArt is kept (kept-local-edit when the source media changed). Old files are left to story 5's sweep.
- Removed at the source: a linked record of the same app not listed this run is kept, counted `removedAtSource` and listed as a difference with its TaleArt name. `import_links` gains `source_app_id` (filled on save and for links seen again).
- One transaction per record update, locks: baseline row (`FOR UPDATE`) → module locks (row lock / zone advisory lock / tag lock). No link lock is taken in an update, so the creation path's order (module lock → link lock) cannot cross it. A deadlock (40P01) retries the record once.
- Report: `changes: {zones, taleGroups, tales, media}` each `{created, updated, unchanged, keptLocalEdit, removedAtSource}`; created+updated+unchanged = imported; keptLocalEdit overlaps them. Difference kinds `keptLocalEdit` (field `title`, `sort_order`, `media`) and `removedAtSource`; no values, token never logged or stored.
- Module touch points (epic: "the importer adds update-by-id calls"): zones `renameZoneWhen`; tales `renameTaleGroupWhen`, `renameTaleWhen`, `orderTaleGroupsWhen`, `orderTalesWhen`, `replaceTaleMediaIf`; targeting `addTaleGroupTagsByNameIn` (caller's transaction).
- Dashboard: each count row shows its changes ("1 updated, 2 unchanged, …"); difference lines for the new kinds.

**Never:** Deleting, unplacing or moving records, tags or files because the source changed or dropped them; overwriting a field changed in TaleArt; storing source ids or media URLs outside `import_links`; scheduled sync (epic boundary); statuses and schedules (story 11).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same twice | Demo shop imported twice | counts in TaleArt unchanged; changes all `unchanged`; no media downloads | — |
| Title changed at source | story 4001 retitled | tale renamed; tales.updated 1 | — |
| Group/zone renamed at source | group 3001 / instance 2001 retitled | renamed; updated 1 | — |
| Edited in TaleArt | tale renamed by a person; source unchanged | kept; unchanged; no difference | — |
| Both changed | person renamed, source renamed too | kept; keptLocalEdit 1; difference `keptLocalEdit title` | — |
| Order changed at source | sort_order swapped | tales re-ordered; group updated | — |
| Order changed in TaleArt | person re-ordered, source re-ordered | person's order kept; keptLocalEdit `sort_order` | — |
| New label | group gains a label | tag added; group updated | — |
| Tag removed in TaleArt | person removes an imported tag | not re-added | — |
| Label removed at source | group loses a label | tag kept; `removedAtSource` difference | — |
| Media changed at source | story media points at another file | media replaced; media.updated 1 | download failure: tale keeps old media, `mediaNotImported` |
| Media set in TaleArt, source changed | upload, then source media changes | kept; media.keptLocalEdit 1, difference | — |
| Removed at source | a story / group / instance no longer listed | kept in TaleArt; removedAtSource count and difference | — |
| No baseline | record imported before this story, title differs | kept; keptLocalEdit difference; baseline set | — |
| Concurrent re-runs | two workers re-import after a source change | each record updated once, no duplicates | deadlock retried once |
| Deleted during update | record gone | skipped silently by the update | — |
| Dashboard | report with/without `changes` | changes text / as before | — |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml` -- `ImportChangeCount`, `ImportReport.changes`, kinds `keptLocalEdit`, `removedAtSource`, nullable `ImportDifferenceRecord.position`; regenerate.
- `libs/server/zones/src/lib/frames.ts`, `index.ts` -- `renameZoneWhen`.
- `libs/server/tales/src/lib/tales.ts`, `index.ts` -- `renameTaleGroupWhen`, `renameTaleWhen`, `orderTaleGroupsWhen`, `orderTalesWhen`, `replaceTaleMediaIf`.
- `libs/server/targeting/src/lib/tags.ts`, `index.ts` -- `addTaleGroupTagsByNameIn`.
- `libs/server/importer/src/lib/migration.ts` -- `import_records`, `import_links.source_app_id`, `import_media.source_digest`.
- `libs/server/importer/src/lib/reimport.ts` (new) -- pure merge rules, baseline read/write.
- `libs/server/importer/src/lib/links.ts`, `worker.ts`, `media-copy.ts`, `label-import.ts` -- update steps, removal detection, report.
- `apps/fake-storyly/src/fake-storyly.mjs` -- instances served from `control.data` so tests can rename them.
- `apps/api/src/app.spec.ts` -- integration tests per matrix row.
- `apps/dashboard/src/app/pages/import-job.ts`, `import-shared.ts`, `app.spec.ts` -- change text and new difference lines.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- schemas; regenerate -- contract first (AD-3).
- [x] `libs/server/zones`, `tales`, `targeting` -- conditional update calls; unit tests -- AD-1, AD-8.
- [x] `libs/server/importer/` -- baselines, merge, update steps, media replace, removal detection, report; unit tests -- AD-7, AD-8.
- [x] `apps/fake-storyly/` -- mutable instances; test.
- [x] `apps/api/src/app.spec.ts` -- integration tests for every matrix row.
- [x] `apps/dashboard/` -- change text, difference lines; component tests.

**Acceptance Criteria:**
- Given the fake account imported once, when it is imported again, then zone, tale group and tale counts do not change and the report counts every record unchanged.
- Given a story title changed on the fake server, when the app is re-imported, then the tale's title updates and the report counts it as updated.
- Given a title a person changed in TaleArt, when the source changes it too and the app is re-imported, then the person's title stays and the report lists it as a kept local edit.

## Implementation Notes

- Product decisions the epic leaves open, settled here as assumptions (none blocked the build):
  - **A person's edit wins.** The epic says a re-run "updates the linked records" (R4, AD-7) but not what happens to edits made in TaleArt. The coordinator's brief says they are never overwritten. Detection: the importer keeps a baseline of what it last wrote (`import_records`), and a field whose current value differs from the baseline is a person's edit.
  - **Records gone from the source are kept.** The epic does not say to delete them. An import never deletes anything (the same rule as story 8's tags and story 5's files). Each is counted `removedAtSource` and listed with its TaleArt name.
  - **Tags are only added.** A tag a person removed is not added again; this closes story 8's open point. A label dropped at the source keeps its tag on the group and is listed as a difference. Tags still have no import links (they are matched by name).
  - **No baseline means "kept".** Records imported before this story have no baseline, so a value that differs from the source cannot be told apart from a person's edit. It is kept, listed as `keptLocalEdit`, and the source value becomes the baseline. Imports are unreleased, so this only affects development data.
- Counting: `changes.<entity>` = created + updated + unchanged = imported. `keptLocalEdit` overlaps those counts and only counts conflicts, where the source changed a field a person had also changed. A person's edit on a field the source left alone is neither counted nor listed. Media set in TaleArt stays `skipped` in the `media` count, as in story 5. It counts `keptLocalEdit` only when the source media's fingerprint changed; otherwise it keeps story 5's note.
- Order is merged on the relative order of the records this run imported into the container. Other records (added in TaleArt, or no longer at the source, or moved to another group in TaleArt) keep their slots. As a consequence, a story that is new at the source now takes its source place instead of going last. Story 2's "appended" tests were updated accordingly.
- Container order: a zone's tale-group order and a group's tale order are merged in the container's update transaction. That transaction runs after the container's children are processed. A record is therefore written in at most two transactions: its creation (with link and baseline), then its update. A tale's media keeps story 5's own transaction and `import_media` bookkeeping.
- Lock order in an update: the baseline row (`import_records … FOR UPDATE`, inserted empty when missing), then the module's lock (zones/tale_groups/tales row lock, zone advisory lock, tag advisory lock). An update never takes a link lock. Creation takes module lock → link lock → inserts the new record's baseline, so the two paths cannot form a cycle. A `40P01` deadlock reruns the record's update once.
- Module touch points, all conditional and run on the caller's transaction: `renameZoneWhen`, `renameTaleGroupWhen`, `renameTaleWhen`, `orderTaleGroupsWhen`, `orderTalesWhen` (the module locks, reads the current value, the importer's `decide` callback answers the value to write or null), `replaceTaleMediaIf` (`UPDATE … WHERE media_key = expected`), and `addTaleGroupTagsByNameIn` (the existing additive tag write on the caller's transaction).
- Media: `import_media.source_digest` = SHA-256 of `mime_type\nurl`. A URL hash is not the URL and not a source id, so neither story 5's rule nor AD-7 is broken. With the same digest, nothing is downloaded, so story 5's "re-run downloads nothing" still holds. With a changed or missing digest, the media is downloaded again. If the bytes are the same, only the digest is recorded; otherwise the media is replaced while the tale still holds the import's key. The earlier copy is left to story 5's sweep, since copies may share it. If a replacement download fails, the tale keeps its earlier media, a `mediaNotImported` difference is listed, and a note says the earlier media was kept.
- Removed at source: `import_links.source_app_id` (a source id, kept in `import_links` as AD-7 requires) scopes the check to the imported app. Links saved before this story get their app id when their record is listed again.
- Merged `autopilot/foundation` 0f3401f (importer story 9, pick what to import) before committing. Re-imports respect the selection:
  - A zone that was not picked is neither created nor updated, and is never taken for removed (it is still listed at the source).
  - When only zones are picked, the zone's name is updated but its group order is left alone, so the order baseline is kept.
  - Story groups and stories are checked for removal only when every zone and the tale groups were picked, since content in a zone that was not read cannot be known to be gone.
  - Tags or media that were not picked leave their baselines unchanged.
- Fake server: story 9 also made instances served from `control.data.instances`; the two changes merged into one.
- Formatting: new files are prettier-formatted; in files whose base was not prettier-clean only the new blocks were formatted (printWidth 120). A few `it(...)` titles and template strings stay over 120 (prettier does not break strings).

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all succeed.

## Auto Run Result

**Summary:** A re-import now updates the records it brought across instead of only finding them. The importer keeps a baseline of what it last wrote to each zone, tale group and tale (`import_records`, keyed by the TaleArt id, holding TaleArt values only). It then merges each field three ways (source, baseline, current). Names, titles, the order of groups in a zone and of tales in a group, tags and media follow the source unless a person changed them in TaleArt; a person's change is kept. Each update writes through the owning module's new conditional calls, in one transaction per record, with the baseline row locked first. Media is downloaded again only when its source fingerprint changes, and replaced only while the tale still holds the import's copy. Records the source no longer lists stay in TaleArt and are reported. The report gains `changes` per entity: created, updated, unchanged, kept local edit and removed at source. It also gains `keptLocalEdit` and `removedAtSource` differences. The job page shows the changes next to each count row. Re-imports respect story 9's selection.

**Files changed:**
- `libs/contract/`: `ImportChangeCount`, `ImportChanges`, `ImportReport.changes`, kinds `keptLocalEdit` / `removedAtSource`, nullable `ImportDifferenceRecord.position`; regenerated.
- `libs/server/zones/`: `renameZoneWhen`; tests.
- `libs/server/tales/`: `renameTaleGroupWhen`, `renameTaleWhen`, `orderTaleGroupsWhen`, `orderTalesWhen`, `replaceTaleMediaIf`; tests.
- `libs/server/targeting/`: `addTaleGroupTagsByNameIn`; tests.
- `libs/server/importer/`: `reimport.ts` (new: merge rules, baselines) and `reimport.spec.ts`; `migration.ts` (`import_records`, `import_links.source_app_id`, `import_media.source_digest`); `links.ts` (`unlistedLinks`); `worker.ts` (update steps, removal detection, `changes`); `media-copy.ts` (digest, replace); `label-import.ts`; unit tests.
- `apps/fake-storyly/`: test for changed instances.
- `apps/api/src/app.spec.ts`: 10 integration tests (matrix rows, selection), updated expectations.
- `apps/dashboard/src/app/pages/`: change text and difference lines; component test.

**Review:** not run (unreviewed build).

**Follow-up review recommended:** true. The locking between update and creation paths, the conservative "no baseline" rule and the removal scoping under a partial selection deserve a second look.

**Verification:** after merging `autopilot/foundation` 0f3401f, `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --skip-nx-cache` passed for all 12 projects against `taleart_w1_test`: api 351, server-importer 223, dashboard 209, server-tales 71, server-targeting 24, contract 95, fake-storyly 14 tests. There were no lint warnings; the only warning is the dashboard bundle budget warning, which was already there.

**Residual risks:**
- Records imported before this story have no baseline, so their first re-import keeps every differing value as a local edit (conservative; development data only).
- Changing the media URL triggers a download even when the media is the same, for example with signed URLs that change on every response. The bytes are then compared and nothing is replaced, but bandwidth is spent. Story 3's real run will show how the live API names media.
- Records removed at the source are reported on every later run until someone deletes them in TaleArt.
- Story groups and stories are not checked for removal when the selection leaves out a zone or the tale groups.
