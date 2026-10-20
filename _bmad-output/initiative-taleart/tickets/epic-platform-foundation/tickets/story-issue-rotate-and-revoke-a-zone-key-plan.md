---
title: 'Issue, rotate and revoke a zone key'
type: 'feature'
ticket: '8'
created: '2026-10-20'
status: 'built'
baseline_revision: '8eb669d947569ac443bc35b98329db359dc7c141'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-platform-foundation/tickets/story-invite-a-user-to-a-project-plan.md'
warnings: ['oversized']
deferred:
  - summary: >-
      One failed per-zone request in refresh() marks the whole dashboard as API-down.
    evidence: |-
      Frames, tale groups and now zone keys are loaded per zone inside one try block in dashboard.store.ts refresh(); any failure sets apiDown.
    location: >-
      apps/dashboard/src/app/dashboard.store.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** SDKs on customer pages need a credential to read a zone's content, separate from dashboard sessions (AD-2, AD-9); there is none, and no Delivery API yet (PRD FR-003).

**Approach:** The access module issues one active key per zone: a random secret shown once and stored hashed. An admin issues, rotates (new key, old one revoked at once) or revokes it in the dashboard. A first Delivery API route at `/delivery/v1` accepts a valid key and refuses a revoked or unknown one.

## Boundaries & Constraints

**Always:**
- Key format `tak_` + 32 random bytes in base64url. Only its SHA-256 hash is stored (NFR-003), with a unique index, plus a display prefix (`tak_` and the next 6 characters).
- At most one active key per zone. Issuing while a key is active is a rotation: in one transaction the old key gets `revoked_at` and the new key is stored. Revoke sets `revoked_at`; nothing is deleted.
- Keys carry `zone_id` and `project_id` (composite foreign key to the zone, AD-4).
- Issue, rotate and revoke are admin-only (FR-003): 403 `forbidden` for content managers. Anyone with access to the project can see whether a key exists, its prefix and dates. Story 13's authorization helper guards every Management route.
- The Delivery API lives under `/delivery/v1`, accepts only a zone key in `Authorization: Bearer <key>` (never a session cookie, AD-2), answers CORS with `Access-Control-Allow-Origin: *` and no credentials, and uses the standard error body. A missing, unknown or revoked key answers 401 `invalid_zone_key`, with the same message in all three cases.
- First Delivery route: `GET /delivery/v1/zone` returns `{id, name, frames: [{id, type, settings}]}` for the key's zone. Published tale content comes with the web zones epic.
- Contract first; story 14 design system; `_test` database.

**Never:** Rate limits or quotas, key expiry, several active keys per zone, key scopes, serving tales or media through the Delivery API, using `window.confirm` (use a drawer to confirm).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No key | `GET /api/v1/zones/{zoneId}/key` | 200 `null` | unknown zone → 404 `zone_not_found` |
| Issue | admin: `POST /api/v1/zones/{zoneId}/key` | 201 `{key, prefix, createdAt}`; `key` appears only here | content manager → 403 `forbidden` |
| Key info | `GET /api/v1/zones/{zoneId}/key` after issuing | 200 `{prefix, createdAt}`, never the key or its hash | — |
| Rotate | `POST` again while a key is active | 201 new key; the old key is revoked in the same transaction | — |
| Revoke | admin: `DELETE /api/v1/zones/{zoneId}/key` | 204; info then answers `null` | no active key → 404 `zone_key_not_found` |
| Delivery, valid | `GET /delivery/v1/zone` with `Authorization: Bearer <key>` | 200 the zone and its frames | — |
| Delivery, bad key | missing header, unknown key, revoked key, rotated-out key | 401 | `invalid_zone_key` |
| Delivery, session | session cookie and no key | 401 | `invalid_zone_key` |
| Delivery CORS | `OPTIONS /delivery/v1/zone` from any origin | 204 with `Access-Control-Allow-Origin: *`, `Authorization` allowed | — |
| Dashboard | zone page "Zone key" section | admin: "Issue key" or prefix, issued date, "Rotate" and "Revoke"; the new key in a drawer with "Copy key" and "Shown only now"; Rotate and Revoke confirmed in a drawer. Content manager: info only | API message in the drawer |

</intent-contract>

## Code Map

- `libs/server/access/src/lib/` -- owns sessions and invitations with hashed tokens (`tokens.ts` for random tokens and SHA-256); add `zone_keys` and `zoneKeys.ts` (issue or rotate, revoke, info, `zoneForKey(hash)`). The composite FK targets `zones (id, project_id)` through the existing unique index `zones_id_project_id_key`; the migration order in `apps/api/src/db.ts` must put this table after zones (a separate access migration step or ordering note).
- `libs/server/zones/src/index.ts` -- `zoneProjectId`, `listFrames`; the Delivery route reads the zone and frames through these.
- `apps/api/src/app.ts` -- mounts `/api/v1` behind the session middleware and its CORS headers; mount `/delivery/v1` beside it with its own CORS and zone-key middleware, never the session middleware.
- `apps/api/src/http/authorize.ts` -- story 13's helper with `requireAdmin`.
- `apps/api/src/http/errors.ts`, `apps/api/src/app.spec.ts` -- error mapping and integration tests.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts` -- `ZoneKeyInfo`, `IssuedZoneKey`, `DeliveryZone`, Delivery server path and bearer security scheme, codes `zone_key_not_found`, `invalid_zone_key`; regenerate.
- `apps/dashboard/src/app/pages/zone-detail.*`, `create-drawer.*`, `dashboard.store.ts`, `auth.ts` (`isAdmin`) -- zone page sections and drawers from earlier stories; the invite drawer's link field and Copy button are the pattern for showing the key once.

## Tasks & Acceptance

**Execution:**
- [x] `libs/server/access/` -- `zone_keys` table, issue or rotate, revoke, info, lookup by hash; unit tests -- AD-4, AD-9, NFR-003.
- [x] `libs/contract/` -- Management and Delivery paths, schemas, codes; regenerate -- AD-2, AD-3.
- [x] `apps/api/src/` -- key routes with admin checks, `/delivery/v1` router with key middleware and open CORS, `GET /delivery/v1/zone`; tests for every matrix row.
- [x] `apps/dashboard/src/app/` -- Zone key section, issue and show-once drawer with Copy, rotate and revoke confirm drawers, role-aware; component tests.

**Acceptance Criteria:**
- Given an admin on a zone page, when they issue a key and call `GET /delivery/v1/zone` with it, then the zone and its frames come back.
- Given that key was rotated, when the old key calls the Delivery API, then it answers 401 `invalid_zone_key`, and the new key works.
- Given a revoked key, when it calls the Delivery API, then it answers 401.
- Given the database, when the zone_keys table is read, then it holds hashes and prefixes, never keys.

## Implementation Notes

- Access module: `zoneKeys.ts` with `migrateZoneKeys`, `issueZoneKey` (one transaction: `pg_advisory_xact_lock` per zone, revoke the active key, insert the new one), `revokeZoneKey` (sets `revoked_at`, `ZoneKeyNotFoundError` when none), `zoneKeyInfo`, `zoneForKey(key)` (hashes the key; refuses anything not starting with `tak_` without a query). Table `zone_keys` (`key_hash` unique, `prefix`, `created_by`, `revoked_at`, composite FK to `zones (id, project_id)`) plus a partial unique index `zone_keys_active_zone_key ON (zone_id) WHERE revoked_at IS NULL`, so the database also enforces one active key. `migrateZoneKeys` runs as its own step after zones in `apps/api/src/db.ts`.
- Zones module exports `findZone` (the Delivery route needs the zone name).
- Contract: `/zones/{zoneId}/key` (GET/POST/DELETE) and `/zone` with a path-level server `/delivery/v1` and the `zoneKey` bearer scheme; schemas `ZoneKeyInfo`, `IssuedZoneKey`, `DeliveryFrame`, `DeliveryZone`; codes `zone_key_not_found`, `invalid_zone_key`; constants `DELIVERY_API_BASE`, `ZONE_KEY_PREFIX`, `zoneKeyPrefix()`. Title is now "TaleArt API".
- API: `http/zone-keys.router.ts` (zone authorization, `requireAdmin` on POST and DELETE, 404 `zone_not_found` for an unknown zone); `http/delivery.router.ts` mounted at `/delivery/v1` after the Management API, with its own CORS (`*`, `Authorization` allowed, no credentials, OPTIONS 204) and key middleware (401 `invalid_zone_key`, one message, `WWW-Authenticate: Bearer`). Management CORS now lists DELETE.
- Dashboard: the store loads each zone's key info in `refresh()` (`zoneKeys`), `issueZoneKey` / `revokeZoneKey`; drawer kind `zoneKey` with action `issue | rotate | revoke`: confirm text, then the key once in a read-only field with "Copy key" and "Shown only now"; revoke closes on success. Zone page "Zone key" section: prefix and issue date; admins get Issue key or Rotate and Revoke. New `.btn--danger`, `.input--mono`, `.key-prefix` styles.

## Plan Change Log

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 6 findings — high 0, medium 1, low 5, false 0, maybe-false 0
- findings:
  - `[medium]` `[patch]` Revoke ran without the per-zone advisory lock, so a revoke racing a rotation could miss the new key and leave it active — fixed: revoke runs in a transaction behind the same lock; new unit and API tests.
  - `[low]` `[patch]` Unused `issuedDate` in the drawer — fixed: removed.
  - `[low]` `[patch]` Rotate and revoke confirmations showed an empty prefix when the store had no key — fixed: "the current key".
  - `[low]` `[reject]` A content manager gets 403 rather than 404 on POST/DELETE for an unknown zone — the role check comes first, as in story 13's invitations; no information leaks.
  - `[low]` `[reject]` One Delivery 401 path lacks `WWW-Authenticate` — unreachable: the composite foreign key keeps a keyed zone from disappearing.
  - `[low]` `[defer]` One failed per-zone request in `refresh()` marks the whole dashboard as down — pre-existing pattern for frames and tale groups; for the refactor sweep.

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting` -- expected: all succeed.

**Manual checks (if no CLI):**
- The parent session issues a key on the dev servers, calls the Delivery API with curl before and after rotating and revoking, and screenshots the Zone key section and the show-once drawer.

## Auto Run Result

**Summary:** The access module issues one active zone key per zone (`tak_` + 32 random bytes, stored only as a SHA-256 hash and a display prefix). Admins issue, rotate (new key, old one revoked in one locked transaction) and revoke keys from the zone page; the key is shown once with "Copy key". A first Delivery API route, `GET /delivery/v1/zone`, accepts only a valid key as a bearer token, with open CORS, and answers 401 `invalid_zone_key` otherwise.

**Files changed:**
- `libs/server/access/src/lib/zoneKeys.ts` — `zone_keys` table, issue or rotate, revoke, info, `zoneForKey`; unit tests.
- `libs/server/zones` — `findZone`.
- `libs/contract/` — key paths, Delivery path and bearer scheme, schemas, codes; regenerated.
- `apps/api/src/` — `zone-keys.router.ts`, `delivery.router.ts`, migration step, error mapping, CORS DELETE; tests.
- `apps/dashboard/src/app/` — Zone key section, issue, rotate and revoke drawers; tests.

**Review:** 3 patches applied (1 medium, 2 low), 1 deferred, 2 rejected (low: 403 before 404 for content managers; unreachable missing header).

**Follow-up review recommended:** false. One medium and no high were patched.

**Verification:** `nx run-many -t lint test build` for the eight projects passed before and after the patches (api 139, server-access 29, dashboard 64 tests). End to end against `taleart_e2e_test`: issue in the dashboard; Delivery API with the key 200, no key 401, old key after rotate 401, new key 200, key after revoke 401. Screenshots were sent to the user.

**Residual risks:**
- No rate limits on the Delivery API yet.
