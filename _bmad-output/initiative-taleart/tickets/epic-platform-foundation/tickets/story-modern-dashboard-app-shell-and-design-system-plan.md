---
title: 'Modern dashboard: app shell and design system'
type: 'feature'
ticket: '14'
created: '2026-10-20'
status: 'built'
baseline_revision: '8a48e943028af985efb9635e5b171ddd1d7a252f'
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
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The dashboard is one unstyled HTML page; the user wants it to look and feel like a modern engagement product (comparable to Storyly's dashboard), not "a website from the 90s".

**Approach:** Add TaleArt's own design system (tokens and reusable components) and an app shell with routing: a navigation rail, a top bar with a project switcher, a Zones page of cards, a Zone page with frames and tale-group rows of 9:16 tale cards, a Projects page, and right-side drawers for every create form. Behavior of every existing flow stays the same.

## Boundaries & Constraints

**Always:** TaleArt's own identity: wordmark "TaleArt" with an inline SVG mark; primary color ember `#F2542D` (hover `#D9441F`), ink `#111827`, text muted `#6B7280`, surface `#FFFFFF`, canvas `#F6F6F9`, border `#E5E7EB`, success `#12B76A`, danger `#D92D20`; radius 12px cards, 8px controls, 999px pills; 4px spacing scale; font Inter (self-hosted through `@fontsource-variable/inter`, OFL-1.1) with a system-ui fallback. All colors and sizes are CSS custom properties in `apps/dashboard/src/styles.css`. WCAG 2.2 AA (NFR-007): text contrast at least 4.5:1, visible focus rings, every control labeled, drawers close on Escape, move focus inside on open and return it on close. Works at 1440px and at 390px wide (the rail becomes a bottom bar under 640px). Icons are inline SVG, no icon font. Every API error message still shows next to the form that caused it. SSR-safe: browser-only APIs (`localStorage`) are guarded.

**Never:** Storyly's logo, name, colors (its purple), screenshots, icons or copied text. A UI component library (Material, PrimeNG, Tailwind). New API endpoints or contract changes. Fake data in the product: empty states say what to do instead.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First visit, no projects | `/` | redirects to `/zones`; empty state "Create your first project" with a button opening the project drawer | — |
| Pick project | project switcher in top bar | Zones page shows only that project's zones; choice survives a reload | — |
| Zones page | project with zones | grid of zone cards: name, frame type pills, tale group count | — |
| Create zone | "New zone" → drawer → name → Create | drawer closes, card appears | API message in the drawer, drawer stays open |
| Zone page | `/zones/:zoneId` | header with zone name and project; Frames section with type pills and "Add frame"; Tale groups section, one row per group: group name, tale count "n / 100", horizontal list of 9:16 tale cards (title on a gradient placeholder), "Add tale" card at the row end | unknown zone → "Zone not found" state with a link back |
| Create frame, tale group, tale | buttons open drawers | item appears in place, order kept | API message in the drawer |
| Projects page | `/projects` | list of project cards and "New project" drawer | API message in the drawer |
| API down | any page | non-blocking banner "Could not reach the API" | — |

</intent-contract>

## Code Map

- `apps/dashboard/src/app/app.ts`, `app.html`, `app.css` -- current single component: holds all state, API calls (`API_BASE`, `apiErrorMessage`, `refresh`, `addProject`, `addZone`, `addFrame`, `addTaleGroup`, `addTale`). Reuse its API calls and error handling; split into a data service plus page components.
- `apps/dashboard/src/app/app.spec.ts` -- component tests with `HttpTestingController` and the extra timer tick after `whenStable()`; rewrite against the new pages, keeping every existing behavior covered (create flows, API message shown, order of tales).
- `apps/dashboard/src/app/app.routes.ts` -- empty; add `''` → `zones`, `zones`, `zones/:zoneId`, `projects`, wildcard → zones. `app.routes.server.ts` -- keep SSR config; render these routes client-side (`RenderMode.Client`) if prerendering would call the API.
- `apps/dashboard/src/styles.css` -- empty; design tokens and shared component classes go here (keeps component styles under the 4 KB budget in `apps/dashboard/project.json`).
- `apps/dashboard/src/index.html` -- title "TaleArt"; add a favicon SVG in `apps/dashboard/public/`.
- `@taleart/contract` -- types `Frame`, `FrameType`, `TaleGroup`, `Tale`, `isErrorBody`; use them, do not change the contract.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- add `@fontsource-variable/inter`; import it in `styles.css`.
- [x] `apps/dashboard/src/styles.css` -- tokens, base typography, buttons (primary, secondary, ghost), inputs, selects, cards, pills, empty state, banner, drawer, focus ring, responsive breakpoint.
- [x] `apps/dashboard/src/app/` -- `dashboard.store.ts` (signals for projects, zones, frame types, frames, tale groups; selected project persisted in `localStorage`; all API calls), shell (`app.html`: rail, top bar with switcher, `router-outlet`), `drawer` component, pages `zones`, `zone-detail`, `projects`, inline SVG icons.
- [x] `apps/dashboard/src/app/*.spec.ts` -- one test per matrix row that the component layer can show; existing behaviors kept.
- [x] `apps/dashboard/src/index.html`, `apps/dashboard/public/` -- title, favicon mark.

**Acceptance Criteria:**
- Given the API and dashboard are running, when a user opens `http://localhost:4200`, then they see the rail, top bar, project switcher and the Zones page, styled per the tokens.
- Given a zone with a tale group of two tales, when the user opens the zone, then the group shows as a row with two 9:16 tale cards in the order added and an "Add tale" card.
- Given a 390px-wide viewport, when any page is shown, then nothing scrolls horizontally except tale rows, and the navigation is a bottom bar.
- Given a create drawer, when the user presses Escape, then it closes and focus returns to the button that opened it.

## Implementation Notes

- Contrast: white on ember `#F2542D` is 3.8:1 and on `#D9441F` 4.4:1, both under the 4.5:1 the plan also requires. Ember stays the brand color (mark, ring, active-nav tint, focus ring, input focus); fills and text that carry text use `--ember-strong #C73E1D` (5.1:1 with white, hover `#A9341A`). `--text-muted #6B7280` is 4.4:1 on the canvas, so muted text on the canvas uses `--text-secondary #4B5563`; muted stays on white surfaces only. Success green is not used for text.
- The zone drawer keeps a project select, prefilled with the selected project, so the API's project validation message still has a place to show.
- The top bar's "New …" button is icon-only under 640px; its label stays for screen readers.
- Removed the unused Nx scaffold `nx-welcome.ts` (it broke the 4 KB component-style budget with a warning) and the Nx `favicon.ico`; the favicon is now `public/favicon.svg`.

## Plan Change Log

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 8 findings — high 0, medium 2, low 6, false 0, maybe-false 0
- findings:
  - `[medium]` `[patch]` Skip link `href="#main"` resolved against `<base href="/">` and reloaded the app at `/` — fixed: the click is handled in code and focuses `#main`.
  - `[low]` `[patch]` `.form-error` red on its tint was ~4.44:1 — fixed: new `--danger-text #B42318`.
  - `[low]` `[patch]` `.avatar` initials ~4.44:1 — fixed: `#A9341A`.
  - `[medium]` `[patch]` With the API down, pages claimed "Create your first project" or "Zone not found" — fixed: only the banner shows while the API is down; new test on three pages.
  - `[low]` `[patch]` Focus fell to `body` when the opener was removed by the refresh — fixed: falls back to `#main`.
  - `[low]` `[patch]` Escape or backdrop during a save lost a refusal's message — fixed: the drawer ignores close requests while saving.
  - `[low]` `[patch]` The drawer stayed open across navigation and could post to the old zone — fixed: closes on `NavigationStart`.
  - `[low]` `[patch]` Top-bar title was 20px, plan says 24px/600 — fixed: `--text-xl`.

## Design Notes

Look and feel: calm, airy SaaS. White cards on the light canvas with a 1px border and a soft shadow (`0 1px 2px rgb(16 24 40 / 6%)`), 24px page padding, page title 24px/600, section titles 16px/600, body 14px. The rail is 72px wide, white, with the mark at the top and icon buttons (Zones, Projects) with a label under each; the active item has an ember-tinted background (`#FEECE7`) and ember icon. Top bar 64px: page title on the left, project switcher (pill-shaped select with the project's initial in a colored circle) and a primary "New …" button on the right. Tale cards: 120×213px, radius 12px, a gradient placeholder from the tale id (two tones of a token palette), title in white over a bottom scrim, position badge. A tale group row starts with a 56px circle "ring" (ember gradient border) holding the group initial — the familiar story-ring pattern. Drawer: 420px from the right (full width on phones), header with title and close button, scrollable body, footer with Cancel and primary action.

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p dashboard api contract` -- expected: all succeed, no budget errors.

**Manual checks (if no CLI):**
- The parent session screenshots `/zones` and a zone page at 1440px and 390px wide.

## Auto Run Result

**Summary:** The dashboard is now a routed app with TaleArt's own design system: navigation rail (bottom bar on phones), top bar with project switcher and a primary "New …" action, Zones page of cards, Zone page with frames and tale-group rows of 9:16 tale cards with a story ring, Projects page, and right-side drawers for every create form. Behavior of every flow is unchanged.

**Files changed:**
- `apps/dashboard/src/styles.css` — tokens and shared component classes; Inter via `@fontsource-variable/inter`.
- `apps/dashboard/src/app/dashboard.store.ts` — state and all API calls; selected project in `localStorage` (SSR-guarded).
- `apps/dashboard/src/app/app.*`, `drawer.ts`, `create-drawer.*`, `icon.ts`, `pages/*` — shell, drawer, forms, icons, pages.
- `apps/dashboard/src/app/app.routes*.ts`, `app.config.ts` — routes, client rendering, input binding.
- `apps/dashboard/src/index.html`, `public/favicon.svg` — title and mark; scaffold favicon and `nx-welcome.ts` removed.
- `package.json`, `package-lock.json` — `@fontsource-variable/inter`.

**Review:** 8 patches applied (2 medium, 6 low), 0 deferred, 0 rejected.

**Deviation from the plan:** white on ember `#F2542D` is 3.8:1, so filled buttons and links use `--ember-strong #C73E1D` (5.1:1); ember stays the brand accent. Muted text on the canvas uses `#4B5563`. Awaiting the user's confirmation.

**Follow-up review recommended:** true. Two medium findings were patched; the focus fallback, the busy guard and close-on-navigation have no tests of their own.

**Verification:** `nx run-many -t lint test build -p dashboard api contract` passed before and after the patches (dashboard 21, api 39, contract 2 tests; no budget warnings). Screenshots at 1440px and 390px of the Zones and Zone pages were sent to the user.

**Residual risks:**
- Every create reloads all data; the Zone page reads from the full zone list.
