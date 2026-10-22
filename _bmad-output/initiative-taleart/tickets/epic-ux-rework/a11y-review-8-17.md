# Accessibility review of the reworked dashboard (UX rework 8.17)

Status: **automated part done; awaiting the keyboard and screen-reader walk**. Date: 2026-10-23. Standard: WCAG 2.2
level AA (NFR-007, epic R18).

The story stays open (hitl) until a person completes the [walk](#keyboard-and-screen-reader-walk) below and signs it
off. The automated scan and its fixes are recorded first.

## Scope

- **In:** the screens the UX rework changed, as built on `autopilot/foundation`: the set-up page, the zones list (empty
  and with a zone), the New zone drawer (template picker), the zone page on each tab (Tale groups, Display, Install)
  with the setup checklist, the ⋯ menu open, the site-key issue drawer, the test page, the group view (desktop drawer
  and phone page), the tale drawer, the New tale group drawer, the Tale groups page under each filter (All, Visible,
  Off, Scheduled, Not in a zone, Archived), and Tale Studio with its status bar and preview pane.
- **Out:** the Web SDK's bar, banner and viewer (reviewed in web zones 3.12; the test page shows them only as the
  zone it renders); Tale Studio's canvas editing in depth (story 7.15, with 7.10 changing its contrast and visual
  order now); projects, theme, fonts and import pages (not reworked).

## Method

`nx run dashboard-e2e:a11y` (new; `apps/dashboard-e2e/src/a11y.spec.ts` and `wcag.ts`) starts the built API on a
fresh `_e2e_test` database and the dashboard, signs up with a virtual passkey (Chromium's WebAuthn emulation), creates
a zone from the default template and a group with two tales from media, turns it On, and adds groups in every state
the filters name (Off; On and scheduled for next month; in no zone; archived). It then scans 25 states in headless
Chromium and fails on any finding:

1. **axe-core 4.10.2** (pinned, SHA-384 checked), tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`.
2. **2.4.7 Focus visible and 2.4.11 Focus not obscured:** a Tab walk from the top of the page (or through the open
   dialog until focus cycles), 3 to 38 stops per state. At each stop the control with focus must look different
   from the same control blurred (pixels compared around it and its three nearest ancestors), and part of it must be
   the topmost element at one of nine sampled points.
3. **2.5.8 Target size:** every visible control is at least 24 × 24 px, or a 24 px circle on its centre touches no
   other control and no other small control's circle; links in a sentence are exempt.
4. **1.4.10 Reflow** (once per screen): at 320 × 640 CSS px, no sideways page scroll and nothing past the right edge
   outside a scroll area.
5. **1.4.12 Text spacing** (once per screen): with line height 1.5, letter spacing 0.12 em, word spacing 0.16 em and
   paragraph spacing 2 em applied (also inside shadow roots), no text is cut that was whole before.

Run it: `E2E_DATABASE_URL=postgres://…/<name>_e2e_test NX_DAEMON=false node_modules/.bin/nx run dashboard-e2e:a11y`.
Optional: `E2E_SCREENSHOTS=<dir>` saves a screenshot per state, one at 320 px per screen and one per finding;
`E2E_A11Y_REPORT=<file>` writes every state's findings and Tab stops as JSON. `E2E_API_PORT` and
`E2E_DASHBOARD_PORT` move the servers. `dashboard-e2e:e2e` no longer runs it (`--grep-invert @a11y`).

## Result

Before the fixes 15 of 25 states had findings (4 distinct issues). After them **all 25 states pass**: 0 axe
violations, no unseen or hidden focus, no small targets, no reflow or text-spacing finding.

| # | Criterion | Screen(s) | Finding | Fix |
|---|---|---|---|---|
| 1 | 1.4.10 Reflow | every shell page and drawer at 320 px | The top bar (title, project switcher, New, Sign out) was 325 to 329 px wide: the page scrolled sideways. | Under 375 px the top bar wraps its actions to a second row (`app.css`). |
| 2 | 1.4.3 Contrast (axe) | New zone drawer | The chosen template's description (`--text-muted` on `--surface-sunken`) was 4.4:1. | Template descriptions use `--text-secondary` (6.8:1 on that background) (`styles.css`). |
| 3 | 2.4.11 Focus not obscured | zone page on a phone | A control scrolled into view by Tab (the last group's "Not visible: starts …" indicator) landed under the fixed bottom bar. | `scroll-padding-top` for the sticky top bar (two rows under 375 px) and, on phones, `scroll-padding-bottom` for the bottom bar (`styles.css`). |
| 4 | 2.4.7 Focus visible | Tale Studio | An image filling the canvas showed no focus ring: its outer ring was cut off by the canvas edge. | The canvas element's ring is drawn again inside its edge (a `::after` overlay, `tale-studio.ts`). |

Unit checks of the four fixes: `apps/dashboard-e2e/scripts/dashboard-a11y-css.test.mjs` (in `dashboard-e2e:test`).
Screenshots before and after: `shots-8.17/` in the build's scratchpad (see the plan).

### What the scan cannot judge

- **Names and announcements as a screen reader speaks them** (4.1.2, 4.1.3): axe checks that controls have names
  and valid roles, not that the live regions say the right thing at the right time. The walk below covers this.
- **The passkey prompt** is the operating system's (Touch ID, Windows Hello), outside the dashboard.
- **The native file chooser** (picking media) is the operating system's.
- **Tale Studio's canvas** at 320 px: the canvas is a two-dimensional editing surface (1.4.10 exception); the scan
  found no sideways scroll, but canvas editing by keyboard is story 7.15's.
- **Contrast of text over tale media** and the SDK views: tale content is the author's; the SDK was reviewed in 3.12.

## Open items

1. The walk below (hitl). Record each step's result and any finding; findings become fixes in this story.
2. The scan runs in Chromium only; Safari and Firefox are seen only in the walk.

## Keyboard and screen-reader walk

For one person, about 45 minutes. Use **only the keyboard** — no mouse, no trackpad, no touch — with a screen reader
on:

- **macOS:** VoiceOver (Cmd+F5) with Safari. Turn on Safari › Settings › Advanced › "Press Tab to highlight each item
  on a webpage". Use VO = Control+Option.
- **Windows:** NVDA with Firefox or Chrome. Browse mode (reading) and focus mode (forms) switch by themselves; Insert+Space
  switches by hand.

Start on a fresh install (no admin yet), e.g. `nx run api:serve` on an empty database and `nx run dashboard:serve`.
Have two images on disk (any PNG or JPEG). Wording of announcements can differ by screen reader; record what you hear
when it differs in meaning, not in punctuation.

Mark each row **Pass**, **Fail** or **N/A**, and write what you heard in Notes when it is not as expected.

### 1. Sign up

| # | Do | Expect to hear / see | Result | Notes |
|---|---|---|---|---|
| 1.1 | Open the dashboard. | Page title "Set up · TaleArt"; heading "Set up TaleArt". Focus is in the page, not lost. | | |
| 1.2 | Tab to Name, type a name. | "Name, edit text" (required). | | |
| 1.3 | Tab to Email, type an email. | "Email, edit text". | | |
| 1.4 | Tab to First project. | "First project, edit text", with its hint ("My project" if left empty). | | |
| 1.5 | Tab to Create passkey, press Enter. Approve the OS prompt by keyboard (or Touch ID). | "Create passkey, button". After: the Zones page loads; its title "Zones · TaleArt" and heading are read or reachable at once. | | |
| 1.6 | If anything fails (cancel the OS prompt once). | An error is announced (alert) and focus stays usable. | | |

### 2. Zone from a template

| # | Do | Expect | Result | Notes |
|---|---|---|---|---|
| 2.1 | On Zones, find the New zone button (Tab, or the screen reader's buttons list). | "New zone, button". Empty state text is readable. | | |
| 2.2 | Press Enter. | Dialog "New zone" announced; focus on its title or first field. Tab stays inside the drawer. | | |
| 2.3 | Tab to Zone name, type "Home top". | "Zone name, edit text". | | |
| 2.4 | Tab to the Template group. | "Template, group"; "Stories bar, radio button, selected, 1 of 3" (or the count shown), with its description read after it. | | |
| 2.5 | Arrow Down / Up through the templates, back to Stories bar. | Each choice and its description is read; the choice changes with the arrow. | | |
| 2.6 | Tab to Create, press Enter. | The drawer closes; the zone page opens; focus on the heading "Home top" (or the page start); the checklist "Set up this zone, 1 of 3 done" (or similar) is reachable. | | |
| 2.7 | Press Escape in a reopened New zone drawer. | The drawer closes and focus returns to the button that opened it. | | |

### 3. Group with two tales from media

| # | Do | Expect | Result | Notes |
|---|---|---|---|---|
| 3.1 | Read the setup checklist with the reading keys (VO+arrows / NVDA arrows). | Heading "Set up this zone"; each step a button followed by "Done" or "To do". | | |
| 3.2 | Activate the "New tale group" button (or the checklist's group step). | Dialog "New tale group" announced; focus inside. | | |
| 3.3 | Tab to Tale group name, type "Summer sale". | "Tale group name, edit text". | | |
| 3.4 | Tab to "Images or videos (optional)", press Enter or Space; pick the two images in the file dialog by keyboard (macOS: Cmd+Shift+G to type a path; Shift+arrows to pick two). | The control is announced with its name; after picking, the drawer says two files are chosen. | | |
| 3.5 | Tab to Create, press Enter. | "Uploading…" announced once, then the result; the drawer closes when done; focus returns to a sensible place (the new group's row or the button). | | |
| 3.6 | Find the group row. | List "Tale groups in Home top"; the row reads "Summer sale" (a button that opens the group), "2 of 2 shown", the switch, the indicator, and "More for Summer sale, menu button". | | |
| 3.7 | Open the ⋯ menu (Enter on "More for Summer sale"); move with arrows; Escape. | "Menu" with items Rename, Cover, Tags, Schedule, …; a disabled item says why; Escape closes it and focus returns to the ⋯ button. | | |
| 3.8 | Move a group with "Move … later" (needs two groups; skip if one). | "… moved to position 2 of 2"; focus stays on the control. | | |

### 4. Turn the group On

| # | Do | Expect | Result | Notes |
|---|---|---|---|---|
| 4.1 | Tab to the switch. | "Summer sale on site, switch, off". | | |
| 4.2 | Press Space. | State becomes "on"; then the live region says "Summer sale is now on" with what the indicator says (for example "Not visible: zone not installed"). Focus stays on the switch. | | |
| 4.3 | Open the group (Enter on its name). | Dialog "Summer sale" announced; focus on its title. Each tale has a "Show <title>" switch. | | |
| 4.4 | In the view, Tab to "Open tale …", press Enter. | The tale drawer opens above the view, announced by its title; Escape closes only it and focus returns to "Open tale …". | | |
| 4.5 | In the tale drawer, change Status (if offered) and listen. | "Status: Hidden" (or the new status) is announced; "Changes save as you make them." is read. | | |
| 4.6 | Escape from the group view. | The view closes; focus returns to the group's name button. | | |

### 5. Install

| # | Do | Expect | Result | Notes |
|---|---|---|---|---|
| 5.1 | Tab to the zone tabs. | "Tale groups, tab, selected, 1 of 3". | | |
| 5.2 | Press Arrow Right twice. | "Display, tab, 2 of 3", then "Install, tab, 3 of 3"; each tab is selected as focus moves and its panel shows. Home and End go to the first and last tab. | | |
| 5.3 | Tab into the Install panel. | The snippet (a code block with `YOUR_SITE_KEY`) and its note are readable; "Copy snippet, button"; "Open test page (opens in a new tab), link". The key warning is read before "Issue site key". | | |
| 5.4 | Activate "Issue site key". | Dialog "Issue site key"; "Site key issued." announced; the key field "Site key" is read-only and readable; the warnings are readable. | | |
| 5.5 | Activate "Copy snippet" in the drawer. | "Snippet with the key copied" announced. | | |
| 5.6 | Activate "Open test page" in the drawer. | A new tab opens (announced by the browser). | | |

### 6. Test page

| # | Do | Expect | Result | Notes |
|---|---|---|---|---|
| 6.1 | In the new tab, read the page. | A heading and the zone; the bar is a list with one item "Summer sale". The key is not in the address bar. | | |
| 6.2 | Tab to "Summer sale", press Enter. | Dialog "Summer sale"; "Summer sale, tale 1 of 2" (or similar); Previous tale, Next tale, Pause, Close reachable by Tab. | | |
| 6.3 | Press Escape. | The viewer closes; focus returns to "Summer sale". | | |
| 6.4 | Back in the dashboard tab, Done in the key drawer. | The drawer closes; focus returns to the Install tab's site key area; the checklist (if still shown) says the step is done ("Step done: …", then "This zone is now visible on your site"). | | |

### 7. Elsewhere (short)

| # | Do | Expect | Result | Notes |
|---|---|---|---|---|
| 7.1 | Go to Tale groups (bottom bar on a phone, side rail on a desktop). | Fieldset "Show" with radio buttons "All, 5", "Visible, 1", …; arrows change the filter and the list; the URL keeps it. | | |
| 7.2 | Open Tale Studio for a tale (from the tale drawer). | The status bar reads the tale's status ("Visible on site · up to date" or similar); "Update tale", "Discard changes" say why when disabled; "Preview, button, collapsed/expanded". | | |
| 7.3 | Zoom the browser to 400 % (Cmd/Ctrl +) on the zone page. | Nothing scrolls sideways; the top bar wraps; focused controls are not hidden by the top or bottom bar. | | |

### Findings from the walk

| # | Step | What happened | Severity (blocker / major / minor) | Fixed in |
|---|---|---|---|---|
| | | | | |

Screen reader and browser used: ______________________

Walked by: ______________________ Date: __________

Result: ☐ Every step done without a pointer, with switches, menus, tabs, reordering and status changes announced.
☐ Findings above to fix first.
