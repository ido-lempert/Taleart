---
title: 'Override the theme in the Web SDK configuration'
type: 'feature'
ticket: '9'
created: '2026-10-21'
status: 'built'
baseline_revision: 'ad0bf8a9aba7ccb6f5faeb7edce79d162536ad46'
route: 'full'
route_source: 'auto'
risk: 'low'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/epic-web-zones.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/tickets/story-set-the-project-theme-in-the-dashboard-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The project theme (story 8) styles every zone of a project alike; a developer cannot restyle one zone on a host page (R9: "a developer sets any of its fields for a zone in the Web SDK configuration").

**Approach:** The Web SDK takes theme fields from two configuration points: a JavaScript option for a zone (`configureZone(zoneKey, { theme })`, keyed by the zone key the host already has) and the element's `theme` property (or its `theme` attribute, JSON). Each field resolves element → zone option → project theme (Delivery API) → TaleArt's default. Overrides are checked field by field with the same rules as `readTheme`; an invalid field is ignored with one console warning naming it. Values still reach CSS only through `applyTheme`'s `style.setProperty`.

## Boundaries & Constraints

**Always:**
- Same field rules as the contract (`ringStyle`, `ringColors` 1–3 `#rrggbb`, `seenRingColor`, `ringWidth` 1–4, `cornerRadius` 0–32 or `null`, `fontFamily` safe list or `null`, `titleColor` colour or `null`, `backgroundColor` colour or `transparent`, `accentColor`); one per-field check table in `libs/web-sdk/src/lib/theme.ts` serves both the delivered theme and overrides, kept equal to the contract's validator by the existing drift tests.
- Per-field precedence: element override, then zone option, then the delivered project theme, then `THEME_DEFAULTS`. A field absent or `undefined` in an override falls through; `null` (where valid) is an explicit value and wins ("use the host page's").
- An invalid or unknown override field is ignored with exactly one `console.warn` per field each time that configuration is set, naming the field and where it came from; a non-object override (or attribute JSON that does not parse to an object) is ignored with one warning. Delivered-theme fields stay silent (story 8).
- Overrides are copied when set; changing an override re-themes the rendered frames and an open viewer without a new Delivery request, and clears CSS properties that no longer apply.
- Bundle ≤ 50 KB gzip; the a11y scan stays clean with an override applied.
- Public configuration documented in `libs/web-sdk/README.md` and on the sample page.

**Never:** a theme per frame or per stage key; a dashboard change; Delivery API or contract changes; theme values written into style text or `innerHTML`; `eval`-like parsing (attribute uses `JSON.parse` only); new npm packages; warnings for the delivered theme; changes to zone keys, Delivery CORS or key handling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No override | project solid red, no config | ring red | no log |
| Zone option wins | project red; `configureZone(key, {theme:{ringColors:['#0000ff']}})` | bar and banner of every element with that key show blue | — |
| Element wins over zone | zone blue; `el.theme = {ringColors:['#00ff00']}` | that element green, others blue | — |
| Attribute | `theme='{"cornerRadius":0}'` | radius 0 | — |
| Remove override | `configureZone(key, {})` / `el.theme = null` / attribute removed | project value returns, live | — |
| Partial override | `{accentColor:'#ffcc00'}` | accent from override, other fields from project | — |
| Explicit null | project title `#000000`; override `{titleColor:null}` | `--ta-title` cleared (host page's colour) | — |
| Invalid field | `{ringWidth:9, ringColors:['#0000ff']}` | blue applies; width from project | one warning naming `ringWidth` |
| Unsafe value | `{fontFamily:'x;}body{', backgroundColor:'url(x)'}` | ignored; nothing reaches style | one warning per field |
| Unknown field | `{size:1}` | ignored | one warning naming `size` |
| Not an object | `el.theme = 'blue'`, attribute `{bad json` or `[1]` | ignored | one warning |
| Re-render | override set before/after load, reload of zone | merged theme on every render; no extra warnings on reload | — |
| Before upgrade | `el.theme` set before the SDK defines the element | applied after upgrade | — |

</intent-contract>

## Code Map

- `libs/web-sdk/src/lib/theme.ts` -- per-field checks, `readTheme`, `themeProperties`, `applyTheme`; add `readThemeOverride` (cleans + warns) and layered resolution; `applyTheme` clears dropped optional properties.
- `libs/web-sdk/src/lib/taleart-element.ts` -- `theme` property/attribute, zone option registry, `configureZone`, live re-theme.
- `libs/web-sdk/src/index.ts` -- export `configureZone` (also on the UMD global `TaleartWebSdk`).
- `libs/web-sdk/src/lib/theme.spec.ts`, `taleart-element.spec.ts` -- matrix tests.
- `libs/web-sdk/README.md` -- public configuration.
- `apps/sdk-sample/index.html` -- `&theme=<json>` zone option and documented snippet.
- `apps/sdk-sample/a11y-scan.mjs` -- override run: project red, zone override blue on a bar stage and a banner stage, invalid `ringWidth` warning, scan.

## Tasks & Acceptance

**Execution:**
- [x] `libs/web-sdk/src/lib/theme.ts` -- check table, override reader with warnings, layered properties, clearing -- one rule set for delivered and SDK values.
- [x] `libs/web-sdk/src/lib/taleart-element.ts`, `src/index.ts` -- configuration API and live re-theme.
- [x] `libs/web-sdk/src/lib/*.spec.ts` -- a test for every matrix row.
- [x] `libs/web-sdk/README.md`, `apps/sdk-sample/index.html` -- documentation and demo hook.
- [x] `apps/sdk-sample/a11y-scan.mjs` -- override checks and scan.

**Acceptance Criteria:**
- Given a red ring in the project theme and a blue ring for the zone in the sample page's SDK configuration, when the page loads with a bar stage and a banner stage, then both show blue; without the SDK value, red returns.
- Given an SDK `ringWidth` of 9, when the page loads, then one warning names `ringWidth` and the project width applies.
- Given the SDK build, when `web-sdk:size` runs, then it is ≤ 50 KB gzip, and the a11y scan with an override reports no violations.

## Implementation Notes

- Assumptions (the epic and ticket leave these open; recorded for review): (1) the zone option is keyed by the zone key, since that is what a host page holds (`configureZone(zoneKey, { theme })`); (2) an element's own `theme` wins over the zone option, being more specific; the ticket names both but not their order; (3) an override is checked and copied when set, and its warnings are logged then, once per invalid field per set, not on every render or reload; (4) `undefined` in an override means "not set" (falls through), `null` is a value where the rules allow it (host page's colour/font, frame's radius); (5) attribute text that is not JSON, or JSON that is not an object, clears that element's override with one warning; (6) changing an override restyles rendered elements and an open viewer at once without a new Delivery request; (7) the API is also reachable as `window.TaleartWebSdk.configureZone` from the UMD build; (8) contrast of host-chosen colours is the host's responsibility (README says so); the SDK does not refuse low contrast, as the dashboard only warns.
- `theme.ts`: one per-field check table (`CHECKS`) now drives `readTheme` (delivered, silent) and the new `readThemeOverride` (SDK values, warns naming the field and its source); the existing drift tests against the contract's `resolveTheme`/`isFontFamily` still pass unchanged. `themeProperties`/`applyTheme` take overrides, lowest precedence first; `applyTheme` removes optional properties (`--ta-gap`, `--ta-radius`, `--ta-font`, `--ta-title`) a new theme leaves out, so a live re-theme leaves nothing stale.
- `taleart-element.ts`: `configureZone`, `ZoneOptions`, the `theme` property/attribute, `retheme()`; a theme property set before the element is upgraded is picked up on connect. A theme attribute change does not refetch.
- Sample page: `&theme=<JSON>` is passed to `configureZone(key, { theme })` before the elements load; the page text documents it. The a11y scan adds a run with a red project ring and a bar stage and a banner stage, overridden in blue with `cornerRadius: 0` and an invalid `ringWidth: 9`, then without the override.
- Bundle 10.92 KB gzipped (was 10.47 KB).

## Plan Change Log

## Review Triage Log

### 2026-10-21 — Coordinator review
- verdicts: 8 findings, all patched.
- findings:
  - `[patch]` `get theme()` leaked the internal `ringColors` array — it now returns a copy with the array copied; stored overrides (and their arrays) are frozen; `themeProperties` checks overrides again, silently, so only checked values reach CSS. Tests: mutating `el.theme.ringColors` changes nothing; unchecked overrides passed to `themeProperties` fall back.
  - `[patch]` Check-then-copy on arrays — the SDK and the contract (`resolveTheme`, `cleanThemeSettings`) now copy arrays by index first (length capped at 4, one over the rules' 3), then check the copy; the contract's `fieldError` checks colours by index, so sparse holes fail (it used `every`, which skips holes). Tests in both: a Proxy that answers differently on a second read, an array with a junk custom iterator, sparse arrays and `[undefined]`, a 1e9-length array; drift tests still compare SDK and contract.
  - `[patch]` Upgrade order — the pre-upgrade own `theme` property is taken in the constructor (before `attributeChangedCallback`), deleted and run through the setter; set by script it wins over a `theme` attribute present at upgrade, which is skipped without logging; later attribute changes apply. `el.theme` never returns an unchecked value. Tests: attribute plus pre-upgrade property, and `customElements.upgrade` of a detached element. Documented in the README.
  - `[patch]` `theme="null"` was silent — it now warns once like other non-object JSON; a missing or empty attribute clears silently. Test.
  - `[patch]` Zone warnings now name the zone by its key's first 8 characters plus "…", never the full key; JSDoc example fixed. Test.
  - `[patch]` `configureZone(key)` / `configureZone(key, {})` / `{ theme: null }` deletes the registry entry (as does an override with no valid field). Test.
  - `[patch]` `get theme()` JSDoc now says it returns this element's own override fields.
  - `[patch]` The rendered zone key is stored with the themed wrapper and the zone override is looked up by it, so a key change never applies the new zone's override to the old content. Test.

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w1_test npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size` -- expected: ≤ 50 KB gzipped.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:a11y` -- expected: 0 violations, override checks pass.

## Auto Run Result

**Summary:** A host page can override the project's theme in the Web SDK configuration (R9): `configureZone(zoneKey, { theme })` for every `<taleart-view>` of a zone, and the element's `theme` property or JSON `theme` attribute for one element. Each field resolves element → zone option → project theme → TaleArt's default. Override fields are checked with the same rules as the delivered theme; an invalid or unknown field is ignored with one console warning naming it, and values reach CSS only through `style.setProperty`. Changing an override restyles rendered frames and an open viewer at once. The configuration is documented in the web-sdk README and on the sample page, which takes `&theme=<JSON>`.

**Files changed:**
- `libs/web-sdk/src/lib/theme.ts` -- per-field check table, `readThemeOverride`, layered `themeProperties`/`applyTheme`, clearing of stale properties.
- `libs/web-sdk/src/lib/taleart-element.ts`, `src/index.ts` -- `configureZone`, `ZoneOptions`, `theme` property and attribute, live re-theme.
- `libs/web-sdk/src/lib/theme.spec.ts`, `taleart-element.spec.ts` -- tests for every matrix row (web-sdk 187 → 208 tests).
- `libs/web-sdk/README.md` -- public configuration.
- `apps/sdk-sample/index.html`, `apps/sdk-sample/a11y-scan.mjs` -- `&theme=` demo hook and documentation; override checks and scan on a bar stage and a banner stage.

**Review:** coordinator review, 8 findings, all patched (see the triage log); `autopilot/foundation` merged (already up to date at ad0bf8a). The review fixes also touch `libs/contract/src/lib/theme.ts` and its spec (sparse arrays, copy before check).

**Verification after review:** the same `nx run-many -t lint test build` for the twelve projects passed against `taleart_w1_test` (web-sdk 217, contract 91, api 306, server-zones 56 tests, among others); `nx run web-sdk:size`: 11.08 KB gzipped; `nx run sdk-sample:a11y`: no WCAG 2.2 AA violations, override checks pass.

**Verification:** `nx run-many -t lint test build` for the twelve projects passed against `taleart_w1_test` (web-sdk 208, api 306, contract 87, server-zones 56 tests, among others); `nx run web-sdk:size`: 10.92 KB gzipped (budget 50 KB); `nx run sdk-sample:a11y`: no WCAG 2.2 AA violations, including the SDK-override state; the override checks (blue wins in bar and banner stages, invalid `ringWidth` warns once and the project's width applies, red returns without it) pass. No live-API run (the Delivery API is stubbed in the scan).

**Residual risks:**
- Precedence of element over zone option, and keying the zone option by zone key, are assumptions (see Implementation Notes).
- A host override can pick colours with poor contrast; the SDK does not check contrast (README warns).
- `configureZone` lives in module state: a page that loads two copies of the SDK has two registries.
