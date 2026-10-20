---
title: 'Pick a frame type for a zone'
type: 'feature'
ticket: '6'
created: '2026-10-20'
status: 'built'
baseline_revision: '2cc9c77f3061de50e850c77d3ec479962a011a35'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A zone cannot show anything yet, because there is no frame. The architecture (AD-5) needs frame types to be data: a registry entry plus a JSON Schema, so new types need no migration.

**Approach:** Add frames to the zones module: a frame belongs to a zone and the zone's project, and stores a `type` key and JSONB `settings` validated against that type's schema. The frame-type registry lives in `libs/contract` as configuration. The API lists frame types and creates and lists a zone's frames. The dashboard lets a user pick a type for a zone and shows the zone's frames.

## Boundaries & Constraints

**Always:** The MVP types are `bar` and `banner`. Their schemas define no fields yet and refuse any extra property (`additionalProperties: false`); fields come with the web zones epic. A new type is added only by a registry entry and its schema file, with no migration and no code change. Frames carry `project_id NOT NULL`, copied from their zone (AD-4). Validation happens in the API on write. Errors use the standard body. Tests run only against a `_test` database.

**Never:** Render frames on a web page (web zones epic). Add stages or playbooks. Add per-type tables or columns. Invent bar or banner settings fields.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List types | `GET /api/v1/frame-types` | 200, the registry's types with key and label, including `bar` and `banner` | — |
| Add bar | `POST /api/v1/zones/{zoneId}/frames {type:"bar", settings:{}}` | 201 `{id, zoneId, projectId, type, settings}` | — |
| List frames | `GET /api/v1/zones/{zoneId}/frames` | 200, the zone's frames, oldest first | — |
| Unknown type | `type:"carousel"` not in the registry | 400 | `{error:{code:"unknown_frame_type"}}` |
| Invalid settings | `type:"bar", settings:{color:"red"}` | 400 | `{error:{code:"invalid_frame_settings"}}`, message names the failing property |
| Missing settings | body without `settings` | treated as `{}` | — |
| Unknown zone | `zoneId` not found or not a UUID | 404 | `{error:{code:"zone_not_found"}}` |
| New type by config | a test type with a required field added to the registry in a test | listed, and saves only when its required field is present | 400 `invalid_frame_settings` otherwise |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml` -- add the frame-type and frame paths and schemas, and the three new error codes; regenerate with `nx run contract:generate`.
- `libs/contract/src/index.ts` -- exports generated types and `ErrorCodes`; add the new codes and export the registry.
- `libs/contract/` -- new `frame-types/` folder: `registry.json` (key, label, schema file) and one JSON Schema per type.
- `libs/server/zones/src/lib/` -- `zones.ts`, `migration.ts`; add a `frames` table and functions here (the spine puts frames and the registry in the zones module). Reuse `Db` and `projectExists` patterns from story 11.
- `apps/api/src/http/` -- routers, `errors.ts` (`HttpError`, `errorBody`), `validation.ts`; add frame-type and frame routes and map the new module errors.
- `apps/api/src/app.spec.ts` -- integration tests against `taleart_test`; follow its structure.
- `apps/dashboard/src/app/app.ts`, `app.html` -- project and zone forms; add a frame picker per zone and the zone's frame list.
- `package.json` -- add `ajv` 8.x for JSON Schema validation.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/frame-types/` -- registry with `bar` and `banner`, empty strict schemas -- AD-5.
- [x] `libs/contract/openapi/openapi.yaml`, `libs/contract/src/index.ts` -- paths, schemas, error codes, registry export; regenerate types -- AD-3.
- [x] `libs/server/zones/src/lib/` -- `frames` table migration (zone id, project id, type, settings JSONB), create and list, settings validation with ajv against the registry -- AD-1, AD-4, AD-5.
- [x] `apps/api/src/http/` -- `GET /frame-types`, `GET` and `POST /zones/{zoneId}/frames`, error mapping.
- [x] `apps/dashboard/src/app/` -- for each zone: a type picker filled from `/frame-types`, an add button, and the zone's frames listed by type label; show the API's error message.
- [x] `apps/api/src/app.spec.ts`, `libs/server/zones/src/lib/*.spec.ts` -- cover every matrix row; the new-type row registers a test type in the test without editing the shipped registry.

**Acceptance Criteria:**
- Given a zone in the dashboard, when the user picks "bar" and adds it, then the frame is listed under the zone and survives a reload.
- Given a new entry and schema added to the registry, when the API restarts, then the type appears in the dashboard picker with no migration run.

## Implementation Notes

- Registry: `libs/contract/frame-types/registry.json` (`{types:[{key,label,schema}]}`) plus `bar.schema.json` and `banner.schema.json` (JSON Schema 2020-12, empty `properties`, `additionalProperties: false`). The contract index exports the registry file name and its TypeScript shapes (`FrameTypeRegistryEntry`, `FrameTypeRegistryFile`) rather than a static JSON import, so the dashboard bundle stays browser-safe and the registry stays editable without a code change.
- The API build copies `libs/contract/frame-types/*.json` to `dist/apps/api/frame-types` (webpack asset), and `main.ts` loads it with `loadFrameTypeRegistry` at every start; schemas are compiled with Ajv2020 at load, so a broken schema fails startup, not a write.
- `frames` table: `zone_id`, `project_id NOT NULL`, `type`, `settings jsonb`. A composite FK `(zone_id, project_id) -> zones (id, project_id)` (backed by a new unique index on zones) guarantees a frame's project is its zone's project (AD-4).
- Order of checks on POST: unknown zone (404) first, then `type` present (`validation_failed`), then registry/schema (`unknown_frame_type`, `invalid_frame_settings`, message names the failing property).
- `ajv` moved from devDependencies to dependencies (it runs in the API), and is declared in `libs/server/zones/package.json`.

## Plan Change Log

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 6 findings — high 0, medium 0, low 6, false 0, maybe-false 0
- findings:
  - `[low]` `[patch]` POST frames validated `type` before the zone, so an unknown zone with no type returned 400 instead of 404 — fixed: the route checks the zone first (`zoneExists`); new integration test for an unknown zone with an empty body.
  - `[low]` `[patch]` Dashboard `frameTypeLabel` comment said unknown types are skipped, but the code shows the raw key — fixed: comment now states the raw key is shown and the dashboard does not fail (AD-5).
  - `[low]` `[patch]` Dashboard test flushed a response the API cannot send for an empty type — fixed: it flushes 400 `validation_failed` "type is required" and asserts that message.
  - `[low]` `[patch]` Unit test "refuses invalid settings" used an unknown type — fixed: uses `bar` with a disallowed property and asserts no insert.
  - `[low]` `[patch]` Unknown-zone unit test checked only the call count — fixed: also asserts the query was not an INSERT.
  - `[low]` `[reject]` `type` is trimmed, so `" bar "` is stored as `bar` — harmless normalization of a registry key; changing it adds code for no user benefit.

## Verification

**Commands:**
- `npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones` -- expected: all succeed.
- `npm exec nx -- test api --output-style=static` -- expected: every matrix row has a passing test.

## Auto Run Result

**Summary:** Zones now hold frames. A frame stores a registry key and JSONB settings, validated with ajv against the type's JSON Schema in `libs/contract/frame-types/`. Bar and banner ship with empty strict schemas. A new type needs only a registry entry and a schema file. The dashboard has a type picker and a frame list per zone.

**Files changed:**
- `libs/contract/frame-types/` — registry and the bar and banner schemas.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts`, `src/generated/api.ts` — frame-type and frame paths, three error codes, registry file shapes.
- `libs/server/zones/src/lib/` — `frames` table (composite key ties a frame's project to its zone's), registry loader and validator, create and list, `zoneExists`.
- `apps/api/src/` — frame-type and frame routes, error mapping, registry loaded at start, build copies the registry.
- `apps/dashboard/src/app/` — picker, add button, frame list, API messages.
- `package.json`, `libs/server/zones/package.json` — `ajv` 8.x.

**Review:** 5 patches applied (all low), 0 deferred, 1 rejected (low: `type` trimming is harmless).

**Follow-up review recommended:** false. No high or medium findings were patched.

**Verification:** `nx run-many -t lint test build` for api, dashboard, contract, server-access and server-zones passed before and after the patches (api 24, server-zones 10, contract 2, server-access 2 tests; dashboard tests passed).

**Residual risks:**
- A new frame type reaches the API through the build's copy of the registry; restarting an old build without rebuilding won't pick it up.
- A POST looks up the zone twice (route and module).
- Not clicked through in a browser; the user reviews that.
