---
title: 'Upload a project font and use it in a tale'
type: 'feature'
ticket: '17'
created: '2026-10-22'
status: 'built'
baseline_revision: '8bea2cb'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'thorough'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-style-text-with-fonts-sizes-colours-and-backgrounds-plan.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A text can only use system stacks, the theme font or a name the host page loads (7.4). A brand cannot ship its own typeface in a tale (epic R4, R18), and no code fetches font files safely or only when needed (R15, AD-16).

**Approach:** Contract first. A `project-fonts` contract module holds the rules (WOFF2 sniffing, size cap, family, weight, style, alias) and the one font loader the SDK and the studio share (`FontFace` from fetched bytes, 3 s give-up). Text gets a fourth font source, `{ source: 'project', fontId }`. The tales module owns `project_fonts`, checks that a document's font ids belong to the tale's project, refuses deleting a font in use, and serves a font publicly only while a delivered tale's published document uses it. The Delivery API lists each tale's font URLs. The dashboard gets a project font page and the inspector offers project fonts.

## Boundaries & Constraints

**Always:**
- Upload: `POST /projects/{projectId}/fonts` with the raw file as body and `family`, `weight`, `style`, `fallback`, `licence=confirmed` as query parameters. Order: access 403, project 404, fields 400, licence 400, declared length > 500 KB 413 before reading, body read capped at 500 KB (413), empty 400, not WOFF2 415, same family+weight+style 409 `font_exists`. The declared type and file name are ignored.
- WOFF2 = magic `wOF2`, header at least 48 bytes, header length field equal to the file size. Nothing else (TTF, OTF, WOFF1, SVG, HTML) is accepted.
- Family: one name that passes `isFontFamily`, bare (letters, digits, spaces, hyphens, starting with a letter), at most 100 characters; no comma, no quotes, no CSS-wide keyword.
- Weight 100–900 in steps of 100; style `normal` or `italic`; fallback a system stack key.
- Licence confirmation stored with the uploader's id and name and the time.
- The SDK and the studio register a font under `taleart-font-<uuid>` (from the id, never the family) with `new FontFace(alias, bytes, { weight, style })` + `document.fonts.add`, after a fetch of at most 3 s; never CSS text. Text is drawn as `"taleart-font-<id>", <fallback stack>`, so it shows the fallback until the face is added.
- The SDK fetches fonts only in the viewer when a tale that uses them is shown; never for first zone content; at most once per URL per page.
- Public URL `/media/fonts/<uuid>.woff2`: 200 `font/woff2`, `Access-Control-Allow-Origin: *`, nosniff, only while a live tale of a delivered group (the `deliveredGroup` rule) has a published document with a visible text using that font; else 404. The ETag/304 answer comes after that check.
- A font referenced by any tale's draft or published document cannot be deleted (409 `font_in_use`); the delete locks the font row so a concurrent save cannot slip a reference in.
- The dashboard imports contract values only through `core` or narrow entries; `@taleart/contract/project-fonts` is a new narrow entry, lazy pages only.

**Never:** fonts in the SDK bundle or first content; `@font-face`/`url()` text; the family name as a CSS identifier; other font formats; transcoding or subsetting; new npm packages; reformatting untouched code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upload ok | WOFF2 ≤ 500 KB, `Brand Sans`, 700, italic, serif, licence | 201 font record with uploader and time | — |
| TTF renamed | bytes `00 01 00 00…`, any type/name | nothing stored | 415 `unsupported_media_type` |
| Too large | 600 KB WOFF2 | nothing stored | 413 `media_too_large` (before buffering when declared) |
| Bad family | `inherit`, `A, B`, `"A"`, `x;y`, 101 chars | — | 400 `validation_failed` naming `family` |
| No licence | `licence` missing or not `confirmed` | — | 400 `validation_failed` |
| Bad weight/style | 950, 150, `oblique` | — | 400 |
| Duplicate face | same family+weight+style | — | 409 `font_exists` |
| Use in document | text `font {source:'project',fontId}` of the tale's project | saved; studio draws it | other project's / unknown id → 400 `invalid_tale_document` at `/elements/i/props/font/fontId`; extra field → 400 |
| Delete in use | font in a draft or published document | kept | 409 `font_in_use` |
| Delete unused | no reference | 204, file removed | other project's font → 404 `font_not_found` |
| Public URL | draft-only, unpublished, paused, hidden element, group not placed | 404 `media_not_found` | — |
| Public URL | delivered tale's published doc uses it | 200 `font/woff2`, ACAO `*`; `If-None-Match` → 304 | — |
| Delivery | delivered tale using fonts | `fonts: [{ id, url, weight, style }]` per tale; omitted when none | — |
| SDK open | tale with fonts opens | fetch once, `FontFace` added; fallback first | fetch error or > 3 s → fallback kept, no throw |
| SDK no font | zone whose tales use none | no font request | — |
| Cross-project copy | group copied to another project | project-font texts become their fallback system stack | — |
| Older SDK | unknown source | fallback stack (7.4 behaviour) | — |

</intent-contract>

## Code Map

- `libs/contract/tale-document/element-types/text.schema.json` -- `project` source with `fontId`.
- `libs/contract/src/lib/project-fonts.ts` (new) -- rules, alias, `projectFontRefs`, shared loader; `text-style.ts` -- `TextFont` project source, `readTextFont`, `textFontFamily`.
- `libs/contract/openapi/openapi.yaml`, `core.ts`, `package.json`, `index.ts`, `tsconfig.base.json`, root and dashboard ESLint configs -- paths, schemas, error codes, the narrow entry.
- `libs/server/tales/src/lib/project-fonts.ts` (new), `migration.ts`, `tale-document.ts`, `tales.ts`, `index.ts` -- table, CRUD, document check, public lookup, delivery fonts, cross-project copy.
- `apps/api/src/http/fonts.router.ts` (new), `public-media.router.ts`, `delivery.router.ts`, `app.ts`, `app.spec.ts`.
- `libs/web-sdk/src/lib/document/fonts.ts` (new), `viewer.ts`.
- `apps/dashboard/src/app/project-fonts.service.ts`, `pages/fonts.ts` (new), `app.routes.ts`, `pages/projects.ts`, `pages/tale-text-style.ts`, `pages/tale-studio.ts`.
- `apps/sdk-sample/perf.mjs`, `a11y-review.mjs` -- no-font check, font tale timing, project-font section.

## Tasks & Acceptance

**Execution:**
- [x] contract: schema, `project-fonts.ts`, text-style, OpenAPI, entry point; `contract:generate`; tests.
- [x] server-tales + api: migration, fonts module, routes, public route, delivery; unit and HTTP tests per matrix row.
- [x] web-sdk: tale font loading in the viewer; tests (no fetch before open, once per URL, failure, timeout).
- [x] dashboard: fonts page, service, route and link; inspector project fonts; studio loading; component tests.
- [x] sdk-sample: perf no-font assertion and font tale timing; a11y-review project-font section.

**Acceptance Criteria:**
- Given a WOFF2 uploaded with the licence confirmed and used on a text, when the tale is published, then the studio and the sample page draw the fallback first and then the font, and the sample page requests the font only when that tale opens.
- Given a zone whose tales use no project font, when the sample page loads and plays, then no font file is requested (`sdk-sample:perf`).
- Given the full verification, all projects lint, test and build; `web-sdk:size` ≤ 50 KB; a11y scans pass; perf cold p75 ≤ 1.5 s.

## Implementation Notes

- Contract: `project-fonts.ts` (new narrow entry `@taleart/contract/project-fonts`, added to the root ESLint allow list, `tsconfig.base.json`, `package.json` exports and the dashboard's lazy-only rule with `pages/fonts.ts`). It holds `isWoff2`/`isWoff2Header`, `projectFontFamilyError`, weights and styles, `projectFontAlias`, `projectFontRefs`/`projectFontIds`, `textWeightForFont`, `fontFaceName` and `loadProjectFont` (fetch with AbortController, WOFF2 re-check, `FontFace` + `document.fonts.add`, 3 s race, cache per alias+URL, failures forgotten so a later open retries). `text.schema.json` gains the `project` source with `fontId` (`if`/`then` rules forbid mixing fields); `readTextFont` lower-cases the id and an invalid one draws in the fallback (7.4 forward-compat test kept); `textFontFamily` gives `"taleart-font-<id>", <fallback>`.
- Server (tales module): `project_fonts` table (unique face per project and `lower(family)`, weight, style; storage key unique; uploader id without FK plus name). `saveTaleDocument` checks fonts and writes with a `WITH fonts AS (... FOR SHARE)` CTE; `copyTaleWithDocument` checks with `FOR SHARE` inside its transaction; `deleteProjectFont` locks the row `FOR UPDATE` before checking draft and published documents (`jsonb_path_exists`). `findPublishedFont` reuses `liveNow` and `deliveredGroup` (now exported from `tales.ts`) and counts only visible elements of the published document. Delivery lists each tale's fonts (own project only). A cross-project group copy replaces project fonts by the text's fallback stack.
- API: `fonts.router.ts` (list, upload, delete, private file); the global JSON parser skips the upload route so a declared type never matters; `/media/fonts/<uuid>.woff2` goes through the public media router with `Cross-Origin-Resource-Policy: cross-origin`; error mapping for `font_not_found` (404), `font_exists`/`font_in_use` (409).
- SDK: `document/fonts.ts` `loadTaleFonts`, called from `viewer.show()` only. README section "Project fonts" and the perf description updated.
- Dashboard: `project-fonts.service.ts`, `pages/fonts.ts` (route `projects/:projectId/fonts`, "Fonts" link on project cards), inspector optgroup "Project fonts" with hint and "Manage project fonts" link, studio loads the list and the used fonts through `loadProjectFont` with the session.
- Not verified by hand: a signed-in browser walk of the font page and studio, and a real screen reader.
- Verification (2026-10-22, `--skip-nx-cache`): `run-many -t lint test build` on the 12 projects passes (contract 168, server-tales 147, web-sdk 300, dashboard 329, api 440 tests). `web-sdk:size` 16.62 KB gzipped (15.72 before); `web-sdk:types-check` passes; `sdk-sample:a11y` no violations; `sdk-sample:a11y-review` all 157 checks pass (6 new project-font checks, axe clean on the font tale). `sdk-sample:perf`: cold p75 first content 1,258 ms, warm 756 ms; 0 font requests on the font-free zone; font zone 0 requests before opening, 1 after; p75 first tale frame (20 texts) 67 ms, font swapped in at p75 240 ms after the tap. Dashboard initial bundle 490.30 KB.

- After the security review (see the triage log): `tale_fonts` replaces the document scans; the upload is a transaction with the file stored before the commit; the public lookup has an in-process cache; the loader remembers failed faces. Residual risk: the server checks only the WOFF2 container structure (no decompression, no table parsing); the font tables are parsed by the visitor's browser, OTS (OpenType Sanitizer) in Chromium and Firefox and CoreText in Safari, and a flaw there is not mitigated beyond the caps, the licence confirmation and loading only in an opened tale's viewer. Recorded in the epic's Notes as well. The body-parser mapping of `request.aborted` and `request.size.invalid` is in the router but not exercised by an HTTP test (fetch cannot send a short body); `encoding.unsupported` and the early `Connection: close` are tested.

- Verification after the security review fixes (2026-10-22, `--skip-nx-cache`): `run-many -t lint test build` on the 12 projects passes (contract 194, server-tales 154, server-importer 276, web-sdk 301, dashboard 338, api 445 tests). `web-sdk:size` 17.48 KB gzipped (the WOFF2 structure check in the shared loader adds about 0.9 KB); `web-sdk:types-check` passes; `sdk-sample:a11y` no violations; `sdk-sample:a11y-review` all 157 checks pass; `sdk-sample:perf` cold p75 first content 1,257 ms, warm 770 ms, 0 font requests on the font-free zone, p75 first tale frame 67 ms, font swapped in at p75 242 ms. Dashboard initial bundle 490.58 KB.

## Plan Change Log

## Review Triage Log

### 2026-10-22 — Coordinator security review
- **Verdicts:** 12 findings, all patched; none deferred. `autopilot/foundation` was already merged (its tip is this story's baseline, `8bea2cb`).
- **Findings:**
  1. `[patch]` Reserved prefix: `taleart-font-` (any case, bare or quoted) is refused by `isFontFamily`/`FONT_FAMILY_PATTERN` (`RESERVED_FONT_PREFIX`), the text schema's `family` pattern, the OpenAPI theme pattern and the SDK's theme copy, so a name or theme font cannot draw text in another project's font. Tests: contract theme rows and OpenAPI agreement, SDK theme fallback, server and HTTP refusals (text `name` source and theme PUT).
  2. `[patch]` `tale_fonts` (tale, font, draft or published, project, `delivered`) written in the transaction of every save, publish, discard, go-live publish, keep-as-copy and group copy, and by a migration backfill for documents written before it; indexes on `tale_fonts (font_id, document)` and `tales (project_id)`. `findPublishedFont`, `listProjectFonts` in-use and the delete check read it, never the documents. A bounded in-process cache (1,000 keys, 30 s TTL) keeps public yes/no answers and is cleared after publishing, status, schedule and placement changes, copies and deletes in this process. Tests: SQL-order unit tests, cache TTL and clearing, HTTP backfill.
  3. `[patch]` WOFF2 structure: flavour TrueType, `OTTO` or `ttcf`; reserved 0; 1 to 256 tables; `totalSfntSize` ≤ 30 MB; table directory parsed (known-tag flags, arbitrary tags, UIntBase128 with no leading zero, at most 5 bytes and 32 bits, transform versions as defined, `loca` transform length 0), collection directory parsed with indices in range; metadata, private data and compressed data inside the file. Uploads stay with admins and content managers (explicit role check). Tests: 19 crafted headers refused, sound collection and transformed tables accepted, a real Inter WOFF2 accepted. Residual browser-parser risk recorded above and in the epic.
  4. `[patch]` Same-project `copyTaleGroup` share locks the source's referenced fonts before inserting the copies, then records the copies' `tale_fonts` rows. SQL-order unit test.
  5. `[patch]` The loader remembers a failed face per page and fetches it again only after 60 s or on `retry: true`; with no browser environment nothing is remembered. Tests: contract backoff and retry, studio edits fetching a failed face once.
  6. `[patch]` The upload takes only `font/woff2` or `application/octet-stream` (CORS preflight types); anything else 415. HTTP test with JSON, text, multipart, `font/ttf` and none.
  7. `[patch]` Early refusals set `Connection: close`; the body is read without inflating; `encoding.unsupported` → 415, `request.aborted`/`request.size.invalid` → 400, `entity.too.large` → 413. HTTP tests for gzip and the closing header.
  8. `[patch]` Upload pipeline: under a per-project advisory lock, caps of 50 faces (409 `font_limit_reached`) and 10 MB (413 `font_storage_full`), insert, store the file, commit; a failed store rolls the row back, a failed commit removes the file, and `sweepUnusedFontFiles` (run by the worker's start-up sweep) removes old `fonts/` files no row names. Family names have their spaces collapsed before the uniqueness check. Tests: unit (order, rollback, cleanup, caps, sweep) and HTTP (caps, collapsed duplicate).
  9. `[patch]` Public route and Delivery agree: `delivered` rows are written only for published documents that passed the document check (publish, go-live, copy and backfill check them), and only for visible text. HTTP test: a published document made invalid in the database is neither delivered nor served.
  10. `[patch]` The private file route's ETag is opaque (a 22-character hash of the key). HTTP test.
  11. `[patch]` Fonts page: server refusals tied to their field (`font_exists` → family, type, size and caps → file, licence message → licence) with `aria-invalid`, the field's error and focus; `aria-required` on file, family and licence; the form resets after an upload; `busy` is set before anything is awaited; Delete is disabled for a face in use with the reason shown and linked by `aria-describedby`; stack names come from the contract (`SYSTEM_FONT_STACK_NAMES`), so the Fonts chunk no longer imports the studio inspector. Component tests for each.
  12. `[patch]` Inspector: with a project face chosen, the weight select and italic box are disabled and a hint names the face, so the browser never synthesises bold or oblique. Studio test.

## Design Notes

Assumptions (none blocks; each is recorded for review):
- A text references one face (a font id). Choosing it in the inspector also sets the text's fallback to the font's fallback, its weight to the nearest of regular/medium/bold and italic to the face's style, so the browser does not synthesise.
- Weights are multiples of 100; the family is at most 100 characters; a duplicate face is refused rather than replaced.
- The uploader is stored as id and name without a foreign key, so the licence record survives a removed user.
- Copying a tale group to another project replaces project-font references with the text's fallback stack: the licence was confirmed for the source project only.
- The public route is `/media/fonts/<uuid>.woff2` on the existing public media router (its CORS is already `*`); `Cross-Origin-Resource-Policy: cross-origin` is added for fonts.
- Upload metadata travels as query parameters with a raw body, as media uploads send raw bodies; no multipart parser is added.

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w1_test npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool --skip-nx-cache` -- expected: all succeed.
- `npm exec nx -- run web-sdk:size`, `web-sdk:types-check` -- ≤ 50 KB gzipped; types pass.
- `npm exec nx -- run sdk-sample:a11y`, `sdk-sample:a11y-review`, `sdk-sample:perf` -- 0 violations; project-font checks pass; no font request on the font-free zone; cold p75 ≤ 1.5 s.
