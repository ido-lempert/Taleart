---
title: 'Check each record and list every difference in the report'
type: 'feature'
ticket: '6'
created: '2026-10-21'
status: 'in-review'
baseline_revision: '69a48ecb7cd61f0426acdeb459a9e349b748413d'
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
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The client checks only `id` and `title` and fails the whole job on a bad record; every other field is dropped silently, so a report can match every count and still hide what did not come across (epic R2, R3; FR-029).

**Approach:** A shape checker in the importer compares each Storyly record (app, instance, story group, story) with the expected shape before mapping: required fields, known fields, fields TaleArt does not hold, and known renames. The client returns each record with its differences, and records it cannot map (not an object, no usable id) as rejected. The worker counts rejected records as source and skipped, and the report gains a `differences` list (entity, record, field, kind) and a once-only `notImportedByDesign` list. The job page shows the differences grouped by entity and record.

## Boundaries & Constraints

**Always:**
- Expected shapes (source field names, from `import-mapping.md` and digests api-recipes-r1-3, entities-content-r1-1; story 3 confirms):
  - app: required `id`, `title`; not held `settings`; known `token`, `category`, `store_type`, `store_id`, `account_id`, `is_inbox_story`, `detailed_info`.
  - instance → zone: required `id`, `title`; not held `token` (per-platform token); known `app_id`, `platform`.
  - story group → tale group: required `id`, `title`, `sort_order`, `status`; not held `media` (cover), `pinned`, `settings`, `clicked_target_cap`; known `segments`, `ts_start`, `ts_end` (later stories map them), `app_id`, `instance_id`, `account_id`, `ts_created`, `ts_updated`.
  - story → tale: required `id`, `title`, `sort_order`, `status`, `media`; not held `deep_link`, `outlink`, `button_text`, `settings`, `target_cap`, `studio_image`, `thumbnail`, `name` (when it differs from the title); known `type`, `mime_type`, `media_raw`, `ts_start`, `ts_end`, `story_group_id`, `account_id`, `ts_created`, `ts_updated`.
- Difference kinds: `missing` (a required field absent and not found renamed), `renamed` (an expected field found under another name: same name ignoring case, `_` and `-`, or a listed alias: `title` ← `name` for apps, instances and groups; `clicked_target_cap` ← `click_target_cap`), `unexpected` (a field the shape does not know), `wrongType` (a required field null or of the wrong type: `title` not text, `sort_order` not a number or numeric text), `notHeld` (a not-held field with a value: not null, `''`, `false`, `{}` or `[]`), `invalidRecord` (not an object, or no usable id: the record is skipped).
- A renamed field is used for mapping (a renamed `title` names the record). A wrong or missing `title` takes story 2's fallback name; a wrong or missing `sort_order` places the record after the others (story 2's note). A shape difference never fails the job; a list response that is not a list (non-2xx or no list) still fails it, as in stories 1 and 2.
- Report: `differences: ImportDifference[]` — `{entity: app|zone|taleGroup|tale, record: {sourceId, name, within, position}, kind, field, sourceField}`; `field` is the expected (or unexpected) field name, `sourceField` the name the source used for a rename. Listed in reading order, once per record (a repeated record is not listed again). `notImportedByDesign: ["Conversion records", "Stats"]` on every report. Both optional in the contract (older reports lack them). At most 5,000 differences are stored; `differencesOmitted` counts the rest.
- No field value ever enters the report; names and record titles are cut to 200 characters, and the token is removed from every report string before it is stored. The token is never logged.
- Fake Storyly server: two more apps beside Demo shop: "Odd shop" (1002), whose records carry a renamed field, an unexpected field, wrong types, missing fields, invalid records and a story with a deep link and button text; and "Clean shop" (1003), whose records match the expected shapes with no not-held values. Demo shop's counts stay as they are.
- Dashboard (story 14 design system): the job page's report shows "Differences (n)" grouped by entity (`<details>`, open when it holds 20 or fewer), each record once with its differences as lines ("deep_link: not held in TaleArt"), "No differences" when the list is empty, and "Not imported by design: Conversion records, Stats". An older report without `differences` shows neither.

**Never:** Values of source fields in the report; failing a job for a record's shape; mapping new fields (media, status, schedules, tags, components are stories 5, 8, 11, 13); changing story 1's per-zone "frame type unknown" notes; pagination of differences in the API.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean | Clean shop | done; counts equal; `differences: []`; not-imported-by-design listed | — |
| Demo shop | instances with tokens, groups with covers | done; 15/15 tales; 3 `notHeld token`, 6 `notHeld media` | — |
| Renamed title | instance with `name`, no `title` | imported under that name; `renamed title ← name` | — |
| Renamed other | story with `sortOrder`; group with `click_target_cap` | position used; `renamed` each | — |
| Unexpected | group with `theme`, story with `cta_macro` | imported; `unexpected` each | — |
| Not held | story with `deep_link`, `button_text`, `outlink`, `settings`; group `pinned: true` | imported; `notHeld` each, no values | — |
| Wrong type | group `title: 42`, `sort_order: "first"` | "Untitled tale group", placed last; `wrongType` each | — |
| Missing | group without `status`, story without `media` | imported; `missing` each | — |
| Invalid record | instance `"oops"`, record without id, story with id `{}` | skipped (source and skipped counted); `invalidRecord` with position | — |
| Repeated record | a story listed twice | skipped as in story 2; its differences listed once | — |
| Many differences | over 5,000 | first 5,000 stored; `differencesOmitted` counts the rest | — |
| Token | any report | no token in report or logs | — |
| List not a list | story list answers `{unexpected: true}` | job failed, as before | — |
| Dashboard | report with differences / empty / older report | grouped list / "No differences" / nothing | — |

</intent-contract>

## Code Map

- `libs/server/importer/src/lib/record-shape.ts` (new) -- shapes per entity, `checkRecord`.
- `libs/server/importer/src/lib/storyly-client.ts` -- lists return checked records with differences and rejected ones.
- `libs/server/importer/src/lib/worker.ts` -- `importContent` counts rejected records, collects differences, report fields; `runImportJob` adds app differences, redacts the token.
- `libs/server/importer/src/lib/importer.spec.ts` -- unit tests.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- `ImportDifference`, report fields; regenerate.
- `apps/fake-storyly/src/fixtures/*.json`, spec -- Odd shop and Clean shop.
- `apps/api/src/app.spec.ts` -- integration tests per matrix row.
- `apps/dashboard/src/app/pages/import-job.ts`, `import-shared.ts`, `app.spec.ts` -- differences view.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- `ImportDifference`, report fields; regenerate -- contract first (AD-3).
- [x] `libs/server/importer/` -- shape checker, client, worker, report; unit tests for every matrix row -- AD-8, FR-029.
- [x] `apps/fake-storyly/` -- Odd shop and Clean shop fixtures; test.
- [x] `apps/api/src/app.spec.ts` -- integration tests: clean, odd, Demo shop differences, token absent.
- [x] `apps/dashboard/src/app/pages/` -- differences section; component tests.

**Acceptance Criteria:**
- Given Odd shop, when an admin imports it, then the job is done and the report lists the renamed field, the unexpected field and the story's deep link and button text against their records.
- Given Clean shop, when it is imported, then the report has no differences and lists conversion records and stats once as not imported by design.
- Given any import, when its report is read, then it holds no source field value and no token.

## Implementation Notes

- Which fields count as differences is an assumption of this story, since story 3's real run is frozen: the expected shapes come from `import-mapping.md`, the digests and the fake fixtures. Fields that a later importer story maps (`media`, `status`, `ts_start`, `ts_end`, `segments`, `type`, `mime_type`, `media_raw`) are expected fields, not differences. The ticket gives their differences to stories 5, 8 and 11. Until those stories ship, a report does not say that tale media, statuses, schedules or tags were not carried. This keeps "a clean fixture shows no differences" true, but it is a known gap against R2 until stories 5, 8 and 11 land.
- Source bookkeeping (`account_id`, `app_id`, `instance_id`, `story_group_id`, `ts_created`, `ts_updated`, the app's `token`, `category`, `store_*`, `is_inbox_story`, `detailed_info`, the instance's `platform`) is known and never a difference.
- Following the mapping table, the instance's `token` (per-platform token) and the story group's `media` (cover) are `notHeld`. Demo shop therefore reports 3 token and 6 cover differences. Clean shop is the clean fixture. The report holds only the field name `token`, never its value.
- Required fields are needed to map the record now or later. Absent is `missing`. Null or of the wrong type is `wrongType`: `title` must be text and `sort_order` a number or numeric text; for other fields only null counts. Optional fields that are absent are not differences, so the real API leaving out null fields does not flood the report.
- Renames are detected for absent expected fields only: the same name ignoring case, `_` and `-` (so `sortOrder`, `Title` and `ID` all match), or a listed alias (`title` ← `name` for apps, instances and groups; `clicked_target_cap` ← `click_target_cap`, the documented misspelling). A renamed value is used, so a renamed `title` names the zone and a renamed `sort_order` places the tale. A story's `name` is its internal name, not an alias. It is `notHeld` only when it differs from the title.
- `notHeld` needs a value. `null`, `''`, `false`, `{}` and `[]` do not count; `0` does.
- A record that is not an object, or has no usable id (also after rename detection), is skipped. It counts as source and skipped and is listed as `invalidRecord` with its position in the list (from 1). A list that is not a list still fails the job, as in stories 1 and 2. That failure is about the response, not a record, and stories 1, 2 and 4 depend on it.
- The client (`StorylyClient.list*`) now returns `{records, rejected}`. `ContentSource` accepts either that or a plain array (`SourceList`), so the existing unit tests keep plain arrays. The apps route answers only checked apps, and one without a title shows its id.
- Differences are listed once per record, when the record is first seen. A repeated id is not listed again. The stories of a skipped group are still listed. `within` is the TaleArt name of the parent: the zone for groups, the tale group for stories.
- 5,000 stored differences (`MAX_IMPORT_REPORT_DIFFERENCES`) is a technical bound, like story 4's list limit. The rest are counted in `differencesOmitted`. `IMPORT_NOT_IMPORTED_BY_DESIGN` lives in the contract.
- Token: differences hold no values. Names and fields are cut to 200 characters, and `runImportJob` runs `redactDeep` over the whole report before storing it.
- Dashboard: `import-shared.ts` groups differences by entity, then by record (`importDifferenceGroups`). The job page shows each entity group in a `<details>` element, open at 20 differences or fewer, with the record list scrolling inside it (max-height 420px). It shows "No differences" for an empty list and nothing for an older report. Rows use the story 14 tokens.
- Fake server: `apps.json` now lists Demo shop, Odd shop (1002) and Clean shop (1003). Instances, groups and stories are added under new ids (21xx/22xx, 31xx/32xx, 41xx/42xx). Demo shop's data is unchanged, though `instances.json` was re-indented. The fixtures were generated by a throwaway script and hold no real data.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all succeed.

## Auto Run Result

**Summary:** Each Storyly record (app, instance, story group, story) is now checked against its expected shape before it is mapped (FR-029, AD-8). The report lists missing, renamed, unexpected and wrong-type fields, fields TaleArt does not hold that carry a value, and records that could not be read. Each difference is named against its entity and record (source id, title, parent, position), with field names only. Conversion records and stats are listed once as not imported by design. A record's shape never fails the job: a renamed field is used, a bad title or position takes story 2's fallbacks, and an unreadable record is skipped and counted. The job page shows the differences grouped by entity and record and stays readable for long lists. The fake server gains Odd shop (every matrix row) and Clean shop (no differences).

**Files changed:**
- `libs/contract/openapi/openapi.yaml`, `src/index.ts`, `src/generated/api.ts`: `ImportDifference` (+ entity, kind, record), `ImportReport.differences`, `.differencesOmitted`, `.notImportedByDesign`; `IMPORT_NOT_IMPORTED_BY_DESIGN`, `MAX_IMPORT_REPORT_DIFFERENCES`.
- `libs/server/importer/src/lib/record-shape.ts` (new), `record-shape.spec.ts` (new): expected shapes and `checkRecord`.
- `libs/server/importer/src/lib/storyly-client.ts`, `worker.ts`, `importer.spec.ts`: checked lists, differences collected into the report, rejected records counted, `redactDeep`.
- `apps/api/src/http/imports.router.ts`, `app.spec.ts`: apps from checked lists; integration tests for Odd shop, Clean shop, Demo shop differences, a repeated record.
- `apps/fake-storyly/src/fixtures/*.json`, `fake-storyly.spec.mjs`, `main.mjs`: Odd shop and Clean shop.
- `apps/dashboard/src/app/pages/import-job.ts`, `import-shared.ts`, `app.spec.ts`: differences section and tests.

**Review:** not run (unreviewed build).

**Follow-up review recommended:** true. The expected-shape tables are guesses until story 3, and the choice to leave later-story fields out of the differences should be confirmed.

**Verification:** `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` passed for all 12 projects against `taleart_w3_test`: api 234, dashboard 133, server-importer 50, fake-storyly 10 tests. The only warning is the dashboard bundle budget warning, which was already there before this story. A template warning (NG8107) was fixed and the dashboard was re-run.

**Residual risks:**
- The expected shapes, aliases and the not-held list are assumptions until story 3's real run. If the live API leaves fields out or renames them widely, reports will be long, though the job still completes.
- Until stories 5, 8 and 11 ship, the report does not say that media, statuses, schedules and tags are not carried yet.
- Reports of very large imports can hold up to 5,000 differences (roughly 1 MB of JSON) in the job row, and the job page reads that report once the job has finished.

