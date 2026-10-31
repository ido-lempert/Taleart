---
name: Tale Studio 2
status: final
updated: 2026-10-24
sources:
  - ../tickets/epic-tale-studio/epic-tale-studio.md
  - ../tickets/epic-interactive-components/epic-interactive-components.md
  - ../architecture-taleart/architecture-taleart.md
companions:
  - DESIGN.md
---

# Tale Studio 2: Experience Spine

## Foundation

Tale Studio 2 is a new layout and interaction model for the existing Tale Studio (epic 7). It is not a new editor. The tale document (AD-15), the element-type registry and studio descriptors (story 7.8), autosave, the draft and published documents, undo and redo, snapping, layers, contrast warnings, project fonts and the SDK preview (AD-16) all stay. What changes is how people find, add, arrange and set up elements.

- **Surface:** the TaleArt dashboard (Angular, responsive web), route `/tales/:id/studio`. It is desktop first, works on tablets, and has an edit-lite mode on phones.
- **UI system:** the dashboard's own tokens and components. DESIGN.md holds the editor's visual delta.
- **Model:** a low-code editor, following the pattern people know from Canva, Figma, Webflow and Framer. Elements are on the left, the canvas is in the centre and properties are on the right.
- **Owner request (2026-10-24):** "all the components on left and be able to drag & drop them, then on right I see the element properties like all low-code apps" and better than what we have today.

Why we are changing it (`current-studio/`): today the canvas, the add buttons, the layers list and the inspector share one narrow column. The add buttons are 13 unlabelled pills. The inspector appears under the layers list, so editing a tall element means scrolling the canvas out of view. Half of the page is empty unless Preview is open. Phones see the canvas, then a long scroll.

## What Tale Studio 2 adds

| Area | Tale Studio 2 |
|---|---|
| Adding elements | A searchable, grouped palette of every registered type. Drag, or click or Enter to add |
| Fonts | Font picker that shows each font in its face, with project fonts (WOFF2 upload), the theme font and system stacks. Size slider, weight, line height |
| Shapes | Rectangle, ellipse and line today; star, arrow and speech bubble added, with stroke and corner radius |
| Layers | Layers tab with reorder, hide, lock, rename and multi-select, the same model on the canvas |
| Alignment | Smart guides, equal spacing, align and distribute, align to canvas or safe area, numeric position |
| Undo | Named undo and redo for every change, including multi-element actions |
| Accessibility | Alt text and names per element, contrast badges, visual reading order, full keyboard and screen-reader editing (WCAG 2.2 AA, 2.5.7) |
| Preview | The real Web SDK viewer on the unsaved draft, in several phone sizes, with an RTL check. The canvas draws components the way the SDK does |
| RTL | Text direction per element, start and end alignment, "Mirror for right-to-left", reading order follows the tale's direction |
| Motion | Entrance animation per element, which respects reduced motion |
| Templates | Built-in starter tales and element presets in the studio; project templates later |
| New components | Every type in the registry appears in the palette and inspector from its descriptor, with no layout work |

## Information Architecture

One page with five regions, in focus order. **F6** moves forward through them and **Shift+F6** moves back.

| Region | Landmark | Purpose |
|---|---|---|
| Top bar | `banner`-like toolbar | Back to the group, tale name, undo and redo, zoom, safe-area toggle, Preview, save state, status line, **Update tale**, tale menu (Discard changes, Duplicate, Mirror for right-to-left, Keyboard shortcuts) |
| Left panel | `complementary`, "Add and layers" | Tabs: **Elements** (default), **Templates**, **Media**, **Layers** |
| Canvas | `main`, "Canvas, 9:16" | The stage at the current zoom, with selection, handles, guides, the safe-area overlay and drop targets |
| Inspector | `complementary`, "Properties" | Contextual properties of the selection, or the tale's settings when nothing is selected. Preview replaces it while open |
| Tale strip | `navigation`, "Tales in <group>" | The group's tales in order: switch, add, duplicate, reorder, Shown or Hidden |

→ Composition reference: `mockups/tale-studio-2.html` and its render `mockups/tale-studio-2.png` (desktop at 1440 wide, plus a phone frame). Spines win on conflict.

### Left panel tabs

| Tab | Contents |
|---|---|
| **Elements** | A search field ("Search elements", `/` focuses it), then categories in order: **Text** (presets: Heading, Subheading, Body, Caption, Label), **Media** (Image, Video, Sticker), **Shapes** (one tile per shape kind), **Stickers & emoji** (Emoji, Sticker), **Buttons & links** (Button, Image button, Swipe-up link), **Interactive** (Poll, Rating, Quiz, then Emoji reaction, Countdown, Promo code and Product pins as epic 4 adds them), **More** (any registered type with no palette category). A type that has reached its limit ("A tale holds one poll") stays in the list as disabled, with the reason as its description. A type that needs the project's media is disabled with a reason when the tale has no project. |
| **Templates** | **Starter tales** (whole-tale documents: Announcement, Product drop, Ask a question, Countdown to launch, Quiz time, Blank) and **Element presets** (styled text, button styles, a poll with a heading). Each shows a 9:16 thumbnail. |
| **Media** | The project's media: search, a filter for Images, Videos and Stickers, an **Upload** button and a drop zone for files. Each item is draggable onto the canvas and has an Add button. A **Use as background** action is on each image. |
| **Layers** | Today's layers list, moved here: top first, with name, type icon, warnings (outside safe area, low contrast, needs alt text, needs a web address, small target, over 15 s), hide, lock and the ⋯ menu. Its keyboard model is unchanged. Multi-select works with Shift and Cmd/Ctrl. |

### Inspector contexts

| Selection | Inspector shows |
|---|---|
| Nothing | **Tale**: background (colour swatches or media, fit), duration, direction summary, warnings count, the Mirror for right-to-left action |
| One element | Header (type icon, editable layer name, lock and hide toggles), then the sections that apply, in this order: **Content**, **Style**, **Position & size**, **Animation**, **Action**, **Accessibility**, **Responses** |
| Two or more | "<n> elements": **Align** (left, centre, right, top, middle, bottom), **Distribute** (horizontal, vertical, with 3 or more selected), **Position & size** of the selection's bounds, and Style controls only where every selected element has the same prop (for example, the colour of several texts) |
| Locked element | Sections shown read-only, with "Unlock to edit" at the top |

### Inspector sections

| Section | Built-in types | Configured types (descriptor) |
|---|---|---|
| **Content** | Text: the text. Media: the file, Replace. Emoji: the emoji picker. Button: its label | Descriptor fields with `section: content` (the default): question, options, title, and similar |
| **Style** | Text: font picker, size slider, weight segmented, italic toggle, line height slider, colour swatches, background (none, line, box) and its colour, alignment segmented (start, centre, end, justify), direction segmented (auto, LTR, RTL). Shape: fill swatches, stroke colour and width, corner radius, opacity. Media: fit segmented, corner radius, opacity. Button: fill, text colour, corner radius, font | Fields with `section: style`, for example the theme segmented (light, dark) |
| **Position & size** | X, Y, W and H in percent of the canvas, lock aspect, rotation slider, align to canvas or safe area (one element). Not shown for the swipe-up link, which is pinned | The same |
| **Animation** | Entrance: None, Fade, Slide up, Slide from start, Pop, Drift. Delay and duration sliders. Play button (plays it on the canvas once) | The same |
| **Action** | Button, image button and swipe-up: web address, with check | Fields with `section: action` |
| **Accessibility** | Name (`a11y.label`), Decorative toggle, alt text for media, place in the reading order ("3 of 7, after 'Summer sale'"), contrast result | The same |
| **Responses** | — | Interactive types: counts, as today's `app-tale-responses` |

## Registry fit: new types appear by themselves

The element-type registry stays the one list (AD-15, story 7.8). Each studio descriptor gains:

- `palette`: `{ category, order, keywords[], presets?[], thumbnail? }`. `category` is one of `text`, `media`, `shapes`, `stickers`, `actions`, `interactive`. A preset is `{ id, label, props, box? }`; one type can offer several tiles, as shape kinds and text presets do. Today's `add[]` entries and their `row` map onto this. Each `AddMenuEntry` becomes a palette tile, and its limit and `needsProject` rules carry over.
- `InspectorField.section`: one of `content` (the default), `style`, `action` or `accessibility`.
- `InspectorField.control` gains `slider` (with `min`, `max`, `step` and `unit` from the schema), `segmented` (with options from the schema's enum, at most 5), `swatch`, `toggle` and `font`.

A type that is registered with a descriptor but has no `palette` appears under **More** and its fields go in **Content**, so nothing silently disappears. Interactive stories 4.4 to 4.7 add descriptors in the current shape. Epic 11 migrates every existing descriptor, those included, in one story.

## Voice and Tone

The dashboard voice: plain verbs, short, no exclamation marks. Never say "Publish" in the studio (owner decision D4).

| Do | Don't |
|---|---|
| "Drag onto the tale, or press Enter to add" | "Drag and drop to get started!" |
| "Poll added, centre of the safe area. Selected." | "Element created successfully" |
| "A tale holds one poll. Delete it to add another." | "Limit reached" |
| "Aligned 3 elements to the left" | "Done!" |
| "Visible on site · 2 changes not updated yet" | "Unpublished changes" |
| "Replace this tale's elements, or add the template as a new tale?" | "Are you sure?" |
| "No elements match 'countdwn'. Try 'timer'." | "No results" |

## Component Patterns

| Component | Behavioural rules |
|---|---|
| **Palette tile** | A `button`. Click, Enter or Space adds the element at the next free spot: the centre of the safe area, offset by 4% down and right for each element already there. Dragging it with a pointer starts a drag (see Interaction Primitives). Its accessible name is the label. Its description says the limit or project reason when disabled, using `aria-disabled` so it stays focusable. Categories are `group`s named by their heading. |
| **Palette search** | Filters by label and keywords as you type. Matching categories stay, and empty ones hide. A polite live region says "<n> elements". Escape clears the search, and a second Escape returns focus to the canvas. Arrow Down moves to the first result. |
| **Template card** | A `button` with a thumbnail and a name. On an empty tale it applies at once. On a tale with elements, a dialog offers **Replace elements** or **Add as new tale**. Replacing is one undo step named "Apply template <name>". |
| **Media item** | A button that adds the media as an image or video element. It can be dragged onto the canvas, or onto the **Background** drop target that appears at the bottom of the canvas during a media drag. Its ⋯ menu has Use as background, Copy alt text and Delete from project (when unused). |
| **Canvas element** | Today's model, kept: a focusable button per element, arrows move it (Shift for 10× steps), Enter edits text, the context menu key or Shift+F10 opens actions, and Delete deletes it. New: Alt+arrows resize from the end edge and Shift+Alt+arrows from the start edge. Ctrl/Cmd+[ and ] change the order, as today. |
| **Selection handles** | Eight resize handles and one rotation handle. Shift keeps the aspect, Alt resizes from the centre, and Shift while rotating snaps to 15°. Each has the same keyboard and inspector equivalents. |
| **Marquee** | A drag on empty canvas selects every element the rectangle touches. The keyboard equivalent is Ctrl/Cmd+A, or Shift-selection in the layers list. |
| **Zoom control** | A menu button showing the percentage, with Fit, 50%, 100%, 200%, Zoom in and Zoom out. Fit keeps fitting when the window resizes, until the user picks a level. |
| **Safe-area toggle** | A toggle button, on by default, remembered per user in local storage. While dragging, the overlay always shows. |
| **Inspector section** | A disclosure button (`aria-expanded`). Content, Style and Position & size are open by default. Open state is remembered per section in local storage. A section with a problem (missing alt text, bad address) shows a warning icon in its header and opens itself. |
| **Swatch row** | A `radiogroup` named for the property ("Text colour"). Each swatch is a radio named by its colour name and hex ("Ember, F2542D"). Arrow keys move through it. "+" opens the custom picker popover, which has a hex field and an eyedropper where the browser supports one. |
| **Slider + number** | A native range input and a number input, both labelled, kept in sync. Typing a value out of range is clamped and the field says so in its hint. One drag, or one burst of arrow keys, is one undo step. |
| **Segmented control** | A `radiogroup` with visible labels or icons, each with a name. Arrow keys move and select it. |
| **Font picker** | A combobox with a listbox. Typing filters. Project fonts list first, then Theme font, then System. Each option renders in its own face once loaded, and in the fallback before. "Upload font…" opens today's project font upload in a dialog and selects the new font after upload. |
| **Tale strip** | A list of the group's tales (`navigation` with a list). Each thumbnail is a link to that tale's studio. Its ⋯ menu holds Duplicate, Move earlier, Move later, Hide or Show, Delete. Drag reorders, and Alt+Left/Right on a focused thumbnail moves it. "+" after the last thumbnail offers Blank tale, From template and From media. The current tale is `aria-current="page"`. |
| **Preview pane** | Today's AD-16 SDK preview, moved into the inspector's place, with phone size, Sound, Play from the start and a new **Right-to-left page** check. Escape or Close returns focus to the Preview button. |
| **Update tale** | As story 8.4: the primary button, with the status line beside it. It is disabled with a reason while saving or when there is nothing to update. |

## State Patterns

| State | Treatment |
|---|---|
| Empty tale | The canvas shows the background and one hint in the safe area: "Drag an element here, or pick one on the left." The Templates tab shows a badge. The hint is not an element and is not saved. |
| Dragging from the palette | The ghost follows the pointer. The safe area shows at full strength and smart guides snap the ghost. A drop outside the stage cancels the drag and says "Not added". Escape cancels too. |
| Drop on a full tale | At 60 elements, tiles are disabled with "A tale holds up to 60 elements." |
| Type limit reached | The tile is disabled with the limit text. Dragging it shows a not-allowed cursor and the reason in a tooltip. |
| Media uploading | A tile in the Media tab shows progress. A media element dropped on the canvas while uploading shows a progress placeholder and saves its key when the upload finishes. If the upload fails, the placeholder becomes an error with Retry and Remove. |
| Autosave | Unchanged: "Saving…", "All changes saved", failure with retry, and the conflict dialog (Reload latest version or Keep my version as a new tale). |
| Switching tales with unsaved edits | Autosave flushes first. If the save fails, the switch stops and the failure shows, so nothing is lost. |
| Selection hidden by zoom | When the selection is off-screen after an undo or a layers-list pick, the canvas scrolls it into view. |
| Locked element | It is drawn with a lock badge and has no handles. The inspector is read-only with "Unlock to edit". |
| Warnings | Each one shows on its layer row, in its inspector section header, and as a count in the Tale context ("3 things to check"), and that count lists them as links. |
| Unknown element type (registry newer than this build) | Shown as a labelled box "Unknown element", locked, kept in the document. |
| Offline | The dashboard banner. Edits continue locally, and autosave retries as today. |

## Interaction Primitives

**Pointer:**
- **Drag from palette, template or media to canvas** adds the item at the drop point. The item centres on the pointer and is clamped inside the stage. Snapping applies, and Alt places it freely.
- **Drag on the canvas** moves elements, with today's snapping plus new equal-spacing guides and distance labels. Shift locks the move to an axis.
- **Click** selects. **Shift or Cmd/Ctrl-click** adds to or removes from the selection. A **double-click** on text edits it.
- **Ctrl/Cmd+wheel or pinch** zooms around the pointer. **Space+drag** or a middle-button drag pans.
- **Files dragged from the desktop** onto the Media tab upload to the project; dropped onto the canvas, they upload and add an element.

**Keyboard** (studio shortcuts are off while typing in a field):

| Keys | Action |
|---|---|
| F6 / Shift+F6 | Next or previous region |
| `/` | Search elements |
| Enter or Space on a tile | Add the element and select it on the canvas |
| Arrows, Shift+arrows | Move by 1% or 10% |
| Alt+arrows, Shift+Alt+arrows | Resize from the end or the start edge |
| Ctrl/Cmd+A, Escape | Select all, clear the selection (or stop editing) |
| Ctrl/Cmd+D, Delete | Duplicate, delete |
| Ctrl/Cmd+[ / ], with Shift | Backward or forward, to the back or the front |
| Ctrl/Cmd+Shift+L / E / R / T / M / B | Align left, centre, right, top, middle, bottom |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Undo, redo |
| Ctrl/Cmd+plus, minus, 0, 1 | Zoom in, zoom out, Fit, 100% |
| Ctrl/Cmd+Enter | Update tale |
| `?` | Keyboard shortcuts dialog |
| Alt+Left/Right on a strip thumbnail | Move the tale earlier or later |

**Banned:** drag as the only way to do anything; hover-only controls; a modal on top of a modal; an action that cannot be undone, except Update tale and deleting a tale, which ask first.

## Accessibility Floor

WCAG 2.2 AA is a hard requirement (NFR-007, epic 7 R13). On top of today's studio floor:

- **2.5.7 Dragging movements.** Every drag has a single-pointer path that needs no dragging. To add, click the tile. To move, use the arrow keys or the X and Y fields, or Align. To resize, use the W and H fields or Alt+arrows. To rotate, use the slider or field. To reorder layers, use the menu or Ctrl/Cmd+[ and ]. To reorder tales, use the ⋯ menu Move earlier or later. To pan, use the scrollbars or arrow keys on the workspace. To zoom, use the zoom menu.
- **2.1.1 Keyboard.** Everything in the table above, with no keyboard trap. F6 always leaves the canvas.
- **Announcements.** One polite live region in the studio says "Poll added at the centre of the safe area. Selected.", "Moved to 12%, 40%" (debounced 500 ms), "Aligned 3 elements to the left", "Undid Apply template Announcement" and "Not added". Save failures stay in today's assertive alert.
- **Palette semantics.** Tiles are buttons in labelled groups. Disabled tiles stay focusable with their reason. Search announces the count.
- **Canvas semantics.** Today's model is kept: element buttons with a type and name, pressed state for selection, and descriptions for lock and hide. Multi-selection announces "<n> selected".
- **2.4.11 Focus not obscured.** The top bar, the strip and phone sheets never cover the focused element. Moving focus scrolls the canvas or the panel to keep it in view.
- **2.5.8 Target size.** Handles, swatches, strip thumbnails and layer buttons are at least 24 by 24 CSS pixels of hit area.
- **1.4.10 Reflow and 1.4.4 Resize.** The panels reflow down to 320px. The canvas is exempt as two-dimensional content, but its controls are not. Page zoom to 200% keeps every control reachable.
- **1.4.11 Non-text contrast.** Selection, handles, guides, the safe area and focus meet 3:1.
- **Motion.** The studio's own transitions and the animation Play respect `prefers-reduced-motion`. The SDK skips entrance animation under reduced motion.

## Responsive & Platform

| Width | Layout |
|---|---|
| 1280px and up | All five regions. Left panel 56px + 280px, inspector 320px, strip 112px |
| 1024 to 1279px | The left panel collapses to its icon rail. A tab opens as a flyout over the canvas edge and closes on Escape or after an add. The inspector stays |
| 768 to 1023px | The rail as above. The inspector becomes a right drawer that opens on selection or with a **Properties** button, and closes with Escape. The strip stays |
| Below 768px (phones) | Edit-lite: the top bar keeps back, undo and Update tale, with everything else in the tale menu. The canvas is full width, at Fit. A bottom toolbar has **Add**, **Layers**, **Properties** and **Tales**, each opening a bottom sheet with the same content as its desktop region. Tap a tile to add; no palette drag. Elements still move by touch drag, with the arrow buttons in Position & size as the alternative. Sheets are half height and can expand, and the canvas scrolls to keep the selection visible above them |

## Key Flows

### Flow 1: Noa builds a launch tale without the docs (desktop)

Noa runs marketing for a shoe brand and has never opened Tale Studio. Her group "Autumn drop" is Off.

1. She opens the group and presses Edit on the first tale. The studio opens with an empty canvas that says "Drag an element here, or pick one on the left."
2. In Templates she picks **Product drop**. The canvas fills with a heading, a product image placeholder, a shape band and a "Shop now" button.
3. She drags her shoe photo from Media onto the placeholder area. It drops at the pointer, snapped to the centre guide. She deletes the placeholder.
4. She types "poll" in Elements search and drags **Poll** under the photo. The pink guides show equal spacing between the photo and the button.
5. In the inspector, under Content, she writes "Which colour next?" and two options. Under Style she clicks **Dark** in the theme control.
6. She selects the heading, opens the font picker, and sees her brand font "Grotesk Brand", which a colleague uploaded, drawn in its own face. She picks it and drags the size slider until the heading fits one line.
7. She Shift-clicks the heading, the photo and the button, and presses **Align centre**.
8. **Climax:** she opens Preview. The real SDK viewer plays the tale with her font, the dark poll and the Shop now button exactly as on the site. She presses **Update tale**, the status line says "Not visible: group is off · up to date", and the strip thumbnail's dot clears.

Failure: her drop of the poll lands half outside the stage. The ghost is clamped inside, and the layer row shows no "Outside safe area" warning because snapping kept it inside.

### Flow 2: Omar edits with a keyboard and a screen reader

Omar is a content editor who uses NVDA and no mouse.

1. He opens the studio. NVDA reads "Tale Studio, Spring sale tale 2. Elements, search elements".
2. He types "rating" and hears "1 element". Arrow Down, then Enter: "Rating added at the centre of the safe area. Selected." Focus is on the rating on the canvas.
3. F6 takes him to the inspector. In Content he types the question. In Style, arrow keys pick **Light**.
4. He F6s back to the canvas and presses Shift+Down three times. After a pause he hears "Moved to 10%, 72%." The layer row warns "Outside safe area", so he presses Up once and the warning clears.
5. He opens Accessibility and checks the reading order: "4 of 4, after 'Shop now'".
6. **Climax:** he presses Ctrl+Enter and hears "Updated. Visible on site, up to date." He never needed a pointer, and nothing he did needed a drag.

### Flow 3: Dana mirrors a tale for her Hebrew site

1. Dana duplicates "Summer sale" from the strip's ⋯ menu and opens the copy.
2. From the tale menu she picks **Mirror for right-to-left**. Each element's x flips, and text direction becomes RTL with start alignment, as one undo step: "Mirrored 6 elements."
3. She retypes the texts in Hebrew. Alignment stays at start, which now means right.
4. **Climax:** Preview with **Right-to-left page** on shows the tale reading right to left, and the reading order in Accessibility follows it.

### Flow 4: Ido checks a new component appears with no layout work

1. A developer merges interactive story 4.5 (Countdown), which adds a registry entry and a descriptor with `palette: { category: 'interactive', keywords: ['timer', 'launch'] }` and fields with sections.
2. **Climax:** in the studio, Countdown appears under Interactive and is found by searching "timer". It drags onto the canvas, and its inspector shows Content, Style (a theme segmented control) and Accessibility. No studio layout code changed.

## Inspiration & Anti-patterns

- **Taken from Canva:** a left panel of tabs for Elements, Templates and Uploads, with search across everything, and templates as the fastest start.
- **Taken from Figma and Framer:** a right properties panel that changes with the selection, with numbers next to every control, smart guides with distance labels, align and distribute, and layers with lock and hide.
- **Taken from Webflow:** add by click or drag, with the same element list in both.
- **Taken from the Instagram story editor:** the full-bleed 9:16 canvas as the hero, and a phone flow built on sheets.
- **Rejected: a floating contextual toolbar over the canvas** (Canva). It covers the tale and fights 2.4.11. Its controls live in the inspector.
- **Rejected: free canvas size or multiple artboards.** A tale is one 9:16 stage (AD-15).
- **Rejected: element groups.** The document has no group type. Multi-select covers alignment, and groups would need an AD-15 change.

## Owner decisions to confirm

1. Layers as a tab of the left panel (proposed), or docked under the inspector.
2. Entrance animation in this epic (proposed). It adds an optional field to the document and to the SDK renderer within the 50 KB budget.
3. Canvas drawing interactive components through the SDK renderer (proposed), instead of today's text stand-ins. This needs an architect check.
4. New shape kinds (star, arrow, speech bubble) and stroke (proposed), as an additive schema change.
5. Starter templates built in only for now. Project-saved templates come later.
6. "Mirror for right-to-left" as a tale action (proposed). The studio UI itself stays English and left to right.
7. Phones get edit-lite: tap to add and sheets, with no palette drag.
8. Discard changes and Duplicate move from the top bar into the tale menu.
9. Reordering tales in the strip changes the group's order everywhere it shows.
