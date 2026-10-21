---
title: 'Import labels as tags on tale groups'
type: 'feature'
ticket: '8'
created: '2026-10-21'
status: 'in-review'
baseline_revision: '7081607'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-storyly-importer/epic-storyly-importer.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-storyly-importer/import-mapping.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Imported tale groups carry no tags, although Storyly labels (the story group `segments` field and the segments list) decide who sees a group; the epic decision maps them to TaleArt tags (mapping row "Segment / label value → tag on the tale group").

**Approach:** The worker reads the app's labels list and each story group's `segments` value, turns every usable label into a project tag through the targeting module (find-or-create by name ignoring case, as copy-to-zone does), and adds the group's tags to its tale group without removing any. Labels that cannot become tags are differences; the report gains a Tags count.

## Boundaries & Constraints

**Always:**
- Sources (story 3 is frozen, so shapes are the fake's guesses and are checked defensively):
  - `GET /segment?app_id=`: a list (bare or `{data}`) of label records `{id, name}` (expected shape: required `id`, `name`, alias `name` ← `title`, `value`, `label`; known `app_id`, `account_id`, `ts_created`, `ts_updated`) or bare strings. Story 6's checker reports their differences under the new entity `tag`. If the list fails (any error, 401/403, not a list), the job goes on with a note, since the path is a guess.
  - Story group `segments`: an array, or a JSON string holding one. Items: a string, or an object whose `name` / `title` / `value` / `label` is a string. Absent, null, `''` and `[]` mean no labels. Any other value is a `wrongType` difference on the group (field `segments`).
- A label becomes a tag when its trimmed text is 1–40 characters (`normalizeTagName`). Otherwise it is skipped with a `tagNotImported` difference (entity `tag`, record within its group or the list, position in its array or list) whose `reason` is `blank`, `tooLong` or `notText`. A list record whose name the checker already reported (missing or wrong type) gets no second difference.
- Targeting module, public interface only: `ensureTags(db, projectId, names)` and `addTaleGroupTagsByName(db, taleGroupId, names)`. Both find-or-create by name ignoring case (an existing tag keeps its spelling) and `addTaleGroupTagsByName` adds links with `ON CONFLICT DO NOTHING` under the group's tag lock; nothing is ever removed.
- Every tale group the import holds (created now or already linked) gets its source group's tags. Tags carry no import links: the name is their identity, so source ids stay only in `import_links` (AD-7).
- Report `tags: {source, imported, skipped}`: source = distinct label texts read (trimmed, exact case; each non-text value once), imported = those now carried by a project tag, skipped = the rest. Distinct labels that differ only in case become one tag and get one note. When any label was read, a note says the AND / OR match mode is not imported (mapping table).
- Every label text in a report goes through `storedText` (token removed, then cut); labels draw on story 6's difference budget; the token never reaches report or logs.
- Fake server: `/segment` route, `segments.json`, `failSegments` switch; Demo shop gets labels (4 in the list, 3 used on groups); new "Label shop" (1005) holds the odd cases: blank, very long, case duplicates, non-text, JSON-string segments, a non-list segments value, renamed and invalid list records.
- Dashboard: a "Tags" row, a "Tags" difference group and lines such as "segments: label not imported (longer than 40 characters)".

**Never:** Removing or renaming tags or tag links; AND/OR rules or targeting (targeting epic); tag import links; failing the job for a label; cutting a long label to fit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Demo shop | 4 listed labels, 3 used | tags 4/4/0; each tale group carries its group's tags; AND/OR note | — |
| Existing tag | project has "VIP", label `vip` | "VIP" reused, no new tag | — |
| Re-run | same app again | tags and tag links unchanged in number | — |
| Tag added in TaleArt | person adds "manual" to an imported group, re-run | "manual" kept | — |
| Case duplicates | `Summer`, `summer`, `SUMMER ` | one tag; counts equal; one note | — |
| Blank / long / non-text | `""`, 41+ chars, `42`, `null`, `{}` | skipped; `tagNotImported` with reason | job continues |
| JSON string | `'["json-label"]'` | parsed, imported | — |
| Wrong container | `segments: {include: [...]}` | `wrongType segments` on the group | job continues |
| List records | renamed `title`, no id, `name: 42` | renamed used; invalid skipped; wrongType | — |
| List fails | `/segment` 500 or not a list | done; note; tags from groups only | — |
| Group gone | tale group deleted during import | note; job continues | — |
| Token | label holding the token | report holds `[token]` | — |
| Dashboard | report with tags / older report | Tags row and lines / nothing | — |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/generated/api.ts`, `src/index.ts` -- `ImportReport.tags`, entity `tag`, kind `tagNotImported`, `ImportTagFailure`, `reason` union.
- `libs/server/targeting/src/lib/tags.ts`, `index.ts`, `tags.spec.ts` -- `ensureTags`, `addTaleGroupTagsByName`.
- `libs/server/importer/src/lib/record-shape.ts` -- `tag` shape, name field per shape, group `segments` carried.
- `libs/server/importer/src/lib/labels.ts` (new) -- parse `segments`, classify label texts.
- `libs/server/importer/src/lib/storyly-client.ts` -- `listLabels(appId)`.
- `libs/server/importer/src/lib/worker.ts` -- label step, report, notes; `package.json` depends on targeting.
- `apps/fake-storyly/src/` -- route, fixtures, Label shop, spec.
- `apps/api/src/app.spec.ts` -- integration tests per matrix row.
- `apps/dashboard/src/app/pages/import-job.ts`, `import-shared.ts`, `app.spec.ts` -- Tags row and difference text.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- schemas; regenerate -- contract first (AD-3).
- [x] `libs/server/targeting/` -- find-or-create and additive link functions; unit tests -- one owner of tags (AD-1).
- [x] `libs/server/importer/` -- shape, parsing, client, worker step, report; unit tests -- AD-7, AD-8.
- [x] `apps/fake-storyly/` -- labels route and fixtures; test.
- [x] `apps/api/src/app.spec.ts` -- integration tests for every matrix row.
- [x] `apps/dashboard/` -- Tags row, difference group and text; component tests.

**Acceptance Criteria:**
- Given the fake account, when an admin imports Demo shop, then the report shows Tags 4 source / 4 imported and each tale group carries its source group's tags.
- Given a project with tag "VIP", when an app with label `vip` is imported, then the project still has one such tag and the groups carry it.
- Given a finished import, when it runs again, then the project's tags and tale-group tags do not change in number and tags added in TaleArt remain.

## Implementation Notes

- Assumptions (story 3 is frozen): the labels list is `GET /segment?app_id=`, a list of `{id, name}` records or bare strings; a group's `segments` is a list of strings (or a JSON string of one). Both come from the digests ("segments (JSON string)", "Segments are string labels") and are guesses. Object items are read through `name`, `title`, `value` or `label`. An object `segments` value (for example include/exclude lists) is a `wrongType` difference, not interpreted.
- Both sources become tags, following the epic decision ("the values of the story group `segments` field and segments endpoint become TaleArt tags"): a label only in the list becomes a tag on no group (Demo shop's `returning`).
- A labels list that cannot be read (error status, unreachable, not a list, or a refused token on that path only) adds a note and the import goes on with the groups' labels, since the path is a guess. Every other list still fails the job, as before.
- A label longer than 40 characters is skipped with `tooLong`, not cut: a cut name could collide with another label and change who sees a group.
- Counting: a label is one distinct trimmed text in its own case, so `Summer` and `summer` count as two source labels, both imported as one tag, with one note naming them (at most 5 names quoted). A non-text value counts once per occurrence. Blank texts share one key (`''`). source = imported + skipped.
- Tags hold no import links: the name ignoring case is their identity, so a re-run finds the same tag. A label renamed at the source becomes a new tag on the next run; the old tag stays on the group (nothing is removed).
- Re-run: tags are only added. A tag a person added stays. A tag a person removed from an imported group comes back on the next run, because there is no record of what the import added; story 7 (re-import updates) can decide otherwise.
- Differences: label problems are listed under the new entity `tag`; group-list label differences are listed right after the group list (they are part of those records); list-record differences come after the instance list. `ImportDifference.reason` is now `ImportMediaFailure | ImportTagFailure`.
- Targeting module: `ensureTags` and `addTaleGroupTagsByName` share a find-or-create helper (`INSERT … ON CONFLICT (project_id, lower(name)) DO NOTHING`, then a select keyed by the requested name). `copyTaleGroupTags` was left as it was to keep its tested queries. A group deleted between the project read and the link insert (FK 23503) becomes `TaleGroupNotFoundError`, which the importer turns into a note.
- Tests deleting a tale group directly (API test of a deleted earlier import) now delete its `tale_group_tags` rows first, since imported groups carry tags.
- Fixtures: Demo shop's groups gained `segments` (counts and differences unchanged); new `segments.json` and app "Label shop" (1005, instance 2401, groups 3401–3405, stories 4401–4405) generated by a throwaway script; no real data.
- Merged `autopilot/foundation` (7081607, web zones story 9) by fast-forward before committing; no files overlapped. Verification below ran on the merged tree.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all succeed.

## Auto Run Result

**Summary:** Storyly labels now come across as tags. The worker reads the app's labels list (`/segment`) and each story group's `segments` value, finds or creates a project tag per usable label through the targeting module (by name ignoring case, so existing tags are reused), and adds each group's labels to its tale group without removing any tag. Labels that cannot become tags (blank, over 40 characters, not text) and `segments` values of the wrong type are report differences; a labels list that cannot be read is a note. The report and job page gain a Tags row, a Tags differences group, a case-merge note and an AND/OR note. Re-runs add no tags or links twice.

**Files changed:**
- `libs/contract/`: `ImportReport.tags`, entity `tag`, kind `tagNotImported`, `ImportTagFailure`, `reason` union; regenerated.
- `libs/server/targeting/`: `ensureTags`, `addTaleGroupTagsByName`; tests.
- `libs/server/importer/`: `labels.ts`, `label-import.ts` (new), `tag` record shape, `listLabels`, worker label step; unit tests (`labels.spec.ts`, `importer.spec.ts`).
- `apps/fake-storyly/`: `/segment` route, `failSegments`, `segments.json`, Demo shop labels, Label shop; test.
- `apps/api/src/app.spec.ts`: 8 integration tests (Demo shop, reused tag, re-run with a TaleArt tag, odd labels, list failures x2, token), updated expectations.
- `apps/dashboard/src/app/pages/`: Tags row and difference text; component test.

**Review:** not run (unreviewed build).

**Follow-up review recommended:** true. Label shapes and the `/segment` path are guesses, and the re-add of tags removed in TaleArt should be confirmed with story 7.

**Verification:** on the tree merged with `autopilot/foundation` (7081607), `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` passed for all 12 projects against `taleart_w3_test`: api 313, dashboard 192, server-importer 158, server-targeting 19, fake-storyly 13 tests. The only warning is the existing dashboard bundle budget warning.

**Residual risks:**
- The labels endpoint path and both label shapes are unconfirmed until story 3; a different live shape shows up as differences or a note, not as tags.
- A tag removed in TaleArt from an imported group is re-added on the next import.
- Distinct Storyly labels differing only in case collapse into one tag (noted in the report).
