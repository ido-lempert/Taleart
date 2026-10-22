---
title: 'Imported tales keep their call to action'
type: 'feature'
ticket: '13'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-turn-every-existing-tale-into-a-document-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-storyly-importer/import-mapping.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The External API exposes a story's call to action only as `button_text`, `outlink` and `deep_link` (digest studio-r4-1); the importer lists all three as "not held", so imported tales lose their CTA, and the report does not say that text, stickers and components cannot be read at all (epic R17).

**Approach:** The record check reads the CTA of each story: a usable label plus an `http`/`https` link (outlink first, else deep_link) passing the contract's one URL rule `linkUrlProblem`. The importer carries it as a `button` element at the bottom of the safe area through a new compare-and-set call of the tales module (`setImportedButtonWhen`), in the same transaction as the tale's creation or re-import update, and keeps a baseline (element id, label, href) in `import_records` so a re-import follows the source unless a person changed the button (AD-7, importer 2.7). The report gains a difference kind `linkNotImported` (with the URL rule's reason) and a count `unreadableLayers` (imported tales whose text, stickers and components the API does not expose).

## Boundaries & Constraints

**Always:**
- Label: `button_text` as text, whitespace runs (line feeds, tabs) become one space, characters the label rule refuses are dropped (`cleanText`, `LABEL_TEXT_RULE`), trimmed, NFC, cut to 80 code points with "…" (a note says so). Blank after this: no button.
- Link: trimmed, then `linkUrlProblem` must answer null. A link with any other value is never written into a document and is listed as `linkNotImported` with the rule's reason (`scheme` for `myapp://` or `javascript:`, `tooLong` past 2,048, `characters`, `invalid`, `credentials`). Link values never appear in the report, only field names.
- Carried CTA: the `notHeld` rows of `button_text` and of the link field used are not listed; an unused valid link stays `notHeld`. Not carried: the rows stay as before (a refused link only as `linkNotImported`).
- Element: `button`, `newButtonProps()` look, `IMPORTED_BUTTON_BOX` (contract: centred, bottom edge on the bottom safe area, `{x 0.2, y 0.77, w 0.6, h 0.07}`), on top of the z-order, same tab. A tale with no document gets a draft only (new, 5 s); its first media step publishes that draft with the media (`publishDraft`) when the tale is `live` and the draft is still the import's, so a tale is never delivered as a button alone (a failed or unpicked media copy publishes nothing). Otherwise the draft always takes the write, and the published document only while it is still exactly what the import left: its fingerprint (`md5` of the stored `jsonb`) equals the one recorded in `import_records.fields.documents`, or, with none recorded (a tale imported before 7.13), it is a document of only the tale's media. A published document a person changed is never written: the change waits in the draft ("not updated yet"). A draft is made from the published document only when that one is a person's and there is no draft.
- Re-import, per field (label → `button_text`, href → the link field used), with `mergeValue` against the baseline and the draft's value (else published): untouched follows the source, in each document whose value still equals the one merged; a person's change is kept (`keptLocalEdit` when the source changed too); a button a person deleted is never added back (listed once per change at the source: "You removed the button; the source's change was not added"). The source dropping its CTA leaves the button and lists `removedAtSource` on `button_text`; a label whose links all turned invalid keeps the earlier link (a note, plus `linkNotImported`). A tale imported before this story gets the button on its next import, unless it already has a button to the same address. `setImportedButtonWhen` is the single gate: it refuses a label or href that fails the label rule or `linkUrlProblem`.
- Each changed document raises its revision and rewrites `tale_media`/`tale_fonts` rows; a write that would make a passing document fail (60 elements) is skipped with a note.
- Every imported tale (created or linked, not one deleted meanwhile) is counted in the report's `unreadableLayers`, shown once: "Text, stickers and components of N tales: not readable through the API, so not imported." Not a difference, so not charged to the 5,000 budget.
- No brand names in UI text; wording follows the report's existing lines.

**Never:** a link other than `http(s)` in a document; deleting a button on re-import; new npm packages; a document version change; source values (URLs) in the report or baselines other than TaleArt values (the href and label are TaleArt values once written).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| https outlink | `button_text` "Shop now", outlink `https://…` | button, label and href; no CTA notHeld rows; counted in `unreadableLayers` | — |
| http deep_link | label + deep_link `http://…`, no outlink | button with the deep link | — |
| myapp:// | label + deep_link `myapp://home` | no button; `deep_link: link not imported (not an http or https link)`; `button_text` notHeld | — |
| javascript: | outlink `javascript:alert(1)` | same, reason scheme | — |
| 2,049 chars | outlink too long | listed `tooLong`, no button | — |
| outlink + myapp deep_link | both | button with outlink; deep_link listed | — |
| label normalisation | "  See\n what's\tnew " / 100 chars / only controls | "See what's new" / 80 with … and a note / no button | — |
| re-import, source label changed | untouched button | label updated in draft and published; tale `updated` | — |
| re-import, person edited label | label differs from baseline | kept; `button_text: changed at the source, kept…` when source changed | — |
| re-import, person deleted button | — | not added back | — |
| re-import twice | nothing changed | unchanged, no write | — |

</intent-contract>

## Code Map

- `libs/contract/openapi/openapi.yaml` -- `ImportDifferenceKind` + `linkNotImported`; `ImportReport.unreadableLayers`; `ImportLinkFailure`; `reason` becomes `anyOf`.
- `libs/contract/src/lib/tale-document.ts` -- `IMPORTED_BUTTON_BOX`.
- `libs/server/tales/src/lib/imported-button.ts` (new) -- pure merge + `setImportedButtonWhen`; exported from `index.ts`.
- `libs/server/importer/src/lib/record-shape.ts` -- CTA reading, row replacement, `linkNotImported` rows.
- `libs/server/importer/src/lib/storyly-client.ts` -- `SourceStory.callToAction`.
- `libs/server/importer/src/lib/reimport.ts` -- `RecordFields.button`.
- `libs/server/importer/src/lib/worker.ts` -- carry on create and re-import; report rows and notes.
- `apps/dashboard/src/app/pages/import-shared.ts` -- lines for the new kinds.
- `apps/fake-storyly/src/fixtures/*` -- "Link shop" (app 1006).
- `apps/api/src/app.spec.ts` -- end-to-end tests.

## Tasks & Acceptance

**Execution:**
- [x] contract: kinds, reason, box; generate.
- [x] server-tales: imported button merge and write; unit tests.
- [x] importer: CTA reading, carrying, re-import; unit tests (record-shape, worker with fake source).
- [x] fake-storyly: Link shop fixture.
- [x] api: HTTP tests against the fake (create, report, re-import, person edit, idempotency).
- [x] dashboard: report lines; tests.
- [x] Playwright walk; screenshots in `shots-7.13/`.

**Acceptance Criteria:**
- Given the Link shop import, when the sample page shows the zone, then the "Shop the sale" tale shows a button that opens its link.
- Given the source label changed, when re-imported, then the delivered button shows the new label; given a person's edit, then it is kept.
- Given the full verification, every project lints, tests and builds; `api:import-scale` passes.

## Implementation Notes

- Merged `autopilot/foundation` 8c5c105 (8.7 zone keys removed, 8.9) mid-build; no conflicts.
- Contract: `ImportDifferenceKind` + `linkNotImported` (`notReadable` removed in review, now `ImportReport.unreadableLayers`); new `ImportLinkFailure` (`scheme|tooLong|characters|invalid|credentials`, the `linkUrlProblem` values; `empty` never listed); `ImportDifference.reason` is now `anyOf` (shared `tooLong` would fail `oneOf`); `IMPORTED_BUTTON_BOX` `{0.2, 0.77, 0.6, 0.07}`.
- Tales module: `imported-button.ts` (`withImportedButton` pure merge, `setImportedButtonWhen` compare-and-set with the tale row `FOR UPDATE`, media keys share-locked, revisions raised, `tale_media`/`tale_fonts` rewritten, `checkTaleDocument` limit guard). A tale with no documents gets a draft, plus a published document when `live`; otherwise only the documents it has are written (no draft is made from the published document).
- Importer: `record-shape.ts` reads the CTA (`buttonLabel`, `linkFailure`) and replaces the rows; `worker.ts` `carryButton` runs in the creation transaction (link, button, baseline `import_records.fields.button`) and in the re-import `updateRecord` transaction; a written button counts the tale `updated`. Each imported tale is counted in `unreadableLayers` (review: was a `notReadable` row); notes for a cut label (only when written) and for a write skipped at the limits.
- Report wording (dashboard): `deep_link: link not imported (not an http or https link)` (also `longer than 2,048 characters`, `holds spaces or control characters`, `not a valid web address`, `holds a user name or password`); `text, stickers and components: not readable through the API, so not imported`; `button_text: no longer at the source; the button stays in TaleArt`; kept edits reuse `button_text: changed at the source, kept as changed in TaleArt`.
- Fixture: app 1006 "Link shop" → instance 2501 "Link wall" → group 3501 "Calls to action", stories 4501–4507 (https outlink, http deep link with a messy label, `myapp://`, `javascript:`, 2,061-char URL, outlink + `myapp://`, a passive one).
- Existing tests updated for the new rows: the Odd shop's 4101 (https deep link + label) is now a button; reports now carry `unreadableLayers` (Clean shop 2, Demo shop 15).
- Verification (2026-10-22, `taleart_w713_test`): `run-many -t lint test build` on the 12 projects passes (api 553, dashboard 509, server-importer 282, server-tales 270, contract 333, web-sdk 382, fake-storyly 18 tests); `web-sdk:size` 23.51 KB gzipped; `web-sdk:types-check` passes; `api:import-scale` 1,000 tales passes (40 s).
- Playwright walk (API 3396 / dashboard 4296 / sample 4396 on `taleart_w713e2e_test`, fake Storyly in-process on 4496, virtual passkey): 17 of 17 checks — report rows, the "Shop now" button on the sample page (`?zones=<slug>#siteKey=…`) opening `https://shop.example/sale` (routed locally), re-import after the source label changed shows "Shop the sale now". Screenshots in the scratchpad `shots-7.13/`.

## Plan Change Log

## Review Triage Log

### 2026-10-22 — Coordinator review
- Security and lock order held. Merged `autopilot/foundation` (a60da61, then 8906799 with 7.8 and 8.10).
- MUST 1 `[patch]` No-document tales get a draft only; `bringTaleMediaInStep` `publishDraft` publishes the import's draft with the media (`setTaleMediaIfNone` option, used by the importer when the recorded draft fingerprint matches). Tests: media failing, media not picked.
- MUST 2 `[patch]` Published writes only while the published fingerprint matches the import's record (fallback: media-only document); otherwise draft only. The media step records fingerprints under the tale's baseline lock. No second button to the same address (`exists`). Public caches cleared after a published write. Tests: a pre-7.13 tale with a person's own button; a person-updated tale gets draft-only changes, published on the person's update.
- SHOULD 3 `[patch]` `setImportedButtonWhen` refuses an invalid href or label (`invalid`).
- SHOULD 4 `[patch]` A label whose links all became invalid: `linkNotImported` plus "its button keeps its earlier link", no `removedAtSource`. Tests: valid to invalid; outlink to deep_link.
- SHOULD 5 `[patch]` Skip reasons reach the notes; "label was cut to 80 characters" only when the label was written, from `MAX_LINK_LABEL_LENGTH`.
- SHOULD 6 `[patch]` Deleted button: `keptLocalEdit` with field `button`, "You removed the button; the source's change was not added", listed and counted once per change (the source's values become the baseline).
- SHOULD 7 `[patch]` `notReadable` kind removed; `ImportReport.unreadableLayers` count, not charged to the budget, not counted for tales deleted meanwhile.
- SHOULD 8 `[patch]` This plan's element bullet rewritten.
- Tests added: DB-level `setImportedButtonWhen` (element limit, malformed, invalid label/href, `exists`, `tale_media` and `tale_fonts` rows, published-only tale, live tale with no document gets a draft only); an editor's autosave on an older revision after a re-import gets 409.

## Design Notes

- The baseline lives in `import_records.fields.button` (`{id, label, href}`): TaleArt values keyed by the tale, never source ids (AD-7). The element id is how the import finds its button; nothing is added to the element (no contract prop).
- Decision on the draft: the person's working copy decides (as the studio shows it); the published document is only written where it still holds the merged value, so a published edit is never overwritten.

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w713_test node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- all succeed.
- `node_modules/.bin/nx run web-sdk:size`, `web-sdk:types-check`, `api:import-scale` -- pass.
