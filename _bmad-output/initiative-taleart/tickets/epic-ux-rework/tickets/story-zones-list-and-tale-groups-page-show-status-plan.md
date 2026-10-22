---
title: 'Zones list and Tale groups page show status, with filters'
type: 'feature'
ticket: '14'
created: '2026-10-22'
status: 'built'
baseline_revision: 'a60da61'
route: 'full'
route_source: 'auto'
risk: 'low'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/epic-ux-rework.md'
  - '{project-root}/_bmad-output/initiative-taleart/ux-review-2026-10-23/ux-report.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-tale-groups-as-a-list-with-a-switch-and-a-menu-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The zones list does not say whether a zone is installed, and the Tale groups page has no status column, no filter and no way to create a group; its rows are a different, older design than the zone page's list (epic R14, report §5, §6 #9, #12).

**Approach:** Extract the zone page's group row (story 8.10) into a shared `GroupRow` component and use it on both pages. The Tale groups page lists the project's groups with that row (plus the zones each is in), filters them by a radio group with counts kept in `?filter=`, and gets a "New tale group" button that opens the create drawer with a zone picker ("Not in a zone" allowed). Zone cards get an Installed / Not installed pill next to the display and group count.

## Boundaries & Constraints

**Always:**
- Filter definitions (archived groups appear only under Archived):
  - **All** (default, no `?filter=`): every group that is not archived.
  - **Visible** (`visible`): visible on site in at least one zone (`visibility.visible`).
  - **Off** (`off`): stored `draft` or `paused`.
  - **Scheduled** (`scheduled`): has a window (`startsAt` or `endsAt` set), whatever it reads now.
  - **Not in a zone** (`unplaced`): `zoneIds` empty.
  - **Archived** (`archived`): stored `archived`.
  - Overlaps: Scheduled overlaps Visible, Off and Not in a zone; Not in a zone overlaps Off and Scheduled. Visible never overlaps Off or Not in a zone. A group that is On but not visible (no shown tales, zone not set up, window not open, process key) shows under All only, unless it is scheduled.
- Filter control: native radios in a `fieldset` with legend, each label with its count; an unknown `?filter=` reads as All; changing the filter replaces the history entry and is announced ("Showing 2 of 7 tale groups: Visible").
- Shared row: `GroupRow` takes the group, its count text, the ⋯ items and its saving state, emits the switch and menu picks; host-specific parts (reorder cell, name control, extra meta such as "In: zones") are projected. The zone page keeps its behaviour and markup classes; its change is limited to using the component.
- Tale groups page ⋯ menu: Rename, Cover, Tags, Schedule, Show in another zone, Copy to zone, Archive/Restore; no "Remove from this zone". "Show in another zone" disabled with "Restore it to show it in a zone" for an archived group, "Already in every zone" when placed everywhere.
- The project list `GET /projects/{id}/tale-groups` returns full groups (tales, cover, tags) plus `taleCount`, so the row and every ⋯ drawer work for a group in no zone.
- "New tale group" from the Tale groups page: the existing create drawer with a Zone select (the project's zones and "Not in a zone"); "Not in a zone" calls the new `POST /projects/{id}/tale-groups`.
- WCAG 2.2 AA; 390 px no horizontal scroll; dashboard initial bundle under 500 kB (new code in lazy chunks).

**Never:** a group view or drawer (8.11); changes to zone-detail beyond using the extracted row; a card view (D5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Each filter | groups in every state | each filter lists exactly its groups; counts match | — |
| Unknown filter | `?filter=nope` | All | — |
| Empty filter | no group matches | "No tale groups match this filter" with "Show all" | — |
| Archived row | archived group | Archived badge, no switch, Restore; place disabled with reason | — |
| New in no zone | "Not in a zone" picked | group created, listed under Not in a zone | API message in the drawer |
| Zone card | active site key / none | "Installed" / "Not installed" | hidden while unknown |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/generated/api.ts` -- `ProjectTaleGroup` = `TaleGroup` + `taleCount`; `POST /projects/{projectId}/tale-groups`.
- `libs/server/tales/src/lib/tales.ts` -- `listProjectTaleGroups` with tales; `createProjectTaleGroup`.
- `apps/api/src/http/tale-groups.router.ts` -- tags on the project list; the create route.
- `apps/dashboard/src/app/group-row.{ts,css}` -- the shared row.
- `apps/dashboard/src/app/pages/zone-detail.{html,ts}`, `zone-groups.css` -- use the row.
- `apps/dashboard/src/app/pages/tale-groups.ts` -- filters, row, New tale group.
- `apps/dashboard/src/app/pages/zones.ts` -- Installed pill.
- `apps/dashboard/src/app/create-drawer.{ts,html}`, `dashboard.store.ts` -- zone picker, create in no zone; drawers find groups in no zone.

## Tasks & Acceptance

**Execution:**
- [x] Contract, tales module, API route and tests.
- [x] `GroupRow` extraction; zone page uses it.
- [x] Tale groups page: filters, row, menu, New tale group; zones list pill.
- [x] Specs: each filter on fixtures in every state, URL, counts, New tale group (zone and no zone), menu items, zone card states.
- [x] Playwright with screenshots at 390 px and axe.

**Acceptance Criteria:**
- Given groups in every state, when each filter is chosen, then exactly the matching groups list and the URL holds the filter; reloading keeps it.
- Given the Tale groups page, when "New tale group" is used, then the group is created and listed.
- Given zones with and without a display, a site key and visible groups, then each zone card shows the right indicator, display, count and install state.

## Implementation Notes

- **Shared row** (`app/group-row.ts`, `group-row.css`): cover, name slot, "n of m shown · max 100", tags, schedule chip, switch, badge, indicator, ⋯. Inputs `group`, `items`, `saving`, `anyZone`, `opens` (pointer cursor only); outputs `toggled`, `picked`. Slots: `[groupRowLead]` (zone page's reorder cell), `[groupRowName]` (the page's heading and open control), `[groupRowExtra]` (Tale groups page's "In: …"). Styles are not encapsulated so they reach projected content; the `.group-row*` rules moved there from `zone-groups.css` unchanged, plus a grid without the lead column (`:has`) and `.group-row--opens`. The zone page's change is the template swap, the import, and dropping `shownCount`/`maxTales`/`describeWindow` (now in the row); its click handler, menus and status logic are untouched, so 8.11 can keep its row-click/drawer change on `(click)` of `app-group-row`.
- **Project list carries whole groups.** `ProjectTaleGroup` is now `TaleGroup` + `taleCount` (tales, cover, tags, visibility in any zone). `store.taleGroup(id)` falls back to the project lists, so Rename, Cover, Tags, Schedule, Copy work for a group in no zone. New `POST /projects/{id}/tale-groups` creates a group in no zone (Off).
- **Filters:** native radios in a fieldset (legend "Show"), styled as chips; counts in the label (", n" for screen readers); `?filter=` via component input binding, replaced in history; unknown values read as All and are dropped. Changes are announced ("Visible: 2 tale groups").
- **Leaving the list:** a group the current filter no longer holds after a switch, Archive or Restore is announced with where it is ("It is listed under Visible / All / Archived") and focus goes to that filter's radio.
- **New tale group:** the create drawer's `taleGroup` request takes an optional `projectId`; then it shows a Zone select ("Not in a zone" first and default, then the project's zones) and its context line names the project. When the drawer closes and the new group is hidden by the current filter, the page switches to All and announces it.
- **Menu on the Tale groups page:** no "Remove from this zone"; "Show in another zone" disabled with "Archived. Restore it to show it in a zone", "This project has no zones yet" or "Already in every zone".
- **Zones list:** cards keep their layout; a summary list (`aria-label` "Summary of <zone>") holds Display, group count and Install (hidden while visibility is unknown), as the zone page header.
- **Bundle:** initial total 495.41 kB (create drawer and store grew); the row and pages are in lazy chunks.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- all pass; dashboard initial under 500 kB.
- `node_modules/.bin/nx run web-sdk:size`, `web-sdk:types-check` -- pass.

**Manual checks:**
- Playwright (`shots-8.14/`, ports 3398/4298/4398, own `_test` DBs): 64 checks passed, including each filter's exact list, URL and announcement, arrow keys, reload, the adapted menu and its disabled reason, New tale group in no zone and in a zone, the switch, zone cards before and after a site key, the zone page's rows (regression of the extraction), 390 px with no horizontal scroll, and axe (WCAG 2.2 AA tags) on every view.
