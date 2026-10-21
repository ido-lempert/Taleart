---
title: 'Place a zone on a page with stages'
type: 'feature'
ticket: '7'
created: '2026-10-21'
status: 'in-review'
baseline_revision: 'ba22a80bb6a2a17e17aad34fcf0f2ad164b13c6a'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/epic-web-zones.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/tickets/story-show-a-banner-frame-on-the-sample-page-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A host page can only render a whole zone: every frame, in order. A content manager cannot name where on a page one frame of the zone shows, so a bar at the top and a banner further down need two zones (R7).

**Approach:** Contract first: a `Stage` (id, zoneId, projectId, frameId, name, key) with Management routes under `/api/v1/zones/{zoneId}/stages` (list, create, rename, delete), and `DeliveryZone.stages` (`{ key, frameId }`). The zones module owns a `stages` table whose frame must be a frame of the same zone. The dashboard zone page gets a Stages section with create, rename and delete drawers. `<taleart-view stage="<key>">` renders only that stage's frame; an unknown key renders nothing and warns once; with no stage named, today's behaviour (every known frame in order, shared viewer, opener-based focus return) stays.

## Boundaries & Constraints

**Always:**
- Table `stages` in `libs/server/zones` (AD-1, AD-4): `project_id uuid NOT NULL`; `(zone_id, project_id)` references `zones (id, project_id)`; `(frame_id, zone_id)` references `frames (id, zone_id)` `ON DELETE CASCADE`, so a stage's frame is always one of its zone's frames; `UNIQUE (zone_id, key)`. Forward-only, idempotent migration.
- Key: 1–64 characters, lowercase letters, digits and single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`), defined once in `libs/contract` (`STAGE_KEY_PATTERN`, `isStageKey`, `stageKeyFromName`). Set on create, never changed by a rename.
- Errors: blank name, bad key or missing frameId 400 `validation_failed`; a frame not in the zone 400 `frame_not_found`; a key taken in the zone 409 `stage_key_taken`; unknown zone 404 `zone_not_found`; unknown stage or a stage of another zone 404 `stage_not_found`; no project access 403 `forbidden`. Standard error body.
- Delivery: `stages` lists `{ key, frameId }` oldest first; no name, project or stage id leaves the server.
- SDK: `stage` attribute and property; the attribute's trimmed value is compared exactly with stage keys from the response, which is untrusted (non-array `stages`, non-string fields ignored). An empty or missing `stage` renders the zone's frames in order as story 6 built it. A named stage renders only its frame through the same render path (viewer, seen ring, focus return, timers). An unknown key, or a stage whose frame is missing, renders nothing and logs one `console.warn` per load; a stage whose frame type is unknown renders nothing silently (AD-5). Changing `stage` reloads.
- Dashboard (story 14 design system, `styles.css` classes): Stages section on the zone page, accessible names on every control, destructive styling for delete, focus returns to the opener, API messages shown in the drawer.
- Bundle ≤ 50 KB gzipped; sample page a11y scan clean.

**Never:** Changing a stage's frame or key after creation, stages in other zones, playbooks (story 10), theme (story 8), a frame delete route, events, changes to zone keys, Delivery CORS or key handling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | POST `{name:' Top bar ', key:'top-bar', frameId:f1}` | 201 Stage, name trimmed, projectId of the zone | — |
| List | GET stages | the zone's stages, oldest first; other zones' not listed | — |
| Bad body | blank name / key `Top Bar`, `-a`, 65 chars / no frameId | 400 `validation_failed`, nothing stored | — |
| Foreign frame | frameId of another zone, unknown or not a UUID | 400 `frame_not_found` | — |
| Duplicate key | same key twice in a zone; same key in another zone | 409 `stage_key_taken`; 201 | — |
| Rename | PATCH `{name:'Hero'}` (+ ignored key) | 200, name changed, key unchanged | blank 400 |
| Delete | DELETE stage | 204; gone from list and Delivery | unknown/other zone 404 `stage_not_found` |
| Access | content manager of another project | 403 `forbidden` on every route | — |
| Unknown zone | any route | 404 `zone_not_found` | — |
| Delivery | zone with two stages | `stages: [{key, frameId}, …]`; `[]` without | — |
| Migration | run twice | one table, constraints once | — |
| SDK stage | `stage="bar-b"`, zone frames `[bar circle, bar rounded]` | only the rounded-square bar | — |
| SDK no stage | no or empty `stage` | every known frame in order (story 6) | — |
| SDK unknown | `stage="nope"`, or stage frame missing | nothing rendered, one warning, no error | — |
| SDK junk | `stages` missing / not an array / bad entries | treated as no stages | — |
| SDK unknown type | stage on a `feed` frame | nothing, no warning | — |
| SDK change | `stage` attribute changes | reloads and renders the new stage | — |
| SDK viewer | item of a staged bar | viewer opens; focus returns to it | — |
| Dashboard list | zone with stages | name, key, "Frame N · Bar", Rename, Delete | — |
| Dashboard create | type name | key prefilled from name until edited; frame select | API message in drawer |
| Dashboard rename / delete | drawers | PATCH / DELETE, list refreshed | API message in drawer |
| Dashboard no frames | zone without frames | no Add stage; hint to add a frame | — |
| Sample page | `?stages=a,b,nope` | one `<taleart-view stage>` per key | — |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/index.ts`, `src/lib/contract.spec.ts` -- Stage schemas, routes, `DeliveryStage`, error codes, key helpers.
- `libs/server/zones/src/lib/migration.ts`, `stages.ts` (new), `stages.spec.ts` (new), `index.ts` -- table and module functions.
- `apps/api/src/http/zones.router.ts`, `errors.ts`, `delivery.router.ts`, `app.spec.ts` -- routes, error mapping, Delivery `stages`.
- `libs/web-sdk/src/lib/taleart-element.ts` + spec -- `stage` attribute.
- `apps/dashboard/src/app/dashboard.store.ts`, `create-drawer.*`, `pages/zone-detail.*`, `app.spec.ts` -- Stages UI.
- `apps/sdk-sample/index.html`, `a11y-scan.mjs` -- `?stages=` and the stage checks.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- schemas, paths, codes, helpers; `contract:generate`; tests for the key helpers.
- [x] `libs/server/zones/` -- migration, `listStages`, `createStage`, `renameStage`, `deleteStage`, `listDeliveryStages`, errors; unit tests.
- [x] `apps/api/` -- routes, errors, Delivery `stages`; integration tests per API matrix row.
- [x] `libs/web-sdk/` -- `stage` attribute; tests per SDK matrix row.
- [x] `apps/dashboard/` -- store, drawers, Stages section; tests per dashboard row.
- [x] `apps/sdk-sample/` -- `?stages=` and a11y scan of two staged elements plus the unknown-key warning.

**Acceptance Criteria:**
- Given a zone with a circle bar and a rounded-square bar and a stage for each, when the sample page holds two `<taleart-view>` naming the two keys, then each shows its own frame's shape.
- Given an unknown stage key, when the page loads, then that element renders nothing and the console shows a warning, no error.
- Given no stage named, when the page loads, then every frame renders in order as before.
- Given the dashboard zone page, when a content manager creates, renames and deletes a stage, then the list follows and the Delivery API returns the stages.
- Given the SDK build, when `web-sdk:size` runs, then it passes.

## Implementation Notes

- Assumptions (the epic leaves these open; recorded for review, none blocked the build): the content manager types the key on create, prefilled from the name (`stageKeyFromName`) until edited; the key is lowercase letters, digits and single hyphens, at most 64 characters, and never changes (a rename changes only the name), since host pages name it; a stage's frame is picked on create and cannot be changed later (delete and re-create instead); several stages may show the same frame; key matching in the SDK is exact and case-sensitive after trimming the attribute; an empty `stage` attribute means no stage; a stage whose frame type the SDK does not know renders nothing silently (AD-5), while an unknown key or a stage pointing at a missing frame warns once per load; the Delivery API sends only `{ key, frameId }` per stage; changing `stage` refetches the zone (two elements on one page fetch the zone twice).
- Contract: `Stage`, `CreateStageRequest`, `RenameStageRequest`, `DeliveryStage`, `DeliveryZone.stages` (required), routes `/zones/{zoneId}/stages` and `/zones/{zoneId}/stages/{stageId}`, error codes `stage_not_found` (404) and `stage_key_taken` (409); `STAGE_KEY_PATTERN`, `MAX_STAGE_KEY_LENGTH`, `isStageKey`, `stageKeyFromName`. Regenerated with `contract:generate`.
- Zones module: `stages` table with `project_id NOT NULL`, `(zone_id, project_id)` FK to zones, `(frame_id, zone_id)` FK to frames `ON DELETE CASCADE` (new unique index `frames_id_zone_id_key`), `UNIQUE (zone_id, key)`; `listStages`, `createStage`, `renameStage`, `deleteStage`, `listDeliveryStages` and four errors. A frame of another zone is 400 `frame_not_found` (as a body reference, like `tale_group_not_found` on placement).
- API: routes in `zones.router.ts` behind the existing zone authorization; errors mapped in `errors.ts`; Delivery adds `stages`. The API spec's TRUNCATE gains `stages`, and the one full-body Delivery assertion gains `stages: []`.
- SDK: `stage` attribute/property on `<taleart-view>`; `framesToRender` picks the frames before the existing render path, so the shared viewer, opener-based focus return, seen ring and timers from story 6 are unchanged; with no stage named the behaviour is identical. Bundle 9.26 KB gzipped.
- Dashboard: Stages section on the zone page between Frames and Zone key (name, key, "Frame N · Type", Rename and Delete described by the stage name); drawers `stage`, `renameStage`, `deleteStage` (destructive button); the store loads stages last in `refresh()` and updates them locally after each call. No Add stage without frames.
- Sample page: `?stages=a,b` places one `<taleart-view stage>` per key under its own heading; the a11y scan covers two staged bars (circle, rounded-square), an unknown key (empty, one warning), focus return in a staged bar, and an axe scan.
- Merge note: stories 8 and 10 run in parallel and touch `taleart-element.ts`, the Delivery router, the OpenAPI document, the zone page, store and create drawer.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size` -- expected: passes.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:a11y` -- expected: 0 violations, all checks ok.

## Auto Run Result

**Summary:** A zone now has stages (R7). The contract defines `Stage` and the Management routes to list, create, rename and delete a zone's stages, and the Delivery API returns each zone's stages as `{ key, frameId }`. The zones module owns a `stages` table whose frame must be one of its own zone's frames and whose key is unique in the zone. The dashboard zone page has a Stages section with create (key suggested from the name, frame picked from the zone), rename and delete drawers. `<taleart-view stage="<key>">` renders only that stage's frame; an unknown key renders nothing and logs one warning; with no stage named the zone's frames render in order, with story 6's shared viewer and focus return unchanged.

**Files changed:**
- `libs/contract/` -- OpenAPI paths and schemas, generated types, stage key helpers and error codes, tests.
- `libs/server/zones/src/lib/` -- `migration.ts`, `stages.ts` and `stages.spec.ts` (new); `src/index.ts`.
- `apps/api/src/http/` -- `zones.router.ts`, `errors.ts`, `delivery.router.ts`; `apps/api/src/app.spec.ts`.
- `libs/web-sdk/src/lib/taleart-element.ts` and spec.
- `apps/dashboard/src/app/` -- `dashboard.store.ts`, `create-drawer.ts`/`.html`, `pages/zone-detail.ts`/`.html`, `app.spec.ts`.
- `apps/sdk-sample/` -- `index.html` (`?stages=`), `a11y-scan.mjs`.

**Verification:**
- `nx run-many -t lint test build` for the 12 projects -- passed (api 271 tests, dashboard 176, web-sdk 144, server-zones 52, contract 26).
- `nx run web-sdk:size` -- passed, 9.26 KB gzipped.
- `nx run sdk-sample:a11y` -- 0 violations in every scan, including two staged elements and an unknown stage; all behaviour checks ok.

**Residual risks:**
- Not reviewed yet. The dashboard Stages UI is covered by unit tests only, not a signed-in browser run against a live API; the Delivery API and the SDK were exercised separately (integration tests, stubbed sample page), not end to end.
- Product choices recorded as assumptions above (key typed and immutable, frame fixed after create, key pattern) await confirmation.
- Parallel stories 8 (theme) and 10 (playbooks, which create stages) touch the same files; merge with care. Story 10 will need `createStage` from the zones module.
- Each `<taleart-view>` fetches the zone itself, so a page with several stages makes one Delivery request per element.
