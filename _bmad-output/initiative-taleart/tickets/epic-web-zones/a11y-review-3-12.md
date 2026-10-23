# Accessibility review of bar, banner and viewer (web zones 3.12)

Status: **awaiting sign-off**. Date: 2026-10-21. Standard: WCAG 2.2 level AA (NFR-007, R11).

User decision (2026-10-22): instead of a person walking the frames, an automated and scripted review runs over the built
SDK; the user signs off this report. What only a person with a real screen reader can judge is in the
[manual checklist](#manual-checklist) at the end.

## Scope

- **In:** the Web SDK's bar, banner and full-screen viewer, as built (`dist/libs/web-sdk`), on the sample page
  (`apps/sdk-sample`), with image, video and text tales (Tale Studio documents), stages, the project theme and the SDK
  theme override.
- **States reviewed:** bar; banner rotating, hovered, stopped; viewer on an image, a text (document, no media) and a
  video tale, playing and paused; reduced motion; forced colours; a dark host page; a themed zone (dark background,
  light titles, yellow accent); the SDK override; two stages; 200 % and 400 % zoom; text spacing; landscape; a
  right-to-left Hebrew host page; a mixed Hebrew/English text tale on both page directions.
- **Out:** the dashboard screens the ticket also names (status badges, schedule fields, settings form, theme pickers,
  stages, playbooks, cover editor). This run covers the SDK only, as the review brief set it; the dashboard scan is
  still open (see [open items](#open-items)). The content of tales (captions, text over pictures, flashing in
  videos) is the author's, not the SDK's.

## Method

`nx run sdk-sample:a11y-review` (new; `apps/sdk-sample/a11y-review.mjs`) drives headless Chromium (Playwright 1.64)
against the sample page with the Delivery API and media stubbed, as the existing `sdk-sample:a11y` scan does. A 2 s
WebM is recorded in the browser for the video tale and the animated cover. It records 123 checks, each tagged with
the WCAG criterion it serves, and fails on any:

1. **axe-core 4.10.2** (pinned, SHA-384 checked), tags `wcag2a/2aa/21a/21aa/22aa`, in 19 states.
2. **Keyboard-only walk:** Tab order through bar and banner; Enter and Space on every bar item, slide, previous,
   next, dot and rotation button; viewer opening by Enter and Space, its Tab order, Shift+Tab, Tab past the last
   control, Enter and Space on each control, arrow keys, Escape, and focus return. At each stop: a focus ring is
   drawn (outline or box shadow) and at least part of the control is the topmost element at sampled points (2.4.11).
3. **Accessibility tree:** Playwright `ariaSnapshot()` and the CDP accessibility tree (`Accessibility.getFullAXTree`,
   which replaces the removed `accessibility.snapshot()`): roles, names, role descriptions, `aria-current`, `inert`
   slides, the dialog's name and modality, live regions and their text ("Summer sale, tale 1 of 3").
4. **Zoom and reflow** at 640 × 400 (200 % of 1280 × 800) and 320 × 256 (400 % of 1280 × 1024): no sideways page
   scroll, controls on screen and apart. **Text spacing** (1.4.12 bookmarklet values) injected into the page and
   into the SDK's shadow root, which a host stylesheet does not reach. **Orientation:** 844 × 390.
5. **Target size** of every visible control; **pointer cancellation** (press, move off, release) on a bar item and
   on Close; **dragging alternatives** (tap across groups; banner buttons).
6. **Contrast** of non-text parts computed from computed styles: dots, banner buttons, viewer controls over light
   media, on white, on a dark host page and on a themed background.
7. **Motion and timing:** banner autoplay, hover pause, rotation button; animated covers; a paused tale held past its
   duration; reduced motion (`reducedMotion: 'reduce'`): no autoplay, no transitions, the viewer opens paused.
8. **Forced colours** (`forcedColors: 'active'` emulation): dots drawn and the current one distinct, focus outline,
   viewer button edges.
9. **RTL:** `<html dir="rtl" lang="he">` with Hebrew group names: banner slides on screen, controls mirrored, viewer
   tap zones, arrows and swipes mirrored; `dir="auto"` on user text.

Run it: `NX_DAEMON=false npx nx run sdk-sample:a11y-review` (add `-- --shots <dir>` to save screenshots,
`--json <file>` for every check's result).

## Result

Before the fixes 14 of 116 checks failed: findings 1 to 9 below, plus three knock-on or expectation failures (Space on a tap zone is the pause shortcut by design; two checks failed only because an earlier step had not moved). Two RTL issues (rotation icon flipped, header order) were then found on the screenshots, fixed and checked. After the fixes all **123 checks pass**, with
**0 axe violations in all 19 states**.

### WCAG 2.2 AA, criterion by criterion

Pass = met, checked by the review. Fixed = failed, fixed in this story, now checked. N/A = nothing in the bar, banner
or viewer it applies to. Needs human = only a person can judge it, or it depends on tale content.

| Criterion | Result | Evidence |
|---|---|---|
| 1.1.1 Non-text content | Pass | Covers are decorative inside named buttons; an image tale's `alt` and a video's name are the tale title; a text tale is a group named by its title. |
| 1.2.1 Audio-only and video-only | Needs human | Tale content. |
| 1.2.2 Captions (prerecorded) | Needs human (gap) | A video tale with speech needs captions; the tale model has no caption track. See open items. |
| 1.2.3 Audio description or media alternative | Needs human (gap) | As 1.2.2. |
| 1.2.4 Captions (live) | N/A | No live media. |
| 1.2.5 Audio description (prerecorded) | Needs human (gap) | As 1.2.2. |
| 1.3.1 Info and relationships | Pass | Bar is a list of buttons; banner a region "Banner" (carousel) with slide groups "N of M"; viewer a labelled modal dialog. |
| 1.3.2 Meaningful sequence | **Fixed** | RTL banner showed an empty slide after Next; controls, tap zones and swipes were not mirrored; mixed-direction text took the page's direction. |
| 1.3.3 Sensory characteristics | N/A | No instructions. |
| 1.3.4 Orientation | Pass | Landscape: viewer at full height, page does not scroll sideways. |
| 1.3.5 Identify input purpose | N/A | No inputs. |
| 1.4.1 Use of colour | Pass | Seen state is in the name ("…, seen"); the current dot is larger, also in forced colours. |
| 1.4.2 Audio control | Pass | A video tale's sound stops with Pause (button or Space). |
| 1.4.3 Contrast (minimum) | Pass | axe in every state; titles take the host's text colour; the dashboard warns on theme pairs (`checkThemeContrast`). Text over a tale's own picture: needs human (content). |
| 1.4.4 Resize text | Pass | 200 %: axe clean, controls fit. |
| 1.4.5 Images of text | N/A | SDK draws text as text; pictures are content. |
| 1.4.10 Reflow | Pass | 320 CSS px: no sideways page scroll; the bar scrolls within itself and brings a focused item into view; viewer controls stay on screen. |
| 1.4.11 Non-text contrast | **Fixed** | Current dot was #111827 on any page: 1.00:1 on a dark host. In forced colours dots vanished and viewer buttons had no edge. |
| 1.4.12 Text spacing | **Fixed** | Bar titles were one truncated line: "Summer sale" and "New arrivals" lost text with spacing. |
| 1.4.13 Content on hover or focus | N/A | No hover or focus pop-ups. |
| 2.1.1 Keyboard | **Fixed** | Space on the focused Close button paused instead of closing. All other controls work by Enter and Space; arrows step. |
| 2.1.2 No keyboard trap | Pass | Tab and Shift+Tab stay in the modal viewer (past Close focus goes to the browser, then back to the first control); Escape closes. |
| 2.1.4 Character key shortcuts | Pass | Space and arrows act only while focus is in the viewer. |
| 2.2.1 Timing adjustable | Pass | A paused tale stays past its 5 s; under reduced motion no tale advances by itself. |
| 2.2.2 Pause, stop, hide | **Fixed** | Animated covers (R12) looped forever with no pause control. Banner: rotation button, hover pause, stops on focus or any interaction. |
| 2.3.1 Three flashes | Pass (SDK) / needs human (content) | The SDK draws nothing that flashes. |
| 2.4.1 Bypass blocks, 2.4.2 Page titled | N/A | Host page's. |
| 2.4.3 Focus order | Pass | Bar left to right; banner previous, next, slide, rotation, dots; viewer previous, next, pause, close; focus moves into the viewer and back to the item or slide on close. |
| 2.4.4 Link purpose, 2.4.5 Multiple ways | N/A | No links. |
| 2.4.6 Headings and labels | Pass | Every control named for what it does. |
| 2.4.7 Focus visible | Pass | Two-colour ring on every control, light and dark pages; outline in forced colours. |
| 2.4.11 Focus not obscured (minimum) | Pass | Every focused control is at least partly topmost. |
| 2.5.1 Pointer gestures | Pass | Swipe and hold have single-tap or button alternatives. |
| 2.5.2 Pointer cancellation | Pass | Moving off before release does nothing (bar item, Close). |
| 2.5.3 Label in name | Pass | Names start with the visible title. |
| 2.5.4 Motion actuation | N/A | |
| 2.5.7 Dragging movements | Pass | Group swipe: taps cross groups; banner swipe: previous and next buttons. |
| 2.5.8 Target size (minimum) | Pass | Controls 44 px, dots 24 px, bar items ≥ 48 px. |
| 3.1.1 Language of page | N/A | Host page's. |
| 3.1.2 Language of parts | Needs human (gap) | Tale text and names carry no language; a Hebrew line on an English page is read with the page's voice. |
| 3.2.1 On focus, 3.2.2 On input | Pass / N/A | Focus never opens or moves anything. |
| 3.2.3 Consistent navigation, 3.2.4 Consistent identification | Pass | Same names and order in every frame and stage. |
| 3.2.6 Consistent help, 3.3.x (forms, authentication) | N/A | No help, forms or sign-in. |
| 4.1.2 Name, role, value | Pass | Tree checks above; dialog is `:modal`. |
| 4.1.3 Status messages | Pass | Polite live region "Group, tale N of M"; banner slide list `aria-live` polite once stopped, off while rotating. |

## Findings and fixes

| # | Finding | Criterion | Fix |
|---|---|---|---|
| 1 | Space on the focused Close button paused the tale instead of closing. | 2.1.1 | Space on Close is left to the button. On the tap zones and elsewhere Space keeps the viewer's pause shortcut (a mouse click leaves focus on a tap zone); the zones step with Enter. `viewer.ts` |
| 2 | Animated covers (video or image) looped with no way to stop them. | 2.2.2 | They stop on their first frame 5 s after a render (`COVER_MOTION_MS`), the same still as reduced motion; turning reduced motion off restarts the 5 s. `taleart-element.ts`, `bar.ts` |
| 3 | The current banner dot was always #111827: invisible on a dark host page (1.00:1). | 1.4.11 | It takes the host page's text colour (`currentColor`), or the theme title colour. Dark host: 16.98:1 (white page: 17.74:1). `banner.ts` |
| 4 | Forced colours: dots (pseudo-element backgrounds) vanished; viewer buttons lost their edge; the ring gradient vanished. | 1.4.11 | `forced-colors` rules: dots in GrayText, the current one CanvasText; transparent border on viewer controls; progress in system colours; ring in CanvasText (seen: GrayText). `banner.ts`, `viewer.ts`, `bar.ts` |
| 5 | Bar titles were one line with an ellipsis: with text spacing "Summer sale" and "New arrivals" were cut. | 1.4.12 | Titles wrap to at most two lines (line clamp), centred. A name that fits on one line looks as before. `bar.ts` |
| 6 | RTL page: after Next (or a swipe) the banner showed an empty slide area: the track moved the wrong way. | 1.3.2 | The track moves right in RTL. `banner.ts` |
| 7 | RTL page: Previous slide sat on the left with a left chevron. | 1.3.2 | Logical sides (`inset-inline-*`); chevrons flip under `:dir(rtl)`; the play/pause icon does not. `banner.ts` |
| 8 | RTL page: banner swipes, viewer tap zones, arrows and group swipes kept left-to-right meaning. | 1.3.2 | Mirrored: the next slide or tale is to the left; ArrowLeft is next. The progress fills from the right; the header's name sits at the start and Close at the end. `banner.ts`, `viewer.ts` |
| 9 | Mixed-direction text took the page's direction: a Hebrew-first line on an English page put its punctuation on the wrong side. | 1.3.2 | `dir="auto"` on text elements, bar titles and the viewer's group name. `document/text.ts`, `bar.ts`, `viewer.ts` |

Unit tests cover each fix (`viewer.spec.ts`, `banner.spec.ts`, `bar.spec.ts`, `document/renderer.spec.ts`,
`taleart-element.spec.ts`); the review script checks each in the browser. Bundle: 14.5 KB gzipped (budget 50 KB).

### Observations (not WCAG AA failures)

- The bar hides its scrollbar. Keyboard, touch and trackpad users scroll it; a mouse with only a vertical wheel cannot
  (Shift+wheel works). Consider visible scroll buttons in a later story.
- Tab past the viewer's last control goes to the browser's own controls before returning to the first: native
  `<dialog>` behaviour, not a trap, and Escape always closes.
- The live region announces every tale change, also while tales advance by themselves. A person should judge whether
  this is too talkative with a screen reader (manual checklist).
- Forced colours were emulated in Chromium; the real Windows High Contrast themes should be looked at once (checklist).

## Screenshots

Saved under `a11y-review-3-12/` (390 × 844 phone unless noted).

| File | What it shows |
|---|---|
| `01-bar-and-banner-default.png` | Default theme on the white sample page. |
| `02-focus-banner-dot.png` | Focus ring on a dot after the keyboard walk; rotation shows Start (focus stopped autoplay). |
| `03-viewer-image-tale.png` | Viewer paused on an image tale. |
| `04-viewer-focus-next-tale.png` | Focus ring on the Next tale zone. |
| `05-viewer-text-tale.png` | A text tale (document, no media). |
| `06-banner-stopped.png` | Banner stopped with the rotation button. |
| `07-reflow-400-bar-banner.png`, `08-reflow-400-viewer.png` | 320 × 256 (400 %). |
| `09-text-spacing-bar.png`, `10-text-spacing-viewer.png` | Text spacing: titles on two lines, nothing cut. |
| `11-dark-host.png` | Dark host page: current dot in the host's light text colour. |
| `12-themed.png` | Themed zone: dark background, light titles, solid ring, radius 0. |
| `13-forced-colors.png`, `14-forced-colors-viewer.png` | Forced colours: system-colour dots and rings, edged viewer buttons. |
| `15-rtl-bar-banner.png` | RTL Hebrew page: items right to left, Previous on the right, chevrons mirrored. |
| `16-rtl-mixed-text-tale.png` | Mixed Hebrew/English text tale, each line in its own direction; Close at the far left. |

## Open items

1. **Dashboard screens** (ticket scope): no WCAG 2.2 AA scan of the dashboard screens this epic added ran in this
   story. Needs a signed-in run against the API (a separate scan or an e2e target) before the ticket's verify line
   is fully met.
2. **Captions and language** (1.2.2, 1.2.3, 1.2.5, 3.1.2): the tale model has no caption track and no language field,
   so the SDK cannot meet these for video tales with speech or for text in another language. Product decision:
   add `captions` (WebVTT) and `lang` to tales or elements, or state in authoring guidance that such tales need
   burnt-in captions.

## Manual checklist

For the person signing off, about 30 minutes. Use the sample page with a live or stubbed zone that has an image, a
video and a text tale (as in the review fixture).

**Screen readers** (VoiceOver + Safari on macOS and iOS; NVDA + Firefox or Chrome on Windows; TalkBack + Chrome on
Android):

- [ ] The bar is announced as a list with its count; each item by its group name, "seen" after viewing.
- [ ] The banner is announced as "Banner, carousel"; each slide as "N of M, slide"; previous, next, the rotation
      button ("Stop/Start automatic slide show") and the dots ("Show …", current) are found and announced.
- [ ] While the banner rotates nothing is announced; after stopping it, moving slides is announced once, politely.
- [ ] Opening a group announces the dialog by the group's name and then "Group, tale 1 of N".
- [ ] The reading cursor (VoiceOver rotor, NVDA browse mode, TalkBack swipe) stays inside the viewer and reaches
      Previous tale, Next tale, Pause/Play, Close, and a text tale's text.
- [ ] Tale changes are announced without being too talkative while tales advance by themselves.
- [ ] Close (and the iOS two-finger scrub, Android back) closes the viewer, and focus lands on the item or slide
      that opened it.
- [ ] A Hebrew group name and a Hebrew text line are readable (note whether the voice switches language: see 3.1.2).

**Other:**

- [ ] Windows High Contrast (a dark and a light theme): dots, rings, focus and viewer buttons are visible.
- [ ] Real browser zoom to 400 % in Safari and Firefox: nothing overlaps or is cut.
- [ ] On a phone: pinch-zoom works in the viewer; with VoiceOver or TalkBack on, tapping the left and right of a
      tale steps, and swipes between groups still have the tap alternative.

Sign-off: ______________________ Date: __________

## Sign-off

Signed off by the user on 2026-10-22, based on the automated and scripted review. The manual checklist above (real screen readers and real high-contrast themes) stays open for a later pass.

User decisions recorded with the sign-off:
- Animated tale group covers stop on their first frame after 5 s (WCAG 2.2.2). Visitors who prefer reduced motion see a still cover.
- Captions for video tales (WebVTT) and a language setting for tales and text are post-MVP. Until then, 1.2.x and 3.1.2 stay open, as recorded above.
- The WCAG scan of this epic's dashboard screens moves to Tale Studio story 7.15, the accessibility review, together with the studio screens.

2026-10-23 (Tale Studio 7.15): the manual checklist above is folded into the 7.15 walk ([`a11y-review-7-15.md`](../epic-tale-studio/a11y-review-7-15.md), part 8); record its results there. The dashboard scan of this epic's screens ran in 8.17 and 7.15. The two landscape failures of `sdk-sample:a11y-review` (1.3.4 and axe in landscape) were the review measuring the wide-screen deck card mid-way through its shuffle-in; fixed in 7.15.
