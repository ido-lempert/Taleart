---
title: 'Set the project theme in the dashboard'
type: 'feature'
ticket: '8'
created: '2026-10-21'
status: 'built'
baseline_revision: 'ba22a80bb6a2a17e17aad34fcf0f2ad164b13c6a'
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
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Bar, banner and viewer render in hard-coded colours, ring, radius and font; a project cannot style its zones (R9).

**Approach:** Contract first: a theme schema (`ThemeSettings`, partial; `Theme`, complete) with TaleArt's default theme and the validation and contrast helpers in `libs/contract`. The zones module stores one theme per project (`project_themes`); the Management API reads and replaces it; the Delivery API returns the zone's project theme with defaults filled in. A Theme page in the dashboard edits it with colour pickers and warns when a colour pair fails WCAG contrast. The SDK re-validates the theme and applies it through CSS custom properties inside its Shadow DOM.

## Boundaries & Constraints

**Always:**
- Fields exactly per R9: `ringStyle` (`gradient` | `solid` | `none`), `ringColors` (1–3 colours), `seenRingColor`, `ringWidth` (integer 1–4 px), `cornerRadius` (integer 0–32 px), `fontFamily` (CSS font-family list), `titleColor`, `backgroundColor`, `accentColor`. Colours are strict `#rrggbb`; `fontFamily` matches a safe pattern (comma-separated names of letters, digits, spaces and hyphens, optionally in single or double quotes; at most 200 characters); unknown fields are refused. One validator in `libs/contract` serves server and dashboard; the SDK keeps its own copy (type-only contract imports) with a drift test.
- Default theme (TaleArt's look) passes WCAG 2.2 AA: title text vs background ≥ 4.5:1, ring colours, seen ring vs background ≥ 3:1, accent vs the viewer's black ≥ 3:1 (tested).
- Storage: `project_themes (project_id uuid NOT NULL PRIMARY KEY REFERENCES projects, theme jsonb, updated_at)` in the zones module, created idempotently; only the fields set are stored.
- `GET /api/v1/projects/{projectId}/theme` → `ProjectTheme { projectId, theme (stored fields), resolved (complete) }`; `PUT` same path, body `ThemeSettings`, replaces the stored theme (`{}` resets to defaults). 400 `invalid_theme` (new code) naming the field (`theme.ringWidth must be at most 4`), nothing stored; 404 `project_not_found`; 403 without access. Content managers may edit.
- Delivery: `DeliveryZone.theme` (required, complete); stored values that fail validation (hand-written rows) are replaced field by field by defaults.
- SDK: theme values reach the DOM only through `style.setProperty` of `--ta-*` custom properties on a wrapper inside the Shadow DOM that also holds the viewer; a missing or invalid field uses its default silently. Bar: ring background (gradient of the colours / first colour / none), seen ring, ring width, rounded-square radius, title colour and font, background; banner: viewport radius, background, font, dots in the title colour; viewer: font, accent on progress fill and control icons. Bundle ≤ 50 KB gzip.
- Dashboard (story 14 design system): "Theme" link on each project card → page `projects/:projectId/theme` with a select for ring style, 1–3 ring colour pickers (add/remove), colour pickers for the other colours (each with a hex text field), number inputs for width and radius, a font text field, Save and "Reset to TaleArt default"; contrast warnings (`role=status`) name the failing pair and its ratio; the API's refusal shows and marks the field.

**Never:** SDK configuration overrides (story 9), theme per zone or frame, refusing a theme for low contrast (warn only), loading fonts, `url()`/arbitrary CSS values, inline `<style>` text built from theme values, new npm packages, changes to zone keys, Delivery CORS or key handling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Read unset | project with no theme | 200 `theme {}`, `resolved` = default | — |
| Save valid | PUT `{ringStyle:'solid', ringColors:['#0055ff'], cornerRadius:0, fontFamily:'Georgia, serif'}` | 200 stored fields; resolved fills the rest | — |
| Reset | PUT `{}` | 200 `theme {}` | — |
| Bad colour | `titleColor:'red'`, `'#12345'`, `'#123456;x'`, `ringColors:[]` / 4 items | 400 `invalid_theme` naming field; unchanged | — |
| Bad range / type | `ringWidth:5`, `cornerRadius:-1`, `ringWidth:2.5`, `ringStyle:'dots'` | 400 `invalid_theme` naming field | — |
| Bad font / unknown / not object | `fontFamily:'a;}b{'`, `'url(x)'`, `size:1`, body array | 400 `invalid_theme` | — |
| Access | unknown project / other project | 404 `project_not_found` / 403 | — |
| Delivery | stored partial; none; hand-written junk row | `theme` complete with defaults; junk fields replaced | — |
| Migration | run twice | table once | — |
| SDK apply | delivered theme solid `#0055ff`, radius 0, Georgia | `--ta-ring` `#0055ff`, `--ta-radius` 0px, `--ta-font` set on wrapper | — |
| SDK invalid / missing | `theme` absent, or `titleColor:'red;x'`, `ringWidth:9` | defaults per field | no log |
| SDK none | `ringStyle:'none'` | ring and seen ring transparent, width 0 | — |
| Dashboard load/save | open Theme page, change ring colour, Save | GET then PUT with the form's theme | API message shown, field `aria-invalid` |
| Dashboard contrast | title `#cccccc` on `#ffffff` | warning naming "Title on background" and ratio | Save still allowed |
| Dashboard reset | Reset to TaleArt default | PUT `{}`, form shows defaults | — |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/index.ts`, `src/lib/theme.ts` (new), specs -- schemas, paths, `invalid_theme`, `DEFAULT_THEME`, `themeSettingsError`, `resolveTheme`, `contrastRatio`, `themeContrastIssues`.
- `libs/server/zones/src/lib/migration.ts`, `theme.ts` (new), `index.ts`, spec -- table, `getProjectTheme`, `setProjectTheme`, `InvalidThemeError`.
- `apps/api/src/http/theme.router.ts` (new), `delivery.router.ts`, `errors.ts`, `app.ts`, `app.spec.ts` -- routes, Delivery theme, mapping, tests (TRUNCATE lists gain `project_themes`).
- `libs/web-sdk/src/lib/theme.ts` (new), `bar.ts`, `banner.ts`, `viewer.ts`, `taleart-element.ts`, specs -- validation, custom properties, CSS.
- `apps/dashboard/src/app/theme.service.ts`, `pages/theme.ts` (new), `app.routes.ts`, `pages/projects.ts`, specs -- the Theme page.
- `apps/sdk-sample/a11y-scan.mjs` -- stub carries a theme; a themed run checks computed styles and scans.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- schemas, paths, helpers; regenerate; tests (default contrast, validator rows, OpenAPI drift) -- AD-3.
- [x] `libs/server/zones/` -- table, get/set, Delivery resolution; unit tests -- AD-4.
- [x] `apps/api/src/` -- routes, Delivery theme, error mapping; integration tests for every API matrix row.
- [x] `libs/web-sdk/` -- theme reading, custom properties, CSS; tests for the SDK rows; size check.
- [x] `apps/dashboard/` -- service, page, route, card link; tests for the dashboard rows.
- [x] `apps/sdk-sample/a11y-scan.mjs` -- themed check and scan.

**Acceptance Criteria:**
- Given the dashboard Theme page, when a content manager sets a solid ring in one colour, corner radius 0 and a serif font and saves, then the sample page's bar, banner, seen ring and viewer follow after a reload.
- Given an invalid colour, when it is saved, then the API refuses it and the stored theme is unchanged.
- Given no theme set, when the sample page loads, then it renders TaleArt's default theme and the WCAG 2.2 AA scan is clean.

## Implementation Notes

- Assumptions (not settled by the epic, recorded for review): colours are strict `#rrggbb` only (no `#rgb`, names, alpha or `transparent`), so the background is always opaque; TaleArt's default theme is the look the SDK had, adjusted to pass AA: ring gradient `#ea580c, #db2777, #7c3aed` (the old `#f59e0b` was 2.2:1 on white), seen `#6b7280`, width 2, radius 12, font `system-ui, sans-serif`, titles `#111827`, background `#ffffff` (the bar and banner were transparent before), accent `#ffffff`; `cornerRadius` drives rounded-square bar items (the cover inside is radius minus ring width; circles stay circles) and banner slides, not the full-screen viewer; `backgroundColor` paints the bar and banner frames, while the viewer stays black; `accentColor` colours the viewer's progress fill and control icons (on black, so contrast is checked against black); banner dots use the title colour (outlined when not current, filled when current) and the banner's previous/next/rotation buttons keep their own light fill so they read over any slide; `ringStyle: none` hides the unseen and the seen ring (width 0), so the seen state is then only in the item's accessible name; a gradient with one colour is drawn solid; the theme is one row per project, editable by anyone with access to the project (content managers included); a save replaces the theme (the page sends all nine fields, "Reset to TaleArt default" sends `{}`); low contrast is warned, never refused; no live preview (the epic does not ask for one).
- Contract: `ThemeColor`, `RingStyle`, `ThemeSettings` (all optional, `additionalProperties: false`, with the defaults), `Theme` (complete), `ProjectTheme`, `DeliveryZone.theme`, `GET`/`PUT /projects/{projectId}/theme`, error `invalid_theme`. `libs/contract/src/lib/theme.ts` holds `DEFAULT_THEME`, the ranges and patterns, `themeSettingsError` (one validator for API and dashboard), `resolveTheme`, `cleanThemeSettings`, `contrastRatio` and `themeContrastIssues`; a test keeps the OpenAPI schema's fields, defaults, ranges and patterns equal to them. The generator types fields with a default as required, so `ThemeSettings` is `Partial<Theme>` and `ProjectTheme.theme` is retyped in `index.ts`.
- Font-family safety: comma-separated names of letters, digits, spaces and hyphens, bare or quoted, at most 200 characters; no `;{}()\/:<` can pass. A 200-character pathological input is checked in under 50 ms.
- Server: table `project_themes` in the zones module (it owns frames and their registry); `getProjectTheme` drops stored fields that fail the rules, so a hand-written row never reaches the dashboard or an SDK; `setProjectTheme` validates before writing (upsert). The router (`theme.router.ts`, mounted at `/projects`) checks access (403), then the project (404), then the body (400). The Delivery API reads the theme of the zone's project in parallel with frames and groups and sends `theme.resolved`.
- SDK: `theme.ts` keeps its own copy of the rules (type-only contract import, as for frame settings), tested equal to the contract's; frames and the viewer's dialog now live in a `div.taleart` wrapper inside the Shadow DOM, which gets `--ta-ring`, `--ta-seen`, `--ta-ring-width`, `--ta-radius`, `--ta-font`, `--ta-title`, `--ta-bg`, `--ta-accent` through `style.setProperty`; the `<style>` text never holds a theme value. Invalid or missing fields fall back silently (story 9 owns warnings for SDK configuration values). Bundle 9.83 KB gzipped.
- Dashboard: `theme.service.ts` and `pages/theme.ts` (route `projects/:projectId/theme`, "Theme" link on each project card for every role): ring style select, 1–3 ring colours (add/remove), four colour fields, each a colour picker plus a hex text field, ring width and corner radius numbers, font text field, a `role=status` contrast warning listing each failing pair with its ratio, Save theme (checked with `themeSettingsError` first, so an invalid value is named and marked without a request) and Reset to TaleArt default. The API's refusal is shown and marks the field it names.
- The sample page's a11y scan now sends the default theme and adds a themed run (solid `#0055ff` ring, radius 0, Georgia, accent `#ffcc00`, seen `#4b5563`): it checks the computed ring colour and radius, banner radius and font, viewer font, progress and button accent, and the seen ring after a reload, and scans both states.
- After review (see the triage log): the defaults above changed. Unset now keeps the look before themes (transparent background; host page's title colour and font; the frame's radius; the viewer's `system-ui`), so the first note's default background, title colour, font and radius no longer hold; `backgroundColor` also takes `transparent`; `titleColor`, `fontFamily` and `cornerRadius` take `null`. Font names refuse CSS-wide keywords and `default`, and bare names start with a letter. Focus rings are two-colour. The dashboard sends only the fields the project sets.
- Merged `autopilot/foundation` (fbe2ef0, web zones story 7, stages): the Delivery API returns `stages` and `theme` together; `taleart-element.ts` keeps the themed wrapper around the frames the stage selects; the API test TRUNCATE has both `stages` and `project_themes`; the a11y scan runs the themed checks, then the stages checks.

## Plan Change Log

- 2026-10-21, coordinator review: the default theme must keep the look before themes. Amended rules (they override the intent contract's default-theme line and colour rule): `backgroundColor` is `#rrggbb` or `transparent` (default); `titleColor`, `fontFamily`, `cornerRadius` are nullable (default `null` = host page's or frame's own); fonts refuse CSS-wide keywords and `default` and bare names not starting with a letter; contrast checks skip host-page pairs and say so, and add the accent on the viewer's track and buttons; Save sends only the fields the project sets. KEEP: one validator in the contract with an SDK copy and drift tests; theme values reach CSS only through `style.setProperty`.

## Review Triage Log

### 2026-10-21 — Coordinator review
- verdicts: 7 findings, all patched.
- findings:
  - `[patch]` The default theme changed the look of existing host pages — unset now means the look before themes: `backgroundColor` is `#rrggbb` or `transparent` (default `transparent`); `titleColor`, `fontFamily` and `cornerRadius` are nullable (default `null`: the host page's text colour and font, the frame's own radius, `size / 4` on bar items and 12 px on banners); the Delivery API returns them as `null`; the SDK leaves the custom property unset and the CSS falls back (`var(--ta-title, inherit)`, `var(--ta-font, inherit)`, `var(--ta-radius, calc(var(--ta-size) / 4))`, the cover edge `#fff`, banner dots grey/near-black as before). The old ring gradient's first stop `#f59e0b` fails 3:1 on white (2.2:1), so the AA-safe `#ea580c` stays; the other stops are the old ones. OpenAPI, the shared validator, the SDK copy and the drift tests are updated; the a11y scan checks the host page's colour and font, the transparent bar and the 12 px banner radius by default. The dashboard shows "Host page's" / "Transparent" / "Frame's own" checkboxes that set or clear an explicit value; contrast checks skip the pairs whose colour comes from the host page and list them as not checked.
  - `[patch]` The font pattern let CSS-wide keywords and bare names starting with a digit or `-` through — a negative lookahead refuses `inherit`, `initial`, `unset`, `revert`, `revert-layer` and `default` as a word anywhere (any case, bare or quoted; `default-font` stays valid), and bare names start with a letter. One builder in the contract, a copy in the SDK, the same pattern in OpenAPI (a test compares sources and sample values); tests in contract, SDK and API.
  - `[patch]` The viewer used the `font` shorthand with the variable — now `font-family: var(--ta-font, system-ui, sans-serif)` with separate size and line height (its look before themes was `system-ui`); a test refuses any `font:` shorthand with the variable.
  - `[patch]` Missing contrast pairs — the accent is also checked on the progress track and on the buttons over light media (both about `#666666`). Focus rings in the bar and banner are now two colours (dark `#111827` outline, white inner ring), so one always contrasts with any background; the warning's doc says so instead of adding a pair that cannot fail.
  - `[patch]` Save sent every field — the page keeps the set of fields the project sets (the stored ones plus the ones changed); a field changed back to TaleArt's default leaves it; Save sends only those. Tests: changing one field stores one field; a stored field returned to its default is dropped.
  - `[patch]` Number fields bound `NaN` back — the typed text is kept as is; a number (even out of range) reaches the theme so the save check can name it; leaving the field with an invalid value restores the last valid number. Test.
  - `[patch]` End-to-end AC — an API integration test saves a theme with PUT (explicit values, then host-page nulls and `transparent`) and reads `/delivery/v1/zone` for the resolved theme. A live-API run of the sample page is not practical here (the dashboard needs a passkey session); the a11y scan covers the SDK side with a stubbed Delivery API. The coordinator checks it in a real browser at merge.

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w1_test npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting web-sdk sdk-sample` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size` -- expected: ≤ 50 KB gzipped.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:a11y` -- expected: 0 violations, themed checks pass.

## Auto Run Result

**Summary:** A project has one theme (R9): ring style, 1–3 ring colours, seen ring colour, ring width, corner radius, font, title, background and accent colours. The contract defines the theme schema, TaleArt's default theme (WCAG 2.2 AA, tested) and one validator: strict `#rrggbb` colours, bounded integers and a safe font-family pattern, so no value can carry CSS. The zones module stores the fields a project sets in `project_themes`; `GET`/`PUT /api/v1/projects/{projectId}/theme` read and replace it (400 `invalid_theme` naming the field, 404, 403). The Delivery API returns the zone's project theme with defaults filled in, dropping any invalid stored field. The Web SDK checks the theme again and applies it through `--ta-*` custom properties on a wrapper inside its Shadow DOM, styling the bar (ring, seen ring, width, rounded-square radius, titles, font, background), the banner (radius, background, font, dots) and the viewer (font, accent progress and buttons). The dashboard's Theme page, linked from each project card, edits it with colour pickers and hex fields, warns about each colour pair that fails AA contrast, saves and resets.

**Files changed:**
- `libs/contract/` -- OpenAPI theme schemas, paths and `invalid_theme`; regenerated types; `src/lib/theme.ts` (new) and tests, including an OpenAPI drift test.
- `libs/server/zones/` -- `project_themes` migration, `theme.ts` (new) and tests, exports.
- `apps/api/src/` -- `http/theme.router.ts` (new), Delivery theme, error mapping, wiring; integration tests; `project_themes` in the test TRUNCATE.
- `libs/web-sdk/src/lib/` -- `theme.ts` (new) and tests; themed CSS in `bar.ts`, `banner.ts`, `viewer.ts`; themed wrapper in `taleart-element.ts` and tests.
- `apps/dashboard/src/app/` -- `theme.service.ts`, `pages/theme.ts` (new), route, Theme link on project cards; tests in `app.spec.ts`.
- `apps/sdk-sample/a11y-scan.mjs` -- default theme in the stub, themed checks and scans.

**Review:** coordinator review, 7 findings, all patched (see the triage log); merged with `autopilot/foundation` (stages).

**Verification:** First build: `nx run-many -t lint test build` for the twelve projects passed against `taleart_w1_test` (api 279, dashboard 175, web-sdk 161, contract 63, server-zones 46 tests); `web-sdk:size` 9.83 KB. After the review fixes and the merge: the same run passed (api 297, dashboard 190, web-sdk 187, contract 87, server-zones 56 tests); `nx run web-sdk:size`: 10.47 KB gzipped (budget 50 KB); `nx run sdk-sample:a11y`: no WCAG 2.2 AA violations in any state, the default-look, themed and stages checks pass. The dashboard build keeps its existing initial-bundle budget warning. The Theme page was checked by component tests only, not in a signed-in browser; no live-API run of the sample page (checked at merge).

**Residual risks:**
- The default ring's first stop is darker than before (`#ea580c` for `#f59e0b`, which failed 3:1 on white); everything else looks as before themes.
- With a transparent background or the host page's title colour, contrast depends on the host page; the dashboard says those pairs are not checked.
- Parallel stories touch the same files (OpenAPI, `ErrorCode`, delivery router, `taleart-element.ts` render loop for stages, API TRUNCATE list, `app.spec.ts`); merges need care. Story 9 should reuse `readTheme`/`applyTheme` for SDK overrides.
