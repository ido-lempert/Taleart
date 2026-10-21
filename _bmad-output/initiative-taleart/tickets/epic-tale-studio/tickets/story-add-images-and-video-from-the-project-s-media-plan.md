---
title: "Add images and video from the project's media"
type: 'feature'
ticket: '5'
created: '2026-10-22'
status: 'in-review'
baseline_revision: 'ad7d3a0'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-upload-a-project-font-and-use-it-in-a-tale-plan.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A tale document holds only text (7.1–7.4, 7.17). A content manager cannot place images, GIFs or a video from the project's media on the canvas, use an image as the canvas background, or set how long a tale plays (epic R5, R2, R12, R14; AD-11, AD-15, AD-16).

**Approach:** Contract first. `image` and `video` element types (media key, `cover`/`contain` fit, corner radius, opacity), a media canvas background (key, fit, band colour) and the media rules (key pattern, one video, 3–15 s duration with a 7 s default, alt text or decorative before publish) in `libs/contract`. The tales module owns `project_media` (studio uploads) and `tale_media` (which tale's draft or published document references which key), written in the transaction of every document write, mirroring `tale_fonts`. The public route serves a document's key only while a delivered, valid published document references it; the Delivery API resolves keys to public URLs. The SDK renders `<img>`/`<video muted playsinline>`, and a document video is the tale's clock. The studio gets a media picker with upload, a media inspector, size and rotation fields, a background image and a duration field.

## Boundaries & Constraints

**Always:**
- Document media is referenced by storage key only (`tales/…` or `media/…`, server-made, ≤ 200 chars, extension `png|jpg|gif|webp|mp4|webm`). An `image` key must be an image type, a `video` key a video type; the background takes images only.
- A key belongs to project P when P has an upload row (`project_media`), a tale of P holds it as its media (`tales.media_key`), or a document of a tale of P references it (`tale_media`, which a group copy writes for the target project: copies share keys, AD-14). Any other key is refused on save, keep-as-copy and publish: 400 `invalid_tale_document` at `/elements/i/props/mediaKey` or `/canvas/background/mediaKey`.
- Saves share-lock each key (`pg_advisory_xact_lock_shared` on the key) before the membership check; `isMediaKeyInUse` passes an exclusive lock on the key before it reads, and counts `project_media` and `tale_media` rows too, so a replaced tale media or cover file, or an imported file, is never deleted while a document references it.
- `tale_media` is written in the same transaction as save, publish, discard, go-live publish, keep-as-copy and group copy. A published row is `delivered` only when the element is visible (the background always is) and the document passes the document and publish checks.
- Public `/media/<key>`: existing tale-media and cover rules unchanged and uncached; otherwise 200 only while a `live` tale in its window of a delivered group (`deliveredGroup`) has a `delivered` row for the key; answers of this branch kept in a bounded in-process cache (1,000 keys, 30 s) cleared on publish, status, schedule, placement and copy, like fonts.
- Delivery: in each delivered document, a media element's `mediaKey` becomes `url` (public URL); an element (or background) whose key has no delivered row for that tale is dropped (background falls back to its colour). No key leaves except inside a URL.
- At most one `video` element per document (save refuses the second, at `/elements/i/type`). `durationMs` 3,000–15,000 (schema); absent means 7,000 for a document tale; with a video the tale plays for the video's length.
- Publish (and go-live publish) refuses a visible image or video with neither a non-blank `a11y.label` nor `decorative: true`: 400 `invalid_tale_document` at `/elements/i/a11y/label`, message naming the element ("Image 2"). Go-live still goes live with `draftNotPublished: true` and `draftNotPublishedReason`. Drafts may hold missing alt text.
- Upload `POST /projects/{projectId}/media`: raw body; role 403, project 404, declared type not one of the six media types 415, declared length over the kind's limit 413 — all before reading; body capped; empty 400; magic number mismatch 415. Stored as `media/<uuid>.<ext>` through the storage port, row and file together (as fonts).
- SDK: `<img alt>` (decorative → empty alt, hidden); `<video muted playsinline>` that autoplays only without reduced motion, shows its first frame (`#t=0.001`) and plays from the Play button under reduced motion, pauses with the viewer; under reduced motion a possibly animated image (GIF, WebP, PNG) is drawn once to a canvas. Styles through CSSOM; http(s) URLs only. Media never loads before the viewer opens a tale.
- Dashboard imports contract values only through `core` or narrow entries, lazy pages only.

**Never:** transcoding or probing media on the server; copying media files; captions or a media library delete (post-MVP); new npm packages; new contract entry points beyond what is needed; reformatting untouched code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upload ok | PNG ≤ 10 MB, `image/png` | 201 `{ key: media/<uuid>.png, kind, contentType, url, source: upload }` | — |
| Upload bad | declared `text/plain` / bytes not PNG / empty / 11 MB image / 101 MB video | nothing stored | 415 / 415 / 400 / 413 / 413 |
| Save media | image + video of the project's media, fit, radius, opacity, rotation | saved, `tale_media` draft rows | — |
| Other project's key | key uploaded to project B in A's tale | — | 400 at `/elements/i/props/mediaKey` |
| Unknown key | `media/<random>.png` | — | 400 at `/elements/i/props/mediaKey` |
| Wrong kind | image element with `.mp4` key; video background | — | 400 at the key |
| Two videos | two `video` elements | — | 400 at the second's `/type` |
| Bad fit / radius / opacity | `fill`, 0.6, 1.5 | — | 400 at the prop |
| Duration | 2,999 / 15,001 / 5,000 | refused / refused / saved | 400 at `/durationMs` |
| Missing alt | visible image, no label, not decorative | draft saves; publish refused naming "Image 1" | 400 at `/elements/i/a11y/label` |
| Go-live, missing alt | unpublished tale set live | live, nothing published | `draftNotPublished` + reason |
| Public URL | draft only, hidden element, tale paused, group unplaced | 404 | — |
| Public URL | delivered tale's published document uses the key | 200, `If-None-Match` → 304 | — |
| Delivery | delivered tale with image, video, media background | URLs in place of keys | — |
| In use | tale media replaced while a document references the old key | file kept | — |
| Keep-as-copy / group copy | same project / other project | keys checked / shared, recorded for the copy's project | — |
| SDK video | tale with a video, motion ok / reduced | autoplays muted, tale ends with it / first frame, Play plays | video error → timer |

</intent-contract>

## Code Map

- `libs/contract/tale-document/element-types/{image,video}.schema.json` (new), `registry.json`, `v1.schema.json` (media background), `openapi.yaml`, `src/lib/tale-document.ts` (types, media helpers, publish rule), `src/lib/core.ts` (types).
- `libs/server/tales/src/lib/document-media.ts` (new), `migration.ts`, `tale-document.ts`, `tales.ts`, `index.ts`.
- `apps/api/src/http/project-media.router.ts` (new), `delivery.router.ts`, `public-media.router.ts`, `tales.router.ts` (go-live reason), `app.ts`, `app.spec.ts`.
- `libs/web-sdk/src/lib/document/media.ts` (new), `renderer.ts`, `viewer.ts`, README.
- `apps/dashboard/src/app/project-media.service.ts` (new), `pages/tale-media.ts` (new: picker and inspector), `pages/tale-studio.ts`, `pages/tale-layers.ts`, `icon.ts`, `dashboard.store.ts`.
- `apps/sdk-sample/a11y-scan.mjs`, `a11y-review.mjs` -- a tale with an image and a video.

## Tasks & Acceptance

**Execution:**
- [x] contract: schemas, registry, OpenAPI, helpers; `contract:generate`; tests.
- [x] server-tales + api: tables, membership, locks, records, publish rule, public lookup, delivery, upload/list/file routes; unit and HTTP tests per matrix row.
- [x] web-sdk: image, video, background renderers; viewer clock and reduced motion; tests.
- [x] dashboard: service, picker, inspector, studio wiring, duration, background, publish refusal; component tests.
- [x] sdk-sample: media tale in the scans.

**Acceptance Criteria:**
- Given an image and a video from the project's media, resized, rotated and rounded, and a published tale, when the sample page opens it, then both render as in the studio and the tale plays for the video's length.
- Given a tale without video and a duration of 5 s, when it plays, then it advances after 5 s.
- Given the full verification, all projects lint, test and build; `web-sdk:size` ≤ 50 KB; a11y scans pass; perf cold p75 ≤ 1.5 s; dashboard initial bundle < 500 KB.

## Implementation Notes

- Contract: `image.schema.json` and `video.schema.json` (mediaKey, fit, radius, opacity), registered; `v1.schema.json` canvas background is `oneOf` colour or `MediaBackground` (key, fit, band `color`). `tale-document.ts` gains the element types and the media helpers (`MEDIA_KEY_PATTERN`, `mediaContentTypeOfKey`, `documentMediaRefs`, `mediaElementName`, `missingAltText`, `resolveDocumentMedia`, `DEFAULT_TALE_DURATION_MS`, `MAX_VIDEO_ELEMENTS`); `core.ts` gains `ProjectMedia`, `DeliveryCanvas`, `projectMediaFileUrl`. OpenAPI: `/projects/{id}/media` (list, upload), `/media/file`, `DeliveryCanvas`, `draftNotPublishedReason`. No new error codes and no new contract entry point.
- Server (tales module): `document-media.ts` (new) owns `project_media` and `tale_media`: membership (`projectMediaKeys`: uploads, tale media, document references of the project), shared advisory key locks (taken in key order, after the tale row lock), `recordTaleMedia` in the transaction of save, publish, discard, go-live publish, keep-as-copy and group copy (copies record the keys for the target project), the cached public lookup (1,000 keys, 30 s, cleared with the font cache), delivered keys per tale, upload and list. `isMediaKeyInUse` waits for in-flight writes on the key (exclusive lock barrier) and counts `tale_media` and `project_media`, so tale-media replace, cover replace and the importer sweep never delete a referenced file. `checkTaleDocument` refuses a second video; `checkPublishRules` (`AltTextRequiredError`, an `InvalidTaleDocumentError` with a message naming the element) runs on publish, go-live (reported as `draftNotPublishedReason`) and delivery.
- API: `project-media.router.ts` (role, project, declared type and length checked before reading; uncompressed raw body; magic-number sniff; `media/<uuid>.<ext>`; private file with ranges and an opaque ETag); the upload path skips the JSON parser; Delivery resolves keys to public URLs and drops what has no delivered row.
- SDK: `document/media.ts` (`<img alt>`, muted inline `<video>`, still canvas for GIF/WebP/PNG under reduced motion), media background in the renderer; the viewer uses a document video as the clock (tale media video stays the clock when present), and a document tale without `durationMs` plays 7 s. Bundle 18.23 KB gzipped (17.48 before).
- Dashboard: `project-media.service.ts`, `pages/tale-media.ts` (picker in the drawer with upload; media inspector: alt text, decorative, fit, radius, opacity, replace), studio: Add image/video (one video), media on the canvas, width/height/rotation fields for every layer, background image with fit and band colour, duration field, "Needs alt text" layer warning, publish refusal shown naming and selecting the element; zone page warning carries the reason.
- sdk-sample: `a11y-review` section 13 (alt text, decorative and background hidden, muted inline video that ends the tale, reduced motion); perf cleanup knows the new tables.
- Verification (2026-10-22, `--skip-nx-cache`): `run-many -t lint test build` on the 12 projects passes (contract 203, server-tales 186, web-sdk 313, dashboard 348+, api 454 tests); `web-sdk:size` 18.23 KB; `web-sdk:types-check` passes; `sdk-sample:a11y` no violations; `sdk-sample:a11y-review` all 165 checks; `sdk-sample:perf` cold p75 1,273 ms, p75 first tale frame 67 ms. Dashboard initial bundle 491.27 KB.
- Not verified by hand: a signed-in browser walk of the studio picker and inspector, and a real screen reader.

## Plan Change Log

## Review Triage Log

## Design Notes

Assumptions (none blocks; each recorded for review):
- "The project's media" is the project's studio uploads, its tales' media and media its tales' documents already use; group covers are not offered. There is no media library delete in this story, so uploads stay.
- The canvas background takes an image (GIF included), never a video: a background is decorative, and a full-bleed `video` element with `cover` fit gives the same look. `MediaBackground` keeps `color` as the band colour, so every background has a colour.
- Alt text is required on visible image and video elements only (hidden ones are not delivered). A legacy tale media video is not a document element and does not count toward the one-video limit; when a tale has both, the legacy video stays the clock.
- A document tale without `durationMs` plays 7 s (was 5 s); tales without a document keep 5 s.
- Corner radius is a fraction of the canvas height (0–0.5), opacity 0–1; both optional (0 and 1).
- A document video is always muted (no sound control in the MVP); it does not loop while it is the clock.
- The content type of a document key comes from its extension, which the server chose from the sniffed type.
- No per-project media caps (tale media has none either); recorded as a risk.

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w1_test npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --skip-nx-cache` -- expected: all succeed.
- `npm exec nx -- run web-sdk:size`, `web-sdk:types-check` -- ≤ 50 KB gzipped; types pass.
- `npm exec nx -- run sdk-sample:a11y`, `sdk-sample:a11y-review`, `sdk-sample:perf` -- 0 violations; checks pass; cold p75 ≤ 1.5 s.
