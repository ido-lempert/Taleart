---
title: 'Tracer: a sample web page shows a zone''s tale groups in a bar'
type: 'feature'
ticket: '1'
created: '2026-10-20'
status: 'built'
baseline_revision: '304c263814470e286ebd1d86224bd7861e21277b'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/epic-web-zones.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Published Web SDK type declarations reference @taleart/contract, which is not a declared or published dependency.
    evidence: |-
      vite-plugin-dts emits bar.d.ts and delivery-client.d.ts importing @taleart/contract types; libs/web-sdk/eslint.config.mjs ignores the dependency check.
    location: >-
      libs/web-sdk/vite.config.mts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Content made in the dashboard cannot yet appear on a customer's web page: the Delivery API returns only the zone and its frames, media needs a session, and the Web SDK (`libs/web-sdk`, `<taleart-view>`) renders nothing.

**Approach:** Contract first, extend `GET /delivery/v1/zone` with the zone's tale groups and tales in dashboard order, each tale with a public media URL. Serve published media from a public, unguessable URL with no key (AD-11). The Web SDK fetches the zone with its key and renders a bar frame. A sample host page in the repo loads the built SDK, and a build check keeps the bundle at or under 50 KB gzipped.

## Boundaries & Constraints

**Always:**
- Delivery response: `{id, name, frames: [{id, type, settings}], taleGroups: [{id, name, tales: [{id, title, media: {kind, contentType, url} | null}]}]}`, groups and tales by `position`. No project id, user data or storage keys beyond what the URL needs (AD-13).
- Public media route: `GET /media/{key}` (outside `/api/v1` and `/delivery/v1`, no session, no zone key). It serves only keys that a tale currently references; any other key (including a replaced file) answers 404. Until story 3 adds status, every tale counts as published. Keys stay server-made (`tales/<uuid>.<ext>`). Responses: stored `Content-Type`, byte ranges (reuse story 12's range handling), `Cache-Control: public, max-age=31536000, immutable` (a replaced file gets a new key), `Access-Control-Allow-Origin: *`, `X-Content-Type-Options: nosniff`.
- Media URLs in the Delivery response are absolute, built from env `PUBLIC_API_URL` (default `http://localhost:3333`); list it in `.env.example`.
- Web SDK: `<taleart-view api-url="…" zone-key="…">` (attributes, also settable as properties). Renders in its Shadow DOM: the zone's first frame of type `bar` (frame types it does not know are skipped, AD-5); one item per tale group with the first tale's media as a circular cover (image, or the video's first frame with `preload="metadata"` and no autoplay) and the group's name below; the row scrolls horizontally; default bar look (circle, medium 64 px, titles shown, start-aligned, 12 px gap). Groups with no tale media show a neutral placeholder. Items are buttons with accessible names (opening the viewer is story 2; clicking does nothing yet but must not throw).
- A refused key (401) or network failure renders nothing and logs exactly one `console.error` with the API's message. No other console noise.
- No runtime dependencies in the SDK; plain TypeScript and DOM APIs. Built as ES module and UMD (existing Vite library config).
- Bundle check: a Nx target (e.g. `web-sdk:size`) that builds and fails when the gzipped ES bundle exceeds 50 KB; wired so `nx run-many -t lint test build` plus this target is the verification.
- Sample host page: a small static page in the repo (e.g. `apps/sdk-sample/` with `index.html`) that loads the built SDK from `dist/libs/web-sdk`, takes the API URL and zone key from the query string (`?key=…&api=…`), and has a Nx serve target on port 4300. Not a product page; plain HTML.
- Contract first; module rules; `_test` database; standard error body.

**Never:** Opening tales (story 2), bar settings (story 5), banner (story 6), statuses (story 3), themes, analytics events, caching layers beyond the media headers, a framework in the SDK.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delivery zone | valid key; zone with a bar frame and groups A, B (tales with media) | 200 with frames and `taleGroups` A, B in order; each tale's `media.url` absolute | — |
| Empty zone | valid key; no tale groups | `taleGroups: []` | — |
| Tale without media | — | `media: null` | — |
| Public media | `GET /media/tales/<uuid>.png` for a referenced key | 200 bytes, stored type, immutable cache, CORS `*`, no key needed | — |
| Unknown or replaced key | key no tale references | 404 | standard body `media_not_found` |
| Range | `Range: bytes=0-99` | 206 | as story 12 |
| SDK render | page with valid key | bar of A, B with covers and names, in order | — |
| SDK refused | revoked key | renders nothing; one console error | — |
| SDK unknown frame | zone has only a frame of type `feed` | renders nothing; no error | — |
| Bundle | build | gzipped ES bundle ≤ 50 KB | target fails above |

</intent-contract>

## Code Map

- `apps/api/src/http/delivery.router.ts` -- `GET /delivery/v1/zone`, key middleware, CORS; extend the response.
- `apps/api/src/http/tales.router.ts`, `media.ts` -- media GET with range handling and ETag (story 12); reuse for the public route.
- `apps/api/src/app.ts`, `main.ts` -- mount the public media route beside `/delivery/v1`, outside the session middleware; read `PUBLIC_API_URL`.
- `libs/server/tales/src/lib/tales.ts` -- `listTaleGroups` (groups with tales by position, media from `media_key`/`media_content_type`); add a lookup "is this storage key referenced by a tale" and a way to get the storage key for building public URLs (keys never leave the server except inside the public URL path).
- `libs/server/storage` -- `MediaStorage.get`.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- `DeliveryZone` (add `taleGroups`), `DeliveryTaleGroup`, `DeliveryTale`; the public media path; regenerate.
- `libs/web-sdk/` -- `src/lib/taleart-element.ts` (stub), its spec, `vite.config.mts` (library build), `project.json` (tags `type:sdk`, may depend only on `type:contract`; import contract types with `import type` so nothing ends up in the bundle).
- `apps/` -- new `sdk-sample` (plain static page and serve target).
- `.env.example` -- add `PUBLIC_API_URL`.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- Delivery types and public media path; regenerate -- AD-3.
- [x] `libs/server/tales/` -- referenced-key lookup and what the Delivery list needs; unit tests.
- [x] `apps/api/src/` -- Delivery response with groups and tales, public media route, `PUBLIC_API_URL`; tests for every API matrix row.
- [x] `libs/web-sdk/` -- fetch with the key, bar rendering, error handling; unit tests in jsdom with a mocked fetch; size target.
- [x] `apps/sdk-sample/` -- sample page and serve target.
- [x] `.env.example`.

**Acceptance Criteria:**
- Given a zone with a bar frame and two tale groups with media and an issued key, when the sample page is opened with that key, then both groups show as bar items in dashboard order with covers and names.
- Given a cover's media URL, when it is opened in a fresh browser without any key or session, then the media loads.
- Given the key is revoked, when the sample page reloads, then nothing renders and the console shows one error.
- Given the SDK build, when the size target runs, then it passes at or under 50 KB gzipped.

## Implementation Notes

- Contract: `DeliveryZone.taleGroups`, `DeliveryTaleGroup`, `DeliveryTale`, `DeliveryMedia` (absolute `url`), path `/media/{key}`; `PUBLIC_MEDIA_BASE` and `publicMediaUrl(apiUrl, key)` helpers.
- Tales module: `listDeliveryTaleGroups` (keys stay for the API to build URLs) and `findPublishedMedia(key)`; new index `tales_media_key_idx`.
- API: range handling extracted to `sendMediaBytes` in `http/media.ts` and shared by the session media route and the new `http/public-media.router.ts` (mounted at `/media`, own CORS with `Range` allowed, `nosniff`, immutable cache). `createApp` takes a 5th optional `{ publicApiUrl }`; `main.ts` reads `PUBLIC_API_URL`.
- Web SDK: `delivery-client.ts` (fetch with bearer key, `credentials: 'omit'`), `bar.ts` (default bar look), element loads once per microtask after attribute/property changes; `index.ts` registers `<taleart-view>` on load. `@taleart/contract` is type-only and listed in `ignoredDependencies` of the lib's dependency-checks rule.
- `web-sdk:size` runs `libs/web-sdk/scripts/check-size.mjs` after build (1.84 KB gzipped at time of writing).
- `apps/sdk-sample`: `index.html` plus a dependency-free `serve.mjs` (page at `/`, built SDK at `/sdk/`), `nx run sdk-sample:serve` on port 4300.

## Plan Change Log

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 7 findings — high 0, medium 3, low 4, false 0, maybe-false 0
- findings:
  - `[medium]` `[patch]` A malformed percent-escape in a public media key made Express's param decoding throw and answer 500 on an unauthenticated route — fixed: the route decodes the path itself and answers 404 `media_not_found`; test added.
  - `[medium]` `[patch]` The public media route set no ETag, so Express hashed every body (up to 100 MB) — fixed: `ETag: "<key>"`; asserted.
  - `[low]` `[patch]` A 2xx body that is not a zone made render throw an unhandled rejection — fixed: shape check, one try/catch around fetch and render; tests for HTML and missing fields.
  - `[low]` `[reject]` `allowReserved` on the `/media/{key}` path parameter has no meaning in OpenAPI 3.1 — clients use the absolute URLs the Delivery API returns, never build media paths; documenting a two-segment path would add contract churn for no caller.
  - `[medium]` `[patch]` Video covers with `preload="metadata"` paint no frame in Safari/iOS — fixed: `#t=0.001` media fragment.
  - `[low]` `[patch]` The cover used only the first tale, so a group with media in a later tale showed the placeholder — fixed: first tale with media; test added.
  - `[low]` `[defer]` The SDK's published `.d.ts` files reference `@taleart/contract`, which is not a declared or published dependency — only matters when the SDK is published to npm.

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting web-sdk` -- expected: all succeed.
- `npm exec nx -- run web-sdk:size` -- expected: passes, prints the gzipped size.

**Manual checks (if no CLI):**
- The parent session issues a key on the dev servers, opens the sample page with Playwright, screenshots the bar, opens a cover URL without cookies, revokes the key and checks the console.

## Auto Run Result

**Summary:** `GET /delivery/v1/zone` now returns the zone's tale groups and tales in dashboard order with absolute public media URLs (`PUBLIC_API_URL`). Published media is served at `GET /media/{key}` with no key or session, only for keys a tale references, with immutable caching, CORS `*` and byte ranges. The Web SDK's `<taleart-view api-url zone-key>` fetches the zone and renders the first bar frame (covers, names, horizontal scroll); a refused key or bad response renders nothing with one console error. A sample host page (`apps/sdk-sample`, port 4300) loads the built SDK, and `web-sdk:size` keeps the bundle under 50 KB gzipped (1.95 KB today).

**Files changed:**
- `libs/contract/` — Delivery zone with tale groups, public media path, `publicMediaUrl`; regenerated.
- `libs/server/tales/` — `listDeliveryTaleGroups`, `findPublishedMedia`, media key index; tests.
- `apps/api/src/` — Delivery response, `public-media.router.ts`, shared `sendMediaBytes`, `PUBLIC_API_URL`; tests.
- `libs/web-sdk/` — `delivery-client.ts`, `bar.ts`, element rendering and errors, size check; tests.
- `apps/sdk-sample/` — sample page and static server.
- `.env.example` — `PUBLIC_API_URL`.

**Review:** 5 patches applied (3 medium, 2 low), 1 deferred, 1 rejected (low: `allowReserved` on a path parameter; no client builds media paths).

**Follow-up review recommended:** true. Three medium findings were patched on an unauthenticated route and in the SDK's error path; a second look at the public media route is worthwhile.

**Verification:** `nx run-many -t lint test build` for the ten projects passed before and after the patches (api 144, web-sdk 14 tests); `web-sdk:size` 1.95 KB gzipped. The implementer's live run with Playwright: the bar showed two groups in order with covers, a cover URL loaded in a fresh context without cookies, and a revoked key rendered nothing with one SDK error (Chrome adds its own 401 network line).

**Residual risks:**
- Chrome prints its own network error line for the 401 besides the SDK's one error.
- Ring and focus colours are placeholders until the theme story.
