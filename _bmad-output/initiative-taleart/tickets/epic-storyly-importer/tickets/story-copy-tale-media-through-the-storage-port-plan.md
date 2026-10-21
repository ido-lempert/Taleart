---
title: 'Copy tale media through the storage port'
type: 'feature'
ticket: '5'
created: '2026-10-21'
status: 'in-review'
baseline_revision: 'fbe2ef0'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'none'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-storyly-importer/epic-storyly-importer.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-storyly-importer/import-mapping.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Imported tales carry a title only; the story's image, GIF or video stays at the source (mapping table: "media → media key via the storage port"). The media URLs come from an external source, so fetching them is a server-side request forgery and resource risk.

**Approach:** For each imported tale, the worker downloads its story's `media` URL through a guarded fetcher (http/https only, public addresses only, checked on the connected socket and on every redirect, capped redirects, size and time), checks the type with the upload rules, streams the bytes into the storage port, and sets the tale's media key and content type through the tales module. A download that fails leaves the tale without media and adds a `mediaNotImported` difference with a reason; the job goes on. An importer-owned `import_media` row records which stored key came from which story, so a re-run reuses it instead of downloading again.

## Boundaries & Constraints

**Always:**
- Storage port (AD-11) gains `putStream(key, chunks)`: the local adapter writes to a temp file and renames it, and removes the temp file when the source fails. Keys are server-made: `tales/<uuid>.<ext>`.
- Type and size rules are the upload's, shared through `@taleart/contract` (`matchesMagicNumber`, `mediaExtension`, `maxMediaBytes`): the declared type is the response `Content-Type`; when it is absent or `application/octet-stream`, the story's `mime_type`. It must be an accepted media type and match the leading bytes. A `Content-Length` over the limit is refused before reading; the stream is cut at the limit.
- Fetch guard: only `http:`/`https:` URLs without credentials; every resolved address must be public (no private, loopback, link-local, CGNAT, multicast, reserved, documentation, metadata, unspecified, IPv4-mapped/NAT64/6to4/Teredo IPv6). The socket connects to the checked address (no second DNS lookup) and its remote address is checked again on connect. At most 3 redirects, each hop checked the same way. A deadline covers the whole download (default 120 s) and an idle socket timeout (30 s). No token, cookie or auth header is sent; no proxy is used.
- `IMPORT_MEDIA_ALLOWED_ADDRESSES` (comma-separated IP literals, default empty) exempts exact addresses from the private-address check, for tests and local reviews against the fake server. Production default allows none.
- Report: `media: {source, imported, skipped}` (source = imported tales whose story names media); a failure is `{entity: 'tale', kind: 'mediaNotImported', field: 'media', reason}` with reason one of `invalidUrl`, `blockedAddress`, `unreachable`, `timeout`, `tooManyRedirects`, `httpError`, `tooLarge`, `unsupportedType`. It draws on story 6's difference budget and caps. Neither the URL nor the token ever enters the report, the job row or the logs.
- Re-run: a tale whose current media key is the one `import_media` recorded for its story keeps it with no download. A tale whose media was set in TaleArt is not overwritten (a note, counted skipped). Setting media and the `import_media` row happen in one transaction under the story's advisory lock; an unused new file or a replaced, no-longer-referenced file is deleted.
- Storage write failures (not source failures) fail the job, like database failures.
- Fake server: story media URLs (`https://media.example/fake/...`) are served by the fake itself (rewritten to its own origin when served). It serves small JPEG, PNG, GIF, WebP, MP4 and WebM files, and a "Media shop" app (1004) with a too-large file, a wrong type, an HTML page, a redirect to a private address, a redirect to loopback IPv6, a redirect loop, a 404, a non-http URL and a good redirect.
- Dashboard: a "Media" report row and difference lines such as "media: not imported (too large)".

**Never:** Importing group covers (still `notHeld`); updating media when the source changed (story 7); concurrency and retries (story 10); transcoding; storing or logging source media URLs; weakening the guard by default; tests that reach the internet.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Demo shop | 15 stories with JPEG media | every tale has `media` (image/jpeg); `media` 15/15/0; files in MEDIA_DIR | — |
| Kinds | Media shop: GIF, MP4, WebP, PNG, good redirect | stored with their types | — |
| Too large | image streamed past 10 MB, or `Content-Length` over the limit | no media; `tooLarge`; no file left | job continues |
| Wrong type | JPEG declared, HTML bytes; or `text/html` | `unsupportedType` | job continues |
| Private redirect | 302 to `169.254.169.254` / `[::1]` | `blockedAddress`; no request to it | job continues |
| Private host | URL host resolving to 10.x / 127.x (not allowed) | `blockedAddress` | — |
| Redirect loop | > 3 redirects | `tooManyRedirects` | — |
| HTTP error | 404 | `httpError` | — |
| Bad URL | `ftp://…`, `file://…`, credentials, not text | `invalidUrl` | — |
| Timeout / no answer | stalled body; refused connection | `timeout` / `unreachable` | — |
| Re-run | same app again | no new files, no downloads; `media` imported unchanged | — |
| Media set in TaleArt | tale media replaced by a user, re-run | kept; note; counted skipped | — |
| Storage fails | put rejects | job failed with the generic message | logged without token |
| No media value | story without `media` | no media; story 6's `missing` only; not counted | — |
| Secrets | any run | no token and no media URL in report, job row or logs | — |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- `ImportReport.media`, `ImportDifferenceKind.mediaNotImported`, `ImportMediaFailure`, `ImportDifference.reason`; magic-number and extension helpers moved here from the API.
- `libs/server/storage/src/lib/*` -- `putStream` on the port and local adapter.
- `libs/server/importer/src/lib/media-fetch.ts` (new) -- address policy, guarded fetch with redirects.
- `libs/server/importer/src/lib/media-copy.ts` (new) -- type and size checks while streaming into storage; `import_media` bookkeeping and setting the tale media.
- `libs/server/importer/src/lib/record-shape.ts`, `storyly-client.ts` -- stories carry `media` and `mimeType`.
- `libs/server/importer/src/lib/worker.ts`, `migration.ts` -- media step after each tale, report counts and differences; `import_media` table.
- `apps/api/src/main.ts`, `http/media.ts`, `app.spec.ts` -- worker gets storage and the allowed addresses; integration tests.
- `apps/fake-storyly/src/*` -- media route, rewriting, Media shop fixtures, media files.
- `apps/dashboard/src/app/pages/import-job.ts`, `import-shared.ts`, `app.spec.ts` -- media row and reasons.
- `.env.example` -- `IMPORT_MEDIA_ALLOWED_ADDRESSES`.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- report and difference schema, shared media sniffing; regenerate -- AD-3.
- [x] `libs/server/storage/` -- `putStream` with temp-file cleanup; tests -- AD-11.
- [x] `libs/server/importer/` -- fetch guard, media copy, bookkeeping, worker step; unit tests for every guard and matrix row -- AD-7, AD-8, AD-11.
- [x] `apps/fake-storyly/` -- media serving, Media shop; test.
- [x] `apps/api/` -- wiring, env, integration tests (Demo shop media, Media shop failures, re-run, secrets).
- [x] `apps/dashboard/` -- media row and difference text; component tests.

**Acceptance Criteria:**
- Given the fake account, when an admin imports it, then every imported tale serves its media from `GET /tales/{id}/media` after a reload, and the report shows Media 15 source / 15 imported.
- Given Media shop, when it is imported, then the job is done, each failing story's tale exists without media, and the report lists each with its reason and no URL.
- Given a finished import, when it is run again, then no media file is added in MEDIA_DIR.

## Implementation Notes

- Assumption (story 3 is frozen): a story's `media` is a plain URL string and `mime_type` its type, as the fake fixtures have them. A non-text `media` value is `invalidUrl`; a null or absent one is left to story 6's `wrongType` / `missing` and is not counted in `media`.
- Declared type: the response `Content-Type`; when it is absent or `application/octet-stream` / `binary/octet-stream` (common on object stores), the story's `mime_type`. Then the upload rule: an accepted type whose leading bytes match. `matchesMagicNumber`, `mediaExtension` and `MEDIA_MAGIC_BYTES` moved from `apps/api/src/http/media.ts` into `@taleart/contract` (works on `Uint8Array`), and the API re-exports them, so uploads and imports share one rule.
- Storage port: `putStream(key, AsyncIterable<Uint8Array>)` opens the temp file before reading the first chunk, writes chunk by chunk, renames at the end, and removes the temp file on any failure. (A first version with `createWriteStream` could leave a temp file when the source failed before the file had opened; an integration test caught it.) Only the first ~12 bytes are held back for the type check.
- Fetch guard (`media-fetch.ts`): `node:http`/`https` with `agent: false` (no pooling, no proxy env), a `lookup` that hands the socket the already checked address (the name is resolved once per hop, so DNS rebinding cannot swap it), and a check of `socket.remoteAddress` on connect. Every resolved address must pass, not just the first. Blocked ranges use `net.BlockList`; IPv4-mapped IPv6 is checked against the IPv4 ranges (BlockList maps it), while NAT64, 6to4, Teredo and IPv4-compatible forms are refused outright. URL parsing normalises odd IPv4 notations (`2130706433`, `0x7f.1`) before the check. Credentials in the URL are refused; no auth header, cookie or token is sent.
- Limits: 3 redirects, 120 s for the whole download, 30 s idle, the per-type size from the contract (10 MB images, 100 MB videos), checked on `Content-Length` first and while streaming. These are technical bounds of this story; story 10 may tune them with concurrency.
- `IMPORT_MEDIA_ALLOWED_ADDRESSES` takes exact IP addresses only (no ranges, no names); invalid entries are logged and ignored. Tests allow exactly `127.0.0.1`, so `[::1]` and `169.254.169.254` stay blocked in the tests too.
- Bookkeeping: an importer-owned `import_media` table (project, source system, story id → tale id, media key, content type, SHA-256). A re-run skips a tale whose current key is the recorded one, with no request to the media host. A tale whose media was set in TaleArt is kept, noted and counted skipped; story 7 decides whether a changed source replaces media. Setting the media and the row happen in one transaction under the story's advisory lock (`story_media` source key); an unused downloaded file is deleted. A small race remains: an upload between the check and `setTaleMedia` inside that transaction is overwritten (the upload path does not take the importer's lock).
- Storage failures are not source failures: they fail the job with the generic message, like database errors. Cleanup failures are logged without the token and never fail the job.
- Failure messages never quote the URL (Node's error is reduced to its code). The report holds the reason only; the job row and logs hold no URL.
- The fake rewrites `https://media.example/fake/` to its own `/media/` origin when it answers lists, so the fixtures keep the documented shape. Media files under `apps/fake-storyly/src/fixtures/media/` were generated with PIL (four gradient JPEGs, PNG, two-frame GIF, WebP). The MP4 and WebM are structural only (they pass the type check but do not play): no encoder was available. New app "Media shop" (1004) covers each failure; Demo, Odd and Clean shop counts are unchanged.
- `inTransaction` moved from `worker.ts` to `transaction.ts` to be shared with `media-copy.ts`.
- Formatting: a stray repo-wide `prettier --write` was undone with a three-way merge. New files are Prettier-formatted (80 columns); edited regions of a few existing files carry Prettier wrapping where the merge took this story's side.
- Merged `autopilot/foundation` (web zones story 7, stages) before the commit; the only conflicts were the API test TRUNCATE list (now `import_media` plus `stages`) and the generated contract (regenerated).

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all succeed.

## Auto Run Result

**Summary:** Each imported tale now gets its story's image, GIF or video. The worker downloads the media URL through a guarded fetcher and streams it into the storage port. The guard allows only http/https, only public addresses (checked on every redirect and on the connected socket, so DNS rebinding cannot get round it) and at most 3 redirects, and it caps size and time. The file must pass the upload's type rule. The worker then sets the tale's media key and content type through the tales module. A failed download leaves the tale without media and adds a `mediaNotImported` difference with a reason; the job goes on. The report gains a Media row. Re-runs download and store nothing again (`import_media` bookkeeping). The fake server now serves the fixtures' media, plus a Media shop with a too-large file, wrong types, redirects to private addresses, a redirect loop and a 404.

**Files changed:**
- `libs/contract/`: `ImportReport.media`, `mediaNotImported`, `ImportMediaFailure`, `ImportDifference.reason`; shared `matchesMagicNumber` / `mediaExtension`; regenerated.
- `libs/server/storage/`: `putStream` on the port and the local adapter; tests.
- `libs/server/importer/`: `media-fetch.ts`, `media-copy.ts`, `transaction.ts` (new); `import_media` migration; stories carry `media` / `mimeType`; worker media step and report; `media-copy.spec.ts` (61 tests).
- `apps/api/`: worker gets storage and `IMPORT_MEDIA_ALLOWED_ADDRESSES`; `media.ts` re-exports the shared rules; 6 integration tests.
- `apps/fake-storyly/`: media route, URL rewriting, Media shop, media files; tests.
- `apps/dashboard/`: Media row and reason text; component test.
- `.env.example`: `IMPORT_MEDIA_ALLOWED_ADDRESSES`.

**Review:** not run (unreviewed build).

**Follow-up review recommended:** true. The SSRF guard and the streaming path are security-relevant and should get an adversarial review.

**Verification:** `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` passed for all 12 projects on the merged result, against `taleart_w3_test` (api 277, dashboard 145, server-importer 118, server-storage 14, fake-storyly 12 tests). The only warning is the dashboard bundle budget warning, which was already there.

**Residual risks:**
- Media URL shape and auth (for example signed URLs that need the token) are unconfirmed until story 3's real run.
- Downloads are sequential. A 1,000-tale import with slow media hosts may miss the 30-minute target until story 10 adds concurrency.
- A narrow race: a user upload landing between the importer's check and its update can be replaced.
- The fake's MP4 and WebM do not play in a browser.

