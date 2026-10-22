---
title: 'Pick a template when creating a zone'
type: 'feature'
ticket: '8'
created: '2026-10-22'
status: 'built'
baseline_revision: '8fcfb89'
route: 'full'
route_source: 'auto'
risk: 'low'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/epic-ux-rework.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-a-zone-has-one-display-and-a-slug-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A playbook is applied from its own card on the zone page, after the zone exists, so a new user meets a fourth noun and an extra step before a zone shows anything (epic R5, owner decision D7). The New zone drawer also asks for a project even when the user has only one.

**Approach:** The playbook registry becomes the **template** registry: "Stories bar", "Promo banner" and "Blank". The New zone drawer offers them as a radio group, and `POST /zones` takes the picked template: in one transaction it creates the zone, gives it the template's display and records the template's key as a "created from template" note. The Playbook card, the apply drawer and `PUT /zones/{id}/playbook` go. With one accessible project the drawer preselects it and hides the picker.

## Boundaries & Constraints

**Always:**
- Contract first (`openapi.yaml`, then the generated types, `core.ts`, `templates.ts`).
  - `ZONE_TEMPLATES`: `stories-bar` (bar, today's "home-stories-bar" preset), `promo-banner` (banner preset), `blank` (no display). Each has `key`, `label`, `description` and `frame` (a type with its settings, or null). `findTemplate(key)`.
  - `CreateZoneRequest.template`: optional, an enum of the registry keys (a contract test keeps the two equal). Missing means Blank without a note.
  - `Zone.playbookKey` becomes `Zone.createdFromTemplate`: the key, or null. A note only; nothing reads it but the zone page.
  - Error `unknown_playbook` becomes `unknown_template` (400). `playbook_already_applied`, `ApplyPlaybookRequest`, `AppliedPlaybook` and `/zones/{zoneId}/playbook` are removed.
- API (zones module): `createZone` takes an optional template. The template is checked before anything is written. A template with a display runs the zone insert and `setDisplay` in one transaction (`inTransaction` from server-access), so a refused display leaves no zone. The `playbook_key` column stays and stores the template key.
- Migration: forward-only, in `migrateZones`: `UPDATE zones SET playbook_key = 'stories-bar' WHERE playbook_key = 'home-stories-bar'`, so old notes name a template. Runs again harmlessly.
- Dashboard: the template radio group (`fieldset` + `legend`, each option with its description via `aria-describedby` and a small bar or banner sketch, `aria-hidden`). "Stories bar" is preselected. One project: preselected, picker hidden, the project named in the context line. The zone page shows "Created from template: Stories bar" as a small muted line in the header. The initial bundle stays under 500 kB.
- The importer keeps calling `createZone(tx, { name, projectId })` unchanged.

**Never:** a link from a zone back to its template after creation; changing a zone's display through its template; touching site keys, Delivery or the SDK (story 6); the zone page tabs (story 9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stories bar | `POST /zones { template: 'stories-bar' }` | 201, `frame` bar with the preset settings, `createdFromTemplate: 'stories-bar'` | — |
| Promo banner | `template: 'promo-banner'` | 201, banner with the preset settings, note `promo-banner` | — |
| Blank | `template: 'blank'` | 201, `frame: null`, note `blank` | — |
| No template | no `template` | 201, `frame: null`, note null (importer, old clients) | — |
| Unknown | `template: 'nope'` or a number | 400 `unknown_template`; no zone written | — |
| Display refused | registry refuses the preset (test registry) | the error; no zone row left | rolled back |
| Old route | `PUT /zones/{id}/playbook` | 404 | — |
| Old note | zone stored `home-stories-bar` | after migrate: `stories-bar` | — |
| One project | user has one project | drawer has no project picker; zone created in that project | — |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/generated/api.ts`, `src/lib/core.ts` -- the shapes and error codes.
- `libs/contract/src/lib/templates.ts` (was `playbooks.ts`) -- the registry.
- `libs/server/zones/src/lib/zones.ts` -- `createZone` with a template; `playbooks.ts` removed; `migration.ts` key rename.
- `apps/api/src/http/zones.router.ts`, `errors.ts` -- create with a template; apply route gone.
- `apps/dashboard/src/app/create-drawer.{ts,html}`, `dashboard.store.ts`, `pages/zone-detail.{ts,html}`, `styles.css` -- drawer, store, card removal, note.
- `apps/sdk-sample/a11y-scan.mjs` -- the playbook scenario becomes the template scenario.

## Tasks & Acceptance

**Execution:**
- [x] Contract: OpenAPI, generate, `templates.ts` + spec, error codes.
- [x] Zones module: create with template (transaction), remove playbooks, migration rename; specs.
- [x] API: router, errors; app specs for every row of the matrix.
- [x] Dashboard: drawer radio group and one-project rule, store, zone page note, remove card and apply drawer; specs.
- [x] a11y-scan scenario renamed to templates.
- [x] Playwright: a zone from each template on the sample page; one project, no picker (`shots-8.8/`).

**Acceptance Criteria:**
- Given the New zone drawer, when a user picks "Promo banner" and creates the zone, then the zone page shows a Banner display with the preset settings and "Created from template: Promo banner", and the sample page renders a banner for it.
- Given a user with one project, when the New zone drawer opens, then it shows no project picker and the zone lands in that project.
- Given the dashboard, then no Playbook card, "Apply playbook" button or apply drawer exists.

## Implementation Notes

- The template registry lives in `libs/contract/src/lib/templates.ts` (`ZONE_TEMPLATES`, `findTemplate`, `ZoneTemplateKey`); its keys are checked against the OpenAPI enum `createZoneRequestTemplateValues`. There is no `GET /templates`: the dashboard imports the registry, as it imported the playbooks.
- `createZoneFromTemplate` (zones module, `templates.ts`) wraps `createZone`; the importer keeps calling `createZone` without a template. It keeps its own small `inTransaction`, since story 8.6 changes the access module in parallel.
- Blank records the note `blank` (the template that was picked); no `template` records null.
- The drawer sends `template` always (Stories bar preselected). With one project the context line says "In project <name>" in place of the picker.
- The zone page note sits in the header meta line: "Created from template: Stories bar".
- `describeSettings` is no longer used by the drawer; it stays in `settings-form.ts` for the zone page.
- Initial bundle 492.46 kB (was about 494 kB): the apply drawer and its preview went, the radio group came in. The drawer stays in the eager shell, as before.
- Playwright (`shots-8.8/`): a zone from each template (bar with the preset settings, banner 3:1, Blank with no display), each with its note; the sample page with `?keys=` shows the circle bar and the 3:1 banner; one project shows no picker, a second project brings it back; at 390 px the drawer has no horizontal scroll.

## Review fixes (2026-10-22)

- **Project read at submit.** The drawer reads the target project when Create is pressed (`onlyProject()?.id ?? projectId`), so projects that load or drop to one after it opened are used, and the slug preview follows the same project. Specs: projects arriving after open, two projects becoming one.
- **Errors on their control.** A refusal now names its control (`ZoneField`: name, slug, template, project): `unknown_template` marks the template fieldset (`aria-describedby` gains `create-error`), `project_not_found`, `forbidden` or a `projectId` message marks the project picker (`aria-invalid`, `aria-describedby`). With one project the fallback message says "Zone was not saved. Enter a name." Specs for each.
- **One transaction helper.** `@taleart/server-access` exports its `inTransaction` (one line); the zones module's copy is gone.
- **One lookup.** The contract's `findTemplate(key, templates?)` takes a registry; the zones module uses it. The other-registry seam is `createZoneFromTemplateIn`, not exported from the module.
- **Slug clash on the template path.** A unit spec retries the made slug and then sets the display once; an API spec creates three "Home" zones from a template at once: `home`, `home-2`, `home-3`, each with its display.
- **Docs.** AD-17 and epic-web-zones R8 note that UX rework R5 (templates) supersedes playbooks.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool` -- expected: all pass.
- `web-sdk:size`, `web-sdk:types-check`, `sdk-sample:a11y` -- expected: pass. Dashboard initial bundle under 500 kB.

**Manual checks:**
- Playwright (`shots-8.8/`): New zone drawer with templates; zone page from each template; sample page rendering each; one-project drawer without a picker.
