---
title: 'Every zone, group and tale says whether it is visible, and why not'
type: 'feature'
ticket: '2'
created: '2026-10-22'
status: 'built'
baseline_revision: 'c4083d8'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-tracer-turning-a-group-on-shows-its-tales-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md#ad-6'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The dashboard said "On" or "Shown", but nothing said whether a visitor actually sees the content, or why not. A group could be On in a zone with no frame or no key, or a tale could be Shown with nothing published, and the site stayed empty (epic R7, UX report §1 and §4).

**Approach:** Every reason is one SQL clause. The Delivery filter is "none of the clauses holds", and the indicator lists the clauses that hold, so the two are built from the same list and cannot disagree. A zone's setup (a display, a key) is checked by one function that both the Delivery API and the Management API call. The contract combines the reasons and words them. The dashboard shows a dot and "Visible on site" or "Not visible: <first reason>", with all reasons on hover and focus.

## Boundaries & Constraints

**Always:**
- Contract first (`libs/contract/openapi/openapi.yaml`, `libs/contract/src/lib/visibility.ts`):
  - `Visibility { visible, reasons }` and `VisibilityReason { code, subject, at? }`, with the 13 codes of R7;
  - `visibility` is required on `Zone`, `TaleGroup` (and so `ZoneTaleGroup`), `ProjectTaleGroup` and `Tale`;
  - `VISIBILITY_REASON_ORDER`, `zoneSetupReasons`, `visibilityInZones`, `taleContentReasons`, `zoneVisibility`, `visibilityReasonText` and `visibilitySummary`.
- One source (`libs/server/tales/src/lib/delivery-rule.ts`): `TALE_REASON_CLAUSES` and `GROUP_REASON_CLAUSES`. `deliveredTale` and `deliveredGroup` are "no clause IS TRUE". `taleReasonsSql` and `groupReasonsSql` return the clauses that are TRUE as jsonb. The status clauses cover every stored key but `live`, so "no reason" still means live, in its window, with something published, placed in a zone and with a delivered tale (the rule from before, unchanged).
- Zone setup (`zoneSetups` in the tales module): "zone has no display" means the zone has no frame (`zoneIdsWithFrames`, zones module). "Zone not installed" means it has no active zone key (`zoneIdsWithActiveKey`, access module). Stories 5 and 6 replace both. The Delivery API calls `zoneSetups` and delivers no tale group when it returns any reason.
- Context: a placement (`ZoneTaleGroup`) and the tales a zone lists are read in that zone. A group or tale read elsewhere is visible when it has no reason of its own and one of its zones is set up. When none is set up, every zone's reasons are listed. Content in no zone says `not-in-any-zone`.
- Mapping of the stored keys: `draft` and `paused` give `group-off` or `tale-hidden`. A process key on a group gives `group-blocked`. On a tale, `processing` gives `media-processing`, and `invalid-media` or `quota-reached` give `media-problem`.
- Dashboard (`apps/dashboard/src/app/visibility.ts`): `VisibilityIndicator`. The dot is filled when visible and hollow when not, so its shape tells the state as well as its colour. When not visible, the line is a button described by a `role=tooltip` list of every reason. The list opens on hover, focus or press, stays while hovered, and closes with Escape (WCAG 1.4.13). The compact form (tale cards) is a 24×24 dot named by the line. The indicator shows on the zone page header, the zone cards, the group rows of the zone page and the Tale groups page, and every tale card. The status change announcements add the indicator's line.

**Never:** a new stored key or column; changing what the Delivery API delivers for a set-up zone; removing zone keys or stages (stories 5 to 8); moving Archive or Schedule (stories 3, 10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| All set up | zone with frame and key, group On, tale from media | zone, placement, tale `visible`; Delivery includes them |
| Group off | group `paused` | tale `group-off`; group not delivered |
| Tale hidden | tale `paused` | `tale-hidden`; tale not delivered |
| Process key | group `quota-reached`; tale `processing` or `invalid-media` | `group-blocked`; `media-processing`; `media-problem` |
| Archived | tale or group `archived` | `archived` (tale) or `archived` (group) |
| No shown tales | every tale hidden | placement `no-shown-tales` (group), zone `no-shown-tales` (zone) |
| Not placed | group removed from its only zone | project list: `not-in-any-zone` |
| Window | start ahead or end passed, on tale or group | `starts-at` or `ended-at`, with `at` |
| No display | zone without frame | zone, placement, tales `zone-no-display`; Delivery `taleGroups: []` |
| Not installed | key revoked | `zone-not-installed`; the old key answers 401 |
| Not updated yet | Shown tale created with nothing published | `not-updated-yet`; uploading media fixes it |
| Two zones | placed in a bare zone and a set-up zone | bare placement lists the bare zone's reasons; the group, read anywhere, is visible |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `libs/contract/src/lib/visibility.ts`: shapes, ordering, combination, words.
- `libs/server/tales/src/lib/delivery-rule.ts`: the reason clauses, the Delivery predicates and the reason SQL.
- `libs/server/tales/src/lib/visibility.ts`: zone setup, and group, tale and zone visibility.
- `libs/server/tales/src/lib/tales.ts`: every group and tale read carries its visibility.
- `libs/server/zones` (`zoneIdsWithFrames`, `StoredZone`) and `libs/server/access` (`zoneIdsWithActiveKey`).
- `apps/api/src/http/zones.router.ts`: zone visibility on list, create and playbook. `delivery.router.ts`: the zone setup check.
- `apps/dashboard/src/app/visibility.ts`, `styles.css`, `pages/zone-detail.*`, `pages/zones.ts`, `pages/tale-groups.ts`, `dashboard.store.ts`.

## Tasks & Acceptance

**Execution:**
- [x] Contract schemas, generated types, `visibility.ts` and its spec.
- [x] Reason clauses, with the Delivery predicates built from them; zone setup functions; visibility on every tales-module read.
- [x] API: zone visibility; the Delivery zone setup check.
- [x] Dashboard indicator, placements, live region announcements; the store refreshes after a key is issued or revoked.
- [x] Tests: contract; a fixture per reason in the API spec, each checking the indicator, the Delivery API and the agreement (API and SQL row by row) broken and fixed; dashboard component and page tests.

**Acceptance Criteria:**
- Given any fixture state, when the indicator and the Delivery API are read, then every placement and tale is visible exactly when it is delivered, and every tale and group row has no reason exactly when the Delivery filter passes it.
- Given a not-visible line, when it is hovered, focused or pressed, then every reason shows in a tooltip that Escape closes.

## Implementation Notes

- The Delivery predicates now have the form `(clause) IS NOT TRUE AND …`. Their meaning is the same as before (status `live`, window, published, placed, with a delivered tale). The tests that matched the old SQL text now match the new form.
- A zone without a frame now delivers `taleGroups: []` (epic R1: "a zone without a display delivers nothing"). Before, it returned the groups, which no SDK could render without a frame. The API test helpers give a zone a bar frame before issuing its key (`withDisplay`, `postKey`).
- Visibility is read with `now()` in SQL, in the same transaction as the change that returns it.
- The zone card's link is now the name, stretched over the card, so the indicator's button is not nested inside a link.
- `group-blocked`, `media-processing` and `media-problem` come from process keys (`processing`, `invalid-media`, `quota-reached`) that nothing sets yet. The fixtures set them in SQL.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool`. Expected: all pass.
- `web-sdk:size`, `web-sdk:types-check`. Expected: pass. Dashboard initial bundle: under 500 kB.

**Manual checks:**
- Playwright on a fresh database: zone page with a visible and a not-visible group, the tale card dots, and the reason list on hover and on focus (`shots-8.2/`).

## Review fixes (2026-10-22)

- **Zone setup is now part of the one rule.** The zones module exports `zoneHasDisplaySql` and the access module exports `zoneInstalledSql`; the tales module builds `ZONE_SETUP_CLAUSES` from them.
  - `deliveredGroup` (used by the public cover, media and font routes) needs a placement in a set-up zone. The reasons of a group read for any zone include every zone's setup reasons when none of its zones is set up.
  - `deliveredPlacement` (used by the Delivery list) is "the group's own reasons are false and the zone is set up". The Delivery router makes no extra query.
  - `zoneDelivers` and `zoneReasonsSql` cover the zone itself.
  - The separate `zoneSetups` lookups and the contract's `zoneSetupReasons`, `visibilityInZones` and `zoneVisibility` are gone.
  - Revoking a key clears this process's public caches.
- **One clock.** Each read takes one `now` and binds it as `$2::timestamptz` in every reason query. `withTales` reads visibility in two queries: group reasons once, and tale reasons once for all of its tales.
- **Zone wording.** New codes `no-visible-groups` ("no visible tale group") and `no-tale-groups` ("no tale groups yet"). `no-shown-tales` is now used only for groups. The Tale groups page says "Visible on site in at least one zone" and "Not visible in any zone because:".
- **Tooltip.** The tooltip is a manual popover in the top layer, so no card clips it.
  - On a tale card it sits beside the card (right, else left), never over the switch or the move buttons; a line's tooltip sits beside the line, or below it when there is no room (`tipPosition`).
  - It stays open for 150 ms after the pointer leaves, so the pointer can reach it.
  - It closes with Escape anywhere or a press elsewhere, and follows its line when the page scrolls. A press toggles it, and the focus that a press gives does not open it.
  - A visible dot has no description, so screen readers do not read the line twice. Nothing renders while the visibility is unknown.
- The store refreshes after a playbook is applied.
- **Tests.**
  - An oracle compares, row by row, the pre-8.2 predicate kept as text in the spec with `deliveredTale`, `deliveredGroup`, `deliveredPlacement` and `zoneDelivers`, over a generated matrix: 3,360 tales and 700 groups. The matrix covers every stored key; window bounds that are null, past, future and exactly now; the document, draft and media key combinations; and tales created before and after the step, with and without the `tales_migrations` row. The group, placement and zone predicates are compared with the old rule plus "placed in a zone with a frame and an active key".
  - A test checks that a start exactly at now shows the tale and an end exactly at now hides it.
  - Indicator fixtures cover a legacy tale with nothing published and an out-of-step tale with only a draft.
  - The cover, tale media and font routes answer 404 for a group placed only in a zone without a display, and 200 again once that zone is set up.
  - Zone wording is tested for a zone with no groups and a zone whose groups are not visible.
  - Dashboard specs cover Escape after a hover open, a press elsewhere, the click toggle, tip placement, the any-zone wording, the empty render and the refresh after applying a playbook.
- **Behaviour change:** revoking a zone's key now makes the media of what it showed private until the zone has a key again. An existing test said otherwise and was changed.
