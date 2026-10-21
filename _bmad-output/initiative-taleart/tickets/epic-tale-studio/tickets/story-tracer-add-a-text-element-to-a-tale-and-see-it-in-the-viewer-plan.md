---
title: 'Tracer: add a text element to a tale and see it in the viewer'
type: 'feature'
ticket: '1'
created: '2026-10-21'
status: 'built'
baseline_revision: '4dc1fb5'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'thorough'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A tale is only a media file. Text cannot be added, so nothing a content manager writes is live, accessible text, and there is no tale document (AD-15) for later Tale Studio stories to grow on.

**Approach:** Thinnest slice through every layer. The contract gets the versioned tale document (JSON Schema files, an element-type registry with one `text` entry, generated types). The `tales` module stores it as JSONB with a revision. The Management API reads and writes it with server-side validation and a stale-revision 409. The Delivery API returns it stripped of hidden elements and editor-only fields. The SDK viewer renders text elements as DOM over the media. A minimal Tale Studio page in the dashboard adds, edits, moves and saves text.

## Boundaries & Constraints

**Always:**
- Document `{ version: 1, canvas: { background: { type: 'color', color } }, durationMs?, elements[] }`. Each element has `{ id (UUID), type, box { x, y, w, h, rotation }, hidden, locked, a11y { label?, decorative? }, props }`. The `text` type's props are `{ text }`. Array order is z-order. No additional properties anywhere.
- The JSON Schema files in `libs/contract/tale-document/` are the source: `v1.schema.json` (envelope), `element-types/registry.json` plus one props schema per type. `contract:generate` makes the TS types (openapi `$ref`s the files) and a TS copy of the schemas for the server's validator.
- Write rules: schema first, then the props schema of the element's registry type, then the semantic rules. These are at most 128 KB (UTF-8 JSON), 60 elements and 1,000 characters per text; unique ids; finite numbers in range; no control characters except a line feed in text, and none in labels. A refusal names the JSON pointer it refused.
- Writes are conditional on the revision they were based on. Reads return `{ document | null, revision }`.
- Delivery: each tale gets `document`, which is null when the tale has none or the stored one no longer validates. Hidden elements are dropped, `hidden` and `locked` are removed, and the SDK skips unknown element types.
- SDK: a 9:16 canvas, a container-query stage, inside the device safe-area insets. Text uses `textContent`, styles use CSSOM properties only, and DOM order is reading order (top to bottom, then left to right) while z-index follows the array. The text is selectable, and clicking it does not step the tale. A tale without a document renders exactly as before.
- Studio: uses the dashboard design system and meets WCAG 2.2 AA. Every action has a non-pointer path: Add text; elements are focusable buttons; arrow keys move 1%, Shift+arrow 10%; X and Y number inputs; Enter or the Edit text field edits; Delete removes. Changes are announced in a live region.

**Never:** Text styling, layers, other element types, undo or autosave, migration of existing tales, or a media background in the document. Also never `innerHTML` or `setAttribute('style')` for content, new npm packages, or changes to bar and banner rendering or zone-key handling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Read, none | GET a tale with no document | 200 `{ document: null, revision: 0 }` | unknown tale 404; other project 403 |
| Save | PUT `{ document, revision: 0 }` | 200 `{ document, revision: 1 }`; GET returns the same | — |
| Stale | PUT with revision 0 after it became 1 | 409 `stale_revision`; nothing changes | — |
| Unknown type | element `type: 'poll'` | 400 `invalid_tale_document`, pointer `/elements/0/type` | — |
| Bad box | `x: 1.5`, `w: 0`, `rotation: 400` | 400, pointer `/elements/0/box/x` | — |
| Extra field | unknown property anywhere | 400, names the property | — |
| Too many | 61 elements | 400, pointer `/elements` | — |
| Too long | text of 1,001 characters | 400, pointer `.../props/text` | — |
| Control char | text holding `\u0007` | 400; `\n` accepted | — |
| Duplicate id | two elements, one id | 400, pointer `/elements/1/id` | — |
| Oversize | JSON over 128 KB | 413 `tale_document_too_large` | — |
| Bad body | missing revision, wrong version | 400 | — |
| Delivery | published tale with one visible and one hidden text | `document.elements` has only the visible one, without `hidden` or `locked` | stored doc invalid → `document: null` |
| Viewer | delivered text `<b>x</b>` at y 0.2 | literal text node in the upper third, selectable, read in the dialog | unknown type skipped; tale without doc unchanged |
| Studio | Add text, type Hello, arrow up, Save | saved; 409 shows a reload message | API message shown |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/index.ts`, new `tale-document/`, `scripts/`, `src/lib/tale-document.ts`: schemas, routes, error codes, constants (limits, safe areas, text defaults) and helpers.
- `libs/server/tales/src/lib/{migration,tales}.ts`, new `tale-document.ts`: the column, get and put, validation, and the delivery read.
- `apps/api/src/http/{tales.router,delivery.router,errors}.ts`, `app.ts`: routes, the 128 KB body parser, error mapping and the delivery field.
- `libs/web-sdk/src/lib/document/` (new), `viewer.ts`: the renderer registry and the text renderer, mounted by the viewer.
- `apps/dashboard/src/app/pages/tale-studio.ts` (new), `app.routes.ts`, `create-drawer.html`, `pages/zone-detail.html`: the studio page and the entry points to it.
- `apps/sdk-sample/a11y-scan.mjs`: the scan covers a tale with a text element.

## Tasks & Acceptance

**Execution:**
- [x] contract: schema files, registry, openapi, generator, constants and helpers, with tests.
- [x] server-tales: migration, validation, get and put of the document (conditional on revision), delivery read, copy keeps the document, with tests.
- [x] api: routes, errors, delivery, and integration tests for every matrix row.
- [x] web-sdk: the document renderer and the viewer integration, with tests.
- [x] dashboard: the studio page, route and entry links, with tests.
- [x] sdk-sample: a scan case with text (axe clean, literal text, selectable).

**Acceptance Criteria:**
- Given a published tale with media, when a person adds "Hello" in Tale Studio, moves it to the upper third by arrow keys and saves, then the sample page viewer shows "Hello" over the media at that place, as selectable text inside the dialog.
- Given the SDK build, when `web-sdk:size` and `sdk-sample:perf` run, then the bundle stays at or under 50 KB gzipped and p75 first content at or under 1.5 s.

## Implementation Notes

- Assumptions. None of them is a product decision the epic settles; each is recorded for review.
  - The canvas background is `{ type: 'color', color }`, so a media background can join later as another `type`. A new document starts black.
  - `box` requires all five fields: x and y from 0 to 1, w and h above 0 up to 1, rotation from -180 to 180. An element may reach past the canvas edge and is clipped there.
  - `durationMs` is optional, from 3,000 to 15,000. The viewer uses it for a tale on the timer; without it the tale keeps today's 5 s. R5's 7 s default belongs to story 7.5.
  - Text may be empty, and it may hold a line feed but no other control character (C0, DEL or C1). `a11y.label` holds at most 300 characters and no control character. For text, `decorative` hides the element from screen readers and `label` is not used, since ARIA forbids a name on a paragraph.
  - Error codes: 400 `invalid_tale_document` with an optional `error.pointer` (an additive field of `ErrorBody`), 413 `tale_document_too_large` (also used when the body is over 256 KB), and 409 `stale_revision`. A revision ahead of the stored one also counts as stale.
  - The document text style (white, system sans, 600, 4% of the canvas height, line height 1.25, centred) lives in the contract (`TEXT_ELEMENT_STYLE`), so the studio and the SDK match until story 7.4 adds styling.
  - Copy to zone (AD-14) copies each tale's document with its element ids, and the copy's revisions start again at 0. R11's new element ids are story 7.12's duplicate.
  - A stored document that no longer validates is delivered as `null`, so the tale shows its media only. It is never sent half-checked.
  - Media inside a document is not modelled yet. The tale's media stays the background, under the elements, and the project-key check of R14 arrives with the first media element type.
  - The studio entry point is an "Edit in Tale Studio" button in the tale's drawer, which the tale card opens. The card itself gets no second control.
- Design. The JSON Schema files in `libs/contract/tale-document/` are the source.
  - `contract:generate` runs openapi-typescript, through `$ref`s in openapi.yaml, and then `scripts/generate-tale-document-schemas.mjs`, which writes `src/generated/tale-document-schemas.ts`. Consumers therefore need no `resolveJsonModule`, and the API needs no asset copy. A contract test keeps that copy equal to the JSON files.
  - The envelope schema checks a generic element. The props are then checked against the registry type's schema, so a new type is a registry entry and a schema (R8). openapi-typescript keeps the file's `$defs` as a property, and `TaleDocument` omits it.
- API.
  - The global `express.json()` (100 KB) skips the document route, which parses up to 256 KB itself, so documents between 100 KB and 128 KB are accepted.
  - The 128 KB rule is checked on `JSON.stringify` of the parsed body, as UTF-8.
- SDK.
  - `libs/web-sdk/src/lib/document/` holds the renderer registry, `{ text }`, and `renderTaleDocument`. Unknown types are skipped with one warning per type.
  - With a document, the viewer mounts a `.ta-area` between the stage (tap zones) and the top bar. The tale's media is placed inside the 9:16 canvas, still `contain`, so tap zones still work around the text, a click on the text does not step, and the text is selectable. A tale without a document takes exactly the old path.
  - The SDK grew from 12.37 KB to 13.51 KB gzipped, so no chunk split is needed yet (AD-16 sets it at 40 KB).
- Dashboard.
  - The studio page is `tales/:taleId/studio`. It renders the canvas in Angular, because module-boundary lint forbids the dashboard from importing `libs/web-sdk`. The shared-renderer preview is R10, a later story.
  - The initial-bundle budget warning (500 KB) was already there at baseline: 611 KB before this story, 626 KB after.
- Delivery cost: shipping every published tale's document in the zone response is to be measured by story 7.14 (the response shape is unchanged here). Reads are cheap-checked and memoised per tale and revision (review item 10).
- Not verified by hand: a browser walk of the studio with a real passkey session. The component tests cover add, type in place, the arrow keys, the position fields, dragging, delete, save, the 409 reload and API messages. The sample-page scan covers the viewer.

## Plan Change Log

## Review Triage Log

### 2026-10-21 — Coordinator review
- **Verdicts:** 19 findings, all patched. `autopilot/foundation` was merged first; the merge was a no-op because the branch already contained it.
- **Findings:**
  1. `[patch]` A revision above 2^31−1 answered 500.
     - The guard now refuses a revision that is not an integer from 0 to 2147483647 with 400 `validation_failed`, and openapi sets `maximum: 2147483647`.
     - Tested with 2147483648, 1e300 and 1.5.
  2. `[patch]` Labels used a looser control-character rule than text.
     - Labels now refuse C0, DEL and C1, like text but without the line feed.
     - Tested in server-tales and the API.
  3. `[patch]` Text and labels were not Unicode-safe.
     - The contract adds `hasDisallowedCharacter` and `cleanText`, with `ELEMENT_TEXT_RULE` and `LABEL_TEXT_RULE`. They refuse lone surrogates and the bidi embeddings and overrides U+202A to U+202E, and they allow U+200E/U+200F, the isolates U+2066 to U+2069, ZWJ and ZWNJ.
     - The server refuses those characters and stores text and labels in NFC. The SDK strips them before rendering, and the studio strips them as people type.
     - Tested with Hebrew and Arabic text, isolates and emoji ZWJ sequences.
  4. `[patch]` Refusal pointers did not escape their keys.
     - Every key is now escaped per RFC 6901 (`pointerSegment`).
     - Tested with `a/b`, `c~d` and a nested key.
  5. `[patch]` The SDK renderer lookup used a plain object.
     - `ELEMENT_RENDERERS` is now a `Map`.
     - Tested that `constructor`, `__proto__` and `toString` are skipped as unknown types.
  6. `[patch]` Touch selection was blocked.
     - `contextmenu` and single-touch `touchmove` are no longer prevented on a `.ta-text`, and are still prevented elsewhere.
     - Tested with synthetic events.
  7. `[patch]` A text's empty box area was a dead zone for taps.
     - The `<p>` box has `pointer-events: none`, and an inline `.ta-glyphs` span takes pointer events and selection.
     - A unit test checks the styles, and the sample scan taps the empty part of a box and sees the tale step.
  8. `[patch]` A document tale without media had no accessible name.
     - Its canvas is now a `role="group"` named by the tale title, which also covers an empty document.
     - Tested.
  9. `[patch]` Document tales and media-only tales were framed differently.
     - The media is now full-bleed in the stage for both. Only the element area respects the safe-area insets, and the canvas paints its colour only when the tale has no media.
     - Tested in the unit tests and the scan.
  10. `[patch]` Delivery checked every document on every read.
      - On read there is now a cheap check: a known `version`, and stored JSON text no larger than 2 × 128 KB. The full check runs once per tale id and revision, and its result is kept in a bounded LRU of 1,000 entries.
      - Tested, including a cache hit and eviction.
      - Shipping every document in the zone response is left to story 7.14 to measure. The response shape is unchanged.
  11. `[patch]` The body-parser exemption depended on the exact path spelling.
      - The document route's parser is now an `app.put` route registered before the global `express.json()`, so it matches in any case and with a trailing slash. The 413 mapping matches `/document/?$` case-insensitively.
      - Tested with `/API/V1/Tales/<id>/Document/` (200 for 112 KB, 413 `tale_document_too_large` for a huge body) and with another route keeping the 100 KB limit.
  12. `[patch]` Keyboard delete in the studio was unsafe.
      - Only Delete removes an element; Backspace does not, until undo exists in story 7.3. After a delete, focus moves to the next element, else the previous one, else the canvas (`tabindex=-1`).
      - Tested.
  13. `[patch]` The Left and Top fields could show a value other than the one applied.
      - The applied value is always written back, an invalid entry is restored, and the live region announces clamps ("as far as it goes").
      - Tested.
  14. `[patch]` The studio could drift from the SDK.
      - The element shows its text through `[textContent]`, so no template whitespace is added, and the in-place textarea is rotated like the element.
      - Tested.
  15. `[patch]` The studio's text limit counted UTF-16 units.
      - `maxlength` is gone. The studio counts code points, cuts input past 1,000 characters and says so.
      - Tested with 1,000 emoji.
  16. `[patch]` The studio passed raw input and raw API messages through.
      - Typed or pasted text is cleaned, keeping line feeds, and a notice says what was removed.
      - Refusals are shown in plain words, with no JSON pointer. The pointer selects the refused element and marks it `aria-invalid`.
      - Tested.
  17. `[patch]` Acceptance criterion 1 needed an end-to-end check.
      - The API test "delivers a tale's document without hidden elements or editor-only fields" saves through PUT and reads `/delivery/v1/zone`.
      - The sample scan still stubs the Delivery API, because it runs without a database; a seeded live API is used only by `perf`. The coordinator walks the live flow in a browser at merge.
  18. `[patch]` `textLength` was unused. It was removed; the studio counts with `[...text].length`.
  19. `[patch]` A 134-character JSDoc line was wrapped.

## Auto Run Result

**Summary:**
- **Contract:** the tale document (AD-15). It comes as the JSON Schema files `tale-document/v1.schema.json` and `element-types/registry.json` (with `text.schema.json`), generated types, a generated schema copy, limits, safe-area constants, the default text style and helpers.
- **Tales module:** a JSONB `document` and a `document_revision` on `tales`. Saves are checked against the schema and the AD-15 rules, and refusals name a JSON pointer. A save is conditional on its revision, and a stale one answers 409. Delivery strips hidden elements and the `hidden` and `locked` fields, and copy to zone keeps documents.
- **API:** `GET` and `PUT /api/v1/tales/{taleId}/document` (400 with a pointer, 409, 413). `DeliveryTale.document` is null for tales without one.
- **Web SDK:** a document renderer registry with a text renderer. Text is a literal text node, styles are set through CSSOM, the 9:16 container-query canvas sits inside the safe-area insets, DOM order is reading order and z-index follows the array. The viewer mounts it over the media, and tales without a document are unchanged.
- **Dashboard:** a Tale Studio page with a 9:16 canvas over the tale's media. A person can add text, type it in place, move it by drag, by the arrow keys (Shift for 10%) or by the Left and Top fields, delete it, and save it. A stale save offers to reload the latest version, and changes are announced in a live region.

**Files changed:**
- `libs/contract/`: `tale-document/**` (new), `scripts/generate-tale-document-schemas.mjs` (new), `src/lib/tale-document.ts` and its spec (new), `src/generated/*`, `openapi/openapi.yaml`, `src/index.ts`, `project.json`.
- `libs/server/tales/`: `src/lib/tale-document.ts` and its spec (new), `tales.ts`, `migration.ts`, `index.ts`, `package.json` (ajv), `tales.spec.ts`.
- `apps/api/src/`: `app.ts`, `http/tales.router.ts`, `http/delivery.router.ts`, `http/errors.ts`, `app.spec.ts` (16 document tests and 1 delivery test).
- `libs/web-sdk/src/lib/`: `document/renderer.ts`, `document/text.ts` and `renderer.spec.ts` (new), `viewer-document.spec.ts` (new), `viewer.ts`.
- `apps/dashboard/src/app/`: `pages/tale-studio.ts` and its spec (new), `tale-document.service.ts` (new), `app.routes.ts`, `create-drawer.html`, `app.spec.ts`.
- `apps/sdk-sample/a11y-scan.mjs`: a tale with a text element. It is scanned, and the checks cover literal text, the upper third, 9:16, mouse selection and no step on click.

**Verification:**
- First build, before review: `run-many -t lint test build` on the 12 projects passed. Test counts: api 373, web-sdk 256, contract 104, server-tales 90, dashboard 217. `web-sdk:size` was 13.51 KB gzipped, `sdk-sample:a11y` found 0 violations in 14 scans, and `sdk-sample:perf` measured cold p75 1,253 ms.
- After the review fixes, the same `run-many` passed. Test counts: api 375, web-sdk 262, dashboard 221, contract 106, server-tales 96.
- `web-sdk:size` after the fixes: 13.85 KB gzipped.
- `sdk-sample:a11y` after the fixes: 0 violations in 14 scans. The new checks pass: RTL and emoji text, media framing, mouse selection, and a tap on a box's empty part stepping the tale.
- `sdk-sample:perf` after the fixes: cold p75 first content 1,266 ms, warm p75 754 ms.

**Residual risks:**
- The studio canvas is Angular, not the SDK renderer, so its look can drift from the viewer until R10. Both read `TEXT_ELEMENT_STYLE` to limit that.
- `<style>` text in the Shadow DOM, as before, is not CSSOM-only under a strict style-src CSP. Only per-element values go through CSSOM.
- The studio has no autosave or leave guard, so unsaved edits are lost on navigation (story 7.3).

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --skip-nx-cache`. Expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size`. Expected: 50 KB or less, gzipped.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:a11y`. Expected: 0 violations, and the text checks pass.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:perf`. Expected: p75 cold first content of 1.5 s or less.
