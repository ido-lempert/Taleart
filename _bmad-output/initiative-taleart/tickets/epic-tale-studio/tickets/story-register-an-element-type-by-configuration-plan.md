---
title: 'Register an element type by configuration (hook for interactive components)'
type: 'feature'
ticket: '8'
created: '2026-10-22'
status: 'in-progress'
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
- [ ] contract: registry entry, schema, generator split, helpers, README; tests.
- [ ] server-tales + api: registry-driven validators with the switch; unit and HTTP tests.
- [ ] web-sdk: typed renderer table; registry and skip tests.
- [ ] dashboard: descriptors, fields inspector, Add menu and inspector from descriptors; tests.
- [ ] Playwright walk (ports 3395/4295/4395), screenshots `shots-7.8/`.

**Acceptance Criteria:**
- Given the test type enabled, it appears in the Add menu, its inspector edits it, saving validates it and an invalid value is refused; on the sample page the tale shows without it and the console has one warning.
- Given the full verification, every project lints, tests and builds; SDK ≤ 50 KB gz; a11y and perf pass (known failures); dashboard initial < 500 KB.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `NX_DAEMON=false node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool` -- all succeed.
- `node_modules/.bin/nx run web-sdk:size`, `web-sdk:types-check`, `sdk-sample:a11y`, `sdk-sample:a11y-review`, `sdk-sample:perf`.
