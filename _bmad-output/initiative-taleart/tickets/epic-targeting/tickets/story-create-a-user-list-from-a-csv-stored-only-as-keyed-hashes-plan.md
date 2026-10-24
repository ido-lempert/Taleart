---
title: 'Create a user list from a CSV, stored only as keyed hashes'
type: 'feature'
ticket: '3'
created: '2026-10-24'
status: built
baseline_revision: '846839b'
route: 'full'
route_source: 'auto'
risk: 'high'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-targeting/epic-targeting.md'
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/libs/server/access/src/lib/siteKeys.ts'
  - '{project-root}/apps/api/src/http/project-media.router.ts'
warnings:
  - 'No project-delete operation exists yet: "deleting a project deletes its lists" is carried by ON DELETE CASCADE from projects, checked with a direct DELETE in the API tests.'
deferred:
  - 'The groups a list targets (story 4), Replace, Remove by CSV, Empty and Erase a person (story 5).'
  - 'Rotating a project secret in place: impossible without the raw IDs; a project gets a new secret only once it holds no list.'
  - 'An installation-level key over the per-project secret (epic R5 note), if the owner wants protection against a full database leak.'
---

<intent-contract>

## Intent

**Problem:** a content manager cannot yet name the viewers a tale group is for. Story 4 matches the
external user ID the host passes against user lists; nothing stores those lists, and the epic's
privacy rules (R5) must hold from the first row written.

**Approach:** the targeting module gets a per-project secret, user lists and their IDs stored only as
HMAC-SHA-256 of the trimmed ID under that secret. The Management API creates, renames, lists and
deletes lists and takes a single-column CSV upload streamed from the request into the database in
one transaction, reporting added, already present and refused rows (first refused line numbers and
why) and how many values look like emails or phone numbers. No ID is ever written in clear, logged,
echoed or kept. The dashboard gets an Audience page with a User lists tab.

## Boundaries & Constraints

**Always:**
- Owner decisions, exactly: HMAC-SHA-256 with a per-project random secret; counts only, the IDs are
  never listed or exported; no ID in logs, error reports or API responses; the CSV is streamed and
  not kept; hard deletes in one transaction; deleting a project deletes its lists (cascade);
  100 lists per project, 1,000,000 rows and 50 MB per CSV, 256 characters per ID; the dashboard warns,
  but does not refuse, when most values look like emails or phone numbers.
- An upload is all or nothing: over 1,000,000 rows, over 50 MB, not UTF-8, cut short or failing
  midway rolls back, so a list never holds half a file.
- Parsing never buffers the file: lines are cut from the stream, hashed and inserted in batches with
  back-pressure; the ID strings are dropped once hashed. Error objects carry line numbers, never values.
- The secret never leaves the targeting module: no route returns it, and it is not in any log.
- Hashes are compared by the database's unique index (exact bytes); any in-process comparison of a
  hash or secret uses `timingSafeEqual`.
- Uploads reuse the media route's shape: checked before the body is read (role, concurrency cap,
  project, list, type, Content-Length, size) and refused with `Connection: close`.
- Project-scoped (AD-4): every table carries `project_id`; the list key is (id, project_id).

**Never:** a change to the Delivery API, the Web SDK, `delivery-rule.ts`, Tale Studio, the SDK
renderers or the interactive module (story 4.2 runs in parallel); an ID in a response, a log line or
an error message; a soft delete; keeping the CSV on disk or in memory.

## Design

- **Contract:** OpenAPI `UserList` (id, projectId, name, idCount, createdAt, updatedAt),
  `CreateUserListRequest`, `RenameUserListRequest`, `UserListUploadReport` (added, alreadyPresent,
  refused, refusedLines [{ line, reason }] up to 10, emptyRows, emailLike, phoneLike, idCount),
  five paths under `/projects/{projectId}/user-lists`, codes `user_list_not_found`,
  `user_list_exists`, `user_list_limit_reached`, `user_list_file_too_large`. `src/lib/user-lists.ts`:
  the limits, `normalizeUserListName`, `externalUserIdRefusal` (empty, too long, control character),
  `looksLikeEmail`, `looksLikePhone` (a `+` or phone separators with 7 to 15 digits; plain digit
  strings are not flagged, they are common opaque IDs), `contactLikeWarning(counts)` (more than half).
- **Targeting module:** tables `user_list_secrets` (project, 32 random bytes, cascade with the
  project), `user_lists` (name unique per project ignoring case, id_count, timestamps, cascade with
  the project) and `user_list_ids` (list, project, 32-byte hash; primary key (list, hash), cascade
  with the list and the project). `user-lists.ts`: `listUserLists`, `createUserList` (limit under a
  project lock), `renameUserList`, `deleteUserList` (one transaction; the project's secret goes with
  its last list), `addUserListIds` (public interface for importer story 2.12, takes an iterable of
  IDs) and `addUserListRows` (the CSV path), both inserting `ON CONFLICT DO NOTHING` in batches in one
  transaction under the list's row lock and a shared project lock. `user-list-csv.ts`: a streaming
  parser (BOM, LF/CRLF/CR, one field, quoted with `""`, optional header row, fatal UTF-8 decoder, row
  and byte caps). `hashExternalUserId(secret, id)` and `sameHash` (timing-safe).
- **API:** `user-lists.router.ts` mounted at `/projects`; the JSON parser skips the upload path; the
  error handler maps the new errors; at most 2 uploads per process at once (429 `upload_busy`).
- **Dashboard:** a rail item Audience, route `/audience` for the selected project, a tablist with one
  tab User lists (story 6 adds Segments): each list with its name, ID count and last change, and Add
  IDs, Rename, Delete. New user list drawer (name, optional CSV, header checkbox); the upload drawer
  reads the first 64 KB of the chosen file and warns before sending when most values look like emails
  or phone numbers, then shows the report (and the server's warning) after; delete is an alert dialog
  naming the list and its count.
- **Tests:** contract unit tests; targeting unit tests (parser cases, hashing, migration SQL);
  API tests on the database (the verify CSV, emails, limits, no ID in the dump, the responses or the
  captured log, delete leaves no row, project delete cascades, roles, access, busy); dashboard unit
  tests; a Playwright spec for the page, plus the page in the a11y scan; a 1,000,000-row run with time
  and memory against the API.

## Verify

Story verify line: upload a 10-row CSV with a duplicate, an empty row and a 300-character value: the
list shows 8 IDs and the report names the refused line; a CSV of emails shows the warning and the list
is created; a database dump and the API log contain none of the uploaded IDs in clear; delete the
list: no row of it remains; delete a test project with a list: none of its lists or hashes remain.
Then the full lint/test/build run, `dashboard-e2e:e2e` and `dashboard-e2e:a11y`.

</intent-contract>
