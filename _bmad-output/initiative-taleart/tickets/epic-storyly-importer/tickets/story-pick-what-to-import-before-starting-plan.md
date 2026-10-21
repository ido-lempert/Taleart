---
title: 'Pick what to import before starting'
type: 'feature'
ticket: '9'
created: '2026-10-21'
status: 'in-review'
baseline_revision: '596ffbcfb580cabd5169840e1e8300b74099665d'
route: 'full'
route_source: 'auto'
risk: 'low'
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

**Problem:** An import always brings across every instance of the app and every entity type. An admin cannot see what the app holds before starting, and cannot leave out a zone, media or tags (epic R1 "picks what to import").

**Approach:** After the token and app are chosen, a preview call reads the app's instances with their story group and story counts (bounded, token not stored) and answers a signed selection key naming the instances it saw. Starting an import may carry a selection (zones by source id, and whether tale groups and tales, media and tags come across); the API checks it against the key, the job stores it, and the worker imports only what was picked. The report lists unpicked zones and entity types as "not selected", counted as skipped, never as missing.

## Boundaries & Constraints

**Always:**
- Preview `POST /projects/{projectId}/imports/storyly/preview {token, appId}` → 200 `ImportPreview {appId, appName, zones: [{id, name, taleGroups, tales}], zonesBeyond, countsComplete, selectionKey, expiresAt}`. It reads the app list (the app must be one the token reads, else 400 `import_selection_invalid`), the app's instances, and for counting each instance's story group list and each group's story list. Counts are source counts (list entries, as the report's `source`).
- Preview bounds: at most 500 zones listed (`zonesBeyond` counts the rest); at most 100 count requests and 20 s of counting in all, 10 s per request; an instance whose counts were not read gets `null` counts and `countsComplete: false`. A count list that fails (non-2xx, not a list) leaves that instance's counts `null`; a refused token is 400, a failing app or instance list 502, as "Find apps".
- The token is used only during the preview call: never stored, logged, or put in the key or response. No job or other row is written.
- Selection key: `v1.<payload>.<mac>` (base64url), payload `{project, app, user, zones, expires}`, HMAC-SHA256 with a key derived (HKDF) from `IMPORT_TOKEN_KEY`; valid 30 min. Stateless.
- `StartImportRequest.selection?` `{selectionKey, zones: string[] (1..500, unique), taleGroups, media, tags: boolean}`. Shape errors → 400 `validation_failed`. Key bad, expired, or for another project, app or user; a zone id the key does not name; media or tags without tale groups → 400 `import_selection_invalid`, no job. Without `selection` the import takes everything, as before.
- `import_jobs.selection jsonb` (nullable, forward-only) stores `{zones, taleGroups, media, tags}`; the key is not stored.
- Worker: an instance not picked is not created and none of its groups or stories is read; it counts `source` and `skipped` with `zones.notSelected`, and its shape differences are not listed. A picked id no longer in the live list is a note. `taleGroups: false` reads no group or story list and the report has no `taleGroups`/`tales`; `media: false` downloads nothing; `tags: false` reads no labels.
- Report: `notSelected?: {zones: [{sourceId, name}] (at most 500), entities: ('taleGroups'|'media'|'tags')[]}`; `ImportCount.notSelected?` (part of `skipped`).
- Dashboard (story 14 design system): Find apps → pick app → "Choose what to import" loads the preview → picker: a Zones fieldset with a tri-state "All zones" checkbox (select all / none) over one checkbox per zone with its counts, a live "n of m zones selected" count; a Content fieldset nesting Media and Tags under "Tale groups and tales" (disabled when it is unticked); Start disabled with no zone picked. All zones and types start ticked. The job page shows "Zones: 3 source / 2 imported / 1 skipped (1 not selected)" and rows such as "Tags: not selected", and lists the zones not selected.

**Never:** Storing or logging the token for the preview; persisting previews; story-group or story level selection; deleting records imported earlier when a re-run leaves their zone out; changing story 2.3 (frozen); new concurrency in the worker (story 10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Preview | Demo shop | Home page 3/8, Product page 2/5, Checkout 1/2 (groups/stories), `countsComplete: true`, key; no rows written | — |
| Preview bad token / app | wrong token / app 9999 | 400 `storyly_token_invalid` / 400 `import_selection_invalid` | — |
| Preview list fails | instances 500 / story list 500 | 502 `storyly_unavailable` / 200 with that zone's counts null, incomplete | — |
| Preview bounds | more zones or requests than the caps; slow source | first 500 zones, `zonesBeyond`; counts null past 100 requests or 20 s | — |
| Untick zone and tags | Demo shop minus Checkout, tags off | done; 2 zones, their groups and tales; zones 3/2/1 notSelected 1; no `tags`; notSelected lists Checkout and tags; no Checkout or label request | — |
| Zones only | tale groups off | zones only; notSelected entities taleGroups, media, tags; no group request | — |
| Media off | media off | tales without media; no media request | — |
| Unknown zone | id not in the key | 400 `import_selection_invalid`; no job | — |
| Bad key | tampered, expired, other project/app/user | 400 `import_selection_invalid` | — |
| Dependent types | media or tags with tale groups off | 400 `import_selection_invalid` | — |
| Bad shape | no zones, duplicates, > 500, non-boolean | 400 `validation_failed` | — |
| Zone gone | picked id gone at the source by run time | done; note | — |
| No selection | `{token, appId}` | everything, as before | — |
| Content manager | preview | 403 `forbidden` | — |
| Dashboard | picker | tri-state all/none, counts, dependent types disabled, start sends the selection | API message shown |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- preview path, `ImportPreview`, `ImportPreviewZone`, `ImportSelection`, `ImportNotSelected`, `ImportCount.notSelected`, code `import_selection_invalid`; regenerate.
- `libs/server/importer/src/lib/preview.ts` (new) -- bounded preview read; selection key sign/verify.
- `libs/server/importer/src/lib/migration.ts`, `jobs.ts` -- `selection` column, stored on create, read on claim.
- `libs/server/importer/src/lib/worker.ts` -- `importContent` options `zones`, `taleGroups`; `runImportJob` maps the job's selection.
- `apps/api/src/http/imports.router.ts`, `errors.ts`, `app.spec.ts` -- preview route, selection validation; tests.
- `apps/dashboard/src/app/import.service.ts`, `pages/import.ts`, `pages/import-job.ts`, `pages/import-shared.ts`, `app.spec.ts` -- picker and report rows.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- schemas, path, error code; regenerate -- contract first (AD-3).
- [x] `libs/server/importer/` -- preview, key, selection column, worker filters; unit tests (bounds, key, filters).
- [x] `apps/api/src/` -- preview route, start validation; integration tests for every API matrix row.
- [x] `apps/dashboard/src/app/` -- picker and report rows; component tests.

**Acceptance Criteria:**
- Given the fake account, when the admin unticks one zone and tags and starts, then only the ticked zones arrive and the report shows the unticked zone and tags as not selected (skipped), not as missing.
- Given a preview, when its rows are inspected, then no token is stored anywhere and no job exists.
- Given a start naming a zone id the preview did not see, then it is refused and no job is created.

## Implementation Notes

- Assumption: the preview's caps (500 zones listed and pickable, 100 count requests, 20 s of counting, 10 s per request) and the selection key's 30 min lifetime are technical bounds like story 4's 50 and story 6's 5,000, not product decisions. An app with more than 500 instances can be imported whole only through the API without a selection; the picker says so ("N more zones than can be listed").
- Assumption: media and tags depend on tale groups (tale media lives on tales; tags go on tale groups, mapping table). The API refuses media or tags without tale groups (400 `import_selection_invalid`), and the picker disables them with a hint. With tags picked, the app-wide labels list still becomes tags even when some zones are left out (story 8's rule); only the left-out zones' group labels are not read.
- Validation is stateless: the preview answers a `selectionKey` (`v1.<base64url payload>.<HMAC-SHA256>`, key derived with HKDF from `IMPORT_TOKEN_KEY`, info `taleart import selection key v1`). The payload names project, app, user, zone ids and expiry; it holds no token. A start with a selection is checked against it (zones ⊆ listed ids, same project/app/user, unexpired), so starting stays instant (story 1's AD-8 choice: `POST /imports` never calls Storyly). No preview row exists to clean up.
- The worker still checks against the live list: a picked zone gone by run time is a note ("Zones: n picked zone(s) are no longer in the app"); an instance new since the preview is not picked, so it counts as not selected.
- Counting semantics: zone counts are source counts (list entries, as the report's `source`); a story group listed under one instance twice is counted once for its stories. A count list that fails with Storyly unavailable leaves that zone's counts null; a refused token anywhere fails the preview with 400.
- Report: an instance not picked counts `source` and `skipped` with `zones.notSelected`; its zone is not created, none of its groups or stories is read, and its shape differences are not listed (their budget is given back). `report.notSelected = {zones: [{sourceId, name}] (≤ 500), entities}` is present only when something was left out. With tale groups not picked the report has no `taleGroups`/`tales` (the job page then shows "Tale groups and tales: not selected, skipped"). Media and tags not picked leave `media`/`tags` absent and list the type in `notSelected.entities`.
- Re-running with a zone unticked never deletes what an earlier run imported; the zone just counts as not selected.
- `import_jobs.selection jsonb` stores `{zones, taleGroups, media, tags}` (not the key); `ClaimedJob.selection` is optional so existing callers and tests are unchanged. Without a selection an import takes everything, as before (the API stays compatible; the dashboard always sends one).
- Worker changes are confined to `importContent`'s instance loop head, a `continue` before the group list, the report's end, and `runImportJob`'s options (to stay mergeable with story 7, which edits the worker in parallel).
- Fake server: `control.data.instances` (by app id) is now editable like the other lists, so a test can remove an instance between preview and run.
- Dashboard: "Find apps" → app select → "Choose what to import" (preview) → picker form with two fieldsets: Zones (tri-state "All zones" native checkbox with `indeterminate`, `aria-controls` the list; one checkbox per zone, its counts as `aria-describedby`; a `role=status` "n of m zones selected") and Content ("Tale groups and tales" with Media and Tags nested beneath, disabled with a described reason when it is unticked). "Start import" is disabled with a described reason when no zone is picked. Changing the token or app drops the preview. An expired or refused selection shows the API's message; "Choose what to import" reads it again. The UI wording keeps "Storyly" only where story 1 already used it.
- Verification ran against `taleart_w2_test`. No browser smoke test was run (passkey sign-in); the flow is covered by component and integration tests.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all succeed.

## Auto Run Result

**Summary:** Before starting an import, the admin now sees the chosen app's zones (Storyly instances) with their tale group and tale counts and picks which zones and which content (tale groups and tales, media, tags) to import. A bounded preview call reads the counts without storing the token and answers a signed selection key; the start validates the selection against it server-side (unknown zones, forged, expired or foreign keys, media/tags without tale groups refused). The job stores the selection, the worker imports only what was picked and reads nothing of what was not, and the report lists unpicked zones and content as "not selected, skipped", never as missing or as differences.

**Files changed:**
- `libs/contract/openapi/openapi.yaml`, `src/index.ts`, `src/generated/api.ts`: `previewStorylyApp` path, `ImportPreviewRequest`, `ImportPreview`, `ImportPreviewZone`, `ImportSelection`, `ImportEntityChoice`, `ImportNotSelected(Zone)`, `ImportCount.notSelected`, `ImportReport.notSelected`, `StartImportRequest.selection`, code `import_selection_invalid`, `MAX_IMPORT_SELECTED_ZONES`.
- `libs/server/importer/src/lib/preview.ts` (new), `preview.spec.ts` (new), `jobs.ts`, `migration.ts`, `worker.ts`, `index.ts`: bounded preview, selection key, `selection` column, worker filters.
- `apps/api/src/http/imports.router.ts`, `app.spec.ts`: preview route, selection validation; integration tests.
- `apps/fake-storyly/src/fake-storyly.mjs`: editable instance lists.
- `apps/dashboard/src/app/import.service.ts`, `pages/import.ts`, `pages/import-job.ts`, `pages/import-shared.ts`, `app.spec.ts`: picker, not-selected report rows; component tests.

**Review:** none run (unreviewed build).

**Follow-up review recommended:** true. New security-relevant surface: the stateless HMAC selection key and the preview's outbound request bounds.

**Verification:** `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` passed for all 12 projects against `taleart_w2_test` with no lint warnings: api 339, dashboard 206, server-importer 186, contract 95, fake-storyly 13 tests.

**Residual risks:**
- The preview runs Storyly reads inside an HTTP request (up to ~20 s of counting plus two list calls of up to 10 s each); a slow source makes "Choose what to import" slow, though bounded.
- The selection key is a bearer-style proof bound to project, app and user; anyone holding a valid key still needs admin access to the project and the Storyly token to start.
- Story 7 (re-import updates) edits the same worker function in parallel; the changes here are small but a merge may need care around `importContent`'s instance loop.
