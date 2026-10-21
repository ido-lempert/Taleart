---
title: 'Apply a playbook to a zone'
type: 'feature'
ticket: '10'
created: '2026-10-21'
status: 'in-review'
baseline_revision: 'ad0bf8a9aba7ccb6f5faeb7edce79d162536ad46'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/tickets/story-place-a-zone-on-a-page-with-stages-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A content manager who wants a common setup (a stories bar on a home page, a promo banner) builds it by hand: add a frame, set each setting, add a stage. R8 asks for preset playbooks that do this in one step.

**Approach:** Contract first: a playbook registry in `libs/contract` (typed data, not a table) with the two MVP presets, `Zone.playbookKey`, and `PUT /api/v1/zones/{zoneId}/playbook` `{ key }` answering `AppliedPlaybook { applied, zone, frames, stages }`. The zones module applies a playbook in one transaction with the zone row locked: it creates each preset frame (validated by the frame registry) and its stage through `createFrame`/`createStage`, then records the key. The dashboard zone page gets a Playbook section and a drawer that previews what the picked playbook creates before applying it.

## Boundaries & Constraints

**Always:**
- Registry `PLAYBOOKS` in `libs/contract/src/lib/playbooks.ts`: key, label, goal, and per frame `type`, full `settings`, `stage { key, name }`. Presets exactly per R8: `home-stories-bar` "Home page stories bar" (bar: circle, medium, showTitles true, start, gap 12; stage `home-stories-bar`) and `promo-banner` "Promo banner" (banner: 3:1, autoplay true, intervalSeconds 5, showDots true, loop true; stage `promo-banner`). No theme fields.
- `zones.playbook_key text NULL` (forward-only, idempotent `ADD COLUMN IF NOT EXISTS`); existing zones read `null`.
- Apply is one transaction: zone row `FOR UPDATE`; any failure leaves no frame, stage or key behind.
- Idempotent: the same key on a zone that already has it answers 200 `applied: false`, empty `frames`/`stages`, nothing written.
- Authorized like every zone edit (`authorizeParam(pool, 'zone', 'zoneId')`).
- Errors: unknown zone 404 `zone_not_found`; no project access 403 `forbidden`; missing/non-string key 400 `validation_failed`; key not in registry 400 `unknown_playbook`; zone has another playbook 409 `playbook_already_applied`; a preset stage key already used in the zone 409 `stage_key_taken`.
- Created frames and stages are ordinary rows: editable through the existing settings form, stage rename and delete.
- Dashboard (story-14 design system classes): the drawer lists playbooks as radios and shows, for the picked one, each frame with its settings (labels from the frame-type schema) and each stage name and key, plus a conflict warning; accessible names, focus return, API message in the drawer.

**Never:** a playbooks table; theme changes; changing Delivery, SDK or the sample page; removing or replacing an applied playbook; deleting frames; changes to zone keys or Delivery key handling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Apply bar | empty zone, `{key:'home-stories-bar'}` | 200 `applied:true`, one bar frame with preset settings, stage `home-stories-bar` on it, `zone.playbookKey` set | — |
| Apply banner | empty zone, `{key:'promo-banner'}` | 200, one banner frame (3:1 …), stage `promo-banner` | — |
| Zone with frames | zone already has a frame and other stages | preset frame and stage added after them; nothing else changed | — |
| Repeat | same key again | 200 `applied:false`, `frames:[]`, `stages:[]`; counts unchanged | — |
| Other playbook | zone has `home-stories-bar`, apply `promo-banner` | 409 `playbook_already_applied`; nothing written | — |
| Stage key taken | zone has stage `promo-banner`, apply `promo-banner` | 409 `stage_key_taken`; no frame created, key not recorded | — |
| Unknown / bad key | `{key:'nope'}` / `{}` / `{key:3}` | 400 `unknown_playbook` / `validation_failed` | — |
| Unknown zone | any key | 404 `zone_not_found` | — |
| Access | content manager of another project | 403 `forbidden`, nothing written | — |
| Concurrent | two applies of one key at once | one creates, the other `applied:false` | — |
| Zone list | GET /zones | each zone has `playbookKey` (null when none) | — |
| Registry | every preset | settings valid against the shipped frame schemas; stage keys valid, unique | — |
| Dashboard section | zone without / with playbook | "No playbook" + Apply button / applied label and goal | — |
| Dashboard preview | pick a playbook | frame type, settings by schema label, stage name and key | — |
| Dashboard conflict | preset stage key already in zone | warning in preview; Apply refused with that message, no request | — |
| Dashboard apply | Apply | PUT sent; zone, frames and stages update; drawer closes | API message in drawer |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/index.ts`, `src/lib/playbooks.ts` (new) + spec -- `Zone.playbookKey`, `ApplyPlaybookRequest`, `AppliedPlaybook`, route, error codes; registry.
- `libs/server/zones/src/lib/migration.ts`, `zones.ts`, `frames.ts`, `playbooks.ts` (new) + spec, `index.ts` -- column, zone columns, `applyPlaybook`, errors.
- `apps/api/src/http/zones.router.ts`, `errors.ts`, `app.spec.ts` -- route, error mapping, integration tests.
- `apps/dashboard/src/app/dashboard.store.ts`, `create-drawer.ts/.html`, `pages/zone-detail.ts/.html`, `app.spec.ts` -- Playbook section, drawer, store call.

## Tasks & Acceptance

**Execution:**
- [x] `libs/contract/` -- OpenAPI shapes and route, `contract:generate`, `PLAYBOOKS`/`findPlaybook`, tests (presets match R8, valid against frame schemas, unique stage keys).
- [x] `libs/server/zones/` -- migration column, `playbookKey` in zone reads, `applyPlaybook` in a transaction, `UnknownPlaybookError`, `PlaybookAlreadyAppliedError`; unit tests.
- [x] `apps/api/` -- `PUT /zones/:zoneId/playbook`, error mapping, integration tests per API matrix row, `playbookKey` in zone assertions.
- [x] `apps/dashboard/` -- store `applyPlaybook`, drawer `applyPlaybook` with preview and conflict check, Playbook section; tests per dashboard row.

**Acceptance Criteria:**
- Given an empty zone, when "Home page stories bar" is applied in the dashboard, then the zone shows one Bar frame with the preset settings and a stage `home-stories-bar` on it, and the Delivery API returns them.
- Given a zone with a playbook, when the preset frame's settings are edited, then they save as for any frame.
- Given a playbook already applied, when it is applied again, then no frame or stage is added.
- Given the full verification run, then lint, test, build, `web-sdk:size` and `sdk-sample:a11y` pass.

## Implementation Notes

- Assumptions (the epic leaves these open; recorded for review, none blocked the build): a zone records one playbook, so applying a different playbook to a zone that has one is refused (409 `playbook_already_applied`) rather than replacing or adding to it, and there is no "remove playbook"; the dashboard hides Apply playbook once a zone has one. A playbook may be applied to a zone that already has frames and stages (R8's verify uses an empty zone, nothing forbids others): its frames come after the existing ones. Idempotency is by the recorded key: re-applying the zone's own playbook creates nothing even if its frames or stages were deleted since. A preset stage key the zone already uses refuses the whole apply (409 `stage_key_taken`) instead of renaming the key, since host pages name stages by key. Preset stage keys equal the playbook keys (`home-stories-bar`, `promo-banner`) and stage names equal the labels; goal texts are my wording. Settings are stored in full (every field explicit), not as defaults. The registry is typed TypeScript data in `libs/contract` (like the theme field definitions), not a JSON file loaded at start: playbooks need no schema compilation, and both the API and the dashboard import it, so no `GET /playbooks` route was added.
- Contract: `Zone.playbookKey` (required, nullable), `ApplyPlaybookRequest`, `AppliedPlaybook { applied, zone, frames, stages }`, `PUT /zones/{zoneId}/playbook`, error codes `unknown_playbook` (400) and `playbook_already_applied` (409); `PLAYBOOKS`, `findPlaybook`, `Playbook`, `PlaybookFrame` in `src/lib/playbooks.ts`. Regenerated with `contract:generate`.
- Zones module: `zones.playbook_key` via `ADD COLUMN IF NOT EXISTS`; zone reads share `ZONE_COLUMNS`; `applyPlaybook(db, registry, { zoneId, key })` checks zone (404), key (400), registry (400) before the transaction, then locks the zone row `FOR UPDATE`, compares the recorded key, checks every preset stage key, creates frames and stages through `createFrame`/`createStage` on the transaction connection, and records the key. Errors `PlaybookKeyRequiredError`, `UnknownPlaybookError`, `PlaybookAlreadyAppliedError`. A unit test checks every preset against the shipped frame-type registry.
- Frames created in one transaction share `created_at` (`now()` is the transaction time), so with several frames per playbook their order would fall to the id tie-break; both MVP presets have one frame. A future multi-frame playbook needs an explicit order.
- API: route behind `authorizeParam(pool, 'zone', 'zoneId')` like every zone edit; errors mapped in `errors.ts`. Integration tests cover each API matrix row, including two concurrent applies and a content manager editing the preset frame. Existing zone shape assertions gained `playbookKey: null`.
- Dashboard: Playbook section first on the zone page (applied label and goal, or "No playbook yet" and Apply playbook); drawer `applyPlaybook` with radios (goal as description), a preview of each frame's settings labelled from the frame-type schema (`describeSettings` in `settings-form.ts`) and its stage name and key, and a conflict warning (other playbook, stage key in use) that also refuses Apply without a request. After applying, the store adds only what the API created, and focus moves to the Playbook heading since the opener is gone.
- Merged `autopilot/foundation` at 7081607 (web zones story 9, SDK theme override) by fast-forward before committing; no file overlapped this story.
- No SDK, Delivery or sample page change: the created stages render through story 7's `stage` attribute (`?stages=home-stories-bar`).

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size` -- expected: passes.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:a11y` -- expected: 0 violations, all checks ok.

## Auto Run Result

**Summary:** A content manager can apply a playbook to a zone (R8). The contract ships a playbook registry with the two MVP presets, "Home page stories bar" (one bar: circle, medium, titles shown, start, gap 12) and "Promo banner" (one banner: 3:1, autoplay, 5 s, dots, loop), each with a stage per frame and no theme. `PUT /api/v1/zones/{zoneId}/playbook` creates the preset frames and stages and records `playbookKey` on the zone in one transaction with the zone row locked. Re-applying the zone's own playbook creates nothing, and another playbook or a stage key already in use is refused with nothing written. The dashboard zone page has a Playbook section, and its drawer shows each frame's settings and stage before applying. The created frames and stages are ordinary rows that stay editable, and the sample page renders them by stage through story 7.

**Files changed:**
- `libs/contract/` -- OpenAPI (`Zone.playbookKey`, `ApplyPlaybookRequest`, `AppliedPlaybook`, route, two error codes), generated types, `src/lib/playbooks.ts` + spec, `src/index.ts`.
- `libs/server/zones/src/` -- `lib/migration.ts`, `lib/zones.ts`, `lib/frames.ts`, `lib/playbooks.ts` + spec (new), `index.ts`.
- `apps/api/src/` -- `http/zones.router.ts`, `http/errors.ts`, `app.spec.ts`.
- `apps/dashboard/src/` -- `app/dashboard.store.ts`, `app/create-drawer.ts`/`.html`, `app/pages/zone-detail.ts`/`.html`, `app/settings-form.ts` + spec (`describeSettings`), `app/app.spec.ts`, `styles.css`.

**Verification (on the merged tip 7081607 plus this change):**
- `nx run-many -t lint test build` for the 12 projects -- passed, no lint warnings (api 319 tests, dashboard 200, web-sdk 217, server-zones 62, contract 94).
- `nx run web-sdk:size` -- passed, 11.08 KB gzipped.
- `nx run sdk-sample:a11y` -- 0 violations, all checks ok.

**Residual risks:**
- Not reviewed yet. The dashboard flow is covered by unit tests with a stubbed API, not a signed-in browser run against a live API. Applied playbooks were not rendered on the sample page end to end; that path is story 7's `stage` attribute and is covered by integration tests up to the Delivery response.
- The product choices recorded under Implementation Notes await confirmation: one playbook per zone, a refusal rather than a replacement, preset stage keys, and idempotency by the recorded key even after the frames are deleted.
- A playbook with several frames would need an explicit frame order, because frames created in one transaction share `created_at`.
