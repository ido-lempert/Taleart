---
title: 'Tale Studio says Update tale and speaks the indicator''s words'
type: 'feature'
ticket: '4'
created: '2026-10-22'
status: 'built'
baseline_revision: '793f2e8'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-every-zone-group-and-tale-says-whether-it-is-visible-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md#ad-15'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Tale Studio said "Publish changes" and "Discard draft", and its status line had its own words ("Published — visitors see this version", "Draft — not visible to visitors"). Since D4, "Publish" and "On" only mean visibility, so the studio used the word for something else, and its line could disagree with the indicator on the zone page (epic R15).

**Approach:** Rename the controls to "Update tale" and "Discard changes", take "Publish" out of every studio text, and build the status line from the tale's `visibility` as the Management API reads it (story 8.2), with the same words as the indicator, plus whether the draft is up to date. The store is read again after Update tale and when the page comes back into view, so the line is current. Behaviour stays as AD-15: Update tale copies the draft to the published document.

## Boundaries & Constraints

**Always:**
- Status line (`#studio-update-state`), from `visibilitySummary(visibility, 'tale')`:
  - visible: "Visible on site · up to date" or "Visible on site · changes not updated yet";
  - not visible: "Not visible: <first reason>", and when the draft differs, " · <n> changes not updated yet" ("1 change").
  - Before the visibility is read: "Up to date" or "Changes not updated yet".
- The tale's visibility is the one the store lists: visible when visible in any zone it is listed in, else as the first zone lists it. Once something is published, a `not-updated-yet` reason is dropped before the store is read again.
- `n` is `changeCount(draft, published)` (`tale-history.ts`): each layer added, removed or changed, a new layer order, and a change to the tale itself (canvas, duration) count one each; against nothing published, each layer counts one; never under 1 when they differ.
- A dot, filled when visible and hollow when not, starts the line, as on the indicator (decorative).
- Update tale refreshes the store and announces "Tale updated. Visitors now see this version.", or "Tale updated. <line>." when not visible. Focus or a return to the tab reads the published document and the store again.
- No "Publish" in the studio: labels, ids, `aria-*`, tooltips, error and confirm texts, announcements and the inspector's alt-text and contrast hints. The contract's alt-text refusal says "before the tale can be updated"; the zone page's warning after showing a tale whose draft fails says "Open Tale Studio to fix it, then press Update tale."

**Never:** a new endpoint or stored field; changing what update and discard do on the server; renaming the `/document/publish` route or the service's method names (code, not words).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Visible, in step | draft equals published | "Visible on site · up to date"; Update and Discard disabled | No error expected |
| Visible, edited | one edit | "Visible on site · changes not updated yet"; Delivery unchanged | No error expected |
| Update | press Update tale | published = draft; store read again; "Visible on site · up to date" | refused draft: "The tale could not be updated…" |
| Group off | group `paused` | "Not visible: group is off", with " · 2 changes not updated yet" after two edits | No error expected |
| Nothing published | Shown tale, no published document | "Not visible: not updated yet · 3 changes not updated yet" | No error expected |
| Updated, store not read yet | nothing published, then Update | `not-updated-yet` dropped at once | No error expected |

</intent-contract>

## Code Map

- `apps/dashboard/src/app/pages/tale-studio.ts`: the update bar, `siteVisibility`, `statusLine`, `updateTale`, `discardChanges`, refresh after update and on focus.
- `apps/dashboard/src/app/pages/tale-history.ts`: `changeCount`.
- `apps/dashboard/src/styles.css`: `.studio-update` and its dot.
- `apps/dashboard/src/app/pages/tale-media.ts`, `tale-text-style.ts`, `tale-document.service.ts`: words.
- `libs/contract/src/lib/tale-document.ts`: the alt-text refusal's words. `apps/dashboard/src/app/dashboard.store.ts`: the show-tale warning's words.

## Tasks & Acceptance

**Execution:**
- [x] `tale-studio.ts` -- rename, status line from the indicator, store refresh after update and on focus.
- [x] `tale-history.ts` -- `changeCount` and its spec.
- [x] Words in the media, text-style, service, contract and store messages; the specs that quote them.
- [x] `tale-studio.spec.ts` -- labels, the three line states, group Off, nothing published, refresh after update, and a scan of the rendered studio (text and every attribute, through selecting an image without alt text, adding a text and a refused update) that finds no "publish".

**Acceptance Criteria:**
- Given a visible tale, when it is edited, then the line says changes are not updated yet and Delivery serves the old document; when Update tale is pressed, Delivery serves the edit and the line says up to date.
- Given the tale's group is Off, when the studio opens, then the line says "Not visible: group is off".

## Implementation Notes

- Ids and classes moved too (`#studio-update`, `#studio-update-state`, `.studio-update`), so the scan can check every attribute.
- The visibility comes from the zone lists in the store (no `GET /tales/{id}`). A tale listed in several zones reads as visible when any zone shows it, matching "visible on site".
- The window focus and `visibilitychange` handlers now also call `store.refresh()`; the store's run counter keeps only the newest answer.

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool` -- expected: all pass.
- `web-sdk:size`, `web-sdk:types-check` -- expected: pass. Dashboard initial bundle under 500 kB.

**Manual checks:**
- Playwright on a fresh database (`shots-8.4/`): a visible tale edited (line not updated yet, Delivery unchanged), Update tale (Delivery shows the edit, line up to date), group Off ("Not visible: group is off").
