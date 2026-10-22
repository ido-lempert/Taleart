---
title: 'Register an element type by configuration (hook for interactive components)'
type: 'feature'
ticket: '8'
created: '2026-10-22'
status: 'built'
baseline_revision: '761f612'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-add-a-button-an-image-button-and-a-swipe-up-link-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** R8 asks that element types be data: a schema in the contract's registry, a studio inspector descriptor and an SDK renderer keyed by the type, with the studio's Add menu and inspector coming from the registry, so epic-interactive-components (poll, quiz, emoji reaction, countdown, product pins, promo code, Rating) can add a type with one registration per layer and no document version change or migration. Today the registry drives only the server's schema validation; the studio's Add menu, inspector choice and type names are hand-written per type.

**Approach:** Keep `element-types/registry.json` the one list. Entries may be marked `testOnly`; the generator splits them into `TALE_TEST_ELEMENT_TYPES` and `elementTypeRegistry({ testTypes })` merges them on request. The server compiles its validators from that registry (test types only behind `TALE_TEST_ELEMENT_TYPES=on`, never with `NODE_ENV=production`). The studio gets a descriptor per registry key (`tale-element-types.ts`): Add menu entries, the inspector kind, and for new types a field list rendered by a generic, schema-checked fields inspector; a registry key without a descriptor fails fast. The SDK's renderer map is typed against the registry union and tested against the registry keys; an unknown type stays skipped with one warning per type per page. A test-only `test-badge` type proves the path end to end. The contract README documents adding a type.

## Boundaries & Constraints

**Always:**
- Existing types' documents, delivery and rendering unchanged; the Add menu keeps its buttons, ids, labels, order and disabled rules; the inspector keeps each type's component.
- The test type is enabled only by configuration: the server's `TALE_TEST_ELEMENT_TYPES=on` outside production; the dashboard only in dev builds (`ngDevMode`, stripped in production) and only when `localStorage['taleart.testElementTypes'] === 'on'`, or a test provides the token.
- A new type's inspector refuses a value its props schema refuses (type, enum, min/max length, pattern, minimum/maximum, integer), with words; the server refuses it with the schema (400, pointer).
- SDK: one console warning per unknown type per page; the rest of the tale renders.

**Never:** a document version change or migration; the test type in `TaleElement`, OpenAPI or the production dashboard; studio code in the dashboard's initial bundle; new npm packages or contract entry points.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Test type on | save a `test-badge` with valid props | 200, version 1, delivered as is | — |
| Test type off | same save, flag off or production | — | 400 `/elements/i/type` not registered |
| Invalid props | label of 41 chars, bad colour, unknown tone, extra prop | — | 400 at the prop's pointer |
| Studio inspector | type an invalid value | not applied, message shown | inline |
| SDK without renderer | tale with a test badge (twice) and a text | text shows, badge skipped | one `console.warn` |

</intent-contract>

## Code Map

- `libs/contract/tale-document/element-types/registry.json`, `test-badge.schema.json` (new), `scripts/generate-tale-document-schemas.mjs` -- registry and generator.
- `libs/contract/src/lib/tale-document.ts` -- `elementTypeRegistry`, `propValueProblem`.
- `libs/contract/README.md` (new) -- how to add a type.
- `libs/server/tales/src/lib/tale-document.ts` -- validators from the registry, test-type switch; `apps/api/src/main.ts` -- env switch.
- `libs/web-sdk/src/lib/document/renderer.ts` -- renderer table typed by the registry.
- `apps/dashboard/src/app/pages/tale-element-types.ts`, `tale-fields-inspector.ts` (new), `tale-studio.ts` -- Add menu, inspector and names from descriptors.

## Tasks & Acceptance

**Execution:**
- [x] contract: registry entry, schema, generator split, helpers, README; tests.
- [x] server-tales + api: registry-driven validators with the switch; unit and HTTP tests.
- [x] web-sdk: typed renderer table; registry and skip tests.
- [x] dashboard: descriptors, fields inspector, Add menu and inspector from descriptors; tests.
- [x] Playwright walk (ports 3395/4295/4395), screenshots `shots-7.8/`.

**Acceptance Criteria:**
- Given the test type enabled, it appears in the Add menu, its inspector edits it, saving validates it and an invalid value is refused; on the sample page the tale shows without it and the console has one warning.
- Given the full verification, every project lints, tests and builds; SDK ≤ 50 KB gz; a11y and perf pass (known failures); dashboard initial < 500 KB.

## Implementation Notes

- Registry: `registry.json` entries may carry `testOnly: true`; the generator now also checks each entry (known fields, key pattern, unique key, closed props schema) and writes `TALE_TEST_ELEMENT_TYPES` beside the unchanged `TALE_ELEMENT_TYPE_REGISTRY`. Contract helpers: `elementTypeRegistry`, `elementTypeEntry`, `propSchema`, `propValueProblem` (type, enum, min/maxLength in code points, pattern, minimum/maximum, integer; tested to agree with Ajv on the test badge). README `libs/contract/README.md` documents adding a type.
- Server: validators compiled from `elementTypeRegistry({ testTypes })`, cached per switch; `setTestElementTypesEnabled` is set by the API from `TALE_TEST_ELEMENT_TYPES` (`apps/api/src/element-types-config.ts`: on/off, any other value or `on` with NODE_ENV=production stops the API).
- SDK: renderer table typed `{ [K in TaleElementType]: ElementRenderer }`; the skip with one warning per type per page was already there (7.1) and is now tested with the test badge. Size 23.51 KB gz.
- Studio: `tale-element-types.ts` holds one descriptor per registry key (Add entries with id, label, icon, row, project need, limit hint; inspector kind); the Add menu, limit hints, kind names and inspector choice come from it; a registered key without a descriptor throws. New types use `{ kind: 'configured' }` + `create` + `{ fields }`, edited by `tale-fields-inspector.ts`. Test descriptors are built in a function reached only behind `ngDevMode`; the production browser bundle holds no `test-badge` (checked in dist). The dev switch is `localStorage['taleart.testElementTypes'] = 'on'`.
- Built-in types' own add flows and inspectors are unchanged; the swipe-up/video limit hints now render in registry order (video first) when both are reached.
- Verification (on autopilot/foundation 8c5c105 merged): run-many lint test build, 12 projects, pass (contract 352, server-tales 276, web-sdk 385, dashboard 516, api 555); web-sdk:size 23.51 KB; types-check pass; a11y 0 violations; a11y-review 215/217 (known: landscape contrast, landscape full height); perf cold p75 1,270 ms. Dashboard initial 493.67 KB. Playwright 16/16 (shots-7.8).

## Plan Change Log

## Review Triage Log

### 2026-10-22 — Coordinator review
- **Verdict:** no production leak; existing types unchanged. 9 findings, all patched; `autopilot/foundation` a60da61 (8.10) merged first.
  1. `[patch]` Inspector chain: an explicit `isMedia(el)` branch for the media inspector, the text inspector only for `text`, and any other type a neutral inspector ("This layer's type can't be edited here…") with Delete. Test with a stored test badge and both switches off.
  2. `[patch]` `described()` refuses a fields descriptor its schema does not fit: schema and prop keywords outside the allowlists (`FIELDS_SCHEMA_KEYWORDS`, `FIELDS_PROP_KEYWORDS`), a control on a prop of another type, select options outside the enum (or none), a colour field whose pattern is not `^#[0-9a-fA-F]{6}$`. Descriptors may add `check(props)`, run after the schema (the studio side of `PROPS_RULES`). README lists the keywords. Tests.
  3. `[patch]` `TALE_TEST_ELEMENT_TYPES=on` only with NODE_ENV `development` or `test` (otherwise, unset included, the API stops at start); `configureTestElementTypes` wired in `main.ts` before the database; both in `.env.example`. Tests, plus the built API refusing to start without NODE_ENV.
  4. `[patch]` Switching the server's test types clears the delivery cache; `draftProblem` says "Layer N is a type this server doesn't take." for an unregistered type (other `/type` refusals keep their words); the README explains the server's whole-document fallback versus the SDK's per-element skip. Tests.
  5. `[patch]` Fields inspector errors follow the element id and props: an undo or redo that changes a prop clears that prop's error. Test.
  6. `[patch]` A11y: each field's error line is a persistent polite live region (no `role=alert`, no second notice); `aria-describedby` names hint and error; the colour picker has `aria-invalid`/`aria-describedby`, the hex field `aria-required`; an optional select offers "None". Tests.
  7. `[patch]` Generator checks moved to `scripts/tale-document-registry.mjs`: schema file name in `element-types/`, non-empty label, `required` within `properties`, every schema (test ones too) compiled with Ajv (unknown keywords refused). Generator unit tests (`registry-generator.spec.mjs`); `scripts/**` ignored by the dependency check.
  8. `[patch]` README: the `TaleElementOf` alias, the key list in `tale-document.spec.ts`, `elementName` naming.
  9. `[patch]` Tests: gating with `ngDevMode = false` (token false, no test types, kind name "Layer") and the localStorage path; the swipe-up hint shows before the video hint, as before 7.8 (`hintOrder`).
- Verification after the fixes: `run-many -t lint test build` on the 12 projects passes (contract 367, server-tales 274, web-sdk 385, dashboard 545, api 559 tests); `web-sdk:size` 23.51 KB gz; `types-check` passes; `sdk-sample:a11y` no violations; `a11y-review` 215 of 217 (known: landscape full height, landscape contrast); `perf` cold p75 1,271 ms; dashboard initial 493.74 KB; Playwright 16 of 16 (API with NODE_ENV=development).

## Verification

**Commands:**
- `NX_DAEMON=false node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- all succeed.
- `node_modules/.bin/nx run web-sdk:size`, `web-sdk:types-check`, `sdk-sample:a11y`, `sdk-sample:a11y-review`, `sdk-sample:perf`.
