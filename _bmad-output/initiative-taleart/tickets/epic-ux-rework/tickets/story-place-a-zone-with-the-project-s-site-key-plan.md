---
title: "Place a zone with the project's site key and its slug"
type: 'feature'
ticket: '6'
created: '2026-10-22'
status: 'built'
baseline_revision: '342f8bd'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-a-zone-has-one-display-and-a-slug-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md#ad-9'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A host page reads a zone only with that zone's own key, so a site with five zones carries five secrets, and a new zone (story 5 gives it no key) can never be installed (epic R3, owner decision D6).

**Approach:** A project has at most one active site key (access module, like a zone key). The Delivery API answers a site key plus a zone slug with that zone, in the same shape as today. "Installed" in the one visibility rule becomes "the project has an active site key or the zone has an active zone key". The Web SDK takes `site-key` and `zone`; the dashboard gets a temporary Site key card on the zone page.

## Boundaries & Constraints

**Always:**
- Contract first (`openapi.yaml`, generated types, `core.ts`):
  - `GET|POST|DELETE /projects/{projectId}/site-key`: info (`SiteKeyInfo` or null), issue or rotate (`IssuedSiteKey`, 201, admins), revoke (204, admins; none active: 404 `site_key_not_found`).
  - `GET /delivery/v1/zone?zone=<slug>` with `Authorization: Bearer <site key>`. Every refusal on this path (missing, unknown or revoked site key, a zone key, a missing or unknown slug, a slug of another project) is the same 401 `invalid_site_key` body.
  - `SITE_KEY_PREFIX` (`tas_`) and `siteKeyPrefix`.
- Access module: `site_keys` stores the SHA-256 hash and a display prefix only; one active key per project (partial unique index plus a per-project advisory lock); rotating revokes the old key in the same transaction.
- One rule: `zoneInstalledSql(zoneId, projectId)` is "an active site key for the project, or an active zone key for the zone". The zones module gives the project expression (`zoneProjectIdSql`). Delivery, the indicator and the public media, cover and font routes all read it.
- Revoking a site key clears this process's public media and font caches, as a zone key revoke does.
- Zone-key delivery (`/zone` without `zone`) answers exactly as before.
- SDK: `site-key` and `zone` attributes and `siteKey`/`zone` properties; one in-flight request per (API, key, slug) shared by elements; a refusal renders nothing and logs one console error per element. `configureZone(zone, options)` takes a zone slug as well as a legacy zone key (a slug never holds `_`).
- Bundle at most 50 KB gzipped; dashboard initial bundle under 500 kB.

**Never:** removing zone keys or `zone-key` (story 7); the Install tab, snippet or test page (story 13); a batch Delivery endpoint; changing the Delivery shape.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Issue | project without a site key | 201 `tas_…` once; GET shows prefix and date only; DB holds hash |
| Rotate | active key A, issue again | new key B; A answers 401; one active row |
| Concurrent issue | two issues at once | both 201, exactly one active key |
| Revoke | active key | 204; key answers 401; second revoke 404 `site_key_not_found` |
| Deliver | site key + `home-top` | that zone's display and groups, same shape as zone key |
| Unknown slug | site key + `nope` | 401 `invalid_site_key`, body equal to a bad key's |
| Other project's slug | key of P1 + slug of a P2 zone | same 401 |
| Installed | zone without zone key, project site key active | no `zone-not-installed`; revoke: reason back, media 404 |
| Content manager | POST/DELETE site key | 403; GET allowed |
| SDK shared key | two elements, one key, two slugs | each renders its own zone |
| SDK refusal | unknown slug / revoked key | nothing rendered, exactly one console error per element |
| Theme per slug | `configureZone('home-top', { theme })` | only that zone restyles |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `libs/contract/src/lib/core.ts` -- site key shapes, prefix helpers, error codes
- `libs/server/access/src/lib/siteKeys.ts` (new), `zoneKeys.ts`, `migration.ts` -- site key storage, "installed" SQL
- `libs/server/zones/src/lib/frames.ts` -- `zoneIdBySlug`, `zoneProjectIdSql`
- `libs/server/tales/src/lib/delivery-rule.ts` -- zone setup clause reads the project's site key
- `apps/api/src/http/site-key.router.ts` (new), `delivery.router.ts`, `errors.ts`, `app.ts` -- routes
- `libs/web-sdk/src/lib/taleart-element.ts`, `delivery-client.ts`, `README.md`, `scripts/check-types.mjs` -- SDK
- `apps/dashboard/src/app/site-key-card.ts` (new), `pages/zone-detail.*` -- temporary Site key card
- `apps/sdk-sample/index.html`, `a11y-*.mjs` -- `?siteKey=…&zones=a,b`

## Tasks & Acceptance

**Execution:**
- [x] contract -- endpoints, schemas, error codes, prefix helpers, generated types
- [x] access -- site keys and the installed SQL; unit tests
- [x] zones and tales -- slug lookup, project expression, setup clause
- [x] API -- site key routes, Delivery by slug; tests of the matrix
- [x] Web SDK -- attributes, properties, shared requests, per-slug theme; README, types check; tests
- [x] sample and a11y scripts -- site-key scenario
- [x] dashboard -- Site key card; tests

**Acceptance Criteria:**
- Given a project with a site key and two zones, when the sample page places both slugs with it, then each shows its own display and groups.
- Given a zone with no zone key, when the project's site key is revoked, then the indicator says "zone not installed" and the Delivery API and public media refuse.

## Implementation Notes

- **Contract.** `GET|POST|DELETE /projects/{projectId}/site-key` (`SiteKeyInfo`, `IssuedSiteKey`), `siteKey` security scheme, the optional `zone` query parameter on `GET /delivery/v1/zone`, error codes `site_key_not_found` (404) and `invalid_site_key` (401), `SITE_KEY_PREFIX` (`tas_`), `siteKeyPrefix`, `DELIVERY_ZONE_PARAM`.
- **Access.** `site_keys` (created by `migrateAccess`, references only `projects` and `users`): SHA-256 hash and a 10-character display prefix, a unique index on the hash and a partial unique index on `project_id WHERE revoked_at IS NULL`. Issue and revoke take `pg_advisory_xact_lock(hashtext('site_keys:' || project))`; issuing revokes the active key in the same transaction. `projectForSiteKey` hashes and queries whatever it gets (also an empty or non-`tas_` value) and accepts only `tas_` keys.
- **One rule.** `zoneInstalledSql(zoneId, projectId)` = active site key of the project OR active zone key of the zone. The tales module passes `zoneProjectIdSql(z)` from the zones module, so Delivery, the indicator and the public media, cover and font routes all follow it. Revoking a site key clears the process's public media and font caches.
- **Delivery.** With `?zone=`, the router always runs both lookups (site key, then `zoneIdBySlug` with the found project or the nil UUID), so every refusal costs two indexed queries and answers the same 401 `invalid_site_key` body ("A valid site key and zone are required") with `WWW-Authenticate: Bearer`: an unknown, empty, repeated or malformed slug, another project's slug, a missing, unknown, revoked or zone key. Without `zone`, the zone key path is unchanged (`invalid_zone_key`). The 200 body is the same `DeliveryZone`; caching stays `private, no-cache` with ETag (the slug is in the URL).
- **Web SDK.** `site-key`/`siteKey` and `zone`/`zone`; the site key and slug win over `zone-key` when both are set; nothing is requested (and nothing logged) while either is missing. `fetchZone` shares one in-flight request per URL and key; each element parses its own copy; a settled request is forgotten, so later loads ask again. No batch endpoint. `configureZone(zone, options)` takes a slug, or a legacy zone key (`tak_…`; a slug never holds `_`); warnings name a slug in full and a key by its first 8 characters. 21.85 KB gzipped.
- **Dashboard.** `pages/site-key-card.ts`, a self-contained card on the zone page above the Zone key card (one line in `zone-detail.html`): the snippet with the zone's slug, prefix and date; for admins Issue, Rotate, Revoke in a drawer that warns that rotating and revoking affect every zone of the project; the key shown once with Copy and Done; the store is read again after each change. `app.spec.ts` answers the card's own GET.
- **Sample page.** `?siteKey=…&zones=a,b` places one element per slug under "Zone <slug>"; `&themeZone=<slug>` limits `&theme=` to that zone. `a11y-scan.mjs` has a site-key scenario (two zones, unknown slug with one error, theme for one slug, one request per zone, axe clean).
- Playwright browsers were missing from `~/Library/Caches/ms-playwright` on this machine; `playwright install chromium` restored them.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --skip-nx-cache` -- passed (api 540 tests, dashboard 417, web-sdk 335).
- `web-sdk:size` 21.85 KB gzipped; `web-sdk:types-check` passed; `sdk-sample:a11y` no violations; `sdk-sample:a11y-review` 3 of 206 failed (the known landscape full height, landscape contrast, R16 pixel diff); `sdk-sample:perf` cold p75 1271 ms. Dashboard initial 493.14 kB.

**Manual checks:**
- Playwright (`shots-8.6/`): issue on the zone page, key shown once, zone visible; sample page with two zones, unknown slug renders nothing with one error; theme for `home-top` only; revoke: "Not visible: zone not installed", three elements empty with one error each.
