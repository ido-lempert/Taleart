---
title: 'Edit bar settings in the dashboard'
type: 'feature'
ticket: '5'
created: '2026-10-21'
status: 'built'
baseline_revision: '9adf4bebe0788c49cb92403673b5ee94442dbf13'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/epic-web-zones.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A bar frame always renders with the default look: `bar.schema.json` has no fields, frames cannot be edited after they are added, and the SDK ignores `settings`.

**Approach:** Contract first: add the R2 fields with their defaults to `libs/contract/frame-types/bar.schema.json`, return each frame type's JSON Schema from `GET /frame-types`, and add `PATCH /zones/{zoneId}/frames/{frameId}` that validates settings against the frame's type (AD-5). The dashboard edits a frame's settings in the drawer through a reusable form built from the schema (stories 6 and 8 reuse it). The Delivery API returns each frame's settings with schema defaults filled in, and the SDK bar renderer applies them.

## Boundaries & Constraints

**Always:**
- Bar fields exactly per R2: `shape` (`circle` | `rounded-square`, default `circle`), `size` (`small` | `medium` | `large`, default `medium`), `showTitles` (boolean, default true), `alignment` (`start` | `center`, default `start`), `gap` (integer 4–24, default 12); `additionalProperties: false`; each field has a `title` (form label) and the schema stays the single source of the defaults.
- `PATCH` body `{ settings }` replaces the frame's settings; 404 `zone_not_found` / `frame_not_found` (new code; a frame of another zone counts as not found), 400 `validation_failed` without `settings`, 400 `invalid_frame_settings` naming the field (`settings.gap must be at most 24`), 403 without access to the zone's project.
- The settings form is a standalone component driven only by the schema: string `enum` → select (labels humanised from the values), `boolean` → checkbox, `integer`/`number` → number input with min/max; unsupported fields are kept untouched; missing values show the schema default; the API's message shows in the drawer and marks the named field invalid. Primary button uses the design system's `btn--primary` (ember `#C73E1D`).
- SDK: each setting is read defensively (an invalid or missing value falls back to its default, no console output); titles hidden keeps the item's accessible name; centred alignment never clips the first item when the row overflows; bundle ≤ 50 KB gzipped.

**Never:** Theme fields or ring colours (stories 8 and 9 own the theme, per project with zone SDK overrides), banner fields (story 6), stages (story 7), a live preview (the epic does not ask for one), a DB migration (settings are JSONB), changes to zone keys, Delivery CORS or key handling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Frame types | `GET /frame-types` | each type with `key`, `label`, `schema` (bar with 5 fields and defaults) | — |
| Save valid | PATCH bar `{shape:'rounded-square', size:'large', showTitles:false, alignment:'center', gap:20}` | 200 frame with those settings; listed after reload | — |
| Gap out of range | `gap: 40` (or 3) | 400 `invalid_frame_settings`, "settings.gap must be at most 24"; stored settings unchanged | — |
| Bad enum / unknown field / non-integer | `shape:'star'`, `color:'red'`, `gap: 12.5` | 400 `invalid_frame_settings` naming the field | — |
| Missing settings | `{}` body | 400 `validation_failed` | — |
| Unknown zone / frame / other zone's frame | — | 404 `zone_not_found` / `frame_not_found` | — |
| No access | user without the project | 403 `forbidden` | — |
| Delivery defaults | bar frame stored `{}` or `{gap:20}` | settings returned with every default filled, stored values kept | unknown type returned as stored |
| Form | open settings of a bar stored `{}` | select/checkbox/number show defaults; Save sends all five | API message shown, field `aria-invalid` |
| SDK render | settings from the matrix "Save valid" row | rounded-square 80 px rings, no visible titles (names kept), centred, 20 px gap | — |
| SDK defaults | settings `{}` or junk (`gap:'x'`, `size:9`) | default bar (circle, 64 px, titles, start, 12 px) | no error |

</intent-contract>

## Code Map

- `libs/contract/frame-types/bar.schema.json` -- the R2 fields.
- `libs/contract/openapi/openapi.yaml`, `src/index.ts`, `src/generated/api.ts` -- `FrameType.schema`, `UpdateFrameRequest`, PATCH path, `frame_not_found`.
- `libs/server/zones/src/lib/frame-types.ts`, `frames.ts`, `index.ts` -- registry keeps schema and defaults (`withDefaults`), friendlier messages; `updateFrameSettings`, `FrameNotFoundError`.
- `apps/api/src/http/zones.router.ts`, `delivery.router.ts`, `errors.ts`, `app.ts` -- PATCH route, defaults in Delivery, 404 mapping.
- `apps/dashboard/src/app/settings-form.ts` (new), `create-drawer.*`, `dashboard.store.ts`, `pages/zone-detail.*` -- form, drawer kind `frameSettings`, store call, Settings button per frame.
- `libs/web-sdk/src/lib/bar.ts`, `taleart-element.ts` -- parse and apply settings.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- schema fields, OpenAPI changes, regenerate -- AD-3, AD-5.
- [x] `libs/server/zones/` -- registry schema/defaults/messages, `updateFrameSettings`; unit tests.
- [x] `apps/api/src/` -- PATCH route, Delivery defaults, error mapping; integration tests for every API matrix row.
- [x] `apps/dashboard/src/app/` -- schema-built settings form, drawer, store, zone page button; component tests for the form rows.
- [x] `libs/web-sdk/src/lib/` -- settings parsing and rendering; tests for the SDK rows and a drift test against `bar.schema.json`.

**Acceptance Criteria:**
- Given a zone with a bar frame, when a content manager sets rounded-square, large, titles hidden, centred, gap 20 in the dashboard and reloads the sample page, then the bar follows each setting.
- Given the settings drawer, when gap 40 is saved, then the API's error shows in the drawer and nothing is stored.
- Given a frame type whose schema has no fields (banner today), when the zone page shows it, then it offers no Settings button.
- Given the SDK build, when `web-sdk:size` runs, then it passes.

## Implementation Notes

- Scope: theme is not in this story. Per the epic, story 8 adds the project theme (one per project) and story 9 the zone override in the SDK configuration; the user's precedence (SDK over zone over project over defaults) belongs there. The epic has no theme per zone in the dashboard (R9: "There is no theme per frame"; the SDK configuration is the per-zone override), so nothing here anticipates one.
- Assumptions (not settled by the epic, recorded for review): cover sizes small 48 px, medium 64 px (story 1's default), large 80 px; rounded-square corner radius is a quarter of the cover size (story 8's theme `cornerRadius` may later drive it); an item is 12 px wider than its cover; enum labels are humanised values ("Rounded square", "Center"); a number field keeps the last number typed while its text is empty or unreadable, and gets its default back when left that way (blur); stored values outside a field's choices, range or type show and save as the default; no live preview, since the epic does not ask for one.
- The Delivery API sanitises and fills settings (`FrameTypeRegistry.withDefaults`: settings that are not an object read as `{}`, unknown keys and values failing their property schema are dropped, then each property's `default` fills the gaps), so clients get complete settings and a field added later reaches old frames; the Management API returns settings as stored. The SDK still reads each field defensively (`readBarSettings`) and never logs.
- `GET /frame-types` now returns each type's `schema`; the dashboard builds the form from it (`settings-form.ts`: `settingsFields`, `initialSettings`, `SettingsForm`), so story 6's banner fields show up with no dashboard code; a type with no fields offers no Settings button.
- Validation messages now say `must be at most N` / `at least N` / `must be one of: …`; the dashboard marks the field the message names (`settings.<key>`) with `aria-invalid` and links it to the error.
- `BarSettings` type added to `libs/contract` (type-only import in the SDK); drift tests in contract and web-sdk compare against `bar.schema.json`.
- Unrelated fix: the API auth test compared the session TTL as an interval, which reads "6 days 23 hours" across a daylight-saving change (it failed today, 2026-10-21); it now compares seconds.

## Plan Change Log

## Review Triage Log

### 2026-10-21 — Coordinator review
- verdicts: 4 findings, all patched.
- findings:
  - `[patch]` Delivery passed stored settings through unvalidated (out-of-range or unknown enum values, unknown keys, non-object JSONB) — `withDefaults` now sanitises per field, each property compiled on its own, then fills defaults; unit tests and a Delivery integration test with hand-stored invalid rows (gap 40, shape `star`, an extra key, an array, a stray banner key).
  - `[patch]` A stored value outside its enum stayed in form state while the select showed the first option — `initialSettings` treats out-of-enum, out-of-range and wrong-type values as missing (default, or left out when there is none); tests.
  - `[patch]` Emptying a number field deleted the key and showed blank — the last number stays in state and the input is not rebound while typing; on blur an empty or unreadable value restores the default in state and input; tests.
  - `[patch]` The refused-field mark stayed after the field changed — the form emits `changed` and the drawer clears the mark for that field (a linked signal of the error); a new save clears the old message so a repeated refusal marks the field again; test.

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size` -- expected: passes, prints the gzipped size.

**Manual checks (if no CLI):**
- Render the built SDK with a stubbed Delivery response carrying the matrix settings and inspect the bar (Playwright screenshot).

## Auto Run Result

**Summary:** `bar.schema.json` now defines the R2 fields (`shape`, `size`, `showTitles`, `alignment`, `gap` 4–24) with titles and defaults. `GET /frame-types` returns each type's JSON Schema, and the new `PATCH /zones/{zoneId}/frames/{frameId}` replaces a frame's settings after validating them against its type (400 `invalid_frame_settings` naming the field, 404 `zone_not_found` / new `frame_not_found`, 403 across projects). The Delivery API returns each frame's settings with schema defaults filled in. On the zone page each frame whose type has fields gets a Settings button that opens a drawer with a form built only from the schema (select, checkbox, ranged number), reusable by stories 6 and 8; the API's refusal shows in the drawer and marks the field. The SDK bar applies shape, size, titles (names kept for screen readers), centring (auto margins, no clipping on overflow) and gap, falling back per field to defaults.

**Files changed:**
- `libs/contract/` -- `bar.schema.json`, OpenAPI (`FrameType.schema`, `UpdateFrameRequest`, PATCH path, `frame_not_found`), regenerated types, `BarSettings`, schema test.
- `libs/server/zones/` -- registry keeps schemas and defaults (`withDefaults`), clearer messages, `updateFrameSettings`, `FrameNotFoundError`; tests.
- `apps/api/src/` -- PATCH route, Delivery defaults, 404 mapping; integration tests; DST-safe session TTL assertion.
- `apps/dashboard/src/app/` -- `settings-form.ts` (new) and spec, drawer kind `frameSettings`, `updateFrameSettings` in the store, Settings button and `settings` icon; tests.
- `libs/web-sdk/src/lib/` -- `readBarSettings`, settings-driven `renderBar`, element passes the frame's settings; `bar.spec.ts` (new) and element test.

**Verification:**
- `nx run-many -t lint test build` for the 12 projects -- passed (api 212 tests, web-sdk 75, server-zones 28, contract 15, dashboard 102).
- `nx run web-sdk:size` -- passed, 6.47 KB gzipped.
- Playwright on the sample page with a stubbed Delivery API: defaults render 64 px circles, titles, start, 12 px gap; the matrix settings render 80 px rounded squares (20 px radius), no visible titles with names kept, centred (182 px either side), 20 px gap; no console output.

**Residual risks:**
- Not reviewed yet; the dashboard drawer was checked by component tests only, not in a signed-in browser.
- Pixel sizes for small/large and the rounded-square radius are assumptions for the user to confirm.
- Parallel stories touch the same files (OpenAPI, delivery router, zone page, drawer, `ErrorCode` enum); merges need care.
