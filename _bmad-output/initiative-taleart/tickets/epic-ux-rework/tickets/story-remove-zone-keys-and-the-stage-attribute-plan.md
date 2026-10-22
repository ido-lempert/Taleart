---
title: 'Remove zone keys and the stage attribute'
type: 'refactor'
ticket: '7'
created: '2026-10-22'
status: 'built'
baseline_revision: 'd6a86ab'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/epic-ux-rework.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-place-a-zone-with-the-project-s-site-key-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-a-zone-has-one-display-and-a-slug-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 8.6 added the project site key but kept the legacy zone key path everywhere (API, Delivery, SDK, dashboard, sample page, scripts). The owner decided on 2026-10-22 that nobody uses zone keys, the `stage` attribute or the pre-rework SDK (epic R4 dropped), so two key paths are now cost without value.

**Approach:** Delete the zone key path end to end. The site key plus the zone slug is the only way to place a zone; "installed" means the project has an active site key. A forward-only access-module migration drops `zone_keys`.

## Boundaries & Constraints

**Always:**
- Delivery requires `Authorization: Bearer <site key>` and `?zone=<slug>`; every refusal (no key, unknown/revoked key, a `tak_` key, no slug, unknown or foreign slug) is the same 401 `invalid_site_key` body with `no-store`, after the same two lookups.
- `zoneInstalledSql(projectId)` = active site key of the project; Delivery, the indicator and the public media, cover and font routes keep reading it.
- Contract first: the `/zones/{zoneId}/key` operations, `zoneKey` security scheme, `ZoneKeyInfo`, `IssuedZoneKey`, `zone_key_not_found`, `invalid_zone_key`, `ZONE_KEY_PREFIX`, `zoneKeyPrefix` go; `zone` becomes a required query parameter.
- SDK: `site-key` + `zone` only; `configureZone(slug, …)` only; a mistaken `tas_` name is still masked in warnings. Bundle ≤ 50 KB gz, first content ≤ 1.5 s p75.
- Dashboard: only the Zone key card and its store/drawer code go (story 8.9 restructures the zone page in parallel).

**Never:** a Delivery path without a slug; keeping `zone_keys` rows; touching the Site key card's behaviour; the Install tab (story 13).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Old route | GET/POST/DELETE `/zones/{id}/key` | 404 `not_found` |
| No slug | site key, no `zone` | 401 `invalid_site_key` |
| Old key form | `tak_…` with a slug | 401 `invalid_site_key` |
| Installed | project with active site key | every zone of it installed; revoke: `zone-not-installed`, media 404 |
| Migration | old `zone_keys` table with rows | table dropped; second run changes nothing |
| SDK | `zone-key` attribute only | no request, nothing rendered, no error |
| Sample | `?key=` / `?keys=` | nothing placed; `?zones=…#siteKey=…` places one element per slug |

</intent-contract>

## Code Map

- `libs/server/access/src/lib/siteKeys.ts`, `index.ts`, `errors.ts`; `zoneKeys.ts` removed -- drop migration, `zoneInstalledSql`
- `libs/server/tales/src/lib/delivery-rule.ts` -- installed clause
- `apps/api/src/http/delivery.router.ts`, `app.ts`, `errors.ts`, `db.ts`; `zone-keys.router.ts` removed
- `libs/contract/openapi/openapi.yaml`, `src/lib/core.ts`, generated types
- `libs/web-sdk/src/lib/taleart-element.ts`, `delivery-client.ts`, `theme.ts`, `README.md`, `scripts/check-types.mjs`
- `apps/dashboard/src/app/dashboard.store.ts`, `create-drawer.*`, `pages/zone-detail.*`, `pages/site-key-card.ts`
- `apps/sdk-sample/index.html`, `serve.mjs`, `a11y-scan.mjs`, `a11y-review.mjs`, `perf.mjs`; `legacy-sdk.mjs` removed

## Tasks & Acceptance

**Execution:**
- [x] access, tales -- remove zone keys, drop table, site-key-only installed rule; unit tests
- [x] contract -- shapes and codes removed, types regenerated
- [x] API -- routes and Delivery path removed; tests moved to site keys
- [x] Web SDK -- attribute, property, key form of `configureZone` removed; source grep test
- [x] dashboard -- Zone key card, drawer and store code removed; test
- [x] sample page and scripts -- site key only; legacy-SDK pixel comparison removed

**Acceptance Criteria:**
- Given a project with a site key and two zones, when the sample page places both slugs, then each renders its own display.
- Given the zone page, then no Zone key card is shown and no `/zones/{id}/key` request is made.

## Implementation Notes

- **Migration.** `migrateSiteKeys` (access module, runs first) ends with `DROP TABLE IF EXISTS zone_keys`. Dropping a referencing table needs nothing from the zones module, so the separate "access (zone keys)" step is gone. 8.5 never recorded original-zone or stage-key bookkeeping in the database (only the fold's `renamedStageKeys` log), so nothing else to drop.
- **Delivery.** One path: the site key and slug lookups run every time; a missing slug reads as the empty slug. Every 401 is `invalid_site_key`.
- **Installed.** `zoneInstalledSql(projectId)` takes only the project expression (from `zoneProjectIdSql`). Consequence: a second zone of an installed project is installed at once; two API tests and the 8.2 oracle were updated, and the oracle now also compares with the project's site key revoked so the not-installed case keeps its coverage.
- **API tests.** Zone keys were the tests' way into Delivery. `installZone(zoneId)` (a display, then the project's site key, reused while the one the test file issued is still active) returns a handle `<site key>|<slug>`; `deliverZone(handle)` sends it as the SDK does. Zone-key-only tests (issue/rotate/revoke/race/content manager) were removed, since the site key suite already covers each. New: old routes answer 404; Delivery without a slug, or with a `tak_` key, is refused; the `zone_keys` drop on a database from the release before, run twice.
- **SDK.** 21.86 KB → 21.80 KB gzipped (the merge of 8.15 is in the second figure). `no-zone-keys.spec.ts` fails if `zone-key`, `zoneKey`, `tak_` or `ZONE_KEY` appears in any SDK source file. `check-types.mjs` asserts `element.zoneKey` is a type error.
- **Sample page.** Only `?zones=…#siteKey=…` (or `&siteKey=` in the query). Each zone sits under "Zone <slug>", also when there is one. `a11y-scan`/`a11y-review` serve the Delivery API by site key and slug.
- **Legacy-SDK check.** `legacy-sdk.mjs` and the R16 before/after pixel comparison in `a11y-review.mjs` are removed: the pre-rework build can only be placed with a zone key. The other R16 checks (migrated tale's name, default covers) stay. The review now has 2 known failures (landscape full height, landscape contrast) instead of 3.
- **Dashboard.** Zone key card, its drawer, `zoneKeys` store state and its per-zone GET removed; the site key card's revoke text no longer mentions zone keys. Initial bundle 493.15 kB.

## Release note (deploy)

**This release needs a stop-the-world deploy, as story 8.5 did.** Stop every API instance of the release before, then start this one. Its start-up migration drops `zone_keys`, which the release before still reads, and its Delivery API refuses the zone keys and the `zone-key` pages of the release before. The drop runs in its own transaction with `SET LOCAL lock_timeout = '10s'`: if an old instance still holds the table, the start fails with a lock timeout instead of queueing every query behind it.

## Review fixes (2026-10-22)

- **Merge of 8.9.** The zone page is in tabs now; the Zone key section 8.9 left below the tab panels is deleted with its `zoneKey` computed, `issuedDate` and styles. The Install tab holds only the site key card, which names no zone key.
- **Drop.** `dropZoneKeys` checks `to_regclass('zone_keys')`, then `BEGIN`, `SET LOCAL lock_timeout = '10s'`, `DROP TABLE IF EXISTS zone_keys`, `COMMIT` (rollback on error). Unit tests: the statement order, no transaction when the table is gone, rollback on a lock timeout.
- **R16 visual guard, without zone keys.** `apps/sdk-sample/fixtures/r16-baseline/` holds one PNG per case, captured at 4768734 in a temporary worktree (removed): the "before" images the release before 7.11 (489b892) drew, except `image-1280.png`. Section 15 of `a11y-review.mjs` draws each case with this SDK and compares it with `differing()`: 0 pixels must differ.
  - Decision (coordinator, owner may change): `image-1280.png` is this SDK's own output, since the wide-screen viewer (f752d74) was a requested change. The old comparison failed there with 766090 differing pixels.
  - Pinned: `baseline.json` names the Chromium the PNGs were drawn with (156.0.8078.4, Playwright's bundled build). Another version fails one check that asks for a recapture.
  - Result: image 390, image 1280, video, gif, overlay, empty, background-image, background-video: 0 pixels differ each.
- **Docs.** The epic marks R4 retired (Description line, R4 header, R7's "zone not installed", Done when). Architecture AD-2 drops the `[ASSUMPTION]` on legacy zone keys and records the 2026-10-22 decision; AD-9 is site keys only.
- **SDK.** An element with the old `zone-key` attribute logs one `console.warn` (once per element): "TaleArt: the zone-key attribute is no longer supported; place the zone with site-key and zone". The attribute name is built by concatenation, so the source check still passes. 21.87 KB gzipped.
- **Sample page.** With only `key` or `keys`, one line says zone keys are no longer supported and how to open the page; `a11y-scan` checks it.
- **Caches.** Issuing a site key now also clears this process's public media and font caches: a "not public" answer kept just before (for up to 30 s) would otherwise hide a newly installed zone's fonts.
- **Tests.** A session cookie with a valid slug and no bearer key is refused; the two site key revokes in the Delivery tests assert 204; a delivered tale's project font is 404 after the site key is revoked and 200 at once after a new one is issued; the site key issue test asserts the info never contains the key's hash.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- passed (after review fixes: api 548, dashboard 498, web-sdk 341, server-access 32).
- `web-sdk:size` 21.87 KB; `web-sdk:types-check` passed; `sdk-sample:a11y` no violations; `sdk-sample:a11y-review` 2 of 207 failed (the known landscape full height and landscape contrast; every R16 baseline 0 px); `sdk-sample:perf` cold p75 1272 ms. Dashboard initial 493.15 kB.

**Manual checks:**
- Playwright (`shots-8.7/`): zone page without a Zone key card, Visible on site; sample page with two zones by slug and site key; `?key=` places nothing; old routes 404.
