---
title: 'Schedules stay out of sight until used'
type: 'feature'
ticket: '3'
created: '2026-10-22'
status: 'built'
baseline_revision: '342f8bd'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-every-zone-group-and-tale-says-whether-it-is-visible-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Every group row and tale drawer said "No schedule", and every group row had a Schedule button, so schedules looked required (UX report Note 1, epic R8).

**Approach:** Schedule moves into a ⋯ menu on the group row and on the tale card. The menu is a small, reusable WAI-ARIA menu button. A chip shows the window only when one exists. The schedule drawer offers "Remove schedule" only when there is a window to remove. The indicator from story 2 already gives "Not visible: starts …" or "ended …".

## Boundaries & Constraints

**Always:**
- `MenuButton` (`apps/dashboard/src/app/menu-button.ts`) works from data: items `{ id, label, disabledReason? }`, and `picked` emits `{ id, opener }` so a drawer it opens returns focus to the ⋯ button. A disabled item stays in the menu, stays reachable, and shows its reason (`aria-disabled`, `aria-describedby`). Story 10 adds the row's other actions as items.
- The menu button pattern: `aria-haspopup=menu`, `aria-expanded`, `aria-controls` while open, and a menu labelled by its button. Enter, Space or Down open the menu on the first item, and Up opens it on the last. The arrow keys move through the items and wrap; Home and End go to the first and last. Escape closes the menu and puts focus back on its button. Tab or a press outside closes it. The menu shows in the top layer (a manual popover), so the tale scroller and the cards do not clip it. Targets are 32px (24px on a card).
- Chip (`windowChip` in `schedule.ts`): "Starts 1 Dec, 09:00", "Ends 3 Nov", or both ends as "1 Dec, 09:00 – 3 Nov". It uses the browser's locale and time zone. It leaves out the time at midnight and the year when it is this year. The chip's `title` holds the full window (`describeWindow`).
- The initial bundle stays under 500 kB. The menu and its tale-card styles load with the lazy zone page.

**Never:** API or contract changes; moving the row's other actions (story 10); changing the indicator's wording.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|---|---|---|
| No window | group and tale without start or end | no chip and no schedule words outside the ⋯ menu; the drawer has no Remove schedule |
| Start ahead | group start in the future | chip "Starts …"; indicator "Not visible: starts …" |
| End only | tale end set | card chip "Ends …" |
| Both | start and end | chip "start – end" |
| Remove | window removed in the drawer | chip gone, indicator back to "Visible on site" right after the refresh |

</intent-contract>

## Code Map

- `apps/dashboard/src/app/menu-button.ts`: new ⋯ menu component and `menuPosition`.
- `apps/dashboard/src/app/schedule.ts`: `formatShort`, `windowChip`.
- `apps/dashboard/src/app/pages/zone-detail.{html,ts}`: the group's and the tale card's ⋯ menus, chips, and the Schedule button removed.
- `apps/dashboard/src/app/create-drawer.{html,ts}`: tale drawer shows the chip and "Edit schedule…" only with a window. "Remove schedule" shows only with a window.
- `apps/dashboard/src/app/dashboard.store.ts`: `openDrawer` also takes the opener element.
- `apps/dashboard/src/styles.css`: `.window-chip`, the tale card title as a column, the handle moved left of ⋯.

## Tasks & Acceptance

**Execution:**
- [x] Menu button component with spec (keyboard, Escape focus return, Tab, outside press, disabled reason, position).
- [x] Chip formatting with spec (formats, midnight, year, en-GB sample).
- [x] Group row and tale card: ⋯ menu with Schedule, chips, no "No schedule".
- [x] Drawer: Remove schedule only with a window; tale drawer chip.
- [x] App specs: no schedule words without a window, the chip on the row and the card, the indicator updating after save and after remove, and focus returning to ⋯.

**Acceptance Criteria:**
- Given a group and a tale without a window, when the zone page shows, then no schedule text or button appears outside the ⋯ menus.
- Given a future start set from the ⋯ menu, when it is saved, then the chip and "Not visible: starts …" appear; when it is removed, both go.

## Implementation Notes

- The Tale Studio 7.12 duplicate icon on the tale card's top row became the item "Duplicate" in the card's ⋯ menu, as the coordinator asked. Its behaviour is the same, and its specs now open it through the menu. The focus-return check now expects the ⋯ button.
- The tale drawer keeps an "Edit schedule…" button, but only when a window exists. Without one, the card's ⋯ menu is the only way in.
- The menu renders only while open. It opens inside the click or keydown handler (`detectChanges`), so focus moves at once.
- Playwright run (`shots-8.3/`, en-GB, Europe/London): no "schedule" text outside the menus. The chip read "Starts 1 Dec, 09:00" and the line "Not visible: starts 1 Dec 2026, 09:00". The card chip read "Ends 3 Nov". After remove, there was no chip and the line read "Visible on site". At 390px there was no horizontal scroll.
- Incident: `nx run dashboard:serve` depends on `api:serve`, so it started a second API on the default dev database. That API ran the 8.5 zone-fold migration there ("zonesCreated":1) and then failed on port 3333, which was in use. Next time, set DATABASE_URL for the dashboard serve as well.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly`: all pass (dashboard 429 tests).
- `web-sdk:size`, `web-sdk:types-check`: pass. Dashboard initial total: 494.20 kB.
