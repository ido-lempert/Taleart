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
- Filter control: native radios in a `fieldset` with legend, each label with its count; an unknown `?filter=` reads as All; changing the filter replaces the history entry (back and forward do not step through filters) and is not announced, since the radio reads its own count.
- Shared row: `GroupRow` takes the group, its count text, the ⋯ items and its saving state, emits the switch and menu picks; host-specific parts (reorder cell, name control, extra meta such as "In: zones") are projected. The zone page keeps its behaviour and markup classes; its change is limited to using the component.
- Tale groups page ⋯ menu: Rename, Cover, Tags, Schedule, Show in another zone, Copy to zone, Archive/Restore; no "Remove from this zone". "Show in another zone" disabled with "Restore it to show it in a zone" for an archived group, "Already in every zone" when placed everywhere.
- The project list `GET /projects/{id}/tale-groups` returns each group's own fields, cover, tags and visibility with `taleCount` and `shownTaleCount`, not its tales, and is read only for the projects a page needs.
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
- Playwright (`shots-8.14/`, ports 3398/4298/4398, own `_test` DBs): 63 checks passed (also after merging autopilot/foundation 8906799), including each filter's exact list, URL and announcement, arrow keys, reload, the adapted menu and its disabled reason, New tale group in no zone and in a zone, the switch, zone cards before and after a site key, the zone page's rows (regression of the extraction), 390 px with no horizontal scroll, and axe (WCAG 2.2 AA tags) on every view.

## Review fixes (2026-10-22)

- **Lighter project list.** `ProjectTaleGroup` is the group without `tales`, with `cover`, `tags`, `visibility`, `taleCount` and a server-computed `shownTaleCount` (tales stored `live`). The row takes either shape (`GroupRowData`). Payload for a 20-group × 100-tale project: see Verification.
- **Read only where needed.** `store.ensureProjectTaleGroups(projectId)` reads a project's list when a page asks (Tale groups page: the selected project; zone page: its zone's project, for "Add existing group"; Duplicate: the tale's project); each refresh then re-reads only those. A refresh started meanwhile wins over that read.
- **One lookup for a group's own fields:** `store.groupSummary(id)` (project list first, else a zone list) in `zonesToPlace` and the rename, place, copy, tags, schedule and cover drawers. `store.taleGroup(id)` stays the zone lists' group with tales. `store.tale()` has no project-list fallback: the project list carries no tales.
- **Patched from answers:** a group's status change patches `status`, `storedStatus`, `visibility`, `taleCount` and `shownTaleCount` in the project lists from the PUT's answer; a tale's status change patches the group's `shownTaleCount`. The Tale groups page announces from the PUT's answer (`changeTaleGroupStatus`).
- **Where a group went:** the first of Archived, Visible, Off, All that lists it. Focus goes to the row now in its place (its switch, else its ⋯), else the row before, else the list heading (`tabindex=-1`); never to a radio that is not checked.
- **No announcement on a filter change**; the radio reads its count.
- **Create** records the new group's id (`store.createdTaleGroupId`), which the page uses to reveal it.
- **Menus** compute "every zone" from the project's zone ids once per menu build.
- **Drawer context** says "In zone <name>" when a zone is picked, else "In project <name>".
- **No-lead row** is a modifier (`[plain]` → `group-row--plain`), not `:has`; the zone page's row, also while a tag filter is on, is as in 8.10.
- **Names** of tale groups: at most 100 characters (`MAX_TALE_GROUP_NAME_LENGTH`, code points, after trimming) on both creates and rename (`maxLength` in the contract, 400 `validation_failed`).
- **Cross-project 403** matrix includes `POST /projects/{other}/tale-groups`; nothing is created.

- **Merged with 8.11** (group view): the zone page's row is the shared `GroupRow`; the name button (`openGroup`, `?group=`) is projected into `[groupRowName]` and the row click stays on `app-group-row`. `group-row.ts` keeps its own `shownCount` (it also takes the project list's counts); `group-view.ts` keeps its own for the view.
- **Tale groups page name** links to the group view in the first zone the group is in (`/zones/<zone>?group=<id>`); a group in no zone shows its name as text.
- **Payload**, 20 groups × 100 tales (browser run, `/api/v1`): whole groups with their tales (what the project list sent before) 904,711 bytes; the project list now 9,381 bytes.
- **Bundle:** initial total 497.93 kB after merging 8.11.
- **Verification:** `run-many -t lint test build --parallel=2` passes except `api:test` "auth > creates the admin, signs them in and stores only the token hash": `expected 605649 to be 604800`. The local Postgres clock runs 14 minutes behind the host (`now()` 19:59:40 vs host 20:13:49 UTC), so `expires_at` (from the host) minus `created_at` (from the database) is off by that much. Unrelated to this story. Browser run: 68 checks passed.

### Follow-ups
- **A per-project cap on tale groups** (none today); the create in no zone makes unbounded growth easier.
- **Groups in no zone cannot get tales yet.** The group view (8.11) needs a zone: it orders tales through a zone's queue, and the tale drawer reads tales from the zone lists. Opening it for a group in no zone needs the store to hold that group's tales (`GET /tale-groups/{id}`) and an order queue that is not per zone.
