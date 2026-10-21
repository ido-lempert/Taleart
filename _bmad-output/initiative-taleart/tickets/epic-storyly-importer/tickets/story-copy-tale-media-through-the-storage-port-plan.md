---
title: 'Copy tale media through the storage port'
type: 'feature'
ticket: '5'
created: '2026-10-21'
status: 'built'
baseline_revision: 'fbe2ef0'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['security']
review_loop_iteration: 0
followup_review_recommended: false
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
- `IMPORT_MEDIA_ALLOWED_ADDRESSES` (comma-separated exact `address:port` endpoints, default empty) exempts those endpoints from the public-address rule, for tests and local reviews against the fake server (`127.0.0.1:4400`). Production default allows none.
- Report: `media: {source, imported, skipped}` (source = imported tales whose story names media); a failure is `{entity: 'tale', kind: 'mediaNotImported', field: 'media', reason}` with reason one of `invalidUrl`, `blockedAddress`, `unreachable`, `timeout`, `tooManyRedirects`, `httpError`, `tooLarge`, `unsupportedType`. It draws on story 6's difference budget and caps. Neither the URL nor the token ever enters the report, the job row or the logs.
- Re-run: a tale whose current media key is the one `import_media` recorded for that tale keeps it with no download. A tale that holds media set in TaleArt is never overwritten (a note, counted skipped): the importer sets media only on a tale that holds none, in one conditional update under the tale's lock, and deletes nothing but its own unused copy. `import_media` is keyed by tale id, so source ids stay only in `import_links` (AD-7).
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
- Storage port: `putStream(key, AsyncIterable<Uint8Array>)` opens the temp file before reading the first chunk, writes each chunk until all of it is written (a short write continues), `fsync`s, closes, then renames; any failure removes the temp file. Only the first ~12 bytes are held back for the type check. The local adapter also lists keys (`listKeys`) and removes stale temp files (`removeStaleTemporaryFiles`) for the sweep; these are adapter methods, not port methods.
- Fetch guard (`media-fetch.ts`): `node:http`/`https` with `agent: false` (no pooling, no proxy env) and a `lookup` that hands the socket the already checked addresses: all of them when Node asks for all (happy eyeballs), else the first. The name is resolved once per hop, so DNS rebinding cannot swap it, and the lookup is bounded by a 10 s DNS deadline and the download signal. On connect, the socket's peer must be one of the checked addresses and pass the guard. Allowing is decided positively and fails closed: the address must parse (anything with `%`, such as a zone id, is refused). IPv4 must be outside the special ranges. IPv6 must be in `2000::/3` and outside `2001::/32`, `2001:2::/48`, `2001:10::/28`, `2001:20::/28`, `2001:db8::/32`, `2002::/16`, `3fff::/20` and `5f00::/16`; IPv4-mapped/translated, NAT64 and the rest fall outside `2000::/3`. Every resolved address must pass, not just the first. URL parsing normalises odd IPv4 notations before the check. Credentials in the URL are refused; no auth header, cookie or token is sent. A test-only `ca` policy option lets the HTTPS tests trust a local self-signed certificate (`libs/server/importer/src/lib/test-tls/`).
- Limits: 3 redirects, 120 s for the whole download, 30 s idle, 10 s per DNS lookup, and the per-type size from the contract (10 MB images, 100 MB videos), checked on `Content-Length` first and while streaming. Per import, at most 5 GB (`IMPORT_MEDIA_MAX_BYTES_PER_JOB`) and 60 min of media copying (`IMPORT_MEDIA_MAX_SECONDS_PER_JOB`). Past either limit, the rest is listed as not imported with reason `jobBudgetExceeded` and no longer requested. The defaults are assumptions; story 10 may tune them with concurrency.
- `IMPORT_MEDIA_ALLOWED_ADDRESSES` takes exact `address:port` entries (`[v6]:port` for IPv6). Host names, ranges, missing ports, and unspecified, broadcast and multicast addresses are refused. Invalid entries and any active exemption are logged at `warn`. Tests exempt exactly `127.0.0.1:<fake port>`, so other ports, `[::1]` and `169.254.169.254` stay blocked in the tests too.
- Bookkeeping: an importer-owned `import_media` table keyed by `tale_id` (project, media key, content type, SHA-256), indexed by media key. The story is known only through `import_links` (AD-7). An unreleased first shape keyed by source id is dropped by the migration. A re-run skips a tale whose current key is the recorded one, with no request to the media host. Media set in TaleArt is kept, noted and counted skipped; story 7 decides whether a changed source replaces media. The write is one transaction under the tale's advisory lock: `setTaleMediaIfNone` (new in the tales module: an `UPDATE … WHERE media_key IS NULL`), then the `import_media` row. If the update finds media already there (an upload while the download ran), the outcome is kept or imported and only the importer's own copy is deleted; no previous key is ever deleted. If COMMIT fails with an unknown outcome (`CommitUncertainError`), the copy is kept and the job fails. `sweepImportedMedia` runs when the worker starts. It removes temp files older than an hour, and imported files (`tales/imported-<uuid>.<ext>`) as old that no tale or cover references and no `import_media` row records. Uploaded files are never touched.
- Storage failures are not source failures: they fail the job with the generic message, like database errors. Cleanup failures are logged without the token and never fail the job.
- Failure messages never quote the URL (Node's error is reduced to its code). The report holds the reason only; the job row and logs hold no URL.
- The fake rewrites `https://media.example/fake/` to its own `/media/` origin when it answers lists, so the fixtures keep the documented shape. Media files under `apps/fake-storyly/src/fixtures/media/` were generated with PIL (four gradient JPEGs, PNG, two-frame GIF, WebP). The MP4 and WebM are structural only (they pass the type check but do not play): no encoder was available. New app "Media shop" (1004) covers each failure; Demo, Odd and Clean shop counts are unchanged.
- `inTransaction` moved from `worker.ts` to `transaction.ts` to be shared with `media-copy.ts`.
- Formatting: `.prettierrc` now sets `printWidth: 120` to match the codebase. The new files are formatted with it. In existing files, hunks that differ from the base only by re-wrapping were reverted, so the diff carries only real changes.
- Merged `autopilot/foundation` twice: web zones story 7 (stages) before the first commit, and web zones story 8 (project theme) after the security fixes. Conflicts were confined to the API test TRUNCATE list and the generated contract.

## Plan Change Log

## Review Triage Log

### 2026-10-21 — Coordinator security review
- verdicts: 12 findings, all patched, none rejected
- findings:
  - `[patch]` An upload landing between the check and the update could be overwritten, and its old key deleted. Fixed: `setTaleMediaIfNone` (conditional update) under the tale's lock; no previous key is ever deleted. Tests: an API test that injects an upload during the download; a unit test of the conditional path.
  - `[patch]` `import_media` stored source story ids outside `import_links` (AD-7). Fixed: it is keyed by tale id; the index.ts comment is restored. A migration test asserts that only `import_links` has `source_id`.
  - `[patch]` The pinned lookup handed over one address when Node asked for all. Fixed: all checked addresses are handed over (`pinnedLookup`), and the socket peer must be one of them. The fake server binds `127.0.0.1` explicitly. Unit test.
  - `[patch]` The guard decided "blocked" and fell through to allowed. Fixed: `isPublicAddress` decides positively, refuses zone ids and anything that does not parse, and serves both the pre-connect check and the socket re-check. Tests.
  - `[patch]` The IPv6 blocklist was incomplete. Fixed: an allowlist of `2000::/3` minus the special ranges listed in the notes. One test per range.
  - `[patch]` The allow list took bare IPs and logged at info. Fixed: exact `address:port` entries; unspecified, broadcast and multicast addresses and host names are refused; logged at warn. Docs name only `127.0.0.1:4400`. Tests.
  - `[patch]` DNS lookups were unbounded. Fixed: bounded by `dnsTimeoutMs` and the download signal. Test with a resolver that never answers.
  - `[patch]` No per-import limits. Fixed: per-job bytes and time limits (env-configurable) with the new reason `jobBudgetExceeded`; once spent, the rest is not requested. Unit tests and an API test.
  - `[patch]` `putStream` ignored short writes and did not sync. Fixed: a write loop, then `fsync`, then rename, keeping the temp cleanup. Test with a stub handle that writes 3 bytes at a time.
  - `[patch]` A failed COMMIT could delete a file a committed tale points at. Fixed: `CommitUncertainError` keeps the copy; a conservative sweep at worker start clears stale temp files and old unreferenced imported files. Unit, storage and API tests.
  - `[patch]` No HTTPS coverage. Fixed: local TLS server tests (a self-signed certificate trusted only through the test `ca`). SNI and Host keep the host name while the connection goes to the pinned address; an untrusted certificate fails; the guard still blocks.
  - `[patch]` Re-wrap noise from an 80-column Prettier run. Fixed: `printWidth: 120`, new files reformatted, and re-wrap-only hunks in existing files reverted.

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
- `libs/server/tales/`: `setTaleMediaIfNone` (conditional media update); tests.
- `libs/server/importer/src/lib/test-tls/`: self-signed certificate for the HTTPS tests only.
- `.prettierrc`: `printWidth: 120`.
- `.env.example`: `IMPORT_MEDIA_ALLOWED_ADDRESSES`.

**Review:** coordinator security review, 12 findings, all patched (see Review Triage Log).

**Follow-up review recommended:** false. The security findings are patched and tested.

**Verification:** after the security fixes and the merge of `autopilot/foundation` (b736f45, web zones story 8), `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` passed for all 12 projects against `taleart_w3_test`: api 306, dashboard 187, server-importer 143, server-tales 67, server-storage 16, fake-storyly 12 tests. The only warning is the dashboard bundle budget warning, which was already there.

**Residual risks:**
- Media URL shape and auth (for example signed URLs that need the token) are unconfirmed until story 3's real run.
- Downloads are sequential. A 1,000-tale import with slow media hosts may miss the 30-minute target until story 10 adds concurrency.
- A per-import media budget that runs out leaves the rest of the tales without media. A re-run picks them up, since tales without media are retried.
- The fake's MP4 and WebM do not play in a browser.

