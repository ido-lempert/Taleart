---
title: 'The docs show the whole API with a Swagger UI you can try with a token'
type: 'feature'
ticket: '2'
created: '2026-10-24'
status: built
baseline_revision: 'f5f75d8'
route: 'full'
route_source: 'auto'
risk: 'medium'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-developer-experience/epic-developer-experience.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-developer-experience/tickets/story-create-list-and-revoke-api-tokens-for-scripts-plan.md'
  - '{project-root}/libs/contract/openapi/openapi.yaml'
  - '{project-root}/apps/docs/src/app/pages/api-tokens.ts'
  - '{project-root}/apps/api/src/app.ts'
warnings:
  - 'Vendored third-party code (swagger-ui-dist 5.33.1) in the docs static assets: review the version and integrity line.'
deferred:
  - 'A cookie-session mode for the reference (the dashboard and the docs on one origin): the session scheme stays out of the docs.'
  - 'Upgrading swagger-ui-dist is manual (copy the five files, update the README line).'
  - 'Swagger UI accessibility issues that only an upstream fix can remove (listed under Accessibility exceptions).'
---

<intent-contract>

## Intent

**Problem:** the API is described only by `libs/contract/openapi/openapi.yaml`, which a developer has to
read as YAML. With API tokens (10.1) a browser page on another origin can now call the Management API,
so the docs can offer the whole reference with a working "Try it out".

**Approach:** an "API reference" docs page that renders the OpenAPI document with a vendored
Swagger UI (swagger-ui-dist 5.33.1, loaded only on that page). The spec is generated as JSON by
`contract:generate`, copied into the docs build (offline) and served by the API at
`GET /api/openapi.json`. The page prepares the spec for the browser: absolute servers from an API URL
field (default `http://localhost:3333`, kept in localStorage), the `token` and `siteKey` schemes in the
Authorize dialog, and no cookie `session` scheme (a browser on the docs origin cannot send it).

## Boundaries & Constraints

**Always:**
- The spec has one source, `openapi.yaml`. Its operations get tags (one each, declared in a top-level
  `tags` list in reading order), which Swagger UI groups by. `contract:generate` writes
  `libs/contract/src/generated/openapi.json` (committed, like `api.ts`) from it, with the tale
  document's JSON Schema files bundled in; a contract test fails when the JSON is stale, an
  operation has no tag or two, or a tag is declared and unused.
- The docs build copies that JSON to `/api-reference/openapi.json` and depends on `contract:generate`
  with `openapi.yaml` as an input, so a spec change rebuilds the docs.
- `GET /api/openapi.json`: the same JSON, no credentials (a request with any `Authorization` header or
  cookie is answered the same), `Cache-Control: public, max-age=300`, a strong ETag and 304 for a
  matching `If-None-Match`, CORS open as the rest of the API. It is in the spec itself (tag "Reference",
  server `/api`).
- Swagger UI files are vendored byte for byte from the verified tarball: `swagger-ui-bundle.js`,
  `swagger-ui.css`, `LICENSE`, `NOTICE`, `swagger-ui-bundle.js.LICENSE.txt` in
  `apps/docs/public/swagger-ui/`, no source maps, with a README line for version and integrity. The
  page adds them with `<script>`/`<link>` after it renders in the browser; the main bundle never holds
  them, and other pages never load them.
- Credentials stay in page memory: `persistAuthorization` off, nothing about tokens in localStorage
  (only the API URL). The page says a token belongs in a test project, and links to API tokens.
- Try it out sends to the API URL field's value: every `servers` entry (root, path, operation) becomes
  absolute against it (`/api/v1`, `/delivery/v1`, `/media`, `/api`). A value that is not an http(s) URL
  is refused with a message tied to the field and the last good URL kept.
- The `session` scheme is removed from the spec the page shows; an operation that accepts only a
  session (API tokens, invitations) keeps a note in its description that it needs the dashboard. The
  `/auth/*` routes keep their notes (they refuse tokens).
- Dark theme follows the docs (`prefers-color-scheme`): the page sets Swagger UI's own `dark-mode`
  class on `<html>` while it is open and clears it on leave; a small page stylesheet maps Swagger UI's
  backgrounds, fonts and accents to the docs' tokens and lifts contrast where Swagger UI falls short.
- The docs' checks keep passing (labelled regions, headings, navigation); the docs e2e adds an axe
  WCAG 2.2 AA scan of every docs page, with the API reference's remaining Swagger UI issues listed as
  exceptions both on the page and below, each by axe rule and selector.

**Never:** a package install; Swagger UI in the docs' main bundle; a token in storage; a request to an
API the reader did not set; a change to API behaviour beyond the new route.

## Design

- **Contract:** `openapi.yaml` gains `tags` (Reference, Projects, Zones, Tale groups, Tales, Media
  and fonts, Theme and tags, Audience, Imports, API tokens, Sign-in, Delivery) and `GET /openapi.json`;
  `scripts/generate-openapi-json.mjs` in `generate`; `src/lib/openapi-json.spec.ts`.
- **API:** `http/openapi.router.ts` (`openapiRouter(document)`), mounted at `/api/openapi.json` before
  the Management API; the document is imported through the `@taleart/contract/openapi.json` path.
  Tests in `app.spec.ts`.
- **Docs:** `pages/api-reference.ts` (the page), `pages/api-reference-spec.ts` (`prepareSpec`,
  `apiUrlFromStorage`, the order of tags, pure and unit-tested), `public/api-reference/theme.css`,
  route and navigation entry "API reference" after "API tokens", the asset copy and `dependsOn`.
- **Docs e2e:** `docs-e2e` gets real targets: `e2e` and `a11y`, after `docs:build`, against the built
  docs served by `scripts/serve-docs.mjs` (E2E_DOCS_PORT, default 4317). Specs: the reference lists every
  path and method of `openapi.yaml` (read from the YAML text, not the JSON), the URL field and its
  storage, the Authorize dialog, Try it out against a stubbed API; `@a11y` scans; `live.spec.ts` runs
  only with DOCS_LIVE_API_URL, DOCS_LIVE_TOKEN, DOCS_LIVE_SITE_KEY and DOCS_LIVE_ZONE (the verify run).

## Accessibility exceptions

The axe WCAG 2.2 AA scan (`docs-e2e:a11y`, light and dark, every docs page and the reference listed,
with an operation tried and with the Authorize dialog open) finds nothing, with no allow-list, after these
fixes over Swagger UI: method badges, Authorize, Execute, Cancel and Download recoloured for contrast in
both themes (`public/api-reference/theme.css`); copy-path buttons enlarged to 24 by 24 px; Swagger UI's
unlabelled server list hidden (the API URL field replaces it); the dialog's icon-only close button named
"Close" and the dialog given `role="dialog"`, `aria-modal` and its heading as its name
(`labelSwaggerControls`); Tab kept inside the dialog and focus returned to its opener on close
(`trapDialogFocus`); wide response tables scroll in their block at 320 px (reflow test). Remaining, listed
on the page under "Accessibility":
- A response from Execute is not announced (Swagger UI has no live region); the reader moves to "Server
  response".
- The per-operation lock buttons are named "authorization button locked/unlocked" (Swagger UI's wording).

## Decisions (build)

- The spec's external `$ref`s to `tale-document/*.json` cannot be followed by a browser, so
  `generate-openapi-json.mjs` bundles them with Redocly's bundler (openapi-typescript's own dependency)
  into `components/schemas`; a contract test checks no reference leaves the file and every one resolves.
- The API imports the JSON through the `@taleart/contract/openapi.json` path (`resolveJsonModule` in the
  API's tsconfig) rather than reading a file at start, so tests and the build use the same document.
- `docs-e2e` was the generated stub (port 4300, a "Welcome" test); it now has real `e2e` and `a11y`
  targets on the built docs. `live.spec.ts` is the verify run and skips without its variables.
- Swagger UI is added with Subresource Integrity; the hashes sit in `SWAGGER_UI` and a docs test checks
  them against the vendored files.

## Verify

Story verify line: open the docs API page, authorize with a token from 10.1, try GET /api/v1/projects
and see the real answer; authorize with a site key and try the Delivery zone call; the reference lists
every path in openapi.yaml (a test compares). Run against the built API on port 3610 on
`taleart_d102_test` with a token created through the API, screenshots (overview, an operation
expanded, the Authorize dialog, a real response), then the full lint/test/build run and the docs e2e
and a11y targets.

</intent-contract>
