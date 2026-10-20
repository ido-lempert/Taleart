---
title: 'Import tale groups and tales in source order'
type: 'feature'
ticket: '2'
created: '2026-10-20'
status: 'built'
baseline_revision: 'fbaf5df2e2d0c96612e460bae80428a32edb84bc'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
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

**Problem:** The importer brings an app's instances across as empty zones; their story groups and stories, the content itself, stay behind.

**Approach:** After each instance's zone, the worker reads the instance's story groups and each group's stories from Storyly, in `sort_order`, and creates a tale group in the project with one placement in that zone (AD-14) and a tale per story (title only), through `@taleart/server-tales`. Each created record gets an import link (AD-7) in the same transaction as its creation, so a re-run finds it and creates nothing twice. The report gains Tale groups and Tales counts.

## Boundaries & Constraints

**Always:**
- Storyly reads (client, read-only, same auth and shape checks as story 1): `GET /story-group?instance_id=` and `GET /story?story_group_id=` (paths from the digests; story 3's real run confirms). A record needs an `id` (number or non-empty string) and a string `title`; `sort_order` is a number or a numeric string. A list whose shape is unexpected fails the job with a message, as in story 1.
- Order: story groups of an instance and stories of a group are created in ascending `sort_order`, ties and records without a usable `sort_order` after them in response order (the latter noted in the report). Because the tales module appends, a fresh zone's placements and a fresh group's tales get positions 0..n-1 in source order.
- Writes only through the tales module's public interface: `createTaleGroup` (zone placement at the end) and `createTale`. Both gain an optional callback that runs inside their transaction once the record exists (as `copyTaleGroup`'s `withCopy`), where the importer locks the source key, re-checks the link and saves it; a link found there rolls the creation back. So a group or tale and its link commit together, and concurrent imports create each once.
- Import links: `source_type` `story_group` → `target_type` `tale_group`, `story` → `tale`, one per source record per project.
- Re-run: a linked group or tale that still exists counts as imported and is not changed (updates are story 7); new source stories of a linked group are added after its tales.
- Report: `{zones, taleGroups, tales, notes}`; each count `{source, imported, skipped}`. `taleGroups` and `tales` are optional in the contract, since reports stored before this story lack them. The dashboard shows "Tale groups: s source / i imported" and "Tales: s source / i imported" rows under Zones (skipped shown when > 0, as Zones).
- Empty names: a blank group title becomes "Untitled tale group"; a blank story title takes its group's name (Storyly's default). Names are trimmed.
- Fake server fixtures: story groups for the three Demo shop instances (Home page 3 groups, Product page 2, Checkout 1, served out of `sort_order` order to prove sorting) and their stories (2–3 each), with the digest field names and no real data; failure switches for the story-group and story lists.

**Never:** Media, covers or media keys (story 5); statuses, schedules, tags/segments (stories 11, 8); per-field difference reporting (story 6); updating or re-placing linked records (story 7); writing `tale_groups`, `zone_tale_groups` or `tales` from the importer.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh import | Demo shop: 3 instances, 6 groups, 15 stories | each zone lists its groups in `sort_order` with their tales in `sort_order`; links per group and story; report zones 3/3/0, taleGroups 6/6/0, tales 15/15/0 | — |
| Re-run | same app again | no new groups, placements or tales; same counts imported | — |
| New story at source | a linked group gains a story | one new tale at the end of the group; others untouched | — |
| No usable `sort_order` | a record without it | created after the ordered ones; note names it | — |
| Blank titles | blank group / story title | "Untitled tale group" / the group's name | — |
| Repeated source id | a group or story listed twice | second one skipped, counted skipped | — |
| Group full | more than 100 stories | extra stories skipped with a note | — |
| Zone not imported | instance's linked zone was deleted | its groups and their stories counted source and skipped, one note | — |
| Linked record gone | a linked group or tale no longer exists | skipped with a note; link not re-pointed | — |
| Source failure | story-group or story list answers 500 or a bad shape | job `failed` with the message; token cleared | — |
| Concurrent jobs | two workers import the same app | each group and tale created once | — |
| Dashboard | finished job with the new report | Zones, Tale groups, Tales rows | an old report without them shows only Zones |

</intent-contract>

## Code Map

- `libs/server/tales/src/lib/tales.ts` -- `createTaleGroup`, `createTale`: add the in-transaction callback; tests in `tales.spec.ts`.
- `libs/server/importer/src/lib/storyly-client.ts` -- `listStoryGroups(instanceId)`, `listStories(storyGroupId)` with `sortOrder`.
- `libs/server/importer/src/lib/worker.ts` -- `importZones` grows into the content import: per instance, its groups and stories; report counts.
- `libs/server/importer/src/lib/links.ts` -- reused (`lockLinkSource`, `findLinkTarget`, `saveLink`).
- `libs/server/importer/package.json`, `project.json`/tsconfig refs -- depend on `@taleart/server-tales`.
- `apps/fake-storyly/src/` -- `story-group` and `story` routes, fixtures, control switches; spec.
- `libs/contract/openapi/openapi.yaml` -- `ImportReport.taleGroups`, `ImportReport.tales`; regenerate.
- `apps/dashboard/src/app/pages/import.ts`, `app.spec.ts` -- report rows.
- `apps/api/src/app.spec.ts` -- integration tests for the matrix rows.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/openapi/openapi.yaml` -- report counts for tale groups and tales; regenerate -- contract first.
- [x] `libs/server/tales/src/lib/tales.ts` -- optional in-transaction callbacks on `createTaleGroup` and `createTale`; tests -- atomic create and link (AD-7).
- [x] `apps/fake-storyly/src/` -- story group and story routes, fixtures, failure switches; tests.
- [x] `libs/server/importer/src/lib/` -- client reads, ordered import of groups and tales with links, report; unit tests.
- [x] `apps/api/src/app.spec.ts` -- integration tests for every matrix row.
- [x] `apps/dashboard/src/app/pages/import.ts` -- Tale groups and Tales rows; component test.

**Acceptance Criteria:**
- Given the fake account, when an admin imports Demo shop, then the report shows Tale groups 6 source / 6 imported and Tales 15 source / 15 imported, and each zone page lists its groups and their tales in the source order.
- Given a finished import, when it runs again, then the project's tale groups, placements, tales and import links do not change in number.
- Given the importer's code, when it is read, then it writes tale groups, placements and tales only through `@taleart/server-tales` and stores Storyly ids only in `import_links`.

## Implementation Notes

- Tales module touch point (epic Boundaries allow additions the importer needs): `createTaleGroup(db, input, withGroup?)` and `createTale(db, input, withTale?)` take an optional callback that runs in their transaction once the record exists, like `copyTaleGroup`'s `withCopy`. Existing callers are unchanged. The importer writes no tales-module table itself.
- Link protocol per group and story (`importLinked` in `worker.ts`): read the link; if none, call the create function, and in its callback take the advisory lock on the source key, read the link again, and save it. If another import linked the record meanwhile, the callback throws, the creation rolls back, and the loop reads the winner's link. Lock order is always module lock (zone advisory lock or group row lock) then link lock, so the two cannot deadlock.
- Storyly paths are assumed from the digests: `GET /story-group?instance_id=` (the update and stats endpoints are `/story-group`) and `GET /story?story_group_id=`. Story 3's real run confirms them. `sort_order` is accepted as a number or a numeric string, since the digests say numbers are sometimes typed as strings.
- Position: the tales module appends, so the importer creates records in source order. A fresh zone gets placements 0..n-1 in `sort_order`, and a fresh group gets tales the same way. On a re-run, a story new at the source goes after the group's existing tales, whatever its `sort_order`, because re-ordering linked records is an update and belongs to story 7.
- A linked group is not placed again or moved if someone removed it from its zone, and a linked record is not renamed (story 7).
- If a story-group or story list fails after some records are written, the job fails with the message and keeps what it wrote. A re-run completes the import without duplicates because each written record is linked.
- A story group listed under two instances is imported once, in the first instance's zone, and the repeat counts as skipped. Placing it in the second zone as well is possible under AD-14, but this story does not decide that.
- Name fallbacks: a blank group title becomes "Untitled tale group", and a blank story title takes the group's name, which is the source's default. Source ids are never used in names, unlike the `Instance <id>` fallback from story 1.
- Fixed a flaky assertion from story 1: `JSON.stringify(zones)).not.toContain('2001')` failed when a UUID contained those digits. It now compares whole values (`leafValues`).
- Fixtures (`apps/fake-storyly/src/fixtures/story-groups.json`, `stories.json`) were generated by hand from the digest field lists. Group ids are 3001–3006 and story ids 4001–4015. Groups and stories are served out of `sort_order` order so the tests show the sorting works. Media URLs point at `media.example`, and no real data is used.

## Plan Change Log

## Review Triage Log

### 2026-10-21 — Coordinator review
- verdicts: 5 findings, all patched
- findings:
  - `[patch]` Six matrix rows were tested only against the in-memory fake. Fixed: API integration tests on the real database for missing sort_order, blank titles, a repeated id, a full group, a zone not imported, and a linked record that is gone.
  - `[patch]` The "no source position" note was written for records that were skipped or already linked. Fixed: `importLinked` reports `created`, and the note is written only for records created in this run.
  - `[patch]` Stories under a skipped group were not marked seen, so a repeated story id counted twice. Fixed: they are added to `seenStories`, so source = imported + skipped; unit test added.
  - `[patch]` A zone or tale group deleted between the check and the create failed the whole job. Fixed: `ZoneNotFoundError` and `TaleGroupNotFoundError` skip the record with a note; unit tests added.
  - `[patch]` No real-database race test. Fixed: the test holds the link's advisory lock, waits until the worker blocks on it, commits a competing link, and checks that the worker's group rolls back and its tales go into the winning group.

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer fake-storyly` -- expected: all succeed.

## Auto Run Result

**Summary:** The importer now brings each instance's story groups across as tale groups of the project, each with one placement in its instance's zone, and their stories as tales with titles only, in `sort_order`. It writes through `@taleart/server-tales`, which gained optional in-transaction callbacks so each record and its import link commit together. Re-runs create nothing twice, and a story that is new at the source is added. The report and the import page have Tale groups and Tales rows. The fake Storyly server serves 6 story groups and 15 stories for Demo shop.

**Files changed:**
- `libs/contract/openapi/openapi.yaml`, `src/generated/api.ts`: optional `taleGroups` and `tales` counts on `ImportReport`.
- `libs/server/tales/src/lib/tales.ts`, `tales.spec.ts`: `withGroup` and `withTale` callbacks, with tests.
- `libs/server/importer/src/lib/storyly-client.ts`, `worker.ts`, `index.ts`, `importer.spec.ts`, `package.json`: story group and story reads, `importContent`, and unit tests for every matrix row.
- `apps/fake-storyly/src/`: `/story-group` and `/story` routes, fixtures, failure switches and `reset()`, with tests.
- `apps/api/src/app.spec.ts`: integration tests (order, placements, links, re-run, new story, list failures, concurrency).
- `apps/dashboard/src/app/pages/import.ts`, `app.spec.ts`: report rows, including the case of an older report.

**Review:** not run (unreviewed build).

**Follow-up review recommended:** true. The link protocol inside other modules' transactions, and the tales module's new callbacks, need a second look.

**Verification:** `nx run-many -t lint test build` passed for all ten projects against `taleart_w3_test`: api 185, dashboard 83, server-importer 27, server-tales 42 and fake-storyly 8 tests, with no lint warnings.

**Residual risks:**
- The Storyly paths `/story-group` and `/story` and the `sort_order` field are assumptions until story 3's real run.
- A re-run does not re-order, rename or re-place linked records (story 7).

**Review (parent):** 5 findings patched (missing real-database tests for six matrix rows, position notes for skipped records, double-counted stories, mid-import deletes failing the job, no deterministic race test). Merged into `autopilot/foundation` after web zones 3.3: the merged tree passes lint, test and build for 12 projects (api 203). Since 3.3, imported tale groups and tales start as `draft` until importer story 11 maps statuses.
