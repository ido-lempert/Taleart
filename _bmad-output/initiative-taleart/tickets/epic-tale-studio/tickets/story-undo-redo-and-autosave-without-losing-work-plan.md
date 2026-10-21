---
title: 'Undo, redo and autosave without losing work'
type: 'feature'
ticket: '3'
created: '2026-10-21'
status: 'built'
baseline_revision: 'ea6f5bf'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'thorough'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-arrange-elements-layers-list-canvas-background-and-safe-area-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Tale Studio saves only on a Save button, has no undo, and loses work on navigation or a 409: a stale save offers only "reload", which discards the person's edits (epic R9, R1). Story 7.2 made Delete immediate because nothing could undo it.

**Approach:** The tale gets a draft document beside its published one (user decision 2026-10-22): the studio edits and autosaves the draft, Delivery serves only the published one, and "Publish changes" / "Discard draft" move between them with compare-and-set on both revisions. Every document change goes through one history (snapshots of the immutable document, labelled, at least 100 steps, consecutive typing merged) with undo and redo from the keyboard and toolbar buttons. An autosaver saves the document debounced through the existing conditional PUT, one save at a time, retries network failures with backoff and shows saved, saving or failed. A 409 stops autosave and offers "Reload latest version" or "Keep my version as a new tale", a new atomic server operation that creates a draft tale in the same group holding the submitted document. Leaving with unsaved changes asks first (`beforeunload` and a `canDeactivate` guard).

## Boundaries & Constraints

**Always:**
- Draft and published (user decision 2026-10-22, AD-15, epic R1/R9): `PUT /tales/{id}/document` writes the draft (`draft_document`, `draft_revision`) and never the published `document`, which Delivery and the SDK read. `POST …/document/publish` and `…/document/discard` take `{ revision, publishedRevision }` and compare-and-set both (409 `stale_revision`). Setting a tale `live` while nothing of it is published yet (from any status) also publishes its draft after re-checking it (a failing draft is not published and the answer flags `draftNotPublished`); a tale with a published document keeps it on resume. Publishing a tale with no draft is refused (409 `nothing_to_publish`). Existing documents become both, same revision (idempotent migration). Keep-as-copy stores the draft, nothing published.
- History covers every document change: add, text edits, moves (arrow keys, fields, one step per drag), reorder, hide, lock, duplicate, delete, background colour. Selection, guides and editing state are not history. Limit 200 steps (at least 100), oldest dropped.
- Shortcuts: Cmd+Z / Shift+Cmd+Z on a Mac, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y elsewhere; letters by `event.key` when it is a Latin letter, else by `event.code` (non-Latin layouts). Handled anywhere in the studio except in a text entry field (input, textarea, contenteditable), where the browser's own text undo stays. Labels with ⌘ ⇧ on a Mac.
- Delete stays immediate and is undoable; it announces "Text deleted — press ⌘Z to undo" (Ctrl+Z off a Mac). Undo/redo announce what they undid ("Undone: Text moved") and keep focus on the control, else the canvas.
- Autosave: debounce 1 s, at most 5 s of continuous editing between saves; never two saves of one tale at once (edits during a save are coalesced into one next save of the latest document); network errors, 408, 429 and 5xx retry at 2, 4, 8, 16, 30 s and on the `online` event, with "Retry now"; 400/401/403/404/413 stop until the document changes or "Retry now". Undoing back to the saved document needs no save.
- Keep-as-copy: `POST /api/v1/tales/{taleId}/document/copy` `{ document }` → 201 `Tale`. One transaction: locks the group row, checks 100 tales per group (409 `tale_group_full`), inserts a `draft` tale at the end of the group with title "<title> (copy)", the source's media key (shared, AD-14), the document validated by the same rules (400/413) at revision 1. Authorized on the source tale's project (403), unknown tale 404.

**Never:** autosave changing what visitors see, collaborative merge, history persisted across sessions, history for selection, new npm packages, auto-retry of a refused (4xx) save, stealing focus when a save fails or conflicts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ten edits | add, move, reorder, hide… then 10× undo, 10× redo | document back to the start, then to the end; buttons enabled accordingly | undo at empty: "Nothing to undo" |
| Limit | 210 edits | 200 undoable, oldest dropped | — |
| Typing | type "Hello" in a text field | one history step; Cmd+Z inside the field is the browser's | — |
| Delete | Delete on a layer | removed at once; "Text deleted — press ⌘Z to undo"; undo restores and selects it | — |
| Debounce | 3 edits within 1 s | one PUT with the latest document | — |
| Serialize | edit while a PUT is in flight | no second PUT until it answers; then one PUT of the latest, with the new revision | — |
| Offline | PUT fails with status 0 | "Not saved" + retry in 2 s, 4 s…; "Retry now"; `online` retries | edits kept |
| Refused | 400 with pointer | element marked, message; no auto-retry | retried after the next change |
| Conflict | PUT answers 409 | alert: Reload latest version / Keep my version as a new tale; autosave stops; edits kept | — |
| Keep-as-copy | POST copy `{document}` | 201 draft tale in the same group, document at revision 1; studio opens it | group full 409; invalid 400; other project 403; unknown 404; >128 KB 413 |
| Leave | navigate away while dirty | flush save; if it fails or conflicts, confirm before leaving; `beforeunload` while dirty or saving | — |
| Reload page | after autosave | last saved draft shown | — |
| Autosave vs Delivery | live tale, three autosaves | Delivery still serves the published version | — |
| Publish changes | draft differs; click | flush, then POST publish with draft and published revisions; state reads "Published" | stale either revision → 409 → reload / keep-as-copy choice; invalid draft 400 |
| Discard draft | confirm | draft = published, draft revision + 1; one undo step that autosaves the old draft back | cancel → nothing; stale 409 |
| Status publish | never-published tale → live (from draft, or archived → paused → live) | its checked draft is published in the same transaction | already published: resume publishes nothing; failing draft: live, not published, `draftNotPublished` shown in the drawer |
| Nothing to publish | no draft stored, nothing changed | "Publish changes" disabled; server answers 409 `nothing_to_publish`, published document untouched | — |
| Publish vs autosave | edit while publish is on its way | autosave paused, edit kept, saved after on the same draft revision | discard holds editing ("Wait until the draft is discarded.") |
| Published elsewhere | publish 409, draft revision unchanged | reads state, retries once with the fresh published revision | draft moved → stale choice; focus/visibility refresh `published` |
| Migration | document, no draft | draft = document, same revision | — |
| Publish state | none / differs / same | "Draft — not visible to visitors" / "Unpublished changes …" / "Published …" (or "not live yet") | — |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml`, `src/lib/tale-document.ts`: copy, publish and discard routes; `published` in `TaleDocumentRevision`; `TaleDocumentRevisionsRequest`.
- `libs/server/tales/src/lib/migration.ts`, `tale-document.ts` (+ spec): draft columns and backfill; draft save, publish, discard.
- `libs/server/tales/src/lib/tales.ts`, `index.ts` (+ spec): `copyTaleWithDocument`.
- `apps/api/src/app.ts`, `http/tales.router.ts`, `http/errors.ts` (+ `app.spec.ts`): route, body limit, 413 mapping.
- `apps/dashboard/src/app/pages/tale-history.ts` (new, + spec): the history.
- `apps/dashboard/src/app/pages/tale-autosave.ts` (new, + spec): the autosaver.
- `apps/dashboard/src/app/pages/tale-layers.ts` (+ spec): undo/redo shortcut parsing and labels; Latin-key-first letters.
- `apps/dashboard/src/app/pages/tale-studio.ts` (+ spec), `tale-document.service.ts`, `app.routes.ts`, `icon.ts`, `styles.css`: wiring, toolbar, indicator, conflict choice, guards.

## Tasks & Acceptance

**Execution:**
- [x] contract: openapi route and request schema, `contract:generate`, type export.
- [x] server-tales: `copyTaleWithDocument` with tests (atomic, full group, invalid, unknown).
- [x] api: route, body parser, 413 mapping, tests for 201/400/403/404/409/413.
- [x] dashboard: history and autosaver with unit tests (fake timers) for every matrix row.
- [x] dashboard: studio wiring, toolbar, indicator, conflict choice, guards; component tests.
- [x] draft and publish (user decision 2026-10-22): contract, migration, storage, status-publish path, routes, studio state and buttons, with tests; AD-15, memlog and epic R1/R9 updated.

**Acceptance Criteria:**
- Given ten edits (add, move, reorder, hide), when undone ten times and redone ten times, then the document matches the start and the end state, and the autosaved document equals the end state.
- Given a tale open in two tabs, when both edit, then the second save offers reload or keep-as-copy, and keep-as-copy creates a new draft tale in the same group with that content.
- Given a live tale, when it is edited and autosaved, then the sample page shows the published version until "Publish changes".
- Given the full verification run, all projects lint, test and build; `web-sdk:size`, `sdk-sample:a11y` and `sdk-sample:perf` pass unchanged.

## Implementation Notes

- Assumptions. None is a product decision the epic settles beyond what is cited; each is recorded for review.
  - **Draft and published (user decision 2026-10-22).** The first build read "draft document" as the single document; the user decided that autosave must not change what visitors see. The `document`/`document_revision` columns stay the published document (so Delivery, its cache key and the SDK are unchanged); `draft_document`/`draft_revision` are added. GET and PUT of `/document` now read and write the draft and also answer `published: { document, revision }` (additive). Publish copies the draft in one conditional UPDATE on both revisions after re-checking the draft; discard copies the other way. The status-publish path is `draft` → `live` only (AD-6's "publish"); resume (`paused` → `live`) keeps the published version, so a resume never shows unreviewed edits. Copy to zone copies both documents. Discard is undoable in the session: the studio records it as a history step, and undo autosaves the old draft back. The studio compares draft and published by content (JSONB returns keys in its own order). "Publish changes" waits for unsaved changes to save first; a 409 on publish or discard opens the same reload / keep-as-copy choice. Discard is offered only when something is published.
  - History is snapshot-based: each step keeps the immutable document before and after, with a label. 200 steps (epic: at least 100), oldest dropped; per editing session (cleared on reload of the latest version and on opening another tale). Merged into one step: typing in one text until a 1 s pause or leaving the field, and a held arrow key (`event.repeat`); each separate key press, field change, drag and command is one step. A change that leaves the document as it was is no step.
  - Undo/redo shortcuts work anywhere in the studio except in text entry fields (inputs other than checkbox/radio/colour/button types, textareas, selects, contenteditable), where the browser's own text undo stays. Off a Mac, Ctrl+Y also redoes. Toolbar buttons use `aria-disabled` (not `disabled`) so focus is not lost when the stack empties; pressing one then says "Nothing to undo".
  - Letter shortcuts now take the Latin letter typed (`event.key`) first and fall back to `event.code` only on non-Latin layouts. This keeps Hebrew working and fixes AZERTY, where `event.code` `KeyQ` is the key labelled A (7.2's Ctrl+A, and Ctrl+Z here, were mismatched there).
  - After undo/redo: layers it brings back are selected; other selected layers that no longer exist leave the selection; focus returns to the control that had it, else the canvas; it announces "Undone: <label>" / "Redone: <label>". Delete stays immediate and announces "Text deleted — press ⌘Z to undo" (Ctrl+Z off a Mac).
  - Autosave: debounce 1 s, at most 5 s of continuous changes; one save in flight per tale, later changes coalesced into one next save on the returned revision; network errors, 408, 429 and 5xx retry at 2, 4, 8, 16, 30 s (repeating) and at once on `online`, with "Retry now"; 400/401/403/404/413 are shown and wait for the next change or "Retry now"; 409 stops autosave and shows the choice. The indicator (plain text, not a live region, so screen readers are not told on every edit) shows "All changes saved", "Unsaved changes", "Saving…", "Not saved" or "Not saved: a newer version exists"; failures appear in a `role="alert"` block without moving focus, and recovery is announced once ("All changes saved"). The manual Save button is gone.
  - Leaving: the studio route's `canDeactivate` lets the page flush unsaved changes (waiting up to 5 s); if they cannot be saved (failure, timeout or a stale refusal) it asks with `window.confirm`. `beforeunload` asks while anything is unsaved and starts a save meanwhile.
  - Keep-as-copy: `POST /api/v1/tales/{taleId}/document/copy` with `{ document }` answers 201 with the new `Tale`. The new tale goes at the **end** of the group (as `createTale` does), titled "<title> (copy)", status `draft`, unscheduled, sharing the source's media key (AD-14), holding the submitted document (element ids kept: it is the same person's version, not R11's duplicate) at revision 1. Authorization is the source tale's project (the copy stays in its group, so the same project). Then the studio refreshes the store, navigates to the copy's studio and says where the version went.
  - The 413 mapping and the 256 KB body parser cover the copy route too.
- Design. `tale-history.ts` (pure stack) and `tale-autosave.ts` (`TaleAutosaver`: timers, serialization, retry, flush; `AUTOSAVE_TIMING` token so tests shorten it) are framework-free classes. The studio routes every change through `commit()`; a drag shows live and records one step at its end. The page re-initialises on a `taleId` change (`ngOnChanges`), since Angular reuses it when keep-as-copy navigates to another tale's studio.
- Dashboard bundle: after merging `autopilot/foundation` fe8c9b6 (lazy routes), the initial bundle is 493.5 KB, within the 500 KB budget; the lazy studio chunk is 53.9 KB (38 KB before this story). The studio route stays lazy, with its `canDeactivate` guard.
- Not verified by hand: a browser walk with two real tabs and a screen reader. Component tests cover each matrix row with a mocked API; API tests cover the two-tab conflict and keep-as-copy against the test database.

## Plan Change Log

### 2026-10-22 — User decision: draft and published documents
- **Trigger:** the user decided autosave must not change what visitors see (the first build's one-document reading let autosaved edits of a live tale go live).
- **Amended:** Approach, Always/Never, matrix (six new rows), Code Map, tasks and acceptance; AD-15, the architecture memlog and epic R1/R9 record the decision.
- **Avoids:** visitors seeing half-finished edits of a live tale.
- **KEEP:** history, autosaver, conflict flow and keep-as-copy, which now act on the draft unchanged.

## Review Triage Log

### 2026-10-22 — Coordinator review (draft and publish)
- **Verdicts:** 12 findings, all patched. `autopilot/foundation` merged first (already at fe8c9b6; 00894d4 merged before the final verification).
- **Findings:**
  1. `[patch]` Keep-as-copy could autosave to the original while it was on its way. Autosave pauses and editing is held from the first await until the copy's studio opens (`ngOnChanges` resets it); if opening fails the page stays in the stale choice. Tested: an edit while keeping is refused and no PUT reaches the original; a failed navigation keeps the choice.
  2. `[patch]` Publish and discard raced autosave. After the flush, autosave pauses (edits are kept, nothing is sent) and resumes after on the draft revision left; discard holds editing. Tested: an edit during publish saves after it on the same revision, no self-conflict.
  3. `[patch]` Publishing with no draft could empty the published document. The server refuses with 409 `nothing_to_publish` (also in the conditional UPDATE); the studio disables "Publish changes" until a draft is stored or changed. Tested (server, API, studio).
  4. `[patch]` A tale published from the zone page made the studio's publish stale. A publish/discard 409 reads the state; when only the published revision moved it retries once; the studio also refreshes `published` on window focus and visibility. Tested.
  5. `[patch]` Status-path publish did not re-check the draft. It runs `checkTaleDocument`; a failing draft is not published, the status still changes, and the answer carries `draftNotPublished`, which the drawer shows ("Tale is live; its studio draft has problems and wasn't published"). Tested.
  6. `[patch]` The status rule keyed on `draft` → `live`. It now keys on nothing published yet (`document IS NULL OR document_revision = 0`) from any status. Tested archive → paused → live of a never-published tale, and a resume with a published document.
  7. `[patch]` `copyTaleWithDocument` now share-locks the source tale after the group lock. SQL-order unit test.
  8. `[patch]` Returning to a refused document cleared the refusal. It is refused again (alert block, Retry now, marked element) and not resent. Tested (autosaver and studio).
  9. `[patch]` `flush()` resent a refused document. It returns false for it, so leaving asks. Tested.
  10. `[patch]` The retry alert was re-inserted each cycle. One always-present alert region announces the first failure only; the visible block (no role) stays through retries with a countdown and a "Retry now" that stays in the DOM (aria-disabled while saving), keeping focus; recovery is announced once; `reload()` focuses the canvas. Tested.
  11. `[patch]` A live tale with nothing published read as a draft. It now says "Live — visitors see the tale's media; studio changes aren't published yet." Tested.
  12. `[patch]` Epic R1's Verify line now includes the publish step; AD-15, the memlog and R9 record findings 3, 5 and 6.

## Auto Run Result

**Summary:**
- **Contract:** `POST /tales/{taleId}/document/copy` with `CopyTaleDocumentRequest`; `contract:generate` run.
- **Tales module:** `copyTaleWithDocument`: checks the document as a save does, then in one transaction locks the group row, enforces 100 tales per group, and inserts a draft "<title> (copy)" at the end of the group with the source's media key and the document at revision 1.
- **API:** the route (taleAccess authorization, 404, 400, 409 `tale_group_full`, 413), the 256 KB body parser and 413 mapping for it.
- **Draft and publish (user decision 2026-10-22):** `draft_document`/`draft_revision` beside the published `document`/`document_revision` (backfilled at the same revision); the studio's GET/PUT act on the draft and also answer `published`; `POST …/document/publish` and `…/discard` compare-and-set both revisions; publishing a draft tale publishes its draft; Delivery and the SDK read only the published document. The studio shows "Draft — not visible to visitors", "Unpublished changes …" or "Published …", with "Publish changes" and "Discard draft" (asks first; undoable).
- **Dashboard (Tale Studio):** a history of every document change (200 steps; typing and held arrows merged; one step per drag) with Undo/Redo toolbar buttons and Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y outside text fields; debounced, serialized autosave with retry/backoff, `online` retry, "Retry now" and a saved/saving/failed indicator; on 409 a choice of "Reload latest version" or "Keep my version as a new tale"; `canDeactivate` and `beforeunload` guards; undoable Delete with "press ⌘Z/Ctrl+Z to undo"; undo/redo icons; Latin-key-first shortcut letters (AZERTY fix).

**Files changed:** `libs/contract/openapi/openapi.yaml`, `libs/contract/src/generated/api.ts`, `libs/contract/src/lib/tale-document.ts`; `libs/server/tales/src/lib/tales.ts` (+ spec), `libs/server/tales/src/index.ts`; `apps/api/src/app.ts`, `apps/api/src/http/tales.router.ts`, `apps/api/src/http/errors.ts`, `apps/api/src/app.spec.ts`; `apps/dashboard/src/app/pages/tale-history.ts` (+ spec, new), `tale-autosave.ts` (+ spec, new), `tale-layers.ts` (+ spec), `tale-studio.ts` (+ spec), `apps/dashboard/src/app/tale-document.service.ts`, `app.routes.ts`, `icon.ts`, `styles.css`.

**Verification:**
- First build: `run-many` passed; api 381, dashboard 286, server-tales 100.
- After draft and publish, on the merge with `autopilot/foundation` fe8c9b6 (`--skip-nx-cache`): `run-many -t lint test build` on the 12 projects passes. Test counts: api 393 (11 new for this story's draft/publish and keep-as-copy rows, plus the foundation's), dashboard 295, server-tales 104, contract 109, web-sdk 264.
- `web-sdk:size`: 13.88 KB gzipped (unchanged).
- `sdk-sample:a11y`: WCAG 2.2 AA scan, no violations.
- `sdk-sample:perf`: cold p75 first content 1,255 ms (≤ 1,500 ms), warm p75 754 ms.
- After the review fixes, on the merge with `autopilot/foundation` 00894d4 (`--skip-nx-cache`): `run-many -t lint test build` on the 12 projects passes. Test counts: api 396, dashboard 305, server-tales 105, contract 109. Dashboard initial bundle 493.9 KB; lazy studio chunk 57.9 KB.
- `web-sdk:size`: 14.54 KB gzipped (the foundation's 3.12 viewer changes; this story adds nothing to the SDK).
- `sdk-sample:a11y`: WCAG 2.2 AA scan, no violations.
- `sdk-sample:perf`: cold p75 first content 1,261 ms (≤ 1,500 ms), warm p75 769 ms.

**Residual risks:**
- "Publish changes" publishes the document only; a tale that is not live stays unseen, and the studio says so. The tale's own status is still set from the zone page.
- `window.confirm` is the leave prompt inside the app (accessible but plain); browsers show their own generic text for `beforeunload`.
- History is in memory only; a page reload starts a new session (the autosaved document is shown).
- The canvas text field's `[value]` binding is rewritten on each keystroke; native text undo inside fields depends on the browser keeping its undo stack when the value is unchanged (unchanged from 7.1).

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --skip-nx-cache` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size` -- expected: 50 KB or less gzipped.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:a11y` -- expected: 0 violations.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:perf` -- expected: p75 cold first content 1.5 s or less.
