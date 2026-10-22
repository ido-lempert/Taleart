---
title: 'Tale groups as a list with a switch and a ⋯ menu'
type: 'feature'
ticket: '10'
created: '2026-10-22'
status: 'built'
baseline_revision: '43a2c46'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/epic-ux-rework.md'
  - '{project-root}/_bmad-output/initiative-taleart/ux-review-2026-10-23/ux-report.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-schedules-stay-out-of-sight-until-used-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-zone-page-with-a-header-a-setup-checklist-and-three-tabs-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** On the zone page's Tale groups tab each group is a header with eight buttons and a tale strip, so the page is long, noisy and wraps badly on phones (epic R10, report Note 3, §5).

**Approach:** Each placed group becomes one list row: reorder handle with move buttons, cover, name, "n of m shown", the On/Off switch, the indicator, the schedule chip when a window exists, and a ⋯ menu (story 8.3's `MenuButton`) holding every other action. "New tale group" and "Add existing group" sit below the list. Until story 8.11 builds the group view, opening a group expands its row to show what used to be under it (tags, "Also in", tale strip, Add tale).

## Boundaries & Constraints

**Always:**
- Menu items, in order: Rename, Cover, Tags, Schedule, Show in another zone, Copy to zone, Remove from this zone, Archive (Restore for an archived group). "Show in another zone" is disabled with "Already in every zone" when no zone of the project is left; a disabled item stays in the menu with its reason (8.3).
- No row action button outside the menu besides the switch, the move buttons and the open control.
- Reorder: drag by the handle; the move earlier/later buttons are the keyboard and single-pointer alternative (WCAG 2.5.7); each move is announced in the page's live region ("Summer moved to position 2 of 3").
- The group's name is a button (`aria-expanded`, `aria-controls`) that opens the group; a click anywhere else on the row that is not on one of its controls does the same. Clicks on the switch, ⋯, move buttons, handle, indicator and links never open it.
- The open region is collapsed by default.
- 390 px: two lines per row, no horizontal page scroll, names wrap at word boundaries (`overflow-wrap: break-word`, not `anywhere`).
- WCAG 2.2 AA: a list (`ul`/`li`) labelled by the zone; the switch named "<group> on site"; targets at least 24 px; focus visible.
- Code stays in the lazy zone page chunk. "Add existing group" is a page-local drawer (like 7.12's Duplicate), not a new case in the shell's create drawer. Initial bundle under 500 kB.

**Never:** a card view (D5); the group view itself (8.11); the Tale groups page (8.14); the legacy Zone key block (8.7 deletes it); API or contract changes.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|---|---|---|
| Counts | group with 4 tales, 3 live | "3 of 4 shown" |
| No tales | empty group | "No tales yet" |
| Switch | Off group switched On | indicator updates after the refresh; announced |
| Every zone | group in every zone of its project | "Show in another zone" disabled, described by "Already in every zone" |
| Archived | archived group | no switch, "Archived" badge, menu offers Restore |
| Filtered | a tag filter is on | no handle or move buttons (as before) |
| Add existing | project groups not in this zone | drawer lists them (not archived); adding places it last |
| Nothing to add | every group of the project is here | "Add existing group" disabled with its reason |
| Row click | click on cover or blank space | the group opens; click on switch or ⋯ does not |

</intent-contract>

## Code Map

- `apps/dashboard/src/app/pages/zone-detail.{html,ts}` -- the row, the menu items and actions, open state, buttons below the list.
- `apps/dashboard/src/app/pages/add-existing-group.ts` -- new page-local drawer to place an existing group in this zone.
- `apps/dashboard/src/app/create-drawer.{html,ts}` -- the place drawer's heading says "Show in another zone".
- `apps/dashboard/src/app/visibility.ts` -- indicator text wraps at word boundaries.
- `apps/dashboard/src/styles.css` -- hover rule for the group's move buttons.
- `apps/dashboard/src/app/app.spec.ts` -- row, menu, open, add existing, reorder announcement specs.

## Tasks & Acceptance

**Execution:**
- [x] Row layout and content, menu items with disabled reason, open region.
- [x] Add existing group drawer.
- [x] Specs: counts, switch and indicator, each menu item, disabled reason, keyboard reorder and announcement, row click vs inner controls, 390 px layout rules.
- [x] Playwright run with screenshots, axe.

**Acceptance Criteria:**
- Given a zone with three groups, when the Tale groups tab shows, then each is one row with its counts and indicator, and every ⋯ item works.
- Given a 390x844 viewport, then rows stack in two lines with full names and no horizontal scroll.

## Implementation Notes

- **Row.** A CSS grid: reorder (grip plus stacked 24px move buttons, shown on hover or focus where the device can hover), cover ring, name and meta ("2 of 3 shown", schedule chip), status (On/Off switch, a badge only for a status the switch does not say, the indicator), ⋯. A container query (`group-list`, 40rem) stacks it into two lines: name and ⋯, then switch and indicator. Names and the indicator wrap with `overflow-wrap: break-word` (the indicator was `anywhere`).
- **Menu.** `groupMenus` is one computed map of items per group, so an open menu keeps its items across change detection. Archive or Restore comes from `statusActions`, ids `status:<key>`. Archive runs at once and is announced, as the row button did.
- **Open the group (for now).** The name is a disclosure button (`aria-expanded`, `aria-controls`) and a click elsewhere on the row (not on a button, link, input, label, the menu or the handle, and not ending a text selection) toggles it. The open body shows the group's tags, "Also in" links and the existing tale strip with Add tale, as before; collapsed by default (`hidden`, still rendered, so the tale controls keep working). Story 8.11 replaces it with the group view. The row's click handler carries an eslint-disable for the two template a11y rules: it is a pointer shortcut; the name button is the keyboard way.
- **Moved out of the row:** tags, "Also in" and the tale capacity ("2 / 100"); tags and "Also in" are in the open body, capacity is gone until 8.11.
- **Add existing group** (`pages/add-existing-group.ts`): a page-local drawer like 7.12's Duplicate; lists the project's groups not in this zone and not archived, with "n tales · In <zones>" or "Not in a zone"; places the picked one last (`PUT /zones/{id}/tale-groups/{gid}`) and announces "<name> added to <zone>". With nothing to add, the button is `aria-disabled` and described by a visible reason. The project's copy of a group (Copy to zone) shows there too, as it is its own group.
- **Place drawer** heading is now "Show in another zone". The Tale groups page still labels its button "Add to zone…" (story 8.14 reworks that page).
- **Styles** moved to `pages/zone-groups.css` (a second stylesheet of the page), as the page's inline styles went over the 4 kB component style budget warning.
- **Bundle:** initial total 497.19 kB, unchanged; all new code is in the lazy zone page chunk.
- **Browser run** (`shots-8.10/`, ports 3394/4294/4394, own `_test` DBs): 44 checks passed, including axe (WCAG 2.2 AA tags) on the list before and after every action and at 390 px, every ⋯ item, the disabled reason, the sample page empty then showing the group after the switch, keyboard reorder announced with focus kept, and at 390x844 no horizontal scroll, two-line rows, full names and no line break inside a word.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- all pass (dashboard 510 tests); dashboard initial 497.19 kB.
- `node_modules/.bin/nx run web-sdk:size`, `web-sdk:types-check` -- pass.

**Manual checks:**
- Playwright (`shots-8.10/`): three groups with counts and indicators; switching On updates the indicator and the sample page; every ⋯ item; disabled reason; 390x844 screenshot.
