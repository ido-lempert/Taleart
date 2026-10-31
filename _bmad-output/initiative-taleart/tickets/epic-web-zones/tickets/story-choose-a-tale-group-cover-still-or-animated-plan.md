---
title: 'Choose a tale group cover, still or animated'
type: 'feature'
ticket: '14'
created: '2026-10-21'
status: 'built'
baseline_revision: '69a48ecb7cd61f0426acdeb459a9e349b748413d'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/epic-web-zones.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The bar always shows a group's first tale's media as its cover; a content manager cannot pick a cover, a video frame, or an animated cover (R12).

**Approach:** Contract first, a tale group gets an optional cover stored through the storage port (AD-11): `PUT`/`GET`/`DELETE /api/v1/tale-groups/{id}/cover`. The dashboard makes the cover in the browser (an uploaded image; a video tale's frame picked with a timeline knob and drawn to a canvas; or a short clip recorded from a canvas with `MediaRecorder`) and uploads the result. The Delivery API returns the cover's public URL with the group; `/media/{key}` serves it under the tale media rules; the SDK bar shows it, animating only without reduced motion. With no cover, the bar keeps the first tale's media.

## Boundaries & Constraints

**Always:**
- Contract: `TaleGroupCover { kind, contentType, animated, url }` (url `/api/v1/tale-groups/{id}/cover`), `TaleGroup.cover` (nullable, required); `DeliveryCover { kind, contentType, animated, url }` (absolute public URL), `DeliveryTaleGroup.cover` (nullable, required). `MAX_ANIMATED_COVER_BYTES` (300 KiB = 307 200 bytes `[ASSUMPTION]` from the epic), `maxCoverBytes(contentType, animated)`, `taleGroupCoverUrl(id)` in `libs/contract`.
- Accepted cover types: the six tale media types. `animated` is decided by the server from the bytes: every video, every GIF, a WebP with the animation flag, a PNG with an `acTL` chunk (APNG). Animated covers are at most 300 KiB, still images up to the image limit (10 MB); over it 413 `media_too_large` "An animated cover is at most 300 KB". Type and magic number as for tale media (415), empty 400, unknown group 404 `tale_group_not_found`, no access 403.
- Storage: nullable `cover_key`, `cover_content_type`, and `cover_animated boolean NOT NULL DEFAULT false` on `tale_groups`, added idempotently; only the key is stored (key `covers/<uuid>.<ext>`). Replace = store, update, then delete the old file only when no tale and no cover references it (1.16); same for `DELETE`. Tale media replacement also keeps a file a cover references. Copy to zone copies the cover key (shared, AD-14).
- Public media: a cover key is public while a group that references it is `live` and in its window and has a published tale (as the Delivery API lists it); otherwise 404. Same `public, no-cache` + ETag.
- Delivery: each group carries `cover` (public URL) or `null`.
- SDK: a cover replaces the first-tale fallback. An animated video cover is a muted, looping, inline `<video>` that autoplays unless `prefers-reduced-motion: reduce`, then it shows its first frame paused, and it follows a live change of the setting. An animated image cover under reduced motion is drawn once to a `<canvas>` (first frame). Bundle ≤ 50 KB gzipped; no new console output.
- Dashboard (story 14 design system): a Cover button on each group row opens a Cover drawer: current cover preview or "First tale's image (default)"; choices Upload an image, Frame of a video tale (tale select, video preview, range knob "Frame time", "Use this frame"), Animated from a video tale (same knob as start, length 1–3 s, "Make animated cover", preview with size), and Remove cover. Frames are cropped to a centred square (still 320 px JPEG; clip 160 px, 15 fps, WebM, else MP4 where only that records). A clip over 300 KB is refused in the form and by the API. The group row's ring shows the cover.
- `_test` database only (`taleart_w1_test`); standard error body.

**Never:** Server transcoding, thumbnails or frame extraction; GIF encoding in the browser; new npm packages; covers for tales; banner changes; changes to zone keys, Delivery CORS, status or schedule rules.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Still cover | `PUT .../cover` JPEG 50 KB | 200 group, `cover {kind image, animated false}`; row holds key only | — |
| Animated cover | WebM 200 KB; animated GIF | 200, `animated true` | — |
| Too large animated | WebM or GIF over 300 KiB | 413 `media_too_large`, cover unchanged | standard body |
| Large still | PNG 2 MB, no `acTL` | 200 | — |
| Bad type | PDF, or PNG header with JPEG bytes | 415 `unsupported_media_type` | — |
| Empty / unknown / access | 0 bytes; unknown id; other project | 400 / 404 `tale_group_not_found` / 403 | — |
| Read | `GET .../cover` | bytes, stored type, ETag; 404 `media_not_found` with none | — |
| Replace | upload again | new key; old file deleted | — |
| Shared key | copy group, replace source cover | copy keeps its cover file | — |
| Remove | `DELETE .../cover` | 200 `cover: null`; file deleted unless shared | — |
| Tale media vs cover | tale media key also a cover key | tale replace keeps the file | — |
| Delivery | live group with cover; without | `cover {…url /media/covers/…}`; `cover: null` | — |
| Public cover | group draft/paused/expired/no live tale; live | 404; 200 | — |
| Migration | run twice | columns once; old groups `cover: null` | — |
| SDK still | cover image | `<img>` of the cover URL | — |
| SDK animated | video cover, motion ok / reduced / toggled | autoplay loop / paused first frame / follows | — |
| SDK animated image | GIF cover with reduced motion | canvas, no `<img>` animating | — |
| SDK fallback | `cover: null` | first tale's media as before | — |
| Dashboard upload | pick PNG, Save | PUT image/png, ring shows cover | API message shown |
| Dashboard frame | pick video tale, move knob, Save | `currentTime` follows knob; JPEG uploaded | capture failure shown |
| Dashboard clip | Make animated cover, Save | WebM uploaded; > 300 KB refused in form | API message shown |
| Dashboard remove | Remove cover | DELETE, default shown | — |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/index.ts`, `src/lib/contract.spec.ts` -- cover schemas, paths, helpers; regenerate.
- `libs/server/tales/src/lib/migration.ts`, `tales.ts`, `index.ts`, `tales.spec.ts` -- cover columns, `cover` in group reads, `getTaleGroupCover`, `setTaleGroupCover`, `removeTaleGroupCover`, copy, Delivery, `findPublishedMedia`, `isMediaKeyInUse`.
- `apps/api/src/http/media.ts` -- `isAnimatedMedia` sniffing; shared upload reading.
- `apps/api/src/http/tale-groups.router.ts`, `delivery.router.ts`, `public-media.router.ts` -- cover routes; cover in Delivery.
- `apps/api/src/app.spec.ts` -- matrix rows; existing Delivery `toEqual`s gain `cover: null`.
- `libs/web-sdk/src/lib/bar.ts`, `taleart-element.ts`, specs -- cover rendering and reduced motion.
- `apps/dashboard/src/app/cover-capture.ts` (new), `cover-editor.ts` (new), `create-drawer.*`, `dashboard.store.ts`, `pages/zone-detail.*`, `styles.css`, `app.spec.ts` -- the Cover drawer.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- schemas, paths, helpers; regenerate; helper tests -- AD-3.
- [x] `libs/server/tales/` -- columns, cover setters and reads, copy, Delivery, public lookup, in-use check; unit tests -- AD-11, AD-14.
- [x] `apps/api/src/` -- sniffing, cover routes, Delivery cover; integration tests for every API matrix row.
- [x] `libs/web-sdk/` -- cover rendering, reduced motion; tests; size check.
- [x] `apps/dashboard/` -- capture helpers, Cover drawer, row ring, store calls; tests.

**Acceptance Criteria:**
- Given a live group with no cover, when the sample page loads, then the bar shows its first tale's image.
- Given a video tale, when the knob is moved to a time and the frame is saved, then the API stores a JPEG cover and the bar shows it after a reload.
- Given an animated cover, when the bar renders, then it loops; with reduced motion it is still.
- Given an animated cover above 300 KB, when it is saved, then it is refused and the previous cover stays.
- Given a cover shared by a copy, when the source's cover is replaced or removed, then the copy's file is kept.

## Implementation Notes

- Assumptions (recorded, not product decisions): the 300 KB cap is the epic's `[ASSUMPTION]`, read as 300 KiB (307 200 bytes) and named "300 KB" in messages; it applies to every animated cover (video, multi-frame GIF, animated WebP, APNG), while a still cover keeps the 10 MB image limit; a GIF the server cannot walk counts as animated (the cap applies); the browser makes animated covers as WebM through `MediaRecorder` (MP4 where the browser records only that, Safari) and never encodes GIF, though an uploaded animated GIF is accepted; frames and clips are cropped to the centred square (still 320 px JPEG at 0.85, clip 160 px, 15 fps, 400 kbit/s, 1, 2 or 3 s, default 2 s); a cover is public while its group is delivered (live, in its window, with a published tale), not merely live; the project's tale group list (`ProjectTaleGroup`) carries no cover; a removed cover is answered with the group and `cover: null` (removing none is a no-op 200); copy to zone shares the cover key, as it shares tale media keys (AD-14).
- Contract: `TaleGroup.cover` (`TaleGroupCover`: kind, contentType, animated, url), `DeliveryTaleGroup.cover` (`DeliveryCover`, absolute public URL); `GET`/`PUT`/`DELETE /tale-groups/{id}/cover`; `MAX_ANIMATED_COVER_BYTES`, `maxCoverBytes`, `taleGroupCoverUrl`. No new error code.
- Tales module: `cover_key`, `cover_content_type`, `cover_animated` (default false) and an index on `cover_key`, added idempotently. `getTaleGroupCover`, `setTaleGroupCover` (one statement locks the row and returns the previous key; `null` removes). Group reads map `cover`; `listDeliveryTaleGroups` returns the stored cover; `findPublishedMedia` adds a cover branch (group live, in window, with a live tale in its window); `isMediaKeyInUse` counts covers, so tale media replacement keeps a file a cover uses and vice versa; `copyTaleGroup` copies the cover columns under the source row's `FOR SHARE` lock, so a concurrent cover replace waits and sees the copy.
- API: `covers.router.ts` mounted at `/tale-groups` (separate file to stay out of the parallel stories' way); `isAnimatedMedia` in `media.ts` walks GIF blocks, reads the WebP VP8X animation flag and looks for an APNG `acTL` chunk; body limit 10 MB (`entity.too.large` on `/cover` answers 413 `media_too_large`); order: group (404), declared type (415), body (400), magic number (415), size per motion (413); store, update, then delete the old file unless referenced.
- SDK: `bar.ts` renders the group's cover before the first-tale fallback; animated video covers autoplay muted, looping and inline unless reduced motion (then first frame, `#t=0.001`); animated image covers under reduced motion are drawn once to a canvas; `applyCoverMotion` redraws animated covers and the element follows live changes of `prefers-reduced-motion`. Bundle 6.79 KB gzipped.
- Dashboard: `cover-capture.ts` (canvas frame capture, `MediaRecorder` clip recording, a `CoverCapture` service so tests replace it), `cover-editor.ts` (the Cover drawer body: current cover and Remove cover, then Upload an image / Frame of a video tale / Animated, from a video tale, with a video preview, a range knob "Frame time" or "Start time" with `aria-valuetext`, a length select, Make animated cover with a looping preview and its size), a `cover` drawer kind ("Save cover"), a Cover button per group row, the row ring shows the cover, store `uploadCover` / `removeCover` / `coverSrc` (version query after a change).

- After review: merged `autopilot/foundation` (5f05391: banner 3.6, importer 2.6). The banner's `coverMedia(group)` export keeps its meaning (a slide shows the first tale's media, R3); the cover renderer became `coverElement`; every bar frame renders through `renderBar` with covers, and the reduced-motion watcher redraws animated covers across all frames. The a11y scan's stub zone now has a group with a cover.
- Verification after the merge: `nx run-many -t lint test build` for the twelve projects passed against `taleart_w1_test` (api 259, dashboard 167, web-sdk 136, server-tales 65 tests); `web-sdk:size` 9.10 KB gzipped; `sdk-sample:a11y` reports no WCAG 2.2 AA violations.

## Plan Change Log

## Review Triage Log

### 2026-10-21 — Coordinator review
- verdicts: 11 findings, all patched.
- findings:
  - `[patch]` The public cover lookup did not match Delivery: a live group with a live tale but no zone placement still served its cover — one `deliveredGroup` SQL predicate (live in window, a live tale in window, placed in a zone) now drives both `listDeliveryTaleGroups` and the cover branch of `findPublishedMedia`; tests: never placed and removed from its last zone answer 404, also with `If-None-Match` (no 304).
  - `[patch]` A video cover was buffered up to 10 MB before the 300 KB check — a declared video type over 300 KB is refused from `Content-Length` before reading, and video bodies use an `express.raw` limit of 300 KB mapped to "An animated cover is at most 300 KB"; the post-sniff check stays for animated images; tests for 300 KB + 1 and 10 MB + 1.
  - `[patch]` Save took whatever frame the video showed (a recording moves it) — Save and "Use this frame" seek to the knob time first; test after a clip moved the video.
  - `[patch]` Controls stayed live during recording — knob, length, tale select and source radios are disabled while busy; `seekTo` times out (5 s) and rejects on `emptied`/`abort`/`error`; state resets in `finally`; tests.
  - `[patch]` No cancellation — `recordClip` takes an `AbortSignal`; the editor aborts on destroy and on source or tale change, and an aborted recording emits nothing and makes no object URL; URLs are revoked on destroy; tests.
  - `[patch]` `recordClip` could leave the recorder running or wait on rAF in a hidden tab — `start()` inside `try`, `stop()` only when not inactive, tracks always stopped, a `setTimeout` deadline; unit tests with a fake recorder.
  - `[patch]` Clip size only announced — shown next to the preview ("84 KB of 300 KB"), marked when over.
  - `[patch]` UI differed from the plan — with no cover the preview shows the first tale's media with "First tale's image (default)"; "Use this frame" captures into a preview that Save uploads (Save without it captures at the knob time).
  - `[patch]` SDK needed `MediaQueryList.addEventListener` — falls back to `addListener`/`removeListener`; test.
  - `[patch]` GET cover read storage before `If-None-Match` and compared it literally — checked first with `etagMatches` (lists, `W/`, `*`); tests.
  - `[patch]` `.ring { overflow: hidden }` applied to every ring — moved to `.ring--cover`, set only where a cover shows.

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w1_test npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting web-sdk sdk-sample` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size` -- expected: ≤ 50 KB gzipped.

**Manual checks (if no CLI):**
- On dev servers: pick a video frame and make an animated cover in the Cover drawer; reload the sample page (cover shows, animates; still with reduced motion emulated).

## Auto Run Result

**Summary:** A tale group has an optional cover, still or animated, stored through the storage port under `covers/<uuid>.<ext>` with only the key on the group (AD-11). `PUT /api/v1/tale-groups/{id}/cover` takes the file's bytes; the server checks the type and magic number, decides from the bytes whether it moves, and refuses an animated cover above 300 KB with 413; `GET` serves it to the dashboard and `DELETE` removes it. Replaced and removed files are deleted only when no tale or cover still references them (copies share cover keys). The Delivery API returns each group's cover as a public URL, served by `/media/{key}` only while the group is delivered. The Web SDK bar shows the cover (falling back to the first tale's media), animates an animated cover, and keeps it still under reduced motion, following live changes. The dashboard's Cover drawer uploads an image, takes a frame of a video tale picked with a timeline knob, or records a 1 to 3 s clip in the browser, and removes the cover.

**Files changed:**
- `libs/contract/` — cover schemas and paths, helpers, regenerated types, tests.
- `libs/server/tales/` — cover columns, cover reads and setters, Delivery cover, public lookup, in-use check, copy; tests.
- `apps/api/src/` — `http/covers.router.ts` (new), `media.ts` animation sniffing, Delivery cover, error mapping, app wiring; integration tests for every API matrix row; existing tests gain `cover: null` and the new columns.
- `libs/web-sdk/src/lib/` — cover rendering, reduced motion and live changes; tests.
- `apps/dashboard/src/` — `cover-capture.ts`, `cover-editor.ts` (new), Cover drawer, Cover button and ring cover on the zone page, store calls, styles; tests.

**Review:** not run (unreviewed, as requested).

**Follow-up review recommended:** true. The change widens what the unauthenticated `/media` route serves and adds browser media capture that only jsdom has exercised.

**Verification:** `nx run-many -t lint test build` for the twelve projects passed against `taleart_w1_test` (api 244, dashboard 146, web-sdk 83, server-tales 65 tests). `nx run web-sdk:size`: 6.79 KB gzipped (budget 50 KB). The dashboard build keeps its existing initial-bundle budget warning (573 KB against a 500 KB warning). No browser run was made: canvas capture and `MediaRecorder` are covered only through a stubbed `CoverCapture` service.

**Residual risks:**
- `recordClip` and `captureFrame` have not run in a real browser here; WebM from `MediaRecorder` has no duration metadata (loops fine, seeking may not).
- The 300 KB cap and the still-cover limit (10 MB) are assumptions; a large still cover costs the 1.5 s budget (R10).
- A GIF the server cannot parse counts as animated, so a malformed large still GIF is refused.
- Under reduced motion an animated image cover is a canvas drawn on load; it stays blank if the image fails to load.
