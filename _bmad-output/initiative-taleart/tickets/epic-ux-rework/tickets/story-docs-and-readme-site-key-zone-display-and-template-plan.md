---
title: 'Docs and README: site key, zone, display and template'
type: 'chore'
ticket: '16'
created: '2026-10-23'
status: 'built'
baseline_revision: '83cdc08'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-a-zone-has-one-display-and-a-slug-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-remove-zone-keys-and-the-stage-attribute-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-install-tab-copy-the-snippet-and-open-a-test-page-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The docs app is still the generated Nx welcome page, the Web SDK README still says "frame" where the product now says display and points the theme and performance examples at a made-up CDN path, and the research terminology map still lists Stage, Frame, Playbook and Zone key as TaleArt's current names (epic R17). A developer has no page that says how to place a zone, and nothing stops the old words coming back.

**Approach:** Replace the welcome page with a small docs app (Getting started, Concepts, Install a zone, Moving from stages and zone keys) that uses the report's glossary and shows the same snippet the dashboard's Install tab builds, by moving the snippet builder into the contract and using it in both. Update the Web SDK README to the glossary and the hosted SDK URL, update the terminology map rows, and add a docs test that refuses the retired instructions and checks the snippet text.

## Boundaries & Constraints

**Always:**
- Zone keys and `stage` are documented as removed (8.7, owner decision 2026-10-22), never as supported (R4 retired); the move is: issue the project's site key, name the zone by its slug.
- One snippet source: `installSnippet` / `testPageLink` / `SITE_KEY_PLACEHOLDER` live in `@taleart/contract/core`; the dashboard and the docs both call it, and the README's snippet is checked against it.
- The docs mention the hosted SDK `/sdk/v1/taleart.js`, the pinned `taleart.<hash>.js` URL with SRI (`sdkPinnedUrl`, `sdkIntegrity` from `GET /api/v1/install`), and the test page `/sdk/v1/test-page?zone=<slug>#siteKey=<key>`.
- No Storyly brand names in user-facing docs (AD-12, NFR-004). The terminology map, a research file, keeps them.

**Never:** behaviour changes to the API, SDK or dashboard beyond help text; an instruction to create a stage, apply a playbook, or use `zone-key` / `zoneKey` / a `tak_` key outside a section marked as removed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Docs snippet | Install page | `installSnippet(example, 'home-top', null)` text, byte for byte | test fails on a drift |
| README snippet | `libs/web-sdk/README.md` | contains the same text | test fails on a drift |
| Retired words | README or a docs page names a stage to create, a playbook to apply, `zone-key`, `zoneKey`, `tak_` | test fails, except inside the marked "removed" section | — |
| Pasted snippet | the snippet with a real key and slug in a blank page | the zone renders | — |

</intent-contract>

## Code Map

- `libs/contract/src/lib/core.ts` -- `installSnippet`, `testPageLink`, `SITE_KEY_PLACEHOLDER` (moved from the dashboard)
- `apps/dashboard/src/app/install-snippet.ts`, `pages/site-key-card.ts`, `create-drawer.html` -- use the contract's builder; glossary help text
- `apps/docs/src/app/**` -- docs pages, routes, shell; `docs-terms.spec.ts`
- `libs/web-sdk/README.md` -- glossary, hosted SDK URL
- `_bmad-output/initiative-taleart/research-storyly-competitive-teardown/terminology-map.md` -- zone, stage, frame, playbook, zone key rows

## Tasks & Acceptance

**Execution:**
- [x] contract -- move the snippet builder and its spec
- [x] dashboard -- import from the contract; glossary hint for tale groups
- [x] docs app -- shell with navigation, four pages, glossary, snippet from the contract; specs
- [x] docs check -- retired words and snippet equality over the docs sources and the README
- [x] README and terminology map
- [x] Playwright -- snippet on a blank page and the sample page against a local API; docs screenshots

**Acceptance Criteria:**
- Given the docs build, when the Install page is opened, then it shows the Install tab's snippet, the hosted, pinned and test page URLs, and no instruction to use a zone key.
- Given a project with a site key and a zone with a visible group, when the docs snippet with that key and slug is the only content of a blank page, then the zone renders.

## Implementation Notes

- **One snippet source.** `installSnippet`, `testPageLink` and `SITE_KEY_PLACEHOLDER` moved from `apps/dashboard/src/app/install-snippet.ts` into `libs/contract/src/lib/core.ts` (they take `Pick<InstallInfo, …>`); their spec moved to `libs/contract/src/lib/install-snippet.spec.ts` unchanged. `site-key-card.ts` imports them from `@taleart/contract/core`. The root ESLint boundaries gain `scope:docs` → `type:contract`.
- **Docs app.** The Nx welcome page is gone. A shell (header, side navigation, skip link, light and dark tokens) and four routes: Getting started (`/`), Concepts (`/concepts`, the glossary table from `docs-content.ts`, On/Off and Shown/Hidden, Update tale), Install a zone (`/install`: the snippet, attributes, site key, several zones, the hosted `/sdk/v1/taleart.js`, the pinned `taleart.<hash>.js` with SRI from `GET /api/v1/install`, the test page, theme per slug, when nothing shows) and Stages and zone keys (`/moving-from-stages`: what 8.5's fold did with the two matrix examples, frames → display, playbooks → templates, zone keys and `stage` removed with old/new markup and three steps). Every code block is built from `docs-content.ts`, which calls the contract's `installSnippet`/`testPageLink`.
- **Docs check** (`apps/docs/src/app/docs-terms.spec.ts`, part of `docs:test`; `tsconfig.spec.json` gains `node` types; the target's inputs add the README and the dashboard templates). It reads every docs source, `libs/web-sdk/README.md` and the dashboard's `*.html`, cuts the text between `docs-check:removed` and `/docs-check:removed`, and fails on: creating/adding/new stage, `stage="`, applying a playbook, "Playbook card", `zone-key`, `zoneKey`, `tak_`, issuing/rotating/using/copying a zone key. Storyly is refused in the docs and README. It also checks the docs snippet equals `installSnippet` for the example zone (and its literal text) and that the README contains it verbatim. `app.spec.ts` renders each page through the router and checks the snippet, URLs, glossary terms and the removed section.
- **README.** A Terms table, the Install tab's snippet verbatim (placeholder key), a marked "Removed: zone keys and the `stage` attribute" section with the move, "display" where it said frame (theme, `cornerRadius`, height reservation, perf seed), and the hosted SDK URL in the theme and preload examples instead of a made-up CDN path.
- **Dashboard help.** The New tale group name hint now defines a tale group with the glossary sentence. Other help text already used the glossary (zone, display, template hints; theme page); no stage, playbook or zone key text remains in dashboard templates.
- **Terminology map.** Zone, Instance/Stage, Widget/Frame, Flow/Playbook and Placement token/Zone key rows updated (display, template, site key plus slug; stage and zone key retired with dates and stories); the core entities list follows.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard docs contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --parallel=2` -- passes except the known clock test
- `node_modules/.bin/nx run web-sdk:types-check` -- passes

**Results (2026-10-23):** lint, test and build pass for every listed project except the known clock test in api ("creates the admin, signs them in and stores only the token hash", 590 of 591). docs 19 tests, contract 371, dashboard 617, web-sdk 411; `web-sdk:types-check` passes; docs initial bundle 244 kB.

**Manual checks (Playwright, `shots-8.16/` in the scratchpad):** API on 3404 (`taleart_w816_play_test`), docs build on 4404, sample page on 4504. The `#docs-snippet` text taken from the built Install page, with the local API URL and an issued site key swapped in, was the only content of a blank page served from localhost: it rendered the `home-top` bar with both groups and logged no console error, and the viewer opened. The sample page `?zones=home-top&api=…#siteKey=…` and the test page rendered the same zone. Docs pages captured at 1280 px and the Install page at 390 px (no horizontal page scroll).
