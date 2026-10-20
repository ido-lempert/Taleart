---
title: 'Set up the first admin and sign in with a passkey'
type: 'feature'
ticket: '7'
created: '2026-10-20'
status: 'built'
baseline_revision: 'e800a749dfbfc04e186673cf0127f898223743ca'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Anyone who can reach the API can read and change everything; there are no users. The user decided (2026-10-20): the first user is the admin, later users join only by an admin's invitation (story 13), and everyone signs in with a passkey, with no passwords (AD-9).

**Approach:** The access module gains users, passkeys and sessions. On an empty install the dashboard shows a setup screen that registers the first admin's passkey (WebAuthn); afterwards a sign-in screen authenticates with a passkey and starts a server-side session in an http-only cookie. Every Management API route except health and auth needs that session.

## Boundaries & Constraints

**Always:**
- WebAuthn through `@simplewebauthn/server` and `@simplewebauthn/browser` 14.x (MIT). Relying party name "TaleArt"; `RP_ID` and `RP_ORIGIN` from env, defaulting to `localhost` and `http://localhost:4200`. User verification required; resident (discoverable) keys required, so sign-in needs no email.
- Challenges are single-use and expire after 5 minutes; they are stored server-side and found through an http-only cookie, never trusted from the request body.
- Setup works only while the `users` table is empty, serialized with a transaction-scoped advisory lock, so two people racing setup cannot both become admin. After that, setup answers 409 `setup_closed`.
- Session token: 32 random bytes, sent as cookie `taleart_session` (`HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` when `RP_ORIGIN` is https), stored only as its SHA-256 hash (NFR-003); expires 7 days after creation. Sign-out deletes the row and clears the cookie.
- Every `/api/v1` route except `GET /health` and `/auth/*` answers 401 `unauthenticated` without a valid session. Media GET needs it too (the dashboard loads media through the same origin).
- The dashboard calls the API through the existing dev proxy (`apps/dashboard/proxy.conf.json`), so `API_BASE` becomes the relative `/api/v1` and cookies are same-origin. CORS stays for other callers but never with credentials.
- Users have `role` `admin` or `content_manager`; this story creates only the admin. Passkey public keys and counters are stored; the signature counter is checked and updated.
- Module rules, contract first, story 14 design system, standard error body, `_test` database.

**Never:** Passwords, email links, open sign-up, invitations (story 13), project membership or role checks on content routes (story 13), account recovery, or more than one passkey per user in the UI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| State, empty install | `GET /api/v1/auth/state` | 200 `{setupRequired: true, user: null}` | — |
| Setup options | `POST /auth/setup/options {name, email}` while no users | 200 WebAuthn creation options; challenge cookie set | blank name or invalid email → 400 `validation_failed` |
| Setup verify | `POST /auth/setup/verify` with the authenticator response | 201 `{user}` with role `admin`; session cookie set | bad or expired challenge, failed verification → 400 `passkey_failed` |
| Setup after admin exists | options or verify when a user exists | 409 | `setup_closed` |
| Sign-in options | `POST /auth/sign-in/options` | 200 request options (no allowCredentials); challenge cookie set | — |
| Sign-in verify | authenticator response for a stored passkey | 200 `{user}`; session cookie set; counter updated | unknown credential or failed verification → 401 `passkey_failed` |
| State, signed in | `GET /auth/state` with session | `{setupRequired: false, user: {id, name, email, role}}` | — |
| No session | any other `/api/v1` route | 401 | `unauthenticated` |
| Expired or signed-out session | cookie of a deleted or expired session | 401 | `unauthenticated` |
| Sign out | `POST /auth/sign-out` | 204; session row deleted; cookie cleared | — |
| Dashboard | not signed in | `/setup` when setup is required, else `/sign-in`; after success, back to the page asked for | the API's message in the form |

</intent-contract>

## Code Map

- `libs/server/access/src/lib/` -- owns `projects` (`migration.ts`, `projects.ts`, `db.ts` with the `Db` type); add `users`, `passkeys`, `sessions`, `auth_challenges` tables and the user, passkey, session and challenge functions here (architecture: access owns users and sessions). Wrap `@simplewebauthn/server` behind a small `PasskeyVerifier` interface so API tests can inject a fake verifier.
- `libs/server/tales/src/lib/tales.ts` -- `inTransaction` and the advisory-lock pattern to copy for setup.
- `apps/api/src/app.ts` -- `createApp(pool, frameTypes, storage)`, CORS headers, router mounting; add cookie parsing (`cookie` package or a small parser), an auth router at `/auth`, and a session middleware before every other router except health. Add a `PasskeyVerifier` parameter (real one in `main.ts`).
- `apps/api/src/http/errors.ts`, `validation.ts` -- error mapping and body validation.
- `apps/api/src/app.spec.ts` -- every existing test now needs a session: add a helper that creates a user and a session directly through the access module and sends the cookie; keep all existing tests passing.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- auth paths, `User`, `AuthState`, codes `unauthenticated`, `setup_closed`, `passkey_failed`; regenerate.
- `apps/dashboard/src/app/dashboard.store.ts` -- `API_BASE` (`http://localhost:3333/api/v1` → `/api/v1`), `API_ORIGIN` for media URLs.
- `apps/dashboard/src/app/app.routes.ts`, `app.html`, `app.ts` -- add `setup` and `sign-in` routes outside the shell, an auth guard on the shell routes, a 401 interceptor that sends the user to sign-in, and the signed-in user's name with a "Sign out" action in the top bar.
- `apps/dashboard/proxy.conf.json` -- already proxies `/api` to `:3333`.

## Tasks & Acceptance

**Execution:**
- [x] `libs/server/access/` -- tables, user, passkey, session and challenge functions, `PasskeyVerifier` with the simplewebauthn adapter, unit tests -- AD-9, NFR-003.
- [x] `libs/contract/` -- auth paths, schemas, codes; regenerate -- AD-3.
- [x] `apps/api/src/` -- auth router, session middleware, cookies, env config, error mapping; existing tests run with a session; new tests for every matrix row with a fake verifier.
- [x] `apps/dashboard/src/app/` -- relative `API_BASE`, setup and sign-in pages (story 14 styling, centered card with the TaleArt mark), guard, 401 handling, user menu with sign-out; component tests.
- [x] `package.json` -- `@simplewebauthn/server`, `@simplewebauthn/browser` 14.x.

**Acceptance Criteria:**
- Given an empty database, when a user opens the dashboard, then the setup screen asks for name and email and registers a passkey, and the user lands on Zones signed in as admin.
- Given an admin exists, when the user signs out and opens the dashboard, then the sign-in screen offers "Sign in with a passkey", and the setup screen is no longer reachable.
- Given no session cookie, when any content route of the API is called, then it answers 401 `unauthenticated`.
- Given the database, when the sessions table is read, then it holds token hashes, never tokens.

## Implementation Notes

- Access module: `users` (with a random base64url `webauthn_user_id` user handle), `passkeys`, `sessions` (`token_hash` = hex SHA-256), `auth_challenges` (id is the cookie value; purpose, challenge, pending setup data as jsonb, `expires_at`). Flows `startSetup`/`finishSetup`/`startSignIn`/`finishSignIn` live in `libs/server/access/src/lib/auth.ts`; setup re-checks inside a transaction holding `pg_advisory_xact_lock(hashtextextended('access:setup', 0))`. `inTransaction` was copied into `access/db.ts` (tales keeps its own).
- The user row is created at setup verify with a DB-generated id (AD-7); the name, email and user handle wait in the challenge row until then.
- Counter rule: besides simplewebauthn's own check, `finishSignIn` refuses a counter that did not grow when either side is non-zero, so the fake verifier can test it. A response whose `userHandle` belongs to another user is refused.
- `createApp(pool, frameTypes, storage, { verifier, secureCookies? })`. `main.ts` builds `SimpleWebAuthnVerifier` from `RP_ID`/`RP_ORIGIN` (`apps/api/src/auth-config.ts`). Cookies are parsed by a small helper (`http/cookies.ts`), no new dependency. The challenge cookie is scoped to `Path=/api/v1/auth`, `Max-Age=300`.
- Session middleware is mounted after `/health` and `/auth`, so unknown `/api/v1` routes without a session also answer 401 (not 404). OPTIONS preflight stays open.
- Dashboard: shell routes sit under a componentless parent with `canActivateChild: [authGuard]`; `/setup` and `/sign-in` carry `data.bare` and render without the shell. Data loads from an effect once `AuthStore.user()` is set (no more refresh on init). If `/auth/state` cannot be reached, the guard lets the shell show its "Could not reach the API" banner. WebAuthn browser calls are behind `PasskeyClient` so component tests fake them.

## Plan Change Log

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 3 findings — high 0, medium 0, low 3, false 0, maybe-false 0
- findings:
  - `[low]` `[patch]` After a 401 during `refresh()`, its `finally` set `loaded` on the reset store, so pages flashed empty or not-found after the next sign-in — fixed with the next row: a generation counter bumped by `reset()`; a stale refresh writes nothing; new test.
  - `[low]` `[patch]` GETs resolving after `reset()` could refill the store while signed out — fixed by the same generation counter.
  - `[low]` `[patch]` `RP_ID` and `RP_ORIGIN` were listed nowhere, against the architecture's one `.env.example` rule — fixed: `.env.example` lists every API variable with its default.

## Design Notes

Setup and sign-in screens: full-height canvas, a 400px white card centered, TaleArt mark and wordmark at the top, a heading ("Set up TaleArt" / "Sign in"), one short line of help ("Your passkey is stored on this device or in your password manager."), the form, and one primary button. Errors show in the card with the `.form-error` style. Browsers without WebAuthn get a clear message instead of a broken button.

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage` -- expected: all succeed.

**Manual checks (if no CLI):**
- The parent session runs setup and sign-in in Chromium with a CDP virtual authenticator against the dev servers, using a fresh database, and screenshots both screens.

## Auto Run Result

**Summary:** The access module owns users, passkeys, sessions and short-lived WebAuthn challenges. On an empty install the dashboard's setup screen registers the first admin's passkey; afterwards everyone signs in with a passkey (no passwords), getting a server-side session in an http-only `SameSite=Strict` cookie whose token is stored only as a SHA-256 hash. Every Management API route except health and auth needs the session (401 `unauthenticated`). The dashboard reaches the API through the dev proxy, has setup and sign-in pages, a guard, 401 handling and sign-out.

**Files changed:**
- `libs/server/access/src/lib/` — users, passkeys, sessions, challenges, setup with an advisory lock, `PasskeyVerifier` with the simplewebauthn adapter; unit tests.
- `libs/contract/` — auth paths, schemas, three error codes, cookie names; regenerated.
- `apps/api/src/` — auth router, session middleware, cookies, `auth-config.ts`; all existing tests now run with a session; auth tests with a fake verifier.
- `apps/dashboard/src/app/` — relative `API_BASE`, `auth.ts` (store, guards, interceptor), setup and sign-in pages, user name and sign-out in the top bar, refresh generation guard; tests.
- `package.json`, `package-lock.json` — `@simplewebauthn/server` and `@simplewebauthn/browser` 14.x.
- `.env.example` — every API variable with its default.

**Review:** 3 patches applied (all low), 0 deferred, 0 rejected.

**Follow-up review recommended:** false. No high or medium findings were patched.

**Verification:** `nx run-many -t lint test build` for the seven projects passed before and after the patches (api 99, server-access 13, dashboard 41 tests). The implementer ran setup, sign-out, the closed setup screen and passkey sign-in end to end in Chromium with a CDP virtual authenticator against a separate database; screenshots of setup and sign-in were sent to the user.

**Residual risks:**
- The relative `API_BASE` needs something serving `/api` on the dashboard's origin in production; only the dev proxy does today.
- The setup race test cannot force both requests to meet inside the lock.
- The database `taleart_passkey_manual`, left by the manual run, is not dropped (autopilot may not delete data outside `_test` databases).
