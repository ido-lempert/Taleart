# Accessibility review of the native bar, banner and viewer (native mobile 9.7)

Status: **checklist written; awaiting the TalkBack and VoiceOver walk**. Date: 2026-10-23. Standard: WCAG 2.2 level AA
and the platforms' own guidance (epic R11).

The story stays open (hitl) until the owner walks the [checklist](#the-walk) below on a real Android phone and a real
iPhone (or an emulator and a simulator, where the check says that is enough) and signs it off. Findings become fixes in
this story. The checklist is written from what the code does on `autopilot/foundation`; the web counterpart is
[`a11y-review-3-12.md`](../epic-web-zones/a11y-review-3-12.md).

## Scope

- **In:** the shared Compose views in `libs/mobile-sdk` (`TaleartZone`, `TaleartBar`, `TaleartBanner`, `TaleartViewer`,
  `TaleViewerState`, `TaleDocumentLayer`), as embedded by the Android `TaleartView` (`libs/android-sdk`) and the iOS
  `TaleartZoneView` (`libs/ios-sdk`), shown in Taller (`apps/taller`). Tales are image, video and Tale Studio documents
  (text, buttons, links, shapes, emoji), left to right and right to left (Hebrew).
- **Out:** Taller's own debug settings and list screens (a developer tool, not shipped); the content of tales
  (captions, flashing, contrast of text over the author's pictures); captions and a language field for tales, which are
  post-MVP as for the web (3.12, 1.2.x and 3.1.2).
- **Not run by a machine:** unlike 3.12 there is no scripted scan here. The Compose semantics are covered by unit and
  UI tests in the SDK libraries; what a screen reader says, and in what order, is only judged by this walk.

## What the code does (the basis of the checks)

Read from the sources; each check below tests one of these lines.

| Part | Behaviour |
|---|---|
| Bar item | One button (`Role.Button`), name = group title, plus `, seen` once viewed. The cover is hidden; the title text under it is hidden from services (the item's name says it). Item at least 48 x 48 dp. Row scrolls sideways. Title is 12 sp, at most two lines, and scales with font size. |
| Banner | Container named "Banner" (a traversal group). The shown slide is a button named by the group title with the state "n of m" (said as "Title, n of m"). Other slides are hidden from services. The slide is a polite live region only when the banner is not rotating. Previous slide / Next slide (44 dp round buttons, dimmed and disabled at an end without loop), the rotation button "Stop automatic slide show" / "Start automatic slide show" (hidden under reduced motion), dots "Show <title>" (24 dp targets, the current one `selected`). Any focus or tap on a control stops autoplay. |
| Viewer | A full-screen window (Android dialog, iOS modal) named by the group. Top controls, 44 dp: "Pause" / "Play" (shown under reduced motion only for a video tale), "Close". Under the tale, two invisible buttons "Previous tale" and "Next tale" (left third and right two thirds; mirrored in RTL), first in the reading order. A 1 dp polite live region says "Group, tale N of M"; on iOS the SDK also posts a UIKit announcement with the same text. |
| Documents | Each element is placed in reading order by its index. Decorative elements are hidden. Images are named by their alt text (hidden if none); shapes and emoji by their label (hidden if none). Buttons, image buttons and the swipe-up link are buttons whose action is named "Open in browser" and that open the system browser. The canvas is one group named by the tale. Text size follows the canvas, not the font size setting. |
| Reduced motion | Android: Settings > Accessibility > Remove animations (animator duration scale 0). iOS: Reduce Motion. Banner never rotates and has no rotation button; the viewer opens paused, tales do not advance by themselves, a swipe down no longer drags the tale. |
| After close | The banner moves to the slide of the group the viewer showed last and focuses it. The bar keeps its items; focus should return to the item that opened the viewer (this is a check, not a promise). |

## Setup

For one person, about 60 minutes in all (30 per platform).

### The API and the zone

1. Run the API on your Mac with its default port 3333 (`nx serve api` from the workspace root, with the development
   database it normally uses). Keep a project with two zones, one with a **bar** display and one with a **banner**
   display, each with at least three tale groups: one group with an image tale, one with a video tale, and one with a
   Tale Studio document tale that has a text element, a button or link, a decorative shape and an image with alt text.
   Give one group a Hebrew name and one document a Hebrew text line. Banner zone: autoplay on, dots on.
2. Issue a site key for the project and note the **site key** and the two **zone slugs**.
3. Have two more things ready: the document tale with a link must point to a harmless URL, and one group must have
   many tales (at least three) so "tale N of M" shows more than one number.

### Android (TalkBack)

- **Emulator:** build and install the debug app (`nx run taller:build-android`, then
  `adb install -r apps/taller/androidApp/build/outputs/apk/debug/taller-android-debug.apk`). The emulator reaches your
  Mac at `http://10.0.2.2:3333` (Taller's default API URL). Use an image with Google Play services so TalkBack is
  available (Settings > Accessibility > TalkBack), or install Android Accessibility Suite.
- **Phone:** the same APK. Either run `adb reverse tcp:3333 tcp:3333` and use `http://localhost:3333`, or use your
  Mac's address on the same Wi-Fi with the API listening on it. Debug builds allow plain HTTP only to `10.0.2.2` and
  `localhost` (`network_security_config.xml`); another address needs HTTPS or a change to that file.
- **Local-network permission:** the debug build declares `ACCESS_LOCAL_NETWORK`, and on Android 17 the app asks for it
  when it starts (a system dialog). **Allow it**, or the API cannot be reached. With TalkBack on, the dialog itself is
  also a check (CK 0.1).
- Open Taller, then Settings: API URL, Site key, Zone slug, **Load**. (Settings are saved on the device; the settings
  button reopens the screen.)
- TalkBack gestures: swipe right / left = next / previous item; double-tap = activate; two-finger swipe = scroll; Back
  gesture = Back. Learn them in TalkBack's tutorial first if you have not used it.

### iPhone (VoiceOver)

- **Simulator:** build with `nx run taller:build-ios`, then
  `xcrun simctl install booted apps/taller/iosApp/build/Build/Products/Debug-iphonesimulator/iosApp.app` and open it.
  The simulator shares the Mac's network, so the default `http://localhost:3333` works (the debug Info plist allows
  local networking). VoiceOver does not run in the simulator; use the **Accessibility Inspector** (Xcode > Open
  Developer Tool) to read names, roles and order, and treat spoken-output checks as **device only**.
- **iPhone:** open `apps/taller/iosApp/iosApp.xcodeproj` in Xcode, choose your device and a signing team, and run. Use
  your Mac's address (`http://<mac-name>.local:3333` or its IP) as API URL, with the API reachable on it; accept the
  local-network prompt if iOS shows one. VoiceOver: Settings > Accessibility > VoiceOver (or ask Siri).
- VoiceOver gestures: swipe right / left = next / previous item; double-tap = activate; two-finger scrub (Z) = escape /
  close; three-finger swipe = scroll; rotor = twist two fingers.
- Open Taller, then Settings, fill the three fields, **Load**.

### Settings to switch during the walk

Android: Font size and Display size (Settings > Display), Remove animations (Accessibility), a right-to-left language
(Hebrew; Settings > System > Languages). iPhone: Larger Text (Accessibility > Display & Text Size > Larger Text, with
Larger Accessibility Sizes on), Reduce Motion (Accessibility > Motion), a right-to-left language (Hebrew; Settings >
General > Language & Region).

Mark each row **Pass**, **Fail** or **N/A** by ticking the box on the platform. Wording differs between TalkBack,
VoiceOver and their versions; record what you hear when it differs in meaning, not in punctuation. Write what you heard
in Notes when a check fails.

## The walk

Boxes: **A** = Android with TalkBack, **i** = iPhone with VoiceOver. Tick Pass only. Leave a box empty for Fail and
describe it in Notes.

### 0. First launch and setup

| # | Do | Expect | A | i | Notes |
|---|---|---|---|---|---|
| 0.1 | Start Taller fresh with the screen reader on. (Android: with the debug build.) | Android: the local-network permission dialog is read with its Allow button and can be answered by TalkBack. iOS: the app opens straight; if a local-network prompt shows, it is readable. | ☐ | ☐ | |
| 0.2 | Enter the three settings (API URL, Site key, Zone slug) and activate Load. | Fields are read with their labels ("API URL", "Site key", "Zone slug"); Load is a button, enabled only when all are set. The zone appears. | ☐ | ☐ | |
| 0.3 | Check the zone loads at all (no "Offline" or "Invalid" message). | The zone's display shows above the zone list. If not, fix the setup before continuing. | ☐ | ☐ | |

### 1. Bar

Use the zone with the bar display. Screen reader on, touch exploration or swipe navigation.

| # | Do | Expect | A | i | Notes |
|---|---|---|---|---|---|
| 1.1 | Move onto the first bar item. | The group's title, then "Button" (TalkBack: "Title, Button, double tap to activate"; VoiceOver: "Title, button"). The picture and the title text under it are **not** read separately. | ☐ | ☐ | |
| 1.2 | Swipe right through all items. | Left-to-right order as drawn, one stop per group, none skipped, no extra stop for cover or title. | ☐ | ☐ | |
| 1.3 | Open a group, read a tale, close, and come back to the bar (see 3.12). Move to the same item. | The item now reads "Title, seen" (and the ring is the seen colour). Other items still read just "Title". | ☐ | ☐ | |
| 1.4 | Check the touch target of an item: Android with Developer options > Show layout bounds, or by feel; iOS with Accessibility Inspector > Audit. | At least 48 x 48 dp around each item, not only the picture. No audit warning for target size. | ☐ | ☐ | |
| 1.5 | With more items than fit, swipe to an item beyond the right edge. | The bar scrolls so the focused item is on screen. | ☐ | ☐ | |
| 1.6 | Activate an item by double-tap. | The viewer opens (part 3). | ☐ | ☐ | |

### 2. Banner

Use the zone with the banner display, autoplay on, dots on, at least three groups. Do this part first with Reduce
Motion / Remove animations **off**.

| # | Do | Expect | A | i | Notes |
|---|---|---|---|---|---|
| 2.1 | Move onto the banner. | "Banner" is read for the container; the next stop is the shown slide. | ☐ | ☐ | |
| 2.2 | Wait without touching while the banner rotates by itself. | The slides change and **nothing is announced** while it rotates on its own. | ☐ | ☐ | |
| 2.3 | Move onto the shown slide. | "Title, 1 of 3" (title, then "n of m"), role button. Hidden slides are not stops. | ☐ | ☐ | |
| 2.4 | Check that moving onto the slide stopped the autoplay. | The slides stop changing as soon as a control has screen reader focus; the rotation button now reads "Start automatic slide show". | ☐ | ☐ | |
| 2.5 | Swipe to "Next slide" and activate it. | "Next slide, button". The slide moves and the new slide is announced once, politely: "Title, 2 of 3". | ☐ | ☐ | |
| 2.6 | Activate "Previous slide". On the first slide with loop **off**, it is dimmed. | "Previous slide, button"; the new slide is announced. At the first slide without loop it reads as disabled (TalkBack "disabled", VoiceOver "dimmed"). | ☐ | ☐ | |
| 2.7 | Swipe to the rotation button. | Reads "Start automatic slide show" (button). Activate it: the label becomes "Stop automatic slide show" and the banner rotates again, without announcing each change. Activate again to stop. | ☐ | ☐ | |
| 2.8 | Swipe through the dots. | One stop per slide, "Show Title" (button); the dot of the current slide is read as selected. Activating a dot shows that slide, announced once. | ☐ | ☐ | |
| 2.9 | Reading order of the whole banner. | Banner, then the slide, then Previous slide, Next slide, rotation button, dots. Note any other order (this is as built; record it either way). | ☐ | ☐ | |
| 2.10 | Check the touch targets: round buttons and dots. | Buttons 44 dp, dots 24 dp apart enough to hit one without the next. | ☐ | ☐ | |
| 2.11 | Turn Remove animations (Android) / Reduce Motion (iOS) **on**. Return to the app and look at the banner. | The banner does not rotate, the rotation button is gone, slides change without sliding. Previous, Next and the dots still work. | ☐ | ☐ | |
| 2.12 | Activate the slide by double-tap. | The viewer opens on that group. | ☐ | ☐ | |

### 3. Viewer

Open any group with at least three tales from the bar or the banner.

| # | Do | Expect | A | i | Notes |
|---|---|---|---|---|---|
| 3.1 | Open the viewer. | Focus moves into the viewer and the viewer is announced. The announcement "Group name, tale 1 of N" is heard. | ☐ | ☐ | |
| 3.2 | **iOS only:** listen to the opening announcement carefully, and again after each tale change. | "Group name, tale N of M" is heard **once**, not twice. (The SDK posts an announcement and also has a live region; this is the check for a double.) | n/a | ☐ | |
| 3.3 | **Android only:** same listening. | "Group name, tale N of M" is heard once, from the live region. | ☐ | n/a | |
| 3.4 | Swipe through the viewer's controls. | The first stops are "Previous tale" and "Next tale" (buttons); the tale's own content and links follow; "Pause", "Close" are reachable (top controls). Record the exact order you hear. | ☐ | ☐ | |
| 3.5 | Activate "Next tale". | The tale changes; "Group name, tale 2 of N" is announced once. | ☐ | ☐ | |
| 3.6 | Activate "Previous tale". | Back to tale 1, announced once. | ☐ | ☐ | |
| 3.7 | Activate "Pause". | The label changes to "Play" and the tale stops advancing; the progress segment stops. Activate "Play": it runs again. | ☐ | ☐ | |
| 3.8 | While the tales advance by themselves, listen for a few tales. | Each change is announced. Judge if that is too talkative (it is the same as on the web, see 3.12). Write your verdict in Notes. | ☐ | ☐ | |
| 3.9 | Swipe past the last control. | Focus stays within the viewer: it does not reach the bar or banner behind it. | ☐ | ☐ | |
| 3.10 | Activate "Close". | The viewer closes. | ☐ | ☐ | |
| 3.11 | Close with the system route: Android Back gesture or button; iOS two-finger scrub, or swipe down on the tale. | The viewer closes the same way. | ☐ | ☐ | |
| 3.12 | After closing from a **bar** item, see where the reading cursor is. | Focus is back on the item that opened the viewer ("Title, seen"). If it lands at the top of the screen, note it. | ☐ | ☐ | |
| 3.13 | After closing from a **banner**, see where the cursor is. | The banner shows the slide of the last group viewed and focuses it. | ☐ | ☐ | |
| 3.14 | Turn Remove animations / Reduce Motion **on**. Open a group. | The viewer opens paused, no tale advances by itself, a swipe down does not drag the tale. "Pause"/"Play" is shown only for a video tale (which plays from Play). Next tale and Previous tale still work. | ☐ | ☐ | |
| 3.15 | With a video tale, activate Play and then Pause. | Sound stops with Pause. | ☐ | ☐ | |

### 4. Documents (Tale Studio tales)

Open the group whose tale is a document with text, a button or link, a decorative shape and an image with alt text.

| # | Do | Expect | A | i | Notes |
|---|---|---|---|---|---|
| 4.1 | Swipe through the document's elements. | The reading order follows the element order in the document (back to front, as authored). Record anything out of order. | ☐ | ☐ | |
| 4.2 | Find the text element. | The text is read as written. | ☐ | ☐ | |
| 4.3 | Find the image with alt text, and an image without. | The first is read by its alt text as an image; the second is not a stop. | ☐ | ☐ | |
| 4.4 | Pass over the decorative shape and any decorative text or emoji. | Nothing is read for them. | ☐ | ☐ | |
| 4.5 | Find the button or link. | Read as "Label, button", with the action "Open in browser" (TalkBack: "double tap to open in browser"; VoiceOver: a hint or custom action). | ☐ | ☐ | |
| 4.6 | Activate the link. | The system browser opens the address; returning to Taller leaves the viewer as it was. | ☐ | ☐ | |
| 4.7 | Find an image button and the swipe-up link, if the document has them. | Each is named by its label or name and has the same "Open in browser" action. | ☐ | ☐ | |
| 4.8 | Open the document with Hebrew text (see part 7 for the RTL locale). | The Hebrew line is read in order and its punctuation is on the correct side. Note whether the voice switches to Hebrew (the tale has no language field: expected to read with the system voice, post-MVP). | ☐ | ☐ | |
| 4.9 | **Known limit, Android:** with TalkBack **touch exploration** (finger sliding), slide a finger over an empty part of the canvas, away from any element. | TalkBack reads the canvas label (the tale title). That is known, not a failure; tick Pass if it does not read anything wrong or a stop that traps the finger. Swiping with one finger still moves element by element. | ☐ | n/a | |
| 4.10 | Same on iOS, drag a finger over an empty part. | Note what is read (the canvas group, if anything). | n/a | ☐ | |

### 5. Large text

Document text does **not** scale with the font size, by design (it follows the canvas, as the web does). The bar's
titles do.

| # | Do | Expect | A | i | Notes |
|---|---|---|---|---|---|
| 5.1 | Set the largest font size (Android: Font size at maximum and Display size at largest; iPhone: Larger Text at the maximum with Larger Accessibility Sizes). Open the bar. | Titles are larger, wrapped to at most two lines, with the ellipsis if still too long. Nothing is cut off at the item's edges, and items do not overlap. | ☐ | ☐ | |
| 5.2 | Look at the banner and the viewer's top bar at the same size. | The group name in the viewer and the screen's own labels are readable; the controls stay 44 dp; nothing overlaps Pause or Close. | ☐ | ☐ | |
| 5.3 | Open a document tale at the same size. | The document text stays the same size as before (does not scale). Nothing breaks and no element moves. | ☐ | ☐ | |
| 5.4 | Return the font size to normal. | The bar returns to its normal size. | ☐ | ☐ | |

### 6. Switch and gesture alternatives (short)

| # | Do | Expect | A | i | Notes |
|---|---|---|---|---|---|
| 6.1 | With the screen reader on, tap the left and right parts of the tale with one finger (double-tap on each of Previous tale and Next tale). | Both step the tale; they are the alternative to the swipe gestures. | ☐ | ☐ | |
| 6.2 | Use the banner's Previous slide and Next slide instead of swiping the slides. | They change the slide, so no swipe is needed. | ☐ | ☐ | |

### 7. Right-to-left locale

Switch the device language to Hebrew (or another right-to-left language) and restart Taller.

| # | Do | Expect | A | i | Notes |
|---|---|---|---|---|---|
| 7.1 | Bar: swipe through the items. | The items start from the right; the swipe order follows. A Hebrew group name is read correctly. | ☐ | ☐ | |
| 7.2 | Banner: look at the controls. | Previous slide sits on the right with a mirrored chevron, Next slide on the left; swipe order follows. The rotation icon is not mirrored. | ☐ | ☐ | |
| 7.3 | Viewer: "Previous tale" and "Next tale". | Mirrored: Previous is the right third, Next the left two thirds. The progress segments fill from the right. | ☐ | ☐ | |
| 7.4 | Viewer: Pause and Close. | The controls are mirrored (the group name at the start, Close at the end). | ☐ | ☐ | |
| 7.5 | A document tale. | The canvas is **not** mirrored: elements stay where the author placed them. A Hebrew line keeps its own direction and an English line its own. | ☐ | ☐ | |
| 7.6 | Switch the language back. | Everything returns to left to right. | ☐ | ☐ | |

## Findings from the walk

| # | Step | What happened | Severity (blocker / major / minor) | Fixed in |
|---|---|---|---|---|
| | | | | |

## Open items

1. The walk above (hitl). Record each step's result and any finding; findings become fixes in this story.
2. The reading order of the viewer (parts 3.4 and 4.1) and focus return to a bar item (3.12) are judged here for the
   first time on the native views; Compose and UIKit decide part of this, so a finding may need a platform workaround
   rather than a one-line fix.
3. Captions for video tales and a language setting for tales are post-MVP (as for the web, 1.2.x and 3.1.2).

## Sign-off

For the owner. Fill in after the walk.

- Android device or emulator and version: ______________________ TalkBack version: ______________________
- iPhone or simulator and iOS version: ______________________ VoiceOver used on a device: ☐ yes ☐ no
- Walked by: ______________________ Date: __________

Result:

- ☐ Every check passes on both platforms (or a failed one is recorded above and fixed).
- ☐ The bar, banner and viewer are usable with TalkBack and VoiceOver alone.
- ☐ Findings above to fix first, then walk again.
- ☐ Items left open on purpose (list): ______________________

Sign-off: ______________________ Date: __________
