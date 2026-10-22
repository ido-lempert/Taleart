---
title: 'Add shapes, stickers and emoji'
type: 'feature'
ticket: '6'
created: '2026-10-22'
status: 'in-review'
baseline_revision: '489b892'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-add-images-and-video-from-the-project-s-media-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A tale document holds text, images and video (7.1–7.5, 7.17), but a content manager cannot add the shapes, emoji and image stickers Tale Studio promises (epic R6, R12, R14, R15; AD-15, AD-16).

**Approach:** Three additive element types in the registry (no version change, no migration): `shape` (rectangle, ellipse, line from whitelisted values), `emoji` (one RGI emoji as text, named by its Unicode name in `a11y.label`) and `sticker` (a PNG, WebP or GIF of the project's media, through 7.5's media rules). Contract helpers draw them the same in the studio and the SDK; the server adds the emoji rule; the SDK gets three renderers; the studio gets Add buttons, an emoji picker, inspectors and canvas drawing.

## Boundaries & Constraints

**Always:**
- `shape` props: `shape` (`rectangle|ellipse|line`), optional `fill`, `stroke` (hex colours), `strokeWidth` (0–0.05 of canvas height), `radius` (0–0.5, rectangle only), `opacity` (0–1). A line needs `stroke` and `strokeWidth > 0` and takes no `fill`. No SVG or CSS text: the SDK builds the shape from these values through CSSOM.
- New shapes are decorative (`a11y.decorative: true`); a shape with a label is `role="img"` named by it; otherwise hidden from assistive technology. Shapes never block publishing.
- `emoji` props: `emoji`, a string the server accepts only when it is exactly one RGI emoji (`isEmojiGlyph`), ≤ 64 UTF-16 units. Rendered as a text node in the platform emoji font stack, sized to its box; `role="img"` with `aria-label` = its label; decorative → hidden; no label → plain text (screen readers read the glyph). No emoji image CDN.
- The picker offers emoji with their Unicode (CLDR) names; adding one stores the name as `a11y.label`; the author edits it.
- `sticker` props: `mediaKey` (`png|gif|webp` only, by the schema's pattern), optional `opacity`. It is media of the tale's project under every 7.5 rule (membership, `tale_media` rows, locks, deletion guard, public route, delivery URL), drawn with `contain`, still under reduced motion, and needs alt text or the decorative mark to publish (R12, "Sticker n").
- Text over a shape: the contrast check uses an opaque unrotated rectangle's fill when it covers the text; any other element under the text makes contrast unknowable ("cannot be checked") rather than judged against the canvas.
- Every change is a history step with an announcement; layers grid, keyboard moves, lock and hide work for the new types unchanged. Dashboard imports stay in the lazy studio chunk.

**Never:** user-supplied SVG or CSS; emoji images; new npm packages or contract entry points; tales migration code; reformatting untouched code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Save shapes | rounded rectangle, ellipse, line | saved | — |
| Bad shape | `shape: "star"`, `fill: "red"`, radius on ellipse, fill on line, line without stroke, `strokeWidth: 0.2`, unknown prop | — | 400 at the prop |
| Save emoji | `😀`, `👩🏽‍💻`, `🇮🇱` with label | saved | — |
| Bad emoji | `abc`, `😀😀`, `<b>`, empty, `😀‮` | — | 400 at `/elements/i/props/emoji` |
| Save sticker | PNG/WebP/GIF of the project | saved, `tale_media` row | — |
| Bad sticker | `.jpg` key; video key; other project's key | — | 400 at `/elements/i/props/mediaKey` |
| Publish sticker | visible, no alt, not decorative | refused naming "Sticker 1" | 400 at `/elements/i/a11y/label` |
| Delivery | delivered sticker | `mediaKey` → `url`; undelivered key dropped | — |
| SDK shape | rectangle/ellipse/line | CSSOM box, border, radius, opacity; decorative hidden | bad colour → none |
| SDK emoji | label / decorative / none | `role=img` named / hidden / text | invalid glyph text stripped of controls |
| Older SDK | unknown `shape` type | skipped, one warning | — |

</intent-contract>

## Code Map

- `libs/contract/tale-document/element-types/{shape,emoji,sticker}.schema.json` (new), `registry.json`, `openapi/openapi.yaml`, `src/lib/tale-document.ts` (types, `resolveShapeStyle`, `isEmojiGlyph`, sticker in media helpers), `src/lib/text-style.ts` (`textBackdropAt`).
- `libs/server/tales/src/lib/tale-document.ts` -- emoji rule, sticker naming.
- `libs/web-sdk/src/lib/document/{shapes.ts (new),media.ts,renderer.ts}`.
- `apps/dashboard/src/app/pages/tale-shapes.ts` (new: emoji catalog and picker, shape and emoji inspectors), `tale-studio.ts`, `tale-media.ts` (sticker picker and inspector), `tale-layers.ts`, `icon.ts`.
- `apps/api/src/app.spec.ts` -- HTTP refusals; `apps/sdk-sample/a11y-review.mjs`, `a11y-scan.mjs` -- shapes, emoji and stickers.

## Tasks & Acceptance

**Execution:**
- [x] contract: schemas, registry, OpenAPI, helpers; `contract:generate`; tests per matrix row.
- [x] server-tales + api: emoji rule, sticker membership and publish rule, naming; unit and HTTP tests.
- [x] web-sdk: shape, emoji, sticker renderers; tests.
- [x] dashboard: Add buttons, emoji picker, inspectors, canvas drawing, layer names and icons, per-text backdrop; component tests.
- [x] sdk-sample: a tale with each new element in the review and scan.

**Acceptance Criteria:**
- Given a rounded rectangle, an ellipse, a line, an emoji and an image sticker published in a tale, when the sample page opens it, then each renders as in the studio, the emoji is announced by its name and a decorative sticker is skipped.
- Given the full verification, all projects lint, test and build; `web-sdk:size` ≤ 50 KB; a11y scans pass; perf cold p75 ≤ 1.5 s; dashboard initial bundle < 500 KB.

## Implementation Notes

- Contract: `shape.schema.json` (`shape`, `fill`, `stroke`, `strokeWidth` ≤ 0.05, `radius` rectangle only, `opacity`; a line needs `stroke` and `strokeWidth > 0` and takes no `fill`), `emoji.schema.json` (`emoji`, 1–64 units), `sticker.schema.json` (`mediaKey` `png|gif|webp`, `opacity`), registered; OpenAPI refs. `tale-document.ts`: the three element types (`MediaElement` now includes `sticker`), `MEDIA_ELEMENT_TYPES` and `isMediaElement` used by `documentMediaRefs`, `resolveDocumentMedia`, `missingAltText` and `mediaElementName` ("Sticker n"), so 7.5's membership, locks, `tale_media` rows, deletion guard, public route and delivery URLs cover stickers unchanged; `resolveShapeStyle`, `newShapeProps`, `SHAPE_KINDS`, new boxes, `EMOJI_FONT_STACK`, `emojiFontSize` (cqh, from the shorter side on the 9:16 canvas), `isEmojiGlyph` (`\p{RGI_Emoji}` with the `v` flag, an approximation without it). `text-style.ts`: `textBackdropAt`. No new entry point, no version change.
- Server: `PROPS_RULES.emoji` refuses anything but one RGI emoji at `/props/emoji`; `draftProblem` names stickers. No change to `tales.ts` or migrations.
- SDK: `document/shapes.ts` (`renderShape`, `renderEmoji`), `renderSticker` in `media.ts`, registered in `ELEMENT_RENDERERS`; CSS `.ta-shape`, `.ta-stroke`, `.ta-emoji`. Bundle 19.17 KB gzipped (18.46 before).
- Dashboard: `pages/tale-shapes.ts` (emoji catalog of 120 emoji with CLDR names, keyboard picker with search and roving tabindex, shape and emoji inspectors, `ElementChange`); studio: Add rectangle/ellipse/line/emoji/sticker, canvas drawing as the SDK draws, `restyleElement` (props set to `undefined` are removed), sticker picker (PNG/WebP/GIF only) and inspector (no fit or radius), per-text contrast backdrop, `kindName` names shapes by kind; layer names and icons. Initial bundle 492.14 KB.
- sdk-sample: `a11y-review` section 14 (shapes, emoji, stickers, accessibility tree order), `a11y-scan` tale with a decorative shape and a named emoji.
- Verification (2026-10-22, `--skip-nx-cache`): `run-many -t lint test build` on the 12 projects passes (contract 243, server-tales 220, web-sdk 326, dashboard 362, api 463 tests); `web-sdk:size` 19.17 KB; `web-sdk:types-check` passes (after a cast in `renderSticker` it first flagged); `sdk-sample:a11y` no violations; `sdk-sample:a11y-review` all 172 checks; `sdk-sample:perf` cold p75 1,266 ms, p75 first tale frame 72 ms.
- Not verified by hand: a signed-in browser walk of the studio, and a real screen reader.

## Plan Change Log

## Review Triage Log

## Design Notes

Assumptions (none blocks; each recorded for review):
- Three registry types rather than one `sticker` type with two kinds: each keeps a flat schema with `additionalProperties: false`, and an image sticker reuses the media helpers by type.
- The emoji picker offers a curated catalog (about 100 common emoji with their Unicode CLDR names), not all of Unicode; the server accepts any single RGI emoji, so a later picker can grow without a contract change.
- An emoji needs no label to publish (R12 lists images, video, image stickers and image buttons); without one, screen readers read the glyph's own name.
- Stroke width and corner radius are fractions of the canvas height, like media radius; the line is drawn across the middle of its box and turns with the box's rotation.
- An image sticker has no fit or corner radius (always `contain`); like images it starts without alt text and is flagged until it gets alt text or the decorative mark.

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w1_test npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool --skip-nx-cache` -- expected: all succeed.
- `npm exec nx -- run web-sdk:size`, `web-sdk:types-check` -- ≤ 50 KB gzipped; types pass.
- `npm exec nx -- run sdk-sample:a11y`, `sdk-sample:a11y-review`, `sdk-sample:perf` -- 0 violations; checks pass; cold p75 ≤ 1.5 s.
