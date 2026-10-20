---
title: 'Publish, pause and archive tale groups and tales'
type: 'feature'
ticket: '3'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/epic-web-zones.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Every tale group and tale is delivered and its media is public as soon as it exists; a content manager cannot hold back new content, pause a running group or tale, or archive one (R5, AD-6, AD-11).

**Approach:** Contract first, add the AD-6 status keys with their HTTP codes, defined once in `libs/contract`. The tales module stores a status on tale groups and tales (new rows `draft`, rows that existed before migrate to `live`) and changes it through a small transition table. The Delivery API and the public media route read only `live` content; the dashboard shows a status badge and offers Publish, Pause, Archive and Restore on groups (zone page) and tales (tale drawer).

## Boundaries & Constraints

**Always:**
- Contract: schema `ContentStatus` with every AD-6 key (`draft`, `live`, `scheduled`, `processing`, `invalid-media`, `paused`, `blocked-by-group`, `expired`, `quota-reached`, `archived`); `CONTENT_STATUS_HTTP_CODES` (draft 204 `[ASSUMPTION]`, live 200, scheduled 202, processing 102, invalid-media 422, paused 403, blocked-by-group 423, expired 410, quota-reached 429, archived 404) and `statusHttpCode(status)` defined only in `libs/contract`. `SetStatusRequest { status: 'live' | 'paused' | 'archived' }`. New error code `invalid_status_transition`.
- `TaleGroup`, `ZoneTaleGroup` and `ProjectTaleGroup` carry `status` (the stored key). `Tale` carries `storedStatus` (the key a person set) and `status` (as read): `blocked-by-group` when the tale is `live` and its group is `paused`, else the stored key. Story 4 adds `scheduled`/`expired` to the read status; nothing stores them.
- Storage: `tale_groups.status` and `tales.status`, `text NOT NULL`, CHECK on the storable keys (`draft`, `live`, `paused`, `archived`, `processing`, `invalid-media`, `quota-reached`). The migration adds each column with default `live` (filling existing rows) and then sets the default to `draft`, in one statement guarded by "column missing", so it is idempotent and a second run changes nothing.
- Transitions (same for groups and tales): `live` from `draft` or `paused` (Publish); `paused` from `live` (Pause) or from `archived` (Restore); `archived` from `draft`, `live` or `paused` (Archive). Setting the current status again answers 200 unchanged. Anything else answers 409 `invalid_status_transition`.
- Routes, authorized with the project helper (AD-4): `PUT /api/v1/tale-groups/{taleGroupId}/status` → 200 `TaleGroup` (with tags); `PUT /api/v1/tales/{taleId}/status` → 200 `Tale`. Resource first (404), then body (400 `validation_failed`), then transition (409).
- Delivery: `GET /delivery/v1/zone` lists only `live` groups placed in the zone, each with only its `live` tales; a live group with no live tale is left out (nothing to play).
- Public media (AD-11): `GET /media/{key}` serves a key only while a `live` tale of a `live` group references it (copies share keys, AD-14); otherwise 404 `media_not_found`. Because a paused tale's URL must answer 404 at once, the cache header becomes `Cache-Control: public, no-cache` with the key as ETag (revalidated, 304 when unchanged) instead of one year immutable.
- Copy to zone (1.16): the copy is a new group and starts `draft`; copied tales keep their source tale's stored status.
- Dashboard: each group row shows a status badge (Draft, Live, Paused, Archived) and the buttons its transitions allow (Publish, Pause, Archive, Restore), each described by the group name; the tale card shows a badge for anything but Live, including "Blocked by group"; the tale drawer shows the tale's status and its buttons. A refused change shows the API's message (zone page banner, or the drawer's alert). The Tale groups page shows each group's badge.
- `_test` database only (`taleart_w2_test`); standard error body.

**Never:** Schedules, `scheduled`/`expired` (story 4); `processing`, `invalid-media`, `quota-reached` setters; deleting content; filtering archived items out of the dashboard; SDK changes beyond what the filtered Delivery response gives; changes to zone keys or Delivery CORS.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New content | create a group, add a tale | both `draft`; Delivery omits the group | — |
| Copy | copy a live group with a live and a paused tale | copy `draft`; its tales `live`, `paused` | — |
| Migration | rows made before status existed | after start they are `live`; new rows `draft`; second run changes nothing | — |
| Publish group | `PUT .../status {live}` on draft | 200 `status: live`; Delivery lists it | — |
| Pause group | live → `paused` | 200; Delivery omits it; its live tales read `blocked-by-group`, stored `live` | — |
| Archive / restore | live → `archived`, then `paused` | 200 each; archived group returns `paused` | — |
| Same status | live → `live` | 200 unchanged | — |
| Bad transition | draft → `paused`; archived → `live` | 409 `invalid_status_transition`, nothing changes | standard body |
| Bad body | `{status: 'expired'}`, missing, non-string | 400 `validation_failed` | — |
| Unknown | unknown group or tale id | 404 `tale_group_not_found` / `tale_not_found` | — |
| Access | caller without the project | 403 `forbidden` | — |
| Tale status | pause the first tale of a live group | Delivery lists the group's other live tales; the SDK's cover becomes the next tale | — |
| Public media | media of a tale that is draft, paused, archived, or in a non-live group | 404 `media_not_found`; publish again → 200 | — |
| Shared key | copy (draft) and live source share a key | public while the source is live; 404 when neither is | — |
| Revalidate | `If-None-Match` with the ETag on live media | 304 | — |
| Status map | `statusHttpCode` for each key | the AD-6 code; one map | — |
| Dashboard | badge and buttons per status; refused change | badges and allowed buttons only; API message shown | banner / drawer alert |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/index.ts`, `src/lib/contract.spec.ts` -- `ContentStatus`, `SetStatusRequest`, status fields, two paths, error code, HTTP code map; regenerate.
- `libs/server/tales/src/lib/migration.ts` -- status columns (idempotent, existing rows `live`).
- `libs/server/tales/src/lib/tales.ts`, `tales.spec.ts`, `index.ts` -- status in reads, `setTaleGroupStatus`, `setTaleStatus`, `InvalidStatusTransitionError`, copy as draft, Delivery and `findPublishedMedia` filter `live`.
- `apps/api/src/http/tale-groups.router.ts`, `tales.router.ts`, `errors.ts`, `public-media.router.ts` -- status routes, 409 mapping, cache header.
- `apps/api/src/app.spec.ts` -- matrix rows; existing Delivery and public media tests publish their content first.
- `apps/dashboard/src/app/dashboard.store.ts`, `pages/zone-detail.*`, `create-drawer.*`, `pages/tale-groups.ts`, `app.css`, `app.spec.ts` -- badge, actions, tests.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- status schema, map, routes, error code; regenerate; map unit test -- AD-3, AD-6.
- [x] `libs/server/tales/` -- migration, transitions, status in reads, copy draft, Delivery and media filters; unit tests -- AD-6, AD-11.
- [x] `apps/api/src/` -- routes, error mapping, public media cache; integration tests for every API matrix row, migration test.
- [x] `apps/dashboard/src/app/` -- badges and actions on groups, tales and the Tale groups page; component tests.

**Acceptance Criteria:**
- Given a live group on the sample page, when it is paused in the dashboard and the page reloads, then it is gone; when it is published again, it is back.
- Given a live group whose first tale is paused, when the Delivery API is read, then the group's tales start with its next live tale.
- Given an archived group, when it is restored, then it reads `paused`.
- Given a new group, when the dashboard shows it, then it has a Draft badge and the Delivery API omits it until it is published.
- Given a paused tale, when its public media URL is requested, then it answers 404.

## Implementation Notes

- Assumptions (recorded, not product decisions): draft maps to 204 as the epic states; the transition table above (publish from draft or paused, pause from live, restore from archived to paused, archive from draft, live or paused; same status is a no-op; anything else 409 `invalid_status_transition`); `blocked-by-group` applies only to live tales of a paused group, as R5 words it (tales of draft or archived groups show their own key, the group's badge says why they are hidden); a live group with no live tale is left out of the Delivery response (review fix; it would be an empty, unplayable bar item); a copied group starts draft and its tales keep their stored statuses; public media becomes `Cache-Control: public, no-cache` (ETag revalidation, 304) so an unpublished URL answers 404 at once instead of staying in caches for a year.
- Contract: `ContentStatus`, `SetStatusRequest`, `status` on `TaleGroup`/`ProjectTaleGroup`, `status` + `storedStatus` on `Tale`, two `PUT .../status` paths, `invalid_status_transition`; `CONTENT_STATUS_HTTP_CODES`, `statusHttpCode`, `isContentStatus`, `SETTABLE_STATUSES`, `isSettableStatus`, `canSetStatus`, `nextStatuses`, `readTaleStatus` (the transition table lives once here; server and dashboard both use it).
- Tales module: migration adds `status` to `tale_groups` and `tales` (default `live` fills old rows, then default `draft`; guarded by the column's absence; named CHECK constraints on the storable keys). `TALE_COLUMNS` reads the group's status with a subquery so every tale read computes `status`. `setTaleGroupStatus` / `setTaleStatus` lock the row (`FOR UPDATE`) in a transaction. Delivery and `findPublishedMedia` filter on `live` tales of `live` groups.
- API: `PUT /api/v1/tale-groups/{id}/status`, `PUT /api/v1/tales/{id}/status`; `requiredSettableStatus` in `validation.ts`; 409 mapping; public media sends 304 on a matching `If-None-Match`.
- Dashboard: `status.ts` (`StatusBadge`, `STATUS_LABELS`, `statusActions`); zone page badge and Publish/Pause/Archive/Restore buttons per group (banner on refusal, live-region announcement), tale-card badge for non-live tales, tale drawer status section (stays open, hint for blocked-by-group), Tale groups page badge; badge colours in `styles.css`.
- Existing API tests that read the Delivery API or public media now publish their content first; the AD-14 migration test expects the new `status` column.
- Review fixes: public media answers 304 before reading storage; `migrate()` runs every module's migration on one connection under a session-level `pg_advisory_lock` (released in `finally`), so concurrent starts cannot race the "if not exists" checks; Delivery leaves out live groups with no live tale; the zone page tracks status saving and errors per group (errors show in the group's row); `setTaleStatus` returns the saved tale and the drawer announces its status from it; a dedicated 403 test for both status routes.

## Plan Change Log

## Review Triage Log

### 2026-10-21 — Review pass
- verdicts: 7 findings — high 0, medium 3, low 4, false 0, maybe-false 0
- findings:
  - `[medium]` `[patch]` Public media read the whole file before answering a 304 — fixed: 304 answered after the published check, before storage is read; test asserts no read.
  - `[low]` `[reject]` Browsers holding the earlier one-year immutable media cache are not invalidated — that header never shipped beyond local development.
  - `[medium]` `[patch]` Concurrent API starts could race the status-column migration — fixed: all migrations run under one session advisory lock; three concurrent `migrate()` calls tested.
  - `[low]` `[patch]` No 403 test for the status routes — added.
  - `[low]` `[patch]` One shared saving/error slot for all groups — fixed: per group id.
  - `[medium]` `[patch]` A live group with no live tales was delivered with `tales: []` and drawn as an empty, unplayable bar item — fixed: left out of the Delivery response.
  - `[low]` `[patch]` The tale status announcement could read the old status — fixed: announced from the PUT response.

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w2_test npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer fake-storyly web-sdk sdk-sample` -- expected: all succeed.

**Manual checks (if no CLI):**
- On dev servers: pause a group and reload the sample page (gone), publish (back), open a paused tale's media URL (404).

## Auto Run Result

**Summary:** Tale groups and tales carry a stored AD-6 status key; new content starts `draft` and rows from before migrate to `live` (idempotent migration). The status keys and their HTTP codes, and the publish/pause/archive/restore transitions, are defined once in `libs/contract`. `PUT /api/v1/tale-groups/{id}/status` and `PUT /api/v1/tales/{id}/status` change status (409 for a disallowed change). The Delivery API returns only live groups and their live tales; live tales of a paused group read `blocked-by-group`; public media answers 404 unless a live tale of a live group references the key, and is revalidated (`public, no-cache`, ETag, 304). The dashboard shows status badges and the allowed buttons on groups (zone page), tales (card badge, drawer actions) and the Tale groups page.

**Files changed:**
- `libs/contract/` — status schema, map, transitions, paths, error code; regenerated; tests.
- `libs/server/tales/` — status migration, setters, status in reads, Delivery and media filters, copy as draft; tests.
- `apps/api/src/` — status routes, validation, 409 mapping, public media cache and 304; integration tests for every matrix row and the migration.
- `apps/dashboard/src/` — `status.ts`, zone page, tale drawer, Tale groups page, store methods, badge styles; component tests.

**Review:** not run (unreviewed, as requested).

**Follow-up review recommended:** true. The public media cache policy changed on an unauthenticated route, and the status filter now gates what is public.

**Verification:** `nx run-many -t lint test build` for the twelve projects passed (api 190, dashboard 90, server-tales 46, contract 14 tests) against `taleart_w2_test`. No browser run of the sample page was made; the Delivery and public media behaviour behind it is covered by the API integration tests.

**Residual risks:**
- Media URLs are now revalidated on each use (one conditional request per cover, 304), a small cost against the 1.5 s budget (R10) in exchange for AD-11's immediate 404.
- The importer's later stories will create groups and tales as `draft` unless they publish them.
- Parallel stories that read the Delivery API or create content in tests must publish their fixtures.

**Review (parent):** 5 patches applied (3 medium, 2 low… see triage log), 0 deferred, 1 rejected. Follow-up review recommended: true — the change decides what content is public on an unauthenticated route. Merged into `autopilot/foundation`; the merged tree passes lint, test and build for 12 projects (api 191).
