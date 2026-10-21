---
title: 'Upload a project font and use it in a tale'
type: 'feature'
ticket: '17'
created: '2026-10-22'
status: 'in-review'
baseline_revision: '8bea2cb'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
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

## Plan Change Log

## Review Triage Log

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
