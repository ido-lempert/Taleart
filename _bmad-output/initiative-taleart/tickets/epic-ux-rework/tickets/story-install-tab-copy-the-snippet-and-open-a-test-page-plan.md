---
title: 'Install tab: copy the snippet and open a test page'
type: 'feature'
ticket: '13'
created: '2026-10-22'
status: 'built'
baseline_revision: 'ddd48ee'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-place-a-zone-with-the-project-s-site-key-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-zone-page-with-a-header-a-setup-checklist-and-three-tabs-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Install tab shows only the site key card with a `site-key="…"` hint: a new user must know the SDK's script URL and markup, has no way to check a zone before touching their site, and the first run from sign-up to a visible tale takes about 26 actions against the epic's 15 (epic R13, Done when; legacy zone keys are void since 8.7).

**Approach:** The API serves the Web SDK bundle and a TaleArt test page under `/sdk/v1`, and tells the dashboard its URLs (`GET /api/v1/install`). The Install tab shows a copy-ready snippet (script tag + `<taleart-view api-url site-key zone>`) with a Copy button and "Open test page"; right after issuing, the key drawer shows the snippet and the test page link with the key. A Playwright first-run test counts actions; the path is cut to 15 by four small changes on the way (below).

## Boundaries & Constraints

**Always:**
- Contract first: `GET /install` → `InstallInfo { apiUrl, sdkUrl, testPageUrl }`; `SDK_BASE`, `SDK_BUNDLE_PATH`, `SDK_TEST_PAGE_PATH`, `TEST_PAGE_KEY_PARAM` in `core.ts`.
- The key is shown only in the issue drawer; the tab's snippet says `YOUR_SITE_KEY` with a note; the test page link carries the key only in the URL fragment.
- Test page: static files, nothing of the request reflected; CSP `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'` (the SDK's Shadow DOM `<style>`), media/connect/font from self and the public API origin, `base-uri`/`form-action`/`frame-ancestors 'none'`; `X-Robots-Tag: noindex` and the meta; `Referrer-Policy: no-referrer`; `no-store`. The page stores the key nowhere and gives it only to the SDK.
- Dashboard initial bundle under 500 kB; the Install tab stays in the lazy zone page.

**Never:** a zone key or legacy-key UI (removed in 8.7); the key in a query string, storage or log; inline script on the test page.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Snippet, no key at hand | Install tab | `<script type="module" src="<api>/sdk/v1/taleart.js">` + `<taleart-view api-url site-key="YOUR_SITE_KEY" zone="<slug>">`, every value attribute-escaped |
| Issue | admin clicks Issue site key | key issued at once (warning shown on the tab before); drawer shows key, snippet with key, Copy snippet, Open test page `…?zone=<slug>#siteKey=<key>` |
| Copy | Copy snippet | clipboard holds the snippet; "Snippet copied" announced; failure says to select and copy |
| Test page with fragment | `?zone=home-top#siteKey=…` | zone renders; fragment removed from the address bar |
| Pasted key | no fragment, key pasted | zone renders; field emptied |
| Unknown slug / revoked key | | nothing renders; one SDK console error |
| Not a slug | `?zone=<img…>` | "This page needs a zone." and no element |
| Bundle missing | API built without web-sdk | 404 |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/lib/core.ts`, `src/generated/api.ts` -- `/install`, `InstallInfo`, SDK paths
- `apps/api/src/http/sdk.router.ts` (new), `app.ts`, `main.ts`, `webpack.config.js`, `project.json` -- routes, bundle copy, implicit dependency on web-sdk
- `apps/api/src/sdk-pages/test-page.{html,js,css}` (new) -- the test page
- `apps/dashboard/src/app/install-snippet.ts` (new), `pages/site-key-card.ts` -- snippet, copy, test page link
- `apps/dashboard/src/app/create-drawer.{ts,html}`, `dashboard.store.ts`, `pages/setup.ts`, `pages/zone-detail.html` -- first-run cuts
- `apps/dashboard-e2e/` -- Playwright config, server scripts, `first-run.spec.ts`, `axe.ts`

## Tasks & Acceptance

**Execution:**
- [x] Contract -- `/install`, `InstallInfo`, constants; regenerate
- [x] API -- `/sdk/v1/taleart.js`, `/sdk/v1/test-page{,.js,.css}`, `GET /api/v1/install`; tests
- [x] Dashboard -- Install tab snippet, Copy, Open test page; issue at once; specs
- [x] First-run cuts -- first project at setup, zone page after New zone, group drawer takes files; specs
- [x] Playwright first-run e2e as `dashboard-e2e:e2e`; README

**Acceptance Criteria:**
- Given a new install, when a user signs up and follows the path, then a tale of the zone shows on the test page in at most 15 actions with no tale published by hand.
- Given the snippet copied from the issue drawer, when it is the only content of a blank HTML page, then the zone renders as on the test page.

## Implementation Notes

- **Where the SDK is served.** The API, at `<PUBLIC_API_URL>/sdk/v1/taleart.js` (the ES build, `dist/libs/web-sdk/index.js`). The API build copies it next to `main.js` as `web-sdk/index.js` (webpack asset; `web-sdk` is an implicit dependency of `api`, so its build runs first). `WEB_SDK_FILE` names another file. Headers: `text/javascript`, CORS `*` (global), `Cross-Origin-Resource-Policy: cross-origin`, `nosniff`, `public, max-age=300`, a SHA-256 ETag (304 on match). Missing: 404. `v1` follows the Delivery API's version.
- **Test page.** `/sdk/v1/test-page` (HTML), `test-page.js`, `test-page.css`, read once from `sdk-pages/` next to the API code; only those three names are served. Headers in the matrix plus `X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin`. The script reads `?zone=` (checked against the slug pattern), the key from `#siteKey=` (then `history.replaceState` drops the fragment), or from a password field (emptied on submit); it builds `<taleart-view>` with DOM calls, `api-url` = its own origin. No storage, no cookie, no other request.
- **Install tab.** `site-key-card.ts` now holds the Site key and Snippet sections. `GET /install` once per card; a partial answer reads as a failure ("The snippet could not be loaded"). The tab's snippet always says `YOUR_SITE_KEY`; the issue drawer shows the key, the snippet with it, Copy snippet and Open test page (primary); Done forgets it. Links open in a new tab with `noopener noreferrer` and a hidden "(opens in a new tab)".
- **Issue at once.** With no active key nothing stops working, so Issue site key issues on click; the exposure warning ("It opens every zone of this project…") moved onto the tab, above the button. Rotate and revoke still confirm in the drawer. A refused issue leaves the drawer with the warning, the message and Issue key to retry.
- **First-run cuts (needed for ≤ 15).** (1) Setup has a "First project" field, "My project" by default; after the passkey the page creates it (a refusal leaves the existing "Create your first project" state). (2) Creating a zone opens its page, focus on its heading. (3) The New tale group drawer takes images or videos (`multiple`): one tale per file, in order, titled after the file name (`taleTitleFromFile`), media uploaded; on a refusal the drawer keeps only Done and says which tale failed. (4) Issue at once.
- **First-run count (e2e).** 15: name, email, Create passkey; New zone, zone name, Create; New tale group, group name, choose two images, Create; turn the group On; Install tab; Issue site key; Open test page; open the tale (viewer shows 2 segments and the image). The bar item is visible after action 14.
- **E2E target.** `dashboard-e2e:e2e` (depends on `api:build`): `scripts/start-api.mjs` drops and creates the database in `E2E_DATABASE_URL` (refused unless it ends in `_test`) and starts `dist/apps/api/main.js` on `E2E_API_PORT` (3413); `scripts/serve-dashboard.mjs` serves the dashboard with `--excludeTaskDependencies` on `E2E_DASHBOARD_PORT` (4313) with a generated proxy. Chromium only, one worker, virtual passkey via CDP. Four serial tests: the first run, the copied snippet on a blank page (served from 127.0.0.1 by the test: Chrome's Local Network Access blocks a page it takes for public from calling localhost), the pasted key (requests carry the key only as `Authorization` to `/delivery/v1/zone`, never in a URL; nothing stored), and unknown slug / not a slug / revoked key. axe (WCAG 2.2 AA) on the Install tab before and after the key, the issue drawer and the test page: clean. The stub `example.spec.ts` is gone.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool --parallel=2`
- `web-sdk:size`, `web-sdk:types-check`, `sdk-sample:a11y`
- `E2E_DATABASE_URL=postgres://…/taleart_w813e2e_test node_modules/.bin/nx run dashboard-e2e:e2e`

**Results (2026-10-23):** lint, test and build pass except one API test, "creates the admin, signs them in and stores only the token hash", the known local Postgres clock skew (api 578 of 579, dashboard 605, web-sdk 385, contract 367). `web-sdk:size` 23.51 KB gzipped; `web-sdk:types-check` passed; `sdk-sample:a11y` no violations; dashboard initial 392.90 kB; `dashboard-e2e:e2e` 4 passed, first run in 15 actions.

**Manual checks:**
- Screenshots in `shots-8.13/` (scratchpad): Install tab before and after the key, the issue drawer, the test page, the viewer, the blank page, the pasted key, the revoked key, the tab at 390 px.
