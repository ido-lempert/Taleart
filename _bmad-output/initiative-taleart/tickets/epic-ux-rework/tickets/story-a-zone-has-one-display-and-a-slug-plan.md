---
title: 'A zone has one display and a slug; stages and frames migrate into zones'
type: 'feature'
ticket: '5'
created: '2026-10-22'
status: 'built'
baseline_revision: '793f2e8'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/epic-ux-rework.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-every-zone-group-and-tale-says-whether-it-is-visible-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md#ad-17'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A zone held several frames and stages, so one zone was really a content channel with its places on a page hidden in stages. People had to learn three nouns (zone, frame, stage) for one idea (epic R1, R2, owner decision D1).

**Approach:** A zone is one spot. It has a slug, unique in its project, and at most one frame, its display. A forward-only migration in the zones module turns each stage and each extra frame into its own zone, with copies of the original zone's placements through the tales module. Stages leave the Management API, the Delivery API, the Web SDK and the dashboard. The Frames card becomes one Display card.

## Boundaries & Constraints

**Always:**
- Contract first (`libs/contract/openapi/openapi.yaml`, `core.ts`). AD-17 keeps the name `frame` in the API; the UI says Display.
  - `Zone` gets `slug` and `frame` (a `Frame` or null). `CreateZoneRequest` takes an optional `slug`. `UpdateZoneRequest` takes `name` and `slug`.
  - `POST /zones/{zoneId}/frame` sets the display (`SetFrameRequest`: type and optional settings). A zone that already has one answers 409 `display_exists`.
  - `PATCH /zones/{zoneId}/frame` (`UpdateFrameRequest`: type and/or settings) changes it. A new type without settings resets them to that type's defaults. No display answers 404 `display_not_found`.
  - `PATCH /zones/{zoneId}` renames a zone or changes its slug. A taken slug answers 409 `slug_taken`. A slug with spaces, uppercase or other characters answers 400 `validation_failed`.
  - The `/frames` and `/stages` endpoints, `Stage`, `DeliveryStage` and the stage error codes are removed. `DeliveryZone` has `slug` and `frame` (one `DeliveryFrame` or null) in place of `frames` and `stages`.
  - `ZONE_SLUG_PATTERN`, `isZoneSlug` and `zoneSlugFromName` replace the stage key helpers.
- Database (zones module): `zones.slug`, NOT NULL, unique per project. `frames` is unique per zone. The `stages` table is dropped once folded.
- Migration (`foldStagesIntoZones`): it runs after the tales migration and gets `copyZonePlacements` from the tales module (AD-14). It is one transaction and does nothing on a second run.
  - A zone with stages keeps its id and becomes its oldest stage's zone: the stage's name, its key as slug, its frame as display.
  - Every further stage becomes a new zone with the same name, slug and display. A frame two stages show is copied for the second.
  - A frame no stage shows, and every frame after the first of a zone without stages, becomes "<zone name> – <Type> <n>". `n` counts the zone's frames of that type, oldest first.
  - New zones copy `playbook_key` and the placements in the same order. They sort right after the original. They get no zone key.
  - Slugs come from the stage key or the name. They are made unique in the project with `-2`, `-3`, and so on, oldest zone first.
- Visibility: "zone has no display" is still `zoneHasDisplaySql` (a frame row of the zone). The indicator and the Delivery filter keep one source.
- Playbooks: applying one creates the zone's display from its preset. A zone that already has a display answers 409 `display_exists`. No stage is created.
- SDK: renders `zone.frame`. The `stage` attribute and property are removed.

**Never:** recording the original zone id or stage key (owner decision 2026-10-22: R4 dropped); new zone keys; site keys (story 6); templates in the New zone drawer (story 8); the zone page tabs (story 9); Tale Studio files (story 4 runs in parallel).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Zone with stages | "Home": stages Top (bar f1), Promo (banner f2); unstaged bar f3; groups G1, G2 | "Top" `top` (id kept, f1); "Promo" `promo` (f2); "Home – Bar 2" `home-bar-2` (f3); each lists G1, G2 |
| Zone with frames only | "Shop": bar f4, banner f5 | "Shop" `shop` (f4); "Shop – Banner 1" `shop-banner-1` (f5) |
| No frame | "Empty" | one zone `empty`, no display |
| Two stages, one frame | stages A, B both show f1 | A keeps f1; B gets a copy of f1 |
| Slug clash | two zones whose stage key is `home-top` | `home-top`, `home-top-2` |
| Second run | migrated database | nothing changes |
| Second display | POST frame on a zone with one | 409 `display_exists` |
| Bad slug | `Home Top`, `HOME` | 400 `validation_failed` |
| Duplicate slug | slug of another zone of the project | 409 `slug_taken`; another project may use it |
| Type switch | bar (gap 20) to banner and back to bar | banner defaults, then bar defaults |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `libs/contract/src/lib/core.ts`, `playbooks.ts` -- shapes, slug helpers, error codes
- `libs/server/zones/src/lib/migration.ts`, `fold.ts` (new), `zones.ts`, `frames.ts`, `playbooks.ts`; `stages.ts` removed -- zone slug, display, fold
- `libs/server/tales/src/lib/tales.ts` -- `copyZonePlacements`
- `apps/api/src/db.ts`, `http/zones.router.ts`, `http/delivery.router.ts`, `http/errors.ts` -- routes and migration order
- `libs/web-sdk/src/lib/taleart-element.ts`, `delivery-client.ts` -- one display, no stage
- `apps/dashboard/src/app/dashboard.store.ts`, `create-drawer.*`, `pages/zone-detail.*`, `pages/zones.ts` -- Display card, no Stages card
- `apps/sdk-sample/index.html`, `a11y-scan.mjs` -- sample page and scan fixtures without stages

## Tasks & Acceptance

**Execution:**
- [x] contract -- schemas, endpoints, helpers, generated types
- [x] zones module -- slug, display, fold, playbook; unit tests
- [x] tales module -- `copyZonePlacements`
- [x] API -- routes, Delivery, migration step; tests for the fold, the refusals, the type switch and Delivery of each folded zone
- [x] Web SDK and sample -- one display, no stage
- [x] dashboard -- Display card, slug, no Stages card; component tests

**Acceptance Criteria:**
- Given the seeded database of the matrix, when the API starts, then it lists five zones with one display each, the expected names and slugs, and the same placement list in each; a restart changes nothing.
- Given each folded zone with a zone key, when the Delivery API is asked, then it returns that zone's display and its groups.

## Implementation Notes

- The original zone of a staged zone takes its oldest stage's name, as R2 says ("each takes the stage's name"). So "Home page" with the stages "Home top bar" and "Home promo" becomes "Home top bar". Zones with only frames, and zones with no frame, keep their names.
- `n` in "<zone name> – <Type> <n>" counts the zone's frames of that type, oldest first, including frames a stage shows. The second bar of "Home" is "Home – Bar 2". The type name is the key capitalised, because the migration has no registry.
- When two stages show one frame, the later stage's zone gets a copy of it with a new id; the earlier one keeps the id.
- New zones sort right after their original (`created_at` plus n microseconds, read in SQL). They copy `playbook_key` and get no zone key, so they read "zone not installed" until story 6.
- The fold runs in one transaction. A second run finds nothing to do and changes nothing. It runs as its own step after the tales migration (`apps/api/src/db.ts`). In order, it:
  - reads the stages and drops the `stages` table, because its foreign key would stop frames from moving;
  - moves the frames and inserts the new zones;
  - copies the placements through `copyZonePlacements` (tales module), keeping the positions;
  - fills the slugs, oldest zone first in each project;
  - sets `slug NOT NULL` and adds `frames_zone_id_key` (one display per zone).
- `createZone` picks a free slug and inserts it with `ON CONFLICT DO NOTHING`, trying again if another request takes the slug first. This keeps it usable inside the importer's transaction. A slug the caller gives that is already taken answers 409.
- `setDisplay` inserts only when the zone has no frame, and the unique index catches races.
- A new display without settings stores the type's defaults explicitly. A type change without settings stores the new type's defaults.
- Delivery: `DeliveryZone` has `slug` and `frame` (or null); `frames` and `stages` are gone. The Web SDK renders `zone.frame` and no longer has the `stage` attribute or property (21.5 KB gzipped). The sample page places one element.
- Playbooks: a playbook has one `frame`. Applying it to a zone that has a display answers 409 `display_exists`, and the dashboard hides "Apply playbook" then.
- Dashboard:
  - A Zone carries its display, so the store no longer loads `/frames` or `/stages`.
  - The Display card shows the type, a summary of the settings, a Settings button (opens the drawer) and a type picker with "Change type". A change is announced in the live region.
  - A zone without a display has "Choose display".
  - The New zone drawer takes an optional slug. The header and the zone cards show the slug.
- The sample page and its scripts (`a11y-scan.mjs`, `a11y-review.mjs`) use the new shape after the review fixes below.

## Follow-up review fixes (2026-10-22)

- Zones made from extra frames take the original zone's own unique slug as their base: `<slug>-<type>-<n>` (for example `top-bar-bar-2`). That base is cut so the type and the number always fit in 64 characters.
- Stage keys: every free key is kept first, then keys another zone took get a suffix, oldest zone first. The fold report and its log list each of these as `renamedStageKeys` (`zoneId`, `key`, `slug`), since a page that named the stage needs the new slug.
- The New zone drawer's slug preview is made unique against the picked project's zones, as the API does.
- Each fold test clears only its own projects' slugs.

## Release note (deploy)

**This release needs a stop-the-world deploy.** Stop every API instance of the release before, then start this one. Its start-up migration (`foldStagesIntoZones`) drops `stages` and makes `zones.slug` NOT NULL. Once it has run, an instance of the release before fails:
- it reads `stages`, which is gone;
- it inserts zones without a slug, which the database now refuses.

A rolling deploy must not be used. The fold runs once, under the migration lock, in one transaction, so several instances of this release can start together.

## Review fixes (2026-10-22)

- **Sample page.** `apps/sdk-sample/index.html` had a second head, body, element and script, the second still reading `?stages=`. It now has one of each. `?keys=a,b` places one `<taleart-view>` per zone key, each under its own heading; `?key=` places one.
- **Accessibility scripts.**
  - `a11y-scan.mjs` and `a11y-review.mjs` serve the Delivery API by key with the new shape (`slug`, `frame`). The bar and the banner are two zones, two keys and two elements.
  - The stage scenarios are replaced by "two zones, two displays": each has its own shape and its own named items, and an unknown key renders nothing and logs one error. The playbook and theme-override scenarios now use zones.
  - The R16 comparison serves the legacy `frames` list to the build from before the rework.
- **Names without Latin letters (Hebrew).**
  - The fold now picks slugs in three passes:
    1. stage keys that are valid slugs, reserved before anything else;
    2. original zone names (`zone` when the name gives none);
    3. zones made from frames, as `<name slug or original slug>-<type>-<n>`, and stage zones whose key is not a slug, as their name's slug or `<original slug>-<type>`.
  - Stage keys are checked with `isZoneSlug`. `uniqueZoneSlug` cuts a base to 64 characters.
- **Zone page.** "Edit name and slug" opens a drawer that saves through `PATCH /zones/{id}`. The New zone drawer previews the slug made from the name, and requires a slug when the name gives none. A refusal marks only the field it is about: `slug_taken`, or a message about the slug or the name.
- **Display card.** The settings summary sits in a labelled group.
- **OpenAPI.** `POST /zones` documents the slug, 409 `slug_taken` and 400 `project_not_found` (the API's existing answer; it was 400 before this story). `PATCH /zones/{id}/frame` documents 409 `concurrent_change`.
- **Display changes.** `updateDisplay` writes only while the display has the type it read (`AND type = $4`). On a miss it checks once more against the new type, then refuses with 409 `concurrent_change`.
- **Fold DDL.** `SET NOT NULL` runs only while the column is nullable. `frames_zone_id_idx` and `frames_id_zone_id_key` are dropped, since `frames_zone_id_key` covers them. `migrateZones` no longer creates `frames_zone_id_idx`. The type names in new zone names are the keys capitalised, which match the shipped registry labels (commented).
- **Tests.**
  - API:
    - Hebrew names in `createZone` and the fold;
    - stage keys that are not slugs;
    - a zone with a single stage;
    - two projects with one stage key, with stage keys reserved before names;
    - a failing `copyPlacements` that rolls everything back, leaving the stages, frames, zones and nullable slug intact;
    - three concurrent `migrate()` runs that fold once and leave only `frames_pkey` and `frames_zone_id_key`.
  - Zones lib: the conditional display update.
  - Contract: the slug cut, and that a Hebrew name gives no slug.
  - Dashboard: the slug preview, a Hebrew name requiring a slug, `slug_taken` marking only the slug, and editing a zone's name and slug.
  - Not done: a fold test starting from the real cf1bf03 migrations. It would need that release's API built beside this one. The tests rebuild its schema by hand (`legacySchema`), with the same constraints and indexes.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting web-sdk sdk-sample` -- expected: all pass.
- `web-sdk:size`, `web-sdk:types-check` -- expected: pass. Dashboard initial bundle under 500 kB.

**Manual checks:**
- Playwright: the zone page's Display card, switching bar to banner to bar, and the zones list after the migration (`shots-8.5/`).
