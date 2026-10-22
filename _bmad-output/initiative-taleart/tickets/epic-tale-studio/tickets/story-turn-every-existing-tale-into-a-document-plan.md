---
title: 'Turn every existing tale into a document'
type: 'feature'
ticket: '11'
created: '2026-10-22'
status: 'in-review'
baseline_revision: '489b892'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-add-images-and-video-from-the-project-s-media-plan.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A tale's media (`tales.media_key`) still lives beside its document: the SDK draws it on a separate legacy path, the studio shows it as a read-only background, and the bar's default cover is "the first tale with media" (epic R16, AD-15 Migration, web zones R12).

**Approach:** The tale's media becomes a document element marked `taleMedia` (contract prop on `image`/`video`), full canvas, `contain` (the legacy viewer's fit), decorative, in a document with `durationMs: 5000`. A forward-only, batched, resumable migration writes it into every existing tale's documents (prepended under an existing overlay); the tales module's media writes (dashboard upload, importer first copy and re-import) keep the documents in step in the same transaction. Delivery always returns a document and, for any row not yet in step, composes the media element on the fly, so the outcome never depends on the migration having finished. The SDK renders only documents: a bottom, full-canvas `taleMedia` element is drawn full-bleed in the stage with the legacy playback rules; the bar's default cover is the first tale's lowest media element, else its canvas colour.

## Boundaries & Constraints

**Always:**
- Visitors see the same output before and after: same media, fit (`contain`, full-bleed in the stage), stage colour, timing (image 5 s; a `taleMedia` video runs the tale for its whole length, with sound where the browser allows it, no 15 s cap or stall rule, as before: epic "must not change the playback rules of tales with one media element"), cover, and the tale's title as its accessible name.
- `tales.document_media_key` records the media key the documents were last brought in step with. A tale is out of step when `media_key IS DISTINCT FROM document_media_key` and `media_key` is set.
- Bringing documents in step (one function, used by the migration, the media writes and Delivery): replace the key (and image/video type) of the `taleMedia` element(s); with none, insert a new one at the bottom (z-order 0) — except for an importer re-import (`replaceTaleMediaIf`), which only replaces `taleMedia` elements still holding the import's earlier key, so a person's studio edit (other media picked, element removed) is kept. A missing draft is created; a missing published document is created only for a tale whose stored status is `live` (else go-live publishes the draft, 7.3). A merge that would turn a passing document into a failing one (61 elements, size) is skipped, leaving the tale out of step (Delivery composes).
- Each changed document raises its revision (an open studio then gets 409 and reloads, 7.3) and rewrites its `tale_media` rows in the same transaction (published rows `delivered` when the document passes).
- The `taleMedia` element is exempt from the one-video limit (as the legacy tale video was); a document has at most one `taleMedia` element.
- Migration: under the migration lock at start, keyset-batched (`FOR UPDATE SKIP LOCKED`, 500 rows), set-based SQL for tales with no document, the shared function for tales with documents, for at most 10 s; then the API continues it in the background. Idempotent: a row in step is never touched again, so an element a person deleted never comes back.
- Delivery keeps `media` in each tale (older SDKs) and the legacy public-media rule; a tale with no deliverable document gets a composed media document, or an empty one in the legacy placeholder colour `#1f2937` for 5 s.

**Never:** new element types; new npm packages; copying media files; deleting legacy columns (rollback); changing the public route's rules, zone keys or Delivery key handling; reformatting untouched code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Legacy live image tale | media, no documents | draft = published = 1 `taleMedia` image, `contain`, decorative, 5 s; `tale_media` rows; in step | — |
| Legacy draft tale | media, no documents, status draft | draft only; go-live publishes it | — |
| Studio overlay tale | media + text draft/published | media element inserted at index 0 of each; texts kept; `durationMs` 5000 only when absent | — |
| Overlay with a video element, video media | both videos | allowed (taleMedia exempt); taleMedia video is the clock, the other loops along | — |
| Full overlay | 60 elements | skipped, stays out of step; Delivery composes | logged count |
| Odd legacy key | key not a document key | skipped; Delivery composes from `media` | — |
| Run twice / after person deletes element | in step | nothing changes | — |
| Concurrent save | studio save during migration | row skipped (locked) and done later, or save gets 409 | — |
| Dashboard upload | new tale, PUT media | draft document created; replace changes the `taleMedia` key | — |
| Import / re-import | fresh import; re-import with changed media | document created; `taleMedia` key replaced only if still the import's | person's edit kept |
| Delivery | out-of-step or unmigrated live tale | composed document with the media element | — |
| Bar cover | first tale media / text on colour / no cover | its lowest media element / colour swatch with the title / explicit cover wins | — |

</intent-contract>

## Code Map

- `libs/contract/tale-document/element-types/{image,video}.schema.json`, `src/lib/tale-document.ts` (taleMedia helpers, limit rule, `LEGACY_TALE_DURATION_MS`), `openapi/openapi.yaml` (descriptions).
- `libs/server/tales/src/lib/tale-media-document.ts` (new: pure merge, sync, migration), `migration.ts`, `tales.ts` (media writes, copies, Delivery), `tale-document.ts` (limit), `index.ts`.
- `apps/api/src/main.ts` (background continuation), `http/delivery.router.ts`.
- `libs/web-sdk/src/lib/viewer.ts`, `bar.ts`, `banner.ts`, `document/media.ts`.
- `apps/dashboard/src/app/pages/tale-studio.ts` (no legacy background, video limit), `cover-editor.ts` (default).
- `apps/sdk-sample/a11y-review.mjs`, `a11y-scan.mjs` (document-shaped stubs, before/after comparison).

## Tasks & Acceptance

**Execution:**
- [x] contract: `taleMedia` prop, helpers, limit exemption, OpenAPI text; tests.
- [x] server-tales: column + index, merge/sync/migration, media writes, copies, Delivery composition; unit tests.
- [x] api: background continuation; HTTP tests (seeded legacy rows, idempotence, concurrency with saves, upload, import and re-import after migration, Delivery).
- [x] web-sdk: documents only, stage media, cover rule; tests.
- [x] dashboard: studio and cover editor; tests.
- [x] sdk-sample: stubs as documents; before/after comparison section.

**Acceptance Criteria:**
- Given tales from before this story, when the API starts, then each renders on the sample page as before (pixel comparison against the legacy framing).
- Given a new upload and a fresh import against the fake Storyly server, then both tales have documents.
- Given a group whose first tale is text on a colour and no cover, then the bar shows that colour with the group's title.

## Implementation Notes

- Contract: `taleMedia` boolean prop on `image`/`video`; `isTaleMediaElement`, `isStageTaleMedia`, `limitedVideoCount`, `taleMediaElement`, `TALE_MEDIA_BOX`, `LEGACY_TALE_DURATION_MS` (5 s), `LEGACY_PLACEHOLDER_COLOR`; OpenAPI descriptions of `DeliveryTale.media`/`document` and `DeliveryTaleGroup.cover`. No new entry point or error code.
- Server: `tale-media-document.ts` (new) holds the pure merge (`mergeTaleMedia`), `bringTaleMediaInStep` (row lock, then key lock; revisions raised; `tale_media` rewritten), and the migration (`migrateTaleMediaDocuments` at start, 10 s budget, at least one 500-row batch; `continueTaleMediaMigration` in the background from `main.ts`). Set-based SQL for tales with no document; the shared function for tales with documents. `checkTaleDocument` exempts the tale's media from the video limit and refuses a second `taleMedia`. `setTaleMedia` is now one transaction; `setTaleMediaIfNone`/`replaceTaleMediaIf` bring documents in step in the importer's transaction (re-import mode keeps person edits); all three clear the public caches. Copies carry `document_media_key`. Delivery: `deliveredWithTaleMedia` always returns a document, composing the media (element id = tale id, so ETags stay stable) for an out-of-step tale.
- SDK: the viewer renders only documents; a stage `taleMedia` element is drawn as the legacy `.media` (contain, sound where allowed, uncapped clock); the canvas always carries the tale's title. `defaultCover` (bar and banner): the first tale's media background or lowest image/video, else its canvas colour. Bundle 18.82 KB gzipped (18.46 before).
- Dashboard: the studio no longer paints `tale.media` behind the canvas; video limit, safe-area and long-video warnings skip the stage media; duplicating it drops the flag; cover editor default is the first tale.
- sdk-sample: stubs are document-shaped (`mediaTale` in `a11y-shared.mjs`); `a11y-review` section 14 compares the legacy viewer framing with the migrated document pixel by pixel (6 picture/viewport cases and one overlay case: 0 pixels differ) and checks the colour cover.
- `import-scale.scale.ts`: its TRUNCATE now lists `tale_media` and `project_media` (it failed on the foreign key since 7.5).
- Verification (2026-10-22, `--skip-nx-cache`, `taleart_w2_test`): `run-many -t lint test build` on the 12 projects passes (contract 206, server-tales 199, server-importer 276, web-sdk 320, dashboard 353, api 465 tests); `web-sdk:size` 18.82 KB; `web-sdk:types-check` passes; `sdk-sample:a11y` 0 violations; `sdk-sample:a11y-review` all 183 checks; `sdk-sample:perf` cold p75 1,285 ms, first tale frame p75 70 ms; `api:import-scale` 1,000 tales passes.
- Not verified by hand: a signed-in browser walk of the studio on a migrated tale, a real screen reader, a production-size database (the batch test seeds 1,200 rows).

## Plan Change Log

## Review Triage Log

## Design Notes

Assumptions (none blocks):
- Fit is `contain`, not the epic's `cover`: the legacy viewer draws tale media with `object-fit: contain` full-bleed in the stage, and R16's overriding rule is "renders exactly as before". The element is decorative (epic) and the viewer names every document tale by its title, as the legacy media's alt text did.
- Under reduced motion a migrated GIF is drawn still (R12), where the legacy viewer let it move.
- The stage path applies only while the `taleMedia` element is the bottom element with the full-canvas box and no rotation, radius or opacity; once a person moves it, it renders as a normal document element (muted, 15 s cap).
- Banner slides use the same default as the bar cover.
- "Its title in the bar" is read as the group's usual title under a colour swatch cover; with `showTitles` off only the swatch shows.
- The dashboard's cover-editor preview uses the first tale's `media` (Management API), not its document.
- A live tale with no published document gets a media-only published document on a media write (it showed its media before); a draft tale gets a draft only, published on going live (7.3).
- Risks: an old API instance writing media during a rolling deploy leaves the tale out of step until the next start (Delivery composes meanwhile); a document already at 60 elements stays out of step (logged count, composed on delivery, the studio does not show the media); the stage path is a viewer special case that the 7.10 preview must reuse; the old key's public-cache yes may live 30 s after an importer replace (cleared before the importer's commit).
- Rollback: legacy columns and Delivery `media` stay, so the previous release still renders every tale (with documents drawn over the media: same look, the video twice, one muted); undoing the documents means clearing `taleMedia` elements and `document_media_key` (documented, not automated).

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w2_test npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --skip-nx-cache` -- all succeed.
- `web-sdk:size`, `web-sdk:types-check`, `sdk-sample:a11y`, `sdk-sample:a11y-review`, `sdk-sample:perf`, `api:import-scale` -- pass.
