---
title: 'Zone page with a header, a setup checklist and three tabs'
type: 'feature'
ticket: '9'
created: '2026-10-22'
status: 'built'
baseline_revision: 'd6a86ab'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-place-a-zone-with-the-project-s-site-key-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The zone page is a stack of equal cards (header, Display, Site key, Zone key, Tale groups), so a new user cannot tell what to do first or when the zone is done (epic R9, report §5).

**Approach:** A header that summarises the zone, a setup checklist shown until the zone is first visible, and three tabs (Tale groups, Display, Install) whose selection lives in the URL. "First visible" is stored server side as `zones.first_visible_at`, set by the API the first time it returns the zone as visible, so it is the same for every user.

## Boundaries & Constraints

**Always:**
- Contract first: `Zone.firstVisibleAt` (ISO date-time or null, required) in `openapi.yaml` and the generated types.
- Forward-only migration in the zones module: `ALTER TABLE zones ADD COLUMN IF NOT EXISTS first_visible_at timestamptz`.
- Set once, never cleared: `UPDATE … SET first_visible_at = COALESCE(first_visible_at, now())`, only for zones the same read found visible.
- Checklist steps from the zone's visibility reasons (the Delivery rule): display = has a frame; install = no `zone-not-installed`; group = neither `no-tale-groups` nor `no-visible-groups`.
- WAI-ARIA tabs: tablist, roving tabindex, ArrowLeft/Right (wrapping), Home, End, `aria-selected`, `aria-controls`, panels `aria-labelledby`.
- The zone page stays a lazy chunk; dashboard initial bundle under 500 kB.

**Never:** reworking group rows (story 8.10), the snippet or test page (8.13), moving the legacy Zone key card into Install (8.7 removes it).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| New zone | no display, key, group | `firstVisibleAt: null`; checklist 0 of 3, opens on Tale groups |
| Step link | click a step | its tab selected, URL updated, its control focused |
| First visible | GET /zones finds the zone visible | `firstVisibleAt` set and returned; checklist gone |
| Later not visible | group turned Off | `firstVisibleAt` unchanged; checklist stays gone |
| Concurrent first reads | three GETs at once | all answer the same value |
| Unknown tab | `?tab=nope` | Tale groups |
| Keys | ArrowRight on last tab | wraps to the first, selects and focuses it |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/generated/api.ts` -- `Zone.firstVisibleAt`
- `libs/server/zones/src/lib/migration.ts`, `zones.ts`, `index.ts` -- column, `ZONE_COLUMNS`, `markZonesFirstVisible`
- `apps/api/src/http/zones.router.ts` -- `withZoneVisibility` marks first-visible zones
- `apps/dashboard/src/app/zone-setup.ts` -- tabs, steps, `showsSetup`, `zoneInstalled`
- `apps/dashboard/src/app/pages/zone-detail.{ts,html}` -- header, checklist, tabs, panels
- `apps/dashboard/src/app/pages/site-key-card.ts` -- contrast fix on the snippet code

## Tasks & Acceptance

**Execution:**
- [x] contract -- `firstVisibleAt`
- [x] zones module and API -- column, mark on read; API tests
- [x] dashboard -- header, checklist, tabs; unit and page tests
- [x] Playwright run with screenshots and axe

**Acceptance Criteria:**
- Given a new zone, when it is opened, then it shows Tale groups and three open steps; doing each step ticks it; once visible the checklist is gone, also after reload and after the zone stops being visible; reloading on Display keeps Display; the theme link opens the project theme.

## Implementation Notes

- **Tab pattern: automatic activation.** Every panel is rendered and the inactive ones carry `hidden`, so selecting is cheap; arrows, Home and End move focus and select at once. Panels have `tabindex="0"` (APG). The selected tab is a `linkedSignal` over the `tab` query parameter input (component input binding), so a click changes it at once and back/forward/reload follow the URL. Each selection is a history entry; Tale groups drops the parameter.
- **First visible.** Set by `withZoneVisibility` in the zones router (list, create, rename), the only places zone visibility is read. Every dashboard mutation re-reads `/zones`, so the zone is marked as soon as the dashboard sees it visible. A zone visible only between two reads that nobody made is not marked; acceptable for a checklist. The dashboard also hides the checklist when `visibility.visible` is true before the API's value arrives.
- **Header.** Name and indicator on one wrapping line, then project, slug and template note, then summary pills (display type or "No display", "n tale groups", "Installed"/"Not installed", the latter hidden while visibility is unknown), then "Edit name and slug".
- **Step links.** Display focuses `#display-choose` or the type select; Install focuses `#site-key-issue` (or Rotate); the group step focuses an Off group switch, else any switch, else "New tale group"; the panel when nothing matches.
- **Legacy Zone key card** left below the tab panels, unchanged, for story 8.7 to delete.
- **Contrast.** axe found the Site key card's `<code>` in muted text under 4.5:1; it now uses `--text`.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool --skip-nx-cache` -- passed after merging 8.15 (api 552 tests, dashboard 497); dashboard initial 497.19 kB.
- `web-sdk:size` 21.86 KB gzipped; `web-sdk:types-check` passed.
- The keydown handler sits on each tab (lint: interactive elements must be focusable), not on the tablist.

**Manual checks:**
- Playwright (`shots-8.9/`): every check passed, including axe on each tab and no horizontal scroll at 390 px.
