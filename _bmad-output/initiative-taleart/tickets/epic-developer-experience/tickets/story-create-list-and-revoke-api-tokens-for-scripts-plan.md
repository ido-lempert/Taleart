---
title: 'Create, list and revoke API tokens for scripts'
type: 'feature'
ticket: '1'
created: '2026-10-24'
status: built
baseline_revision: 'decc06c'
route: 'full'
route_source: 'auto'
risk: 'high'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-developer-experience/epic-developer-experience.md'
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/libs/server/access/src/lib/siteKeys.ts'
  - '{project-root}/apps/api/src/http/auth.router.ts'
warnings:
  - 'Security-sensitive: a new credential on the Management API. Review before merge.'
deferred:
  - 'Admin view of every user''s tokens and revoking another user''s token (owner may want it).'
  - 'Finer scopes than read-only / read-write (epic note: owner may refine scopes later).'
  - 'The docs page that explains tokens (story 10.2 builds the API reference around this scheme).'
---

<intent-contract>

## Intent

**Problem:** the Management API accepts only a passkey session cookie, so a script, the coming
`taleart` CLI (10.3) and the docs' Swagger UI (10.2) cannot call it.

**Approach:** personal API tokens in the `access` module, on the site-key pattern: a random secret
with its own prefix (`tat_`), shown once, stored only as its SHA-256 hash, listed by prefix, revocable.
The Management API's auth middleware accepts `Authorization: Bearer tat_…` as an alternative to the
session cookie and acts as the creating user, narrowed by the token's scope (a project list or all of
the user's projects, and read-only or read-write). The scope is applied where every project check
already happens (`canAccessProject`, `accessibleProjectIds`), intersected with the user's access
read live on every request. A dashboard page, Settings > API tokens, creates, lists and revokes them.

## Boundaries & Constraints

**Always:**
- Token format `tat_` + 32 random bytes in base64url; display prefix `tat_` + 6 characters
  (`apiTokenPrefix` in the contract, like `siteKeyPrefix`). Only the SHA-256 hash and the display
  prefix are stored (NFR-003). Any bearer text is hashed and looked up, so a wrong-form token costs the
  same query (the site-key rule), and the prefix is checked after the lookup.
- A token acts as its user: the user's role and project membership are read on every request, so a
  user who loses a project (or admin) loses it for every token at once. A token never widens access:
  its effective projects are the user's accessible projects intersected with the token's list.
- Read-only tokens may use only GET, HEAD and OPTIONS; anything else answers 403 `forbidden`.
- A revoked, expired, unknown or malformed token answers 401 `unauthenticated`, like no session,
  with `WWW-Authenticate: Bearer` and `Cache-Control: no-store`.
- Guessing is limited: failed bearer authentications count against the address's bucket (10 at once,
  refilled at 10 a minute, `rateLimitClient` of `req.ip`); when it is empty every bearer request from
  that address answers 429 `rate_limited` with `Retry-After`, before any lookup, so a lock-out is no
  oracle. Configurable (`AppAuth.tokenGuessLimit`), off with null.
- `last_used_at` is written at most once a minute per token (`API_TOKEN_LAST_USED_INTERVAL_MS`): the
  lookup reads it, and only an older or empty value triggers a conditional `UPDATE`, best effort,
  after the request is let through.
- Credential surfaces stay apart (AD-2, AD-9): the Delivery API accepts only `tas_` site keys (a
  `tat_` token is refused like any other key, 401 `invalid_site_key`); the Management API refuses a
  `tas_` site key with 401 `unauthenticated`.
- Cookie and token are never mixed: when a request carries an `Authorization` header, only that
  header is read and the session cookie is ignored, even when the header fails (no fallback). The
  cookie path keeps its CSRF protections untouched: `HttpOnly; SameSite=Strict`, CORS without
  credentials. `Authorization` joins the Management API's CORS allowed headers, which is safe since a
  bearer token is never sent by the browser on its own (it is what 10.2's Swagger UI needs).
- **What a token can never do (decision):** create, list or revoke API tokens; sign in, sign out,
  set up, join by invitation or otherwise use `/auth/*` (any request there with an `Authorization`
  header answers 403 `forbidden`); manage passkeys or sessions; create invitations (an invitation
  mints a new person's passkey); create projects unless it covers all of the user's projects and is
  read-write. Those need a passkey session. Admin-only routes stay admin-only: an admin's token keeps
  admin rights within its scope, a content manager's never gains them.
- At most 50 active tokens per user (409 `api_token_limit_reached`); name 1 to 80 characters; an
  expiry, when given, in the future; a project list of 1 to 100 distinct project ids the user can
  access now (an unknown one 400 `project_not_found`, one the user cannot access 403 `forbidden`).
- Each user sees and revokes only their own tokens; another user's token answers 404
  `api_token_not_found`, like an unknown one. A revoke keeps the row (`revoked_at`), as site keys do.
- WCAG 2.2 AA on the new page: labelled controls, errors tied to fields and announced, the shown-once
  token in a read-only field with Copy and a status message, a confirmation drawer for revoke.
- New code in new files where possible: 4.3 (quizzes) and 5.3 (user lists: targeting module, a
  user-lists router, the Audience page, OpenAPI) are built in parallel.

**Never:** storing the token or anything reversible; a token on the Delivery API; a site key on the
Management API; a token minting a token; reading the cookie when an `Authorization` header is present;
a change to the Delivery API's behaviour.

## Design

- **Contract:** `API_TOKEN_PREFIX`, `API_TOKEN_PREFIX_CHARS`, `apiTokenPrefix`, `MAX_API_TOKENS_PER_USER`,
  `MAX_API_TOKEN_NAME_LENGTH`, `MAX_API_TOKEN_PROJECTS` in `core.ts`. OpenAPI: a `token` security scheme
  (http bearer) next to `session` in the global `security`, so every Management route lists both;
  `/api-tokens` (GET list, POST create) and `/api-tokens/{tokenId}` (DELETE revoke) and
  `/projects/{projectId}/invitations` override it with `session` only. Schemas `ApiToken`,
  `CreateApiTokenRequest`, `IssuedApiToken`; error codes `api_token_not_found`,
  `api_token_limit_reached`.
- **Access module (`apiTokens.ts`):** `api_tokens` (id, user_id → users ON DELETE CASCADE, name,
  token_hash unique, prefix, all_projects, read_only, created_at, expires_at, last_used_at,
  revoked_at) and `api_token_projects` (token_id, project_id → projects, both ON DELETE CASCADE).
  `createApiToken` (per-user advisory lock for the cap), `listApiTokens`, `revokeApiToken`,
  `authenticateApiToken`, `touchApiToken`. `Caller` gains `tokenProjects`, which
  `canAccessProject` and `accessibleProjectIds` intersect with the user's access.
- **API:** `http/credentials.ts`: `requireCaller` (token or session, the rules above), `sessionOnly`,
  `requireAllProjects`, `refuseAuthorizationHeader`; `http/api-tokens.router.ts`. `authorize.ts`'s
  `caller()` carries the token's projects. `app.ts` mounts them; `projects.router.ts` guards
  invitations and project creation.
- **Dashboard:** `pages/api-tokens.ts` at `/settings/api-tokens` (rail item Settings): a create form
  (name, all projects or a checkbox list, read-only switch defaulting on, expiry select: never, 7, 30,
  90 days, 1 year), the shown-once token in a drawer with Copy, a table of tokens (name, prefix,
  scope, created, last used, expiry) and Revoke with a confirmation drawer.
- **Tests:** access unit tests with a fake db (format, hash only, cap, scope intersection, throttled
  touch); API tests in `app.spec.ts` for the verify line and every rule above; dashboard unit tests;
  a Playwright spec (`api-tokens.spec.ts`) for the flow and an `@a11y` scan of each state.

## Verify

Story verify line: create a read-only token for one project: GET of that project's zones works, a
POST is refused 403, another project answers 404/403 as for a session; revoke it: the next call is
401; the dashboard shows the token once and never again; the database holds only its hash. Then the
full lint/test/build run, `dashboard-e2e:e2e` and `dashboard-e2e:a11y`, screenshots of the page's
states and a `curl` transcript.

</intent-contract>
