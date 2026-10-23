# Accessibility review of Tale Studio and composed tales (Tale Studio 7.15)

Status: **automated part done; awaiting the keyboard and screen-reader walk**. Date: 2026-10-23. Standard: WCAG 2.2
level AA (NFR-007, epic R12 and R13).

The story stays open (hitl) until a person completes the [walk](#keyboard-and-screen-reader-walk) below and signs it
off. The walk also holds the manual screen-reader checklist of the viewer that web zones 3.12 left open
([part 8](#8-the-viewer-left-open-by-web-zones-312)).

## Scope

- **In:** Tale Studio as built on `autopilot/foundation` (ce14153): adding each element type (text, image, rectangle,
  emoji, button; the media and emoji pickers), selecting, moving, resizing, rotating, the layers grid and its
  shortcuts, the layer menu, undo and redo, the keyboard shortcuts panel, Duplicate, Update tale, the preview pane, a
  phone width; a composed tale in the Web SDK viewer on the sample page; and the web-zones dashboard screens 3.12 left
  to this story that 8.17 did not scan: the Projects page, the theme, fonts and import pages, and a group's Rename,
  Cover, Tags and Schedule drawers.
- **Out:** the reworked zone screens (8.17 scanned them; its walk is open); the content of tales (the author's colours,
  pictures and words); captions and language of parts (post-MVP, user decision 2026-10-22).

## Method

1. **`nx run dashboard-e2e:a11y`** now runs two specs: 8.17's dashboard scan (`a11y.spec.ts`, 27 states) and
   **`studio-keyboard.spec.ts`** (new). The new spec signs in with a session written to the e2e database, makes a
   project, a zone, a group and an empty tale, and puts one picture in the project's media. Then, **with the keyboard
   only**, it composes a tale: every control is reached by pressing Tab or Shift+Tab until it has focus (the number
   of presses is reported); nothing is clicked. Along the way it scans 22 states with the 8.17 checks (`wcag.ts`):
   axe-core 4.10.2 (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`), a Tab walk for 2.4.7 and 2.4.11, target
   size (2.5.8), and once per screen reflow at 320 px (1.4.10) and text spacing (1.4.12). It fails on any finding.
2. **`studio-a11y.spec.ts`** (7.10, in `dashboard-e2e:e2e`): axe over a composed tale with each kind selected and the
   preview open, and the contrast warnings.
3. **`nx run sdk-sample:a11y`** (axe and Tab order of composed tales on the sample page, reading order, 7.10) and
   **`nx run sdk-sample:a11y-review`** (3.12's scripted review of bar, banner and viewer, 217 checks).

Run them:

```sh
psql postgres://taleart:taleart@localhost:5432/postgres -c 'DROP DATABASE IF EXISTS taleart_w715_e2e_test'
E2E_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w715_e2e_test \
  E2E_API_PORT=3407 E2E_DASHBOARD_PORT=4407 NX_DAEMON=false node_modules/.bin/nx run dashboard-e2e:a11y
NX_DAEMON=false node_modules/.bin/nx run sdk-sample:a11y
NX_DAEMON=false node_modules/.bin/nx run sdk-sample:a11y-review
```

`E2E_SCREENSHOTS=<dir>` saves a screenshot per state and per finding; `E2E_A11Y_REPORT=<file>` writes the dashboard
findings to `<file>` and the studio's (findings, Tab stops, keyboard steps) to `<file>-studio.json`.

## Result

Before the fixes the studio and web-zones scan found 5 issues and the keyboard walk 2 more; the sample-page review had
its 2 known landscape failures. After the fixes **all 22 studio and web-zones states pass, every keyboard step passes, and the
sample-page review passes 217 of 217 checks** (`sdk-sample:a11y` passes too). 8.17's 27 states still pass.

| State (studio spec) | Tab stops | | State | Tab stops |
|---|---|---|---|---|
| studio-empty (+ reflow, text spacing) | 31 | | updated (after Update tale) | 52 |
| media-picker (+ layout) | 3 | | preview | 57 |
| emoji-picker (+ layout) | 3 | | composed-phone (390 px) | 51 |
| composed, text selected (+ layout) | 55 | | projects (+ layout) | 18 |
| composed, image selected | 49 | | theme (+ layout) | 29 |
| composed, rectangle selected | 52 | | fonts (+ layout) | 15 |
| composed, emoji selected | 46 | | import (+ layout) | 10 |
| composed, button selected | 52 | | group Rename drawer (+ layout) | 4 |
| layer menu open (no walk: Tab closes it) | – | | group Cover drawer (+ layout) | 5 |
| shortcuts panel open (no walk) | – | | group Tags drawer (+ layout) | 5 |
| Duplicate drawer (+ layout) | 4 | | group Schedule drawer (+ layout) | 5 |

### Findings and fixes

| # | Criterion | Where | Finding | Fix |
|---|---|---|---|---|
| 1 | 1.4.10 Reflow | Layers list at 320 px | A layer's name was one line with an ellipsis: "Autumn sale" was cut at 320 px, whole at full width. | Names wrap (`overflow-wrap: anywhere`); they are short (the contract's `elementName`, 40 characters) (`styles.css`). |
| 2 | 2.4.3 Focus order, 2.1.2 | Emoji picker (and any drawer with a roving grid) | The drawer's Tab trap counted the grid's `tabindex="-1"` emoji as stops: Tab from the grid (the real last stop) left the drawer, and Shift+Tab from Close landed on the last emoji, off the Tab order. The walk found 1 stop. | The trap counts only Tab stops (`tabIndex >= 0`) (`drawer.ts`). Now 3 stops: Close, search, grid. |
| 3 | 2.4.11 Focus not obscured | Canvas | A layer under another (the text under the picture added after it) took focus unseen. | A layer focused by keyboard (`:focus-visible`) comes above the others while it has focus, below the guides and snap lines; a click keeps the stacking (`tale-studio.ts`). |
| 4 | 2.1.1 Keyboard | Canvas and layers grid | The layer menu opened only from a `contextmenu` event. Browsers send one for Shift+F10 or the context-menu key on Windows and Linux, not on a Mac, where the canvas then had no keyboard way to the menu (the help text promises Shift+F10). | The studio answers Shift+F10 and the context-menu key itself and stops their default, so the menu opens once on every system (`tale-studio.ts`). |
| 5 | 4.1.2 / 2.5.3 (good practice) | Canvas and layers grid | An emoji's name included its glyph ("Emoji: 😀 grinning face"); a screen reader reads the glyph as its name, so it was said twice. | Spoken names drop the leading glyph ("Emoji: grinning face", "More actions for grinning face"); the row still shows it, hidden from screen readers (`layerSpokenName`, `tale-studio.ts`). |
| 6 | 4.1.3 Status messages (good practice) | Live region | A change and a contrast verdict ran together: "Layer moved to the front "Autumn sale" has enough contrast now." | Two sentences: "Layer moved to the front. "Autumn sale" has enough contrast now." (`say`, `tale-studio.ts`). |
| 7 | 1.4.12 Text spacing, 1.4.10 | Projects page, a long project name | The name's button shrank under the actions (Theme, Fonts, Invite, Import from another tool): "Northwind Traders International Marketing" ran beneath the buttons, and with text spacing "1 zone" overlapped "Import from another tool". Seen only with 8.17's long name in the same run. | The card wraps: the actions go below the name when both do not fit, and the name breaks where it must (`projects.ts`). |
| 8 | 1.3.4 Orientation, 1.4.3 (axe) | Sample page, 844 × 390 | The 2 known failures: "the viewer shows the tale at full height" and "axe: viewer in landscape (color-contrast)". Cause: at 844 px wide the viewer is the wide-screen deck (f752d74); the review measured and scanned the card while it shuffled in (scale 0.92 → 315.7 px tall; opacity rising, so its text read 1.14:1). Not an SDK fault. | The review waits for the card's animations, then expects the deck card whole and centred (88 % of the height, 343 px) on a wide screen, full height in the phone layout; axe runs after. Both pass (`a11y-review.mjs`). |

Harness changes (not product fixes):
- axe's `target-size` rule flagged canvas layers that overlap (the rectangle under the emoji). Where a layer sits and
  how big it is is the tale's content; 2.5.8's **equivalent** exception covers it: each layer has its row in the
  layers grid (≥ 24 px), which selects it, and its fields. The exemption is in `axe.ts`, for `#studio-el-*` only;
  `wcag.ts`'s own 2.5.8 check still runs on the canvas.
- The scan starts each studio state from the top of the page: a control scrolled under the sticky top bar was
  judged covered by axe (Update tale, once).
- The focus walk ended at a date and time field (its parts keep focus over several Tabs). It now passes through up to
  ten repeats of one control; the Schedule drawer walks 5 stops, and the spec reaches End time by Tab.

Unit checks:
- 1, 3 and 7: `apps/dashboard-e2e/scripts/dashboard-a11y-css.test.mjs` (`dashboard-e2e:test`);
- 2: `apps/dashboard/src/app/drawer.spec.ts`;
- 4: `tale-studio.spec.ts` ("opens the actions menu by the Shift+F10 and context-menu keys themselves");
- 5: `tale-layers.spec.ts` (`layerSpokenName`) and `tale-shapes.spec.ts`;
- 6: `tale-shapes.spec.ts`;
- 8: the review script itself (`sdk-sample:a11y-review`).

### Keyboard operability (R13), as the spec does it

| Action | How, with the keyboard only | Result |
|---|---|---|
| Add text | Tab to Add text (16 Tabs from the top), Enter; type in place; Escape | Pass: "Text added"; focus back on "Text: Autumn sale" on the canvas |
| Add an image | Tab to Add image, Enter; in the picker Tab to "Use …", Enter; type the alt text | Pass: "Image added. Give it alt text…"; focus on Alt text |
| Add a rectangle | Tab to Add rectangle, Enter | Pass: "Rectangle added. It is decorative: screen readers skip it."; focus on it |
| Add an emoji | Tab to Add emoji, Enter; type "face" in the search; Tab to the grid; arrows; Enter | Pass: "Emoji added: grinning face…"; focus on it |
| Add a button | Tab to Add button, Enter; type the web address; Tab to Label, type | Pass: "Button added. Give it a web address…"; focus on Web address |
| Select | Tab to the layers grid (one stop); Ctrl/Cmd+Home, Down through every layer, Right, End, Home, Enter | Pass: rows in top-first order; Enter selects; the inspector shows "Selected text" |
| Move | On the canvas: ArrowRight, Shift+ArrowDown | Pass: 1 % and 10 % steps; "Text moved to left 11%, top 52%"; focus stays |
| Resize, rotate, place | Width, Height, Rotation and Left fields: type and Tab | Pass: 70 %, 9 %, −5°, 8 % applied and announced |
| Reorder | Alt+↑ and Alt+Shift+↓ on the canvas; Alt+Shift+↑ in the grid | Pass: "Layer brought forward", "Layer moved to the back", "Layer moved to the front"; focus stays |
| Hide, lock | H and L in the grid | Pass: "Layer hidden", "Layer locked"; `aria-pressed` follows |
| Layer menu | Shift+F10 on a row; ArrowDown; Escape | Pass: opens on its first item; Escape returns focus |
| Undo, redo | Ctrl+Z / Ctrl+Shift+Z (⌘Z / ⇧⌘Z on a Mac); the Undo and Redo buttons by Enter | Pass: "Undone: Layer sent backward", "Redone: …"; focus stays on the button |
| Shortcuts panel | Enter on Keyboard shortcuts; Escape | Pass: opens, closes, focus back |
| Duplicate | Enter on Duplicate; Escape | Pass: drawer opens; Escape returns focus |
| Update tale | Shift+Tab to Update tale, Enter | Pass: "Tale updated. Not visible: group is off." |
| Preview | Enter on Preview; Tab into the pane to Play from the start, Enter; back to Preview, Enter | Pass: opens and closes, focus back on Preview |

Observations (not WCAG AA failures, for the walk to judge):
- The preview pane comes after the whole inspector in the Tab order: from the Preview button it is about 50 Tabs to
  its first control (the screen reader's landmarks or headings get there faster). Moving focus into the pane when it
  opens, or putting it next to the button, would shorten this; left as is for the walk.
- Default boxes of new layers stack on one another (the rectangle, the emoji): fine for a pointer, and the layers grid
  is the keyboard's way to each; noted for the walk.
- The scan runs in Chromium only; Safari, Firefox and real screen readers are seen only in the walk.

### What the scan cannot judge

- How a screen reader speaks the canvas, the grid and the live region (4.1.2, 4.1.3), and whether the announcements are
  timely and not too talkative.
- The native file chooser and colour picker (the operating system's).
- Reading order of a published tale as a screen reader meets it (the sample-page scan checks the DOM and Tab order;
  the walk checks the voice).
- Contrast of text over the author's pictures (the studio warns; it does not block, user decision 2026-10-21).

## Open items

1. The walk below (hitl). Record each step's result and any finding; findings become fixes in this story.
2. Captions (1.2.2, 1.2.3, 1.2.5) and language of parts (3.1.2): post-MVP (user decision 2026-10-22), as in 3.12.

## Keyboard and screen-reader walk

For one person, about 60 minutes. Use **only the keyboard** — no mouse, trackpad or touch — with a screen reader on:

- **macOS:** VoiceOver (Cmd+F5) with Safari. Turn on Safari › Settings › Advanced › "Press Tab to highlight each item
  on a webpage". VO = Control+Option.
- **Windows:** NVDA with Firefox or Chrome. Browse mode and focus mode switch by themselves; Insert+Space switches by
  hand. In the studio's canvas and layers grid use focus mode.

Use a **throwaway database, never the development one**. From the workspace root, in two terminals:

```sh
NX_DAEMON=false node_modules/.bin/nx run api:build
E2E_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_walk_e2e_test PORT=3413 \
  PUBLIC_API_URL=http://localhost:3413 RP_ORIGIN=http://localhost:4313 RP_ID=localhost \
  node apps/dashboard-e2e/scripts/start-api.mjs
```

```sh
E2E_API_PORT=3413 E2E_DASHBOARD_PORT=4313 node apps/dashboard-e2e/scripts/serve-dashboard.mjs
```

Open `http://localhost:4313`, set up an admin with a passkey (8.17's walk, part 1), create a zone "Home" and a tale
group "Autumn" with one picture (8.17's walk, parts 2 and 3), and turn the group On. Have a second picture on disk.
Afterwards stop both servers and drop the database
(`psql postgres://taleart:taleart@localhost:5432/postgres -c 'DROP DATABASE taleart_walk_e2e_test'`).

Mark each row **Pass**, **Fail** or **N/A**, and write what you heard in Notes when it is not as expected. Wording can
differ by screen reader; record differences in meaning, not punctuation.

### 1. Open Tale Studio

| # | Do | Expect to hear / see | Result | Notes |
|---|---|---|---|---|
| 1.1 | Open the group (Enter on "Autumn"), Tab to the tale's "Open tale …", Enter; in the tale drawer find "Edit in Tale Studio" and press Enter. | Page title and heading "Tale Studio"; the tale's title; the status line ("Visible on site · up to date" or similar) is read with "Update tale". | | |
| 1.2 | Read the studio's first controls (Tab). | "Undo, button, dimmed/unavailable" with "Nothing to undo"; "Redo"; "Keyboard shortcuts, button, collapsed"; "Preview, button, collapsed"; the save state. | | |
| 1.3 | Enter on "Keyboard shortcuts", read the panel, Escape. | The panel's text is read; Escape closes it and focus is back on the button. | | |
| 1.4 | Continue with Tab to the canvas and the Add buttons. | The tale's media is a layer "Image: …" on the canvas (the tale's own media); "Add text, button", "Add image, button", … each named. | | |

### 2. Compose a tale: text, image, shape, emoji, button

| # | Do | Expect | Result | Notes |
|---|---|---|---|---|
| 2.1 | Enter on "Add text". | "Text added"; focus in a text field on the canvas ("Text, edit text"). | | |
| 2.2 | Type "Autumn sale", press Escape. | Focus on "Text: Autumn sale, toggle button, pressed" (or "selected"); its layer state is read as its description. | | |
| 2.3 | Tab to "Add image", Enter. | Dialog "Add an image" (or similar); focus on its first control; "Upload image" file field and the project's pictures as "Use …" buttons. Tab stays in the dialog and wraps. | | |
| 2.4 | Tab to a "Use …" button, Enter. | The dialog closes; "Image added. Give it alt text, or mark it decorative, before updating the tale."; focus on "Alt text". | | |
| 2.5 | Type "An orange sky", Tab. | The layer row and canvas name follow ("Image: An orange sky"). | | |
| 2.6 | Tab to "Add rectangle", Enter. | "Rectangle added. It is decorative: screen readers skip it."; focus on "Rectangle: Rectangle 1" on the canvas. | | |
| 2.7 | Tab to "Add emoji", Enter. | Dialog "Add an emoji"; focus on "Search emoji by name". | | |
| 2.8 | Type "leaf"; Tab to the grid; arrows; Home and End; Enter on one. | The status says how many emoji match; the grid is one Tab stop; each emoji is read by its name (once, not twice); Enter: "Emoji added: fallen leaf. Screen readers announce it by this name, which you can edit."; focus on "Emoji: fallen leaf". | | |
| 2.9 | Shift+Tab from the grid to Close and Tab back (before 2.8's Enter, in a reopened picker). | Tab and Shift+Tab stay inside the dialog: Close → search → grid → Close (fix 2). | | |
| 2.10 | Tab to "Add button", Enter. | "Button added. Give it a web address before updating the tale."; focus on "Web address". | | |
| 2.11 | Type `https://example.com/shop`, Tab to "Label", replace it with "Shop now", Tab. | The address and label hints are read; the canvas button becomes "Button: Shop now". | | |

### 3. Select, move, resize and reorder

| # | Do | Expect | Result | Notes |
|---|---|---|---|---|
| 3.1 | Tab to the layers grid. | "Layers, grid" (or table) with its hint read; the focused row's name ("Shop now", read #5 or similar). | | |
| 3.2 | Down and Up through the rows; Right and Left across a row; Ctrl+Home / Ctrl+End (VoiceOver: Cmd+Home may be taken; use Up and Down). | Each row's kind, name, reading order and state ("Hidden", "Low contrast", "Needs alt text", …); the Hide, Lock and "More actions for …" buttons with their pressed state. | | |
| 3.3 | On "Autumn sale", press Enter. | It is selected; the inspector "Selected text" follows it. | | |
| 3.4 | Shift+Tab back to the text on the canvas (or find it with the screen reader's form-controls list); press Right arrow, then Shift+Down. | "Text moved to left …%, top …%" each time; focus stays on it. With VoiceOver, use VO+Shift+Down first if the arrows read instead of moving (interact). A text under the picture shows above it while focused (fix 3). | | |
| 3.5 | Tab to Width, type 70, Tab; Height 9; Rotation −5; Left 8. | Each is read with its label and unit; "Text width set to 70%", …, "Text rotated" (or similar). | | |
| 3.6 | Back on a layer (canvas or grid): Alt+Up (Option+Up), Alt+Shift+Down. | "Layer brought forward", "Layer moved to the back"; the grid order follows; focus stays. A contrast verdict that turns is said as a second sentence (fix 6). | | |
| 3.7 | In the grid: H, then H; L, then L. | "Layer hidden" / "shown"; "Layer locked" / "unlocked"; the Hide and Lock buttons' pressed state follows. | | |
| 3.8 | Shift+F10 (on a Mac too) or the context-menu key on a row; arrows; Escape. | "Menu" with Bring forward … Delete, each with its shortcut; Escape closes it and focus is back on the row (fix 4). | | |
| 3.9 | Ctrl+Z / ⌘Z outside a text field; then Ctrl+Shift+Z / ⇧⌘Z. | "Undone: …", "Redone: …"; focus stays. In a text field the browser's own undo works instead. | | |

### 4. Check, update and preview

| # | Do | Expect | Result | Notes |
|---|---|---|---|---|
| 4.1 | Give the text a light grey colour on white (Canvas › Background colour hex `#ffffff`, the text's colour hex `#cccccc`), Tab. | The layer row says "Low contrast"; the inspector says the ratio and what it was judged against. Darken it: the warning goes and the change is announced once. | | |
| 4.2 | Clear the image's alt text; Tab to "Update tale", Enter. | Updating is refused; the message names the image; focus goes to a place where it can be fixed (record where). Put the alt text back. | | |
| 4.3 | Enter on "Update tale". | "Tale updated. …" with the status (visible or why not). | | |
| 4.4 | Enter on "Preview". | "Preview, button, expanded"; the preview pane appears after the inspector (find it with the screen reader's landmarks or headings: "Preview"). Record how many steps it takes to reach it. | | |
| 4.5 | In the pane: the size choice, "Show safe areas", "Sound", "Play from the start", the tale's button. | Each named; the tale plays muted; its button is announced as a link "Shop now" that does not leave the studio. | | |
| 4.6 | Back to "Preview", Enter. | The pane closes; focus stays on the button ("collapsed"). | | |
| 4.7 | Enter on "Duplicate", then Escape. | Dialog "Duplicate tale"; Escape closes it and focus is back on Duplicate. | | |

### 5. The published tale on the sample page

Open the zone's test page: on the zone page, Install tab, "Open test page" (8.17's walk 5.3–5.6; issue a site key if
asked). It is the sample page with this zone.

| # | Do | Expect | Result | Notes |
|---|---|---|---|---|
| 5.1 | Tab to "Autumn" in the bar, Enter. | Dialog "Autumn"; "Autumn, tale 1 of 1". | | |
| 5.2 | Read the tale with the reading keys (VO+Right / NVDA Down arrow). | In visual order, top to bottom then left to right: "Autumn sale"; the emoji "fallen leaf" (named once); the image "An orange sky"; the button "Shop now, link"; the rectangle is skipped (decorative). The tale's own media, if decorative, is skipped. | | |
| 5.3 | Tab through the viewer. | Previous tale, Next tale, Pause, Close and the link "Shop now" in reading order; the tale waits while the link has focus. | | |
| 5.4 | Enter on "Shop now". | The link opens (in a new tab only if set so, and then its name says "(opens in a new tab)"). | | |
| 5.5 | Escape. | The viewer closes; focus is back on "Autumn". | | |

### 6. Web-zones screens (short)

| # | Do | Expect | Result | Notes |
|---|---|---|---|---|
| 6.1 | Projects, then the project's Theme, Fonts and Import pages. | Each page's heading and form fields are named; errors are announced and tied to their field. | | |
| 6.2 | On the zone page, ⋯ on a group: Rename, Cover, Tags, Schedule; Escape from each. | Each opens as a named dialog with focus inside; Escape returns focus to ⋯. In Schedule each date and time field is read with its label and the time zone hint. | | |

### 7. Zoom and a phone width

| # | Do | Expect | Result | Notes |
|---|---|---|---|---|
| 7.1 | Zoom the studio to 400 % (Cmd/Ctrl +). | Nothing scrolls sideways but the canvas; layer names wrap rather than being cut (fix 1); focused controls are not under the top bar. | | |
| 7.2 | On a phone in landscape (or a window about 844 × 390), open the sample page's viewer. | The tale shows whole as a centred card (wide-screen deck) or at full height (phone layout); nothing is cut. | | |

### 8. The viewer, left open by web zones 3.12

3.12's manual checklist, unchanged in substance, on the sample page with an image, a video and a text tale (the
fixture of `sdk-sample:a11y-review`, or the zone above with more tales).

**Screen readers** (VoiceOver + Safari on macOS and iOS; NVDA + Firefox or Chrome on Windows; TalkBack + Chrome on
Android):

| # | Check | Result | Notes |
|---|---|---|---|
| 8.1 | The bar is announced as a list with its count; each item by its group name, "seen" after viewing. | | |
| 8.2 | The banner is announced as "Banner, carousel"; each slide as "N of M, slide"; previous, next, the rotation button ("Stop/Start automatic slide show") and the dots ("Show …", current) are found and announced. | | |
| 8.3 | While the banner rotates nothing is announced; after stopping it, moving slides is announced once, politely. | | |
| 8.4 | Opening a group announces the dialog by the group's name and then "Group, tale 1 of N". | | |
| 8.5 | The reading cursor (VoiceOver rotor, NVDA browse mode, TalkBack swipe) stays inside the viewer and reaches Previous tale, Next tale, Pause/Play, Close, and a text tale's text. | | |
| 8.6 | Tale changes are announced without being too talkative while tales advance by themselves. | | |
| 8.7 | Close (and the iOS two-finger scrub, Android back) closes the viewer, and focus lands on the item or slide that opened it. | | |
| 8.8 | A Hebrew group name and a Hebrew text line are readable (note whether the voice switches language: 3.1.2, post-MVP). | | |

**Other:**

| # | Check | Result | Notes |
|---|---|---|---|
| 8.9 | Windows High Contrast (a dark and a light theme): dots, rings, focus and viewer buttons are visible. | | |
| 8.10 | Real browser zoom to 400 % in Safari and Firefox: nothing overlaps or is cut. | | |
| 8.11 | On a phone: pinch-zoom works in the viewer; with VoiceOver or TalkBack on, tapping the left and right of a tale steps, and swipes between groups still have the tap alternative. | | |

### Findings from the walk

| # | Step | What happened | Severity (blocker / major / minor) | Fixed in |
|---|---|---|---|---|
| | | | | |

Screen reader and browser used: ______________________

Walked by: ______________________ Date: __________

Result: ☐ Every studio action done without a pointer, and every element of the published tale announced in visual
order. ☐ Findings above to fix first.
