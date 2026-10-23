---
title: 'A tale group in no zone can get tales'
type: 'feature'
ticket: '19'
created: '2026-10-23'
status: 'built'
baseline_revision: '60eaff8'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-open-a-group-to-show-or-hide-each-tale-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-zones-list-and-tale-groups-page-show-status-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-the-tale-drawer-saves-status-at-once-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A group created in no zone (8.14) cannot get tales: the group view (8.11) needs a zone, it reads tales from the zone lists and orders them through a per-zone queue, and the tale drawer and Tale Studio find a tale only in the zone lists. The Tale groups page shows such a group's name as plain text (follow-up from 8.14).

**Approach:** Contract first, a read of one group with its tales (`GET /tale-groups/{id}`). The store reads a group on its own when a page opens it, keeps it fresh on each refresh until released, and finds groups and tales there too; tales of such a group are ordered through the existing group-level endpoint (`PUT /tale-groups/{id}/tales/order`) in a queue of its own. The Tale groups page opens **every** group, placed or not, in the same group view, in-page (`/tale-groups?group=<id>`).

## Boundaries & Constraints

**Always:**
- One UX on the Tale groups page: the name is a button (`aria-haspopup="dialog"`, `aria-expanded`, `aria-controls` while open) that opens the group view here, for any group; a click on the row outside its controls does the same (8.10 rules, shared helper). The zone page keeps its own view (`/zones/<id>?group=`), unchanged.
- The view on the Tale groups page works on the group as `GET /tale-groups/{id}` reads it: visibility in any zone (as the row says), the page's ⋯ menu (no "Remove from this zone"), "In: <zones>" or "Not in a zone. Show it in a zone from the ⋯ menu to put it on the site."
- URL and history as on the zone page: opening pushes an entry marked as ours, closing goes back (else drops `?group=` in place); a deep link and a reload open it; a `?group=` naming no group of the selected project is dropped once the project's list is read; focus returns to the name, else the list heading.
- Status changes, reorder and Add tale from the view save as on the zone page; the order is optimistic and a refusal rolls back, with the message in the view; an order pending through a refresh is kept, then the group is read again.
- Tale Studio: a tale no zone lists has its group read (title, project, Update tale, Duplicate work); its back link goes to `/tale-groups?group=<id>` when opened from there (`?from=tale-groups`) or when no zone lists the tale.
- All dashboard code in lazy chunks; initial bundle under 500 kB; WCAG 2.2 AA.

**Never:** a second order endpoint (the group-level one exists); tales on the project list (8.14 kept it light); changes to the zone page's view behaviour; the tale group cap (8.22) or Delete (8.20).

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|---|---|---|
| Open in no zone | click "Loose" | `/tale-groups?group=g2`, `GET /tale-groups/g2`, dialog "Loose" with its tales, "Not in a zone…" |
| Open placed | click a placed group | same view here, "In: Home top" |
| Add tale | Add tale in the view | drawer "In tale group Loose", POST, the new card shows after the refresh |
| Hide | card switch | `PUT /tales/{id}/status` at once; switch and count update from the answer |
| Reorder | move button | `PUT /tale-groups/g2/tales/order` at once; refusal rolls back with the message |
| Tale drawer | open a card | finds the tale though no zone lists it |
| Studio | Edit in Tale Studio | `/tales/{id}/studio?from=tale-groups`, back link to the view |
| Unknown | `?group=nope` | dropped in place, other params kept |
| Close | Escape | back in history, focus on the name, the group is no longer read |
| API | `GET /tale-groups/{id}` other project / unknown | 403 `forbidden` / 404 `tale_group_not_found` |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/generated/api.ts` -- `getTaleGroup`.
- `apps/api/src/http/tale-groups.router.ts` -- the GET route (`getTaleGroup` + tags).
- `apps/dashboard/src/app/dashboard.store.ts` -- `readGroups`, `ensureTaleGroup` / `releaseTaleGroup`, refresh, lookups, patches, order queue keyed `group:<id>`.
- `apps/dashboard/src/app/pages/tale-groups.ts` -- name button, row click, in-page group view with `?group=`.
- `apps/dashboard/src/app/pages/group-view.{ts,html}` -- `zoneId` '' on the Tale groups page: studio link `?from=tale-groups`, "In:" / "Not in a zone".
- `apps/dashboard/src/app/group-row.ts`, `pages/zone-detail.ts` -- shared `opensFromRowClick`.
- `apps/dashboard/src/app/pages/tale-studio.ts` -- reads the group of an unlisted tale; back link.
- Specs: `apps/api/src/app.spec.ts`, `apps/dashboard/src/app/app.spec.ts`, `pages/tale-studio.spec.ts`, `apps/dashboard-e2e/src/a11y.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] Contract, API route and tests (read in no zone and placed, tags, order, 404, cross-project 403).
- [x] Store: groups read on their own, kept fresh, patched, ordered through the group.
- [x] Tale groups page: in-page group view for every group; group view and studio adjustments.
- [x] Specs (dashboard and studio) and an a11y state; browser run with screenshots.

**Acceptance Criteria:**
- Given a group created in no zone on the Tale groups page, when it is opened, two tales added from media, one hidden and the two reordered, and the group is shown in a zone and turned On, then the sample page shows the group with only the shown tale.

## Implementation Notes

- **API:** `GET /tale-groups/{taleGroupId}` (`getTaleGroup`) answers the `TaleGroup` with tales in order, tags, zones and visibility in any zone; the existing `getTaleGroup` of the tales module plus `withTags`; access through `authorizeParam('taleGroup')`.
- **Store:** `readGroups` (keyed by id) holds groups read with `ensureTaleGroup(id)`; each refresh reads the wanted ones again after the project lists (a group that cannot be read is dropped, without the API-down banner); `releaseTaleGroup(id)` forgets it. `taleGroup(id)` now returns the zone lists' group, else the read one (type `TaleGroup`; no caller used `position`); `tale(id)` looks in both. Status, tale status and tags answers patch the read group too. `orderTales('', groupId, ids)` orders a read group through its own queue (`group:<id>`): `enqueueOrder` now works on a list key, with `orderList`/`setOrderList` giving a zone's groups or the one read group; a saved order is shared with the zones that list the group and with the read group (`shareTales` by key); `keepPendingGroupOrders` keeps a pending order through a refresh and reads again once settled.
- **Decision (UX):** the Tale groups page opens every group in an in-page group view, placed or not, rather than linking placed groups to a zone page: one behaviour per page, no zone to choose for a group in several, and the view's visibility matches the row's ("in any zone"). The zone page's view is unchanged; "In: <zone>" links in the row and in the view still lead to the zone pages.
- **Tale groups page:** the name is the 8.11 trigger button (`#group-name-<id>`, class `group-row__open`); the open id follows `?group=` (`linkedSignal`); an effect reads the open group and releases it on close or leaving; history as the zone page (`taleartGroupView` state). Status changes from the view keep it open (Archive included; the page has no Undo); the leaving-row focus move only runs with the view closed. The page's live region is empty while the view is open (the view has its own).
- **Group view:** `zoneId` '' means the Tale groups page: Edit in Tale Studio carries `?from=tale-groups` instead of `?zone=`; "Also in" reads "In:" there, or says the group is in no zone.
- **Tale Studio:** after `GET /tales/{id}`, a tale the store does not know gets its group read (`ensureTaleGroup`), so the header, Update tale and Duplicate work for a tale in no zone; the group stays read for the session (one extra GET per refresh until the Tale groups page releases it). Back link order: `?from=tale-groups` → Tale groups view; else the zone lists as before; else a known group → Tale groups view; else "Back".
- **Bundle:** dashboard initial total 396.89 kB; the group view is now shared by the zone page and Tale groups page chunks.
- **Env note:** an `api:build` run with `--excludeTaskDependencies` before `web-sdk` was built cached a `dist/apps/api` without `web-sdk/index.js` (the copy is not an Nx input), so the first `dashboard-e2e:e2e` run failed on `/sdk/v1/taleart.js` 404; rebuilt with `--skip-nx-cache`, it passed.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard docs contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly dashboard-e2e --parallel=2` -- all pass except the known `api:test` "auth > creates the admin, signs them in and stores only the token hash" (`expected 606033 to be 604800`, local Postgres clock behind). API 599/600, dashboard 667.
- `dashboard-e2e:e2e` -- 8 passed; `dashboard-e2e:a11y` -- 28 passed (new state `tale-groups-group-view`).

**Manual checks:**
- Browser run (`shots-8.19/`, ports 3419/4419/4519, own `_e2e_test` DB): 24 checks passed. New group in no zone on the Tale groups page; opened (URL, "Not in a zone…"); two tales added from PNGs in the view; Pool hidden from its card (1 of 2 shown); Pool moved earlier by keyboard (focus kept); reload reopens the view with the order and the hidden state; tale drawer for a tale in no zone; Edit in Tale Studio and its back link to the view; Show in another zone → Home top, turned On; Escape returns focus to the name; the Delivery API lists the group with Beach only and the sample page plays it; 390x844 without horizontal scroll; axe (WCAG 2.2 AA tags) clean on the view empty, with tales and at 390 px.
