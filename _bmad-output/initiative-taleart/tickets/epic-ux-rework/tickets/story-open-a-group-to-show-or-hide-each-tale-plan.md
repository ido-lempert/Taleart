---
title: 'Open a group to show or hide each tale in one action'
type: 'feature'
ticket: '11'
created: '2026-10-22'
status: 'built'
baseline_revision: 'a60da61'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-tale-groups-as-a-list-with-a-switch-and-a-menu-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 8.10 made each group one row, but its tales still open inline under the row, so a long zone page grows with every open group, and a tale card's ⋯ offers only Schedule and Duplicate (epic R11, report §5, §6 #3, #14).

**Approach:** Opening a group (its name, or a click on the row) opens the **group view**: a wide modal drawer on desktop and a full-screen page on phones (≤ 640 px), whose state is in the URL (`?group=<id>`), so it deep-links, reloads, and the browser's Back closes it. Its header has the group's name, On/Off switch, indicator and the group's ⋯ menu; its body has "Also in", the tale strip (reorder by drag and by move buttons), "Add tale", and on each card the Shown/Hidden switch (one action, saves at once, announced), the indicator dot and a ⋯ menu: Edit in Tale Studio, Replace media, Schedule, Duplicate, Archive (Restore when archived).

## Boundaries & Constraints

**Always:**
- One group view at a time; the row's name button is its trigger (`aria-haspopup="dialog"`, `aria-expanded`, `aria-controls` on the open dialog); a row click outside its controls does the same (8.10's rules).
- The view is `role="dialog"`, `aria-modal`, labelled by the group name; focus moves to its title, Tab is trapped, Escape closes it unless a menu or a drawer above it takes the Escape; focus returns to the row's name button (also after a deep link).
- A drawer opened from the view (tale drawer, schedule, rename, Duplicate…) stacks above it; closing that returns focus into the view.
- Opening pushes a history entry; closing replaces the URL; an unknown `?group=` is dropped.
- Status changes announced in a live region inside the dialog.
- Edit in Tale Studio carries `?zone=`; the studio's back link returns to the group view (`?group=`).
- All new code in the lazy zone page chunk; initial bundle under 500 kB.

**Never:** the tale drawer's rework (8.12); API or contract changes; several groups open at once.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|---|---|---|
| Open | click name / row | URL `?group=g1`, dialog named "Summer", focus on title |
| Deep link | load `/zones/z1?group=g1` | view open; closing focuses Summer's name |
| Unknown | `?group=nope` | param dropped, no view |
| Hide | Shown card switch | `PUT /tales/{id}/status` paused at once; dot and count update; announced |
| Group removed | Remove from this zone while open | view closes |
| Escape in menu | ⋯ menu open | only the menu closes |
| Archived tale | tale archived | badge, no switch, menu offers Restore |
| Setup step | all tales Hidden | view opens with focus on the first Hidden switch |

</intent-contract>

## Code Map

- `apps/dashboard/src/app/pages/group-view.{ts,html,css}` -- new: the group view.
- `apps/dashboard/src/app/pages/zone-detail.{ts,html}`, `zone-groups.css` -- open state from `?group=`, remove the inline body and tale logic.
- `apps/dashboard/src/app/drawer.ts` -- stacked drawers (only the top one takes Escape), wide variant, title focus, initial focus selector, panel id.
- `apps/dashboard/src/styles.css` -- wide drawer and phone page layout.
- `apps/dashboard/src/app/create-drawer.html`, `dashboard.store.ts` -- Replace media focuses the file input.
- `apps/dashboard/src/app/pages/tale-studio.ts` -- back link opens the group view.
- `apps/dashboard/src/app/app.spec.ts` -- specs.

## Tasks & Acceptance

**Execution:**
- [x] Drawer stacking and variants.
- [x] Group view component; zone page wiring; remove the inline body.
- [x] Tale ⋯ items; Replace media focus; studio back link.
- [x] Specs: open/close and focus return, deep link, toggle saves at once and updates the indicator, every ⋯ item, keyboard reorder, Add tale, phone layout rules, a11y attributes.
- [x] Playwright run with screenshots, axe.

**Acceptance Criteria:**
- Given a group of four Shown tales, when one card's switch is pressed once, then the sample page shows three; pressed again, four; every card has a dot.

## Implementation Notes

- **Design: drawer-as-fullscreen with the group in the URL**, not a separate route. `GroupView` (`pages/group-view.*`) wraps the shared `Drawer` with `wide`: 960 px on desktop, the whole page (`inset: 0`, no backdrop, no shadow) at ≤ 640 px. The zone page binds `?group=<id>` (component input binding, like `?tab=`): opening pushes a history entry, closing replaces the URL, so a deep link or reload opens it and the browser's Back closes it, as a page would on a phone. An id the zone does not list (stale link, group removed while open) is dropped in place and the view closes.
- **Drawer** (shared): drawers stack (a module-level list); Escape closes only the top one, so Escape in the tale or schedule drawer opened from the view leaves the view open. New inputs: `wide`, `panelId` (the trigger's `aria-controls`), `closeLabel`, `initialFocus` (`'title'` or a selector). Its heading now has `tabindex="-1"`. The view focuses its heading; the setup step "group On with a shown tale" opens the view at the first Hidden tale switch.
- **Layering:** the view sits at z-index 38/39, under the shell's drawers (40/50), so the tale drawer, schedule, rename etc. open above it and return focus into it. Duplicate's drawer renders beside the view's drawer (not inside), so the two focus traps never nest.
- **Row:** the inline open body is gone. The name button is the trigger: `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls` only while open. Row click outside the controls opens it (8.10 rules unchanged). The row's status alert hides while its view is open (the view shows it).
- **View head:** the group's On/Off switch, badge when needed, indicator, ⋯ (the row's menu, same items), "n of m shown · max 100", schedule chip, tags, "Also in". **Body:** "Add tale" (toolbar button, `#group-view-add-tale`), a reorder hint, and the tale cards wrapping into rows (`cdkDropListOrientation="mixed"`), each with the Shown/Hidden switch, the dot, ⋯ (Edit in Tale Studio → `/tales/{id}/studio?zone=`, Replace media → the tale drawer with focus on its media field, Schedule, Duplicate, Archive/Restore), handle and move buttons. "No tales yet." for an empty group.
- **Live region:** the view has its own (a screen reader may skip one outside an `aria-modal` dialog); the page's region is empty while the view is open, so nothing is said twice.
- **Tale Studio back link** returns to `/zones/{zone}?group={group}` (the group view).
- **Styles:** `group-view.css` is unencapsulated, every rule under `app-group-view`, so it can size the drawer and loads only with the zone page. Initial bundle 494.43 kB.
- **Tests:** dashboard specs open the first group's view through its name (`expandGroups`, optionally by name); `drawer()` skips the group view; `announced()` reads the view's region when open. 12 new specs: open/close with focus return and URL, Tab trap, deep link, unknown id dropped, Back closes, one-action hide/show with indicator and count and announcement, refusal, every ⋯ item (with Escape closing only the drawer on top), keyboard reorder, Add tale, group switch in head and close when removed, phone/wide CSS rules.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool` -- pass (dashboard 557 tests after merging `autopilot/foundation` 8906799); initial 494.43 kB.
- `node_modules/.bin/nx run web-sdk:size`, `web-sdk:types-check` -- pass.

**Manual checks:**
- Playwright (`shots-8.11/`, ports 3397/4297/4397, own `_test` DB): 40 checks passed. Group of four from media, On: the sample page shows four; Pool hidden from its card with one press (saved at once, announced in the view): three; shown again: four; every card has a dot. Tale ⋯ items; Replace media over the view, Escape closes only it; keyboard reorder; Studio `?zone=` and back link reopening the view; Escape and focus return; deep link; Back closes. Axe (WCAG 2.2 AA tags) clean on the view at desktop, after a hide, and at 390x844; at 390x844 the view fills the screen with no horizontal scroll.
