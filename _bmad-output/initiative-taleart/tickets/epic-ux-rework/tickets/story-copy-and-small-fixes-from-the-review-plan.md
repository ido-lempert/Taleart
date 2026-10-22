---
title: 'Copy and small fixes from the review'
type: 'feature'
ticket: '15'
created: '2026-10-22'
status: 'built'
baseline_revision: 'ee3ad4a'
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
  - '{project-root}/_bmad-output/initiative-taleart/ux-review-2026-10-23/ux-report.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The review (§6 #13, #15–#18) found small copy and layout faults: the API banner says "Could not reach the API. Is it running on port 3333?" and never clears until something else reloads; Tale Studio's keyboard help is a paragraph that is always open; its "Back" link does not say where it goes; "In every zone" sits as grey text where a button would be; and frames had numbered names ("Frame 1 · Bar").

**Approach:** Plain words and small behaviour fixes in the dashboard only (epic R16): a banner that says "We can't reach TaleArt. Retrying…", retries with backoff and clears itself; a "?" button that opens the keyboard help as a popover; "Back to <group name>"; a disabled "Add to zone…" with its reason instead of the grey text; and a scan test that no screen numbers a frame.

## Boundaries & Constraints

**Always:**
- Banner text exactly "We can't reach TaleArt. Retrying…", in a polite live region (`role="status"`) that is always in the shell; no focus moves. While it shows, the shell retries: auth state first when it was never read, else a store refresh. Delays 2 s, 4 s, 8 s, 16 s, then every 30 s; the browser coming back online retries at once. A success clears the banner and announces "Connected to TaleArt again." (visually hidden). Only in the browser (no timers in SSR).
- The keyboard help: a button named "Keyboard shortcuts" showing "?", `aria-expanded`, `aria-controls`; the help (`#studio-keys`, same text as today) is hidden by default and stays in the DOM, so the canvas's `aria-describedby` still names it. Escape inside the help or on the button closes it and returns focus to the button; a click outside closes it; the Escape does not reach the studio's own key handling.
- The back link reads "Back to <group name>" and goes to the zone page that lists the tale; "Back" and the zones list when the group is unknown.
- When a group is already in every zone, the "Add to zone…" button stays, `aria-disabled="true"`, described and titled "Already in every zone"; pressing it does nothing.
- No "Frame <n>" naming and no "frame type" wording on any dashboard screen; the settings form's empty text says "This display has no settings yet." and the theme's corner hint says "the display's own".

**Never:** studio changes beyond the help popover and back link (story 7.7 runs in the studio); new API endpoints; the group row's ⋯ menu (story 10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| API stops | a refresh fails | banner "We can't reach TaleArt. Retrying…"; retry after 2 s, then 4 s… | each failure doubles the wait, at most 30 s |
| API back | next retry succeeds | banner gone; "Connected to TaleArt again." announced | No error expected |
| Down at start | auth state unreadable | banner; retry reads auth again; signed in → data loads; signed out → sign-in | No error expected |
| Help | press "?" | help shows, `aria-expanded="true"`; Escape closes, focus on "?" | No error expected |
| Back | tale in "Summer" in zone z1 | "Back to Summer" → `/zones/z1` | unknown group → "Back" → `/zones` |
| Every zone | group in all project zones | disabled "Add to zone…" described "Already in every zone" | click does nothing |

</intent-contract>

## Code Map

- `apps/dashboard/src/app/app.html`, `app.ts`, `app.css` -- the banner, its live region and the retry loop.
- `apps/dashboard/src/app/pages/tale-studio.ts` -- back link text, help popover.
- `apps/dashboard/src/app/pages/zone-detail.html`, `pages/tale-groups.ts` -- "In every zone".
- `apps/dashboard/src/app/settings-form.ts`, `pages/theme.ts` -- frame wording.

## Tasks & Acceptance

**Execution:**
- [x] `app.ts`/`app.html` -- banner text, polite region, retry with backoff, recovery announcement; `app.spec.ts` covers text, retry, recovery, the down-at-start path.
- [x] `tale-studio.ts` -- back link names the group; "?" popover; `tale-studio.spec.ts` covers back text, fallback, popover keyboard behaviour.
- [x] `zone-detail.html`, `tale-groups.ts` -- disabled "Add to zone…" with reason; spec.
- [x] `settings-form.ts`, `theme.ts` -- wording; a scan spec over the dashboard sources finds no "Frame <n>", "Frame ${…}" or "frame type" text in templates.

**Acceptance Criteria:**
- Given the API is stopped, when the dashboard loads data, then the banner says "We can't reach TaleArt. Retrying…"; when the API starts again, the banner goes away without a reload.
- Given Tale Studio opens, then the keyboard help is closed and the back link reads "Back to <group name>".
- The dashboard's initial bundle stays under 500 kB.

## Implementation Notes

- The retry loop lives in the shell (`app.ts`, `API_RETRY`, `apiRetryDelay`): tries never overlap, the next wait starts when a try ends. When the auth state was never read, the retry reads it and loads that user's data itself; the "user signed in" effect remembers the user it loaded for (`loadedFor`, by identity) so the data is not loaded twice.
- The polite region (`.api-status`, `role="status"`) is always in the shell; the old banner was `role="alert"`. Import page specs now look for their own status inside `main`.
- The help popover is a disclosure (button with `aria-expanded`/`aria-controls`, panel `hidden` when closed), not the native popover API, so it works in jsdom and keeps `aria-describedby="studio-keys"` on the canvas. It sits in the undo/redo bar. `.canvas` got `isolation: isolate`: its guides (z-index 100) were painting over the panel.
- No "Frame 1 · Bar" text remained after story 8.5; the scan test renders the zones list, a zone page, Tale groups and Projects and finds no "frame" in text, `title`, `aria-label` or `placeholder`. Two leftovers changed: the settings form's empty text and the theme's corner-radius option.
- Report #16 (project picker) was already done by story 8.8 (`onlyProject`).
- Initial bundle 494.79 kB (was ~493 kB).

## Verification

**Commands:**
- `node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly` -- expected: all pass.
- `web-sdk:size`, `web-sdk:types-check` -- expected: pass. Dashboard initial bundle under 500 kB.

**Manual checks:**
- Playwright (`shots-8.15/`): stop the API → banner; start it → banner gone; Tale Studio with help closed and "Back to <group>"; help open.

## Review fixes (2026-10-22)

- **Reconnect is its own service** (`api-reconnect.ts`, `ApiReconnect`, timing from the `API_RETRY_TIMING` token, no mutable global). Each try times out after 15 s; tries never overlap, except that `online` starts a fresh one and the stale try then schedules nothing. Timer tries are skipped while the tab is hidden or the browser is offline; becoming visible or coming online tries at once. `apiRetryDelay` falls back to 30 s with no delays.
- **"Connected to TaleArt again."** only after a try that reached the API (not when sign-out or a 401 clears the banner). It clears after 5 s, on navigation and on sign-out.
- **One load per user:** `DashboardStore.loadFor(user)` shares a running load between the sign-in effect and a reconnect that read the auth state.
- **Help popover** also closes when focus leaves it and when a layer menu opens.
- **Disabled "Add to zone…"**: the reason shows under it on hover and focus (`.disabled-reason__tip`, also its description; no title). Buttons with `aria-disabled="true"` get no hover styling.
- **Back link** returns to the zone the studio was opened from: the tale drawer's link carries `?zone=`, bound to the studio's `zone` input; a zone that does not list the tale falls back to the first that does. A change of `zone` alone does not reload the tale. "Open the copy" keeps it.
- **Tests:** `api-reconnect.spec.ts` with fake timers (backoff, timeout, online during a hung try, hidden, offline, announcement and its clearing, 401, auth path, destroy); app specs for 401 during a retry and sign-out while down, with no sleeps; studio specs for the zone query, focusout and the layer menu.
