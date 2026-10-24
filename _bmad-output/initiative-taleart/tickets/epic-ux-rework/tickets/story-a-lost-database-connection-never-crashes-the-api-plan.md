---
title: 'A lost database connection never crashes the API'
type: 'bugfix'
ticket: '24'
created: '2026-10-24'
status: built
baseline_revision: '0a1ab20'
route: 'full'
route_source: 'auto'
risk: 'medium'
context:
  - '{project-root}/libs/server/access/src/lib/db.ts'
  - '{project-root}/libs/server/targeting/src/lib/user-lists.ts'
  - '{project-root}/libs/server/importer/src/lib/transaction.ts'
  - '{project-root}/libs/server/importer/src/lib/jobs.ts'
  - '{project-root}/libs/server/tales/src/lib/tale-media-document.ts'
  - '{project-root}/apps/api/src/db.ts'
warnings:
  - 'A session the database ends during COMMIT leaves the outcome unknown; the shared inTransaction throws the error as before (the importer keeps its CommitUncertainError).'
deferred:
  - 'Retrying a request whose connection was lost: the request fails (500) and the client retries; nothing is retried in the server.'
---

<intent-contract>

## Intent

**Problem:** a pg client checked out of the pool has no `error` listener while it is out (the pool's
own listener is attached only while the client is idle). When the database restarts, fails over, or
`pg_terminate_backend` ends that session, pg emits `error` on the client and Node exits. Story 5.3
fixed this for the user-list upload only (`uploadTransaction`); the shared `inTransaction` (about 35
call sites), the importer's transaction and job-claim clients, the migration runner and the
tale-media continuation's lock holder still check clients out bare.

**Approach:** one helper in server-access, `withClient`, is the only way a client is checked out.
It attaches an `error` listener for as long as the client is out, keeps the first error, makes every
later query on that client fail with it, releases a broken client with the error so the pool drops
it, and removes the listener before release. `inTransaction` (server-access), the importer's
`inTransaction` and `claimNextJob`, `uploadTransaction`, `migrate` and the continuation's holder are
built on it. The holder checks its session before each batch: a lost session ends the pass cleanly
(its lock went with the session) and the next attempt takes the lock again on a new connection.

## Boundaries & Constraints

**Always:**
- No code path outside `withClient` calls `connect()` on a pool (`grep connect(` in libs and
  apps/api/src, outside tests, finds only the helper).
- A broken client is never returned to the pool: it is released with its error.
- The listener is removed before release, so a released client has only the pool's listener.
- Works with the fakes tests pass as a `TransactionalDb` (clients without `on`/`off`).
- A request whose connection is lost fails with 500 `internal_error`; the process keeps serving and
  the next request gets a fresh connection.
- A lost migration-lock session at start fails `migrate` with its error (the API does not start, as
  with any migration failure); the continuation's lost lock fails that pass, which is retried with
  the lock taken again.
- Public contract descriptions name no epic, story or AD number.

**Never:** a change to routes' behaviour beyond the lost-connection case; a retry of user work in the
server; touching the dashboard (11.4 runs in parallel).

## Design

- **server-access `db.ts`:** `TransactionalDb.connect()` returns a `CheckoutClient` (query, release,
  optional `on`/`off`). `withClient(db, work, { discardOnError? })` passes `work` a
  `CheckedOutClient` (`query`, `lost(): Error | null`, `assertUsable()`, `discard(reason)`); on
  return or throw it removes the listener and releases the client, with the lost error, else with
  the discard reason (or the work's error under `discardOnError`), else plainly. `inTransaction` =
  `withClient` + BEGIN/COMMIT and `rollback(tx)`, which skips ROLLBACK on a lost client and discards
  one that cannot roll back. `DbConnection` becomes query-only (a session the helper owns). All
  exported from the module's index. A unit test fails if any server source calls `connect()`
  outside the helper.
- **importer:** `transaction.ts` and `claimNextJob` use `withClient`; `CommitUncertainError` stays.
- **targeting:** `uploadTransaction` becomes the shared `inTransaction` (its listener logic moves
  into the helper); the 408 description says the connection is reset, usually before any answer.
- **tales:** the continuation's holder is a `withClient` client; each batch first checks
  `holder.assertUsable()`; a lost holder ends the pass with `MigrationLockLostError`, which is not
  mistaken for an ended pool.
- **api `db.ts`:** `migrate` runs on `withClient(pool, …, { discardOnError: true })`.
- **Tests:** server-access unit tests on a fake client (listener attached and removed, lost client
  discarded, later queries fail, rollback skipped). API tests on the database that end the session
  with `pg_terminate_backend` (only backends of the test database, never the test's own) while it is
  in use: a request in the shared `inTransaction` (held on an advisory lock), a user-list upload
  mid-file, an import's own transaction and the import worker's claim (each held on a table lock),
  `migrate` holding the migration lock, and the
  continuation's lock holder; each shows the work failing cleanly, the process serving (`/health`)
  and the next request or pass succeeding.

## Verify

Story verify line: a test terminates the backend while each kind of checked-out client is in use;
the request fails cleanly, the API keeps serving, and the pool recovers; the migration lock holder
survives a terminated session by re-acquiring or failing the migration cleanly. Then the full
lint/test/build run and `api:import-scale`.

## Review fixes (2026-10-24)

- **Lost is decided early and broadly:** pg rejects the query in flight first and emits `error`
  after, so a query failing with SQLSTATE class 57P, 08 or 25P03 (`isSessionEndedError`, exported)
  marks the client lost at once with that first error; a work error with such a code, or a client
  pg marks `_queryable = false`, is also released with an error. A cancelled statement (57014) is
  not. `CheckedOutClient.signal` aborts when the client is lost.
- **migrate** reports the original cause (57P01), not the follow-up "Connection terminated" of
  its unlock, which is skipped on a lost client.
- **Importer:** a session already lost before COMMIT throws its stored error, not
  `CommitUncertainError` (COMMIT was never sent).
- **Continuation:** "the pool ended" is read from the pool's `ending`/`ended` state, never from an
  error's text; `MigrationLockLostError` (with the cause) is thrown whenever the holder is lost,
  also when the pass itself threw; the pass stops on `AbortSignal.any([signal, holder.signal])`.
- **`apps/api/scripts/tale-media-rollback.mjs`** gets a pool `error` listener and one on its
  checked-out client (a lost client is dropped, its error thrown); the guard test scans `.mjs` and
  `.ts`, catches `connect(` with or without a callback, and checks the script's listeners.
- **Tests:** every blocker is rolled back and released with `true` in `finally`; `waitForBackend`
  gives up after 4 s and the tests set 20 s (30 s for the import) timeouts; the migration test
  always ends its pool and blocker and checks the 57P01 message; a new test closes the holder's
  socket without a FATAL; a unit test follows pg's real order (reject, then `error`).

</intent-contract>
