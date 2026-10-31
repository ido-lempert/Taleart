---
title: 'The tale drawer saves status at once and closes with Done'
type: 'feature'
ticket: '12'
created: '2026-10-22'
status: 'built'
baseline_revision: '3a203ff'
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
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/tickets/story-open-a-group-to-show-or-hide-each-tale-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The tale drawer's footer is Cancel / Upload, but its status switch and actions save at once, so Cancel undoes nothing and suggests it does; replacing media needs a pick and then a footer button (epic R12, report §6 #8).

**Approach:** The edit drawer of an existing tale (`taleMedia`) puts the title, Shown/Hidden switch, badge and status actions at the top (saving at once, announced, as now), then the schedule summary and Edit in Tale Studio, then a Media section with the preview and its own **Replace media** button (Add media when none) that opens the file picker and uploads the picked file at once, with client-side validation, a progress bar, an error, and an announcement when done. The footer has one **Done** button. The new-tale drawer (`tale`) keeps Cancel / Add.

## Boundaries & Constraints

**Always:**
- Status changes and media replacement save as they happen; a line says so ("Changes save as you make them."); Done only closes.
- Done, Escape and the close button wait only for a status save (the drawer's `busy`); during a media upload they close the drawer and cancel the upload (review fix: the drawer says so under the progress bar, which has its own Cancel upload).
- Replace media from the group view's ⋯ opens the drawer with focus on the Replace media button; from a card, focus goes to the first control (the switch).
- Client-side check before upload: type in `MEDIA_CONTENT_TYPES`, images ≤ 10 MB, videos ≤ 100 MB; the API's message shows for anything it refuses.
- Initial dashboard bundle under 500 kB.

**Never:** API or contract changes; a title field in the edit drawer (titles are edited in Tale Studio; the drawer has no editable field, so Done has nothing pending to lose); changes to the Tale groups page or the shared group row (8.14).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hide then Done | Shown tale, press switch, Done | `PUT /tales/{id}/status` paused at once, "Status: Hidden" announced; Done closes; card stays Hidden | Refusal: alert in drawer, switch unchanged |
| Replace media | pick a PNG | PUT media at once, progress shown, "Media replaced." announced, preview and card update | API refusal: alert, previous media kept |
| Wrong type / too large | pick a PDF or an 11 MB PNG | message, no request | — |
| Upload in flight | Done / Escape / × / Cancel upload | the request is aborted, the media kept; Cancel upload announces "Upload cancelled." | — |
| New tale | Add tale | Cancel / Add as before; a refused file switches to the edit drawer with the message | — |

</intent-contract>

## Code Map

- `apps/dashboard/src/app/create-drawer.html` -- tale edit branch layout, Replace media button and hidden input, progress, footer Done.
- `apps/dashboard/src/app/create-drawer.ts` -- `replaceMedia`, client validation, progress signal, focus target.
- `apps/dashboard/src/app/dashboard.store.ts` -- `uploadTaleMedia` reports upload progress.
- `libs/contract` -- read only: `MEDIA_CONTENT_TYPES`.
- `apps/dashboard/src/styles.css` -- small rules for the media section.
- `apps/dashboard/src/app/app.spec.ts` -- specs.

## Tasks & Acceptance

**Execution:**
- [x] `create-drawer.*`, `dashboard.store.ts` -- the layout, Replace media flow and Done footer.
- [x] `app.spec.ts` -- status saves at once and is announced; Done keeps it; Replace media (validation, progress, error, success updates the card); no Cancel; new-tale flow; focus from the view's ⋯ and the card.
- [x] Playwright run with screenshots, axe, 390 px.

**Acceptance Criteria:**
- Given a Shown tale in a group that is On, when it is hidden in the drawer and Done is pressed, then it stays hidden on the card and the sample page.
- Given a tale with media, when Replace media uploads a new file, then the sample page shows the new media.
- Given any existing tale's drawer, then it has no Cancel button.

## Implementation Notes

- **Layout (`create-drawer.html`, `taleMedia` branch):** a status section first (title, Shown/Hidden switch, badge when needed, Archive/Restore, the blocked-by-group hint, "Changes save as you make them."), then the schedule summary (only with a window), the status warning, the live region and Edit in Tale Studio, then a **Media** section (`h3`) with the preview, a **Replace media** button (**Add media** when the tale has none), the hint and, while uploading, a labelled `<progress>` with "Uploading… n%". Footer: one primary **Done** (disabled while a save is in flight, like Escape and ×, through the drawer's `busy`). Enter in the form also only closes.
- **Replace media:** the button clicks a `hidden` file input (out of the tab order and the accessibility tree); `change` uploads at once. Client check first (`isMediaContentType`, `maxMediaBytes` from the contract): a PDF or an oversized file shows the message and sends nothing. The input is cleared after each pick so the same file can be picked again. Success announces "Media replaced." in the drawer's live region; the preview and the card show the new version (`?v=`). An API refusal shows its message; the old media stays.
- **Progress:** `DashboardStore.uploadTaleMedia(taleId, file, progress?)` sends with `observe: 'events'`, `reportProgress` and reports `UploadProgress` (the app uses the XHR backend, so upload progress exists). Subscribed directly (no `tap`/`lastValueFrom`) to keep the initial bundle small.
- **Field edits / Done:** the edit drawer has no title or other typed field (titles are edited in Tale Studio), so Done has no pending edit to lose; every change in it (status, archive, media) saves as it is made. A spec asserts the body has no text input.
- **Focus:** Replace media from the group view's ⋯ opens with focus on `#tale-replace-media` (was `#create-file`); from a card, the first control (the switch). Done returns focus to the opener (card or ⋯).
- **New tale (`tale`)** is unchanged: Cancel / Add with the optional file; a refused file switches to the edit drawer with the message, now with Add media and Done.
- **Specs (`app.spec.ts`):** replaced the three Upload specs with: Add media picks and uploads at once with progress, Done disabled while uploading, announcement, preview and card updated; PDF and >10 MB refused without a request; API refusal keeps the old media. Extended the drawer hide spec with Done (only footer button, no "Cancel", no request, status kept, focus back on the card). New: status first, focus on the switch from a card, no typed field. New-tale specs check Cancel / Add and the switch to the edit drawer with Done. The ⋯ Replace media spec expects focus on the action. Dashboard 569 tests.
- **Bundle:** initial 497.09 kB (from 494.91 kB; mostly the template).
- **Browser run** (`shots-8.12/`, ports 3399/4299/4399, own `_e2e_test` DB): 31 checks pass. Hide Beach in the drawer (saved at once, "Status: Hidden"), Done (no request, focus back on the card): hidden after a reload, the sample page shows one; Replace media from Pool's ⋯ (focus on the action, PDF refused, PNG uploaded, announced, preview and card updated) and the sample page serves the new bytes; new tale with Cancel / Add; 390x844 without horizontal scroll, Done in view; axe (WCAG 2.2 AA tags) clean on the drawer at desktop, hidden, refusal and 390 px.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting web-sdk sdk-sample` -- pass (dashboard 569); initial 497.09 kB.
- `node_modules/.bin/nx run web-sdk:size`, `web-sdk:types-check` -- pass.

**Manual checks:**
- Playwright (`shots-8.12/`): the verify steps on the sample page, axe clean on the drawer, 390 px.

## Review fixes (2026-10-22)

Merged `autopilot/foundation` 3578b7c (8.14) first; the base initial bundle was then 500.11 kB, over the budget.

- **Cancellable uploads:** `DashboardStore.uploadTaleMedia(taleId, file, { progress, signal, type })` resolves to '' (saved), the API's message, or null when the `AbortSignal` aborted it; aborting unsubscribes, which aborts the XHR, and nothing is read again. The drawer shows **Cancel upload** beside the bar (until 100 %), announces "Upload cancelled.", and aborts on destroy. Decision: **closing cancels** (Done, ×, Escape, Edit in Tale Studio); the upload no longer sets `saving`, so they stay available, and a line under the bar says "Closing the drawer cancels the upload."
- **Focus:** Replace media, Archive/Restore and Edit schedule use `aria-disabled` with guards instead of `disabled` (the switch already did), so the control that started an action keeps focus. When the control leaves (Cancel upload at the end of an upload, Archive turning into Restore), focus goes to Replace media or the first status control (`afterNextRender`, only when focus was lost, never after the drawer closed). `drawer.ts` leaves out anything under `hidden` (the file input), `input[type=hidden]` and disabled textareas from its focus list and first-control choice.
- **New tale refused file:** after the switch to the edit drawer, focus goes to `#tale-replace-media`.
- **Announcements:** "Uploading…" once at the start (the percentage is in the label, not live); at 100 % the label says "Saving…" until the lists are read again; no total gives an indeterminate bar and "Uploading…".
- **Picks:** a successful pick clears the studio-draft warning; a pick during a status save says "Wait until the change is saved, then pick the file again."; a file with no type is typed by its extension (jpg, jpeg, png, webp, gif, mp4, webm) and sent with that type; the API still checks the bytes.
- **Bundle:** `CreateDrawer` moved off the initial bundle with `@defer (when store.drawer(); prefetch on idle)` in `app.html` (it loads when the browser is idle or with the first drawer). Initial 392.27 kB (from 500.11 kB after the merge). Budget unchanged.
- **Tests:** progress, "Uploading…" once, "Saving…" at 100 %, busy Replace media keeps focus and opens no second picker; Cancel upload aborts (`req.cancelled`), keeps media and focuses Replace media; Done and Escape during an upload close and abort; indeterminate progress; Tab/Shift+Tab during an upload (hidden input never in the list); same file twice after a refusal; network failure fallback; extension typing; pick during a status save; warning cleared; Archive keeps focus on refusal and focus moves to Restore when done; new-tale refusal focuses Replace media. Dashboard 591.
- **Verification:** `run-many` lint/test/build of the 12 projects with `--parallel=2`: all pass except one API test, `auth > creates the admin, signs them in and stores only the token hash` (`expected 605649 to be 604800`): the local Postgres clock is about 14 minutes behind, unrelated. `web-sdk:size`, `types-check` pass. Browser run (`shots-8.12/`): all checks pass, including a throttled upload cancelled with Cancel upload (focus kept on Replace media, media kept) and axe while uploading.
