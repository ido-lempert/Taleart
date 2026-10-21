---
title: 'Schedule tale groups and tales with start and end times'
type: 'feature'
ticket: '4'
created: '2026-10-21'
status: 'built'
baseline_revision: '9adf4bebe0788c49cb92403673b5ee94442dbf13'
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
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A content manager cannot limit a tale group or a tale to a time window; published content stays delivered, and its media public, until someone pauses it (R6, AD-6, AD-11).

**Approach:** Contract first, add an optional `startsAt` / `endsAt` window (UTC, ISO 8601) to tale groups and tales, set through one schedule route each. `scheduled` and `expired` are computed when content is read, from the stored `live` key and the window (one function in `libs/contract`); nothing stores them. The Delivery API and `/media/{key}` serve only content whose own window and its group's contain the current time. The dashboard edits the window in the browser's local time and shows the computed status.

## Boundaries & Constraints

**Always:**
- Contract: `startsAt` and `endsAt` (`string` `date-time` or `null`) on `TaleGroup`, `ProjectTaleGroup` and `Tale`; `TaleGroup` and `ProjectTaleGroup` gain `storedStatus` (the key a person set) and their `status` becomes the status as read, like `Tale`. `SetScheduleRequest { startsAt, endsAt }`, both required, each an ISO 8601 date-time with a `Z` or offset, or `null`. `readContentStatus(stored, window, now)` and `isInWindow(window, now)` defined once in `libs/contract`; `readTaleStatus` gains the tale's window.
- Window rule: live while `startsAt <= now < endsAt` (a missing bound is open). Read status: a stored key other than `live` is shown as stored (paused beats scheduled); a `live` tale whose group is `paused` reads `blocked-by-group` (as in story 3); otherwise `scheduled` before `startsAt`, `expired` at or after `endsAt`, else `live`.
- `endsAt` must be later than `startsAt` when both are set: else 400 `validation_failed`, nothing changes. The database holds the same rule as a CHECK.
- Storage: nullable `starts_at`, `ends_at` `timestamptz` on `tale_groups` and `tales`, added idempotently; existing rows get no window.
- Routes, authorized with the project helper (AD-4): `PUT /api/v1/tale-groups/{taleGroupId}/schedule` → 200 `TaleGroup` (with tags); `PUT /api/v1/tales/{taleId}/schedule` → 200 `Tale`. Resource first (404), then body (400).
- Delivery: `GET /delivery/v1/zone` lists only `live` groups in their window, each with only `live` tales in their window; a group left with no tale is left out (story 3 rule).
- Public media: `GET /media/{key}` serves a key only while a `live` tale in its window, of a `live` group in its window, references it; else 404 `media_not_found`. Cache stays `public, no-cache` with ETag, so an expired URL answers 404 on the next revalidation.
- Copy to zone copies the group's window and each tale's window, as it copies tales' statuses.
- Dashboard: the zone page group row and the tale drawer each show the window (or "No schedule") and a form with two `datetime-local` inputs (Start, End), Save and Remove schedule (saves no window at once); values are shown and entered in the browser's time zone and sent as UTC. An end before the start is refused in the form and by the API, and the message is shown. Badges show the status as read (Scheduled, Expired); buttons follow `storedStatus`.
- `_test` database only (`taleart_w1_test`); standard error body.

**Never:** A job or trigger that stores `scheduled` / `expired`; campaigns; time zones stored per item; SDK changes (the filtered Delivery response is enough); changes to zone keys, Delivery CORS or the status transitions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Set window | `PUT .../schedule {startsAt, endsAt}` on a group or tale | 200 with both as ISO UTC | — |
| Clear | `{startsAt: null, endsAt: null}` | 200, no window; status as stored | — |
| Future start | live group, `startsAt` 1 min ahead | reads `scheduled`; Delivery omits it; its media 404 | — |
| Start passes | same group after `startsAt` | reads `live`; Delivery lists it | — |
| Past end | live tale with `endsAt` in the past | reads `expired`; Delivery lists the group's next tale; its media 404 | — |
| Boundaries | now = `startsAt`; now = `endsAt` | live at start; expired at end | — |
| End before start | `endsAt <= startsAt` | 400 `validation_failed`, nothing changes | standard body |
| Bad body | missing field, non-ISO string, no time zone, number | 400 `validation_failed` | — |
| Paused + scheduled | paused group with a future start | reads `paused` | — |
| Draft + window | draft tale with a window | reads `draft`; not delivered | — |
| Group window | live tale in its window, group expired | Delivery omits the group; tale media 404 | — |
| Blocked by group | live tale of a paused group, tale window expired | reads `blocked-by-group` | — |
| Unknown / access | unknown id; caller without the project | 404 `tale_group_not_found` / `tale_not_found`; 403 `forbidden` | — |
| Copy | copy a group with windows | copy and its tales keep the windows | — |
| Migration | run twice | columns exist once, old rows have no window | — |
| Dashboard | set a window in local time; end before start | UTC sent; badge Scheduled / Expired; refusal shown | form error |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/index.ts`, `src/lib/contract.spec.ts` -- window fields, `storedStatus` on groups, `SetScheduleRequest`, two paths, `readContentStatus`, `isInWindow`; regenerate.
- `libs/server/tales/src/lib/migration.ts` -- window columns and CHECK.
- `libs/server/tales/src/lib/tales.ts`, `tales.spec.ts` -- window in reads, read status, `setTaleGroupSchedule`, `setTaleSchedule`, copy windows, Delivery and `findPublishedMedia` window filters (with a `now` for tests).
- `apps/api/src/http/tale-groups.router.ts`, `tales.router.ts`, `validation.ts` -- schedule routes and body parsing.
- `apps/api/src/app.spec.ts` -- matrix rows over HTTP.
- `apps/dashboard/src/app/schedule.ts` (new), `dashboard.store.ts`, `pages/zone-detail.*`, `create-drawer.*`, `pages/tale-groups.ts`, `styles.css`, `app.spec.ts` -- schedule form, local-time conversion, read status badges.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- schemas, paths, status functions; regenerate; unit tests for window and precedence -- AD-3, AD-6.
- [x] `libs/server/tales/` -- migration, setters, reads, copy, Delivery and media filters; unit tests -- AD-6, AD-11.
- [x] `apps/api/src/` -- routes and validation; integration tests for every API matrix row.
- [x] `apps/dashboard/src/app/` -- schedule form on groups and tales, local time display, badges; component tests.

**Acceptance Criteria:**
- Given a live group whose first tale's end time passes, when the Delivery API is read, then the group starts with its next tale and the dashboard shows that tale Expired.
- Given a live group with a start time one minute ahead, when the Delivery API is read before and after it, then the group is absent, then present.
- Given a schedule with the end before the start, when it is saved, then it is refused and the stored window is unchanged.
- Given a scheduled-not-started or expired tale or group, when its media key is requested at `/media/{key}`, then it answers 404.

## Implementation Notes

- Assumptions (recorded, not product decisions): the window is half-open (live at `startsAt`, expired at `endsAt`); an `endsAt` equal to `startsAt` is refused like an earlier one (an empty window); a stored key other than `live` wins over the window (paused, draft, archived read as stored), as AD-6 computes `scheduled`/`expired` only from `live`; `blocked-by-group` keeps precedence over a tale's own window (story 3's rule is unchanged); a tale's status as read uses only its own window, while the Delivery API and public media need both windows; copy to zone keeps the group's and the tales' windows (a copy, like the tales' statuses); validation errors use the existing `validation_failed` code (no new error code); the API accepts only ISO 8601 date-times with `Z` or an offset and rejects impossible dates such as 30 February.
- Contract (breaking for clients reading a group's `status` as the stored key): `TaleGroup` and `ProjectTaleGroup` gain `storedStatus`, and their `status` is now the status as read, like `Tale`; the dashboard's Publish/Pause/Archive/Restore buttons now follow `storedStatus`. New `SetScheduleRequest`, `PUT /tale-groups/{id}/schedule`, `PUT /tales/{id}/schedule`; helpers `windowPosition`, `isInWindow`, `isValidWindow`, `readContentStatus`, `OPEN_WINDOW`; `readTaleStatus` takes the tale's window.
- Tales module: nullable `starts_at`/`ends_at` `timestamptz` on both tables plus a named CHECK added once (guarded by `pg_constraint`); `setTaleGroupSchedule`, `setTaleSchedule`, `InvalidScheduleError` (400). Reads compute the status in JS with the current time; `listDeliveryTaleGroups` and `findPublishedMedia` take a `now` (default: the current time) passed to SQL as a parameter, so the server clock decides consistently and tests can move time with `vi.setSystemTime`.
- Public media already answers `public, no-cache` with ETag revalidation (story 3), so an expired or not-yet-started key answers 404 on the next request; nothing else changed there.
- Dashboard: new `schedule.ts` (local `datetime-local` ↔ UTC, window text, time zone name); a `schedule` drawer kind used for groups (a Schedule button in each group row, which also shows the window) and tales (a Schedule… button in the tale drawer, which turns the drawer into the schedule form and keeps the original focus return); the form refuses an end before the start itself and shows the API's refusal; badges for Scheduled and Expired; the publish announcement reads the group's status after the refresh. The Tale groups page needed no change: its badge now shows the status as read.

## Plan Change Log

## Review Triage Log

### 2026-10-21 — Review pass
- verdicts: 7 findings — 6 patched, 1 rejected (by design)
- findings:
  - `[patch]` A half-typed `datetime-local` reports '' and silently cleared the bound — fixed: the form reads each input's `validity.badInput` and refuses with "Enter a complete date and time, or leave it empty."; component test.
  - `[patch]` The fields hold minutes only, so saving rewrote an untouched bound and could refuse an unchanged sub-minute window — fixed: each field keeps the loaded ISO value and an unchanged field sends it as stored; tests for an untouched sub-minute window and for one edited bound.
  - `[patch]` A local time inside a spring-forward gap shifted silently — fixed: `parseLocalInput` refuses it as nonexistent (the Date does not format back to the typed local time) and the form names the time zone and the daylight-saving change; a time that happens twice in autumn is read as its first occurrence `[ASSUMPTION]`; unit tests in Europe/Berlin via `process.env.TZ`.
  - `[patch]` The group row showed nothing without a window — fixed: "No schedule" on the group row and in the tale drawer.
  - `[patch]` "Clear both" only emptied the fields — replaced by "Remove schedule", which saves no window at once and closes the drawer.
  - `[patch]` Missing API tests — added: a key shared by copies stays public while one copy is in its window and answers 404 once neither is; `If-None-Match` with the key's ETag answers 404, not 304, for expired and scheduled media.
  - `[reject]` A tale reads `live` while its group is outside its window — by design (plan: a tale's status as read uses its own window; Delivery needs both).
- Merged `autopilot/foundation` (importer story 2.4, web zones story 5 bar settings); one conflict in `create-drawer.ts` (imports and the Save label switch) resolved keeping both features; contract regenerated.

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w1_test npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool` -- expected: all succeed.

**Manual checks (if no CLI):**
- On dev servers: set a tale's end one minute ahead, wait, reload the sample page (cover moves to the next tale; dashboard shows Expired); set a group's start one minute ahead (hidden, then shown); an end before the start is refused.

## Auto Run Result

**Summary:** Tale groups and tales carry an optional start and end time (UTC, `timestamptz`, CHECK end > start). `PUT /api/v1/tale-groups/{id}/schedule` and `PUT /api/v1/tales/{id}/schedule` set or clear it (400 `validation_failed` for an end not later than the start or a bound that is not an ISO date-time with a time zone). `scheduled` and `expired` are computed on read from the stored `live` key and the window, never stored. The Delivery API lists only live groups and tales inside their own and their group's window, and `/media/{key}` serves only media of such tales. The dashboard edits windows in the browser's local time on group rows and from the tale drawer, and shows Scheduled and Expired badges.

**Files changed:**
- `libs/contract/` — window fields, `storedStatus` on groups, `SetScheduleRequest`, two paths, window and read-status helpers; regenerated; tests.
- `libs/server/tales/` — window columns and CHECK, schedule setters, status as read, copy keeps windows, Delivery and media window filters; tests.
- `apps/api/src/` — schedule routes, body validation, 400 mapping; integration tests for every API matrix row (time passing simulated with `vi.setSystemTime`), migration column checks.
- `apps/dashboard/src/` — `schedule.ts`, schedule drawer, group row schedule button and window text, tale drawer schedule summary, badge colours; component and helper tests.

**Review:** not run (unreviewed, as requested).

**Follow-up review recommended:** true. The change narrows what the unauthenticated public media route and the Delivery API serve, and it changes the meaning of a group's `status` in the Management API contract.

**Verification:** `nx run-many -t lint test build` for the twelve projects passed against `taleart_w1_test` (api 212, dashboard 101, server-tales 54, contract 19 tests). No browser run of the sample page was made; the Delivery and public media behaviour behind it is covered by the API integration tests.

**Residual risks:**
- `TaleGroup.status` / `ProjectTaleGroup.status` now mean the status as read; a parallel story or client that used them as the stored key (for transitions) must switch to `storedStatus`.
- Status as read depends on the API server's clock; the Delivery filter uses the API's clock too (passed to SQL), so they agree, but a skewed server clock shifts every window.
- Media URLs of a group that turns expired keep working in a client that cached the bytes until it revalidates (`no-cache` means it revalidates on each use).
