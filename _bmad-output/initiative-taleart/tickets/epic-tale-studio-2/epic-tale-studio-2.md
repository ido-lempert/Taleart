---
type: epic
title: "Tale Studio 2: a low-code editor with the elements on the left and the properties on the right"
parent: initiative-taleart
id: 11
covers: [R13, R10]
sources: [_bmad-output/initiative-taleart/ux-tale-studio-2/EXPERIENCE.md, _bmad-output/initiative-taleart/ux-tale-studio-2/DESIGN.md]
companions: [_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md, _bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md, _bmad-output/initiative-taleart/research-another tool-competitive-teardown/digests/studio-r4-1.md]
after: []
refined: true
risk: high
---

# Tale Studio 2: a low-code editor with the elements on the left and the properties on the right

## Description

The owner finds another tool's studio more intuitive than ours. He asked for an editor with every component on the left, ready to drag onto the tale, and the selected element's properties on the right, like low-code apps, and for it to be better than another tool's (owner request, 2026-10-24).

Today's Tale Studio (epic 7) is strong underneath. It has the tale document, the registry, autosave, undo, snapping, layers, project fonts, contrast warnings and the SDK preview. But its layout hides all of this: the canvas, 13 unlabelled add buttons, the layers list and the inspector share one narrow column (`ux-tale-studio-2/current-studio/`).

This epic rebuilds the studio's layout and interaction model per the UX spines (`ux-tale-studio-2/EXPERIENCE.md`, `DESIGN.md`):

- a top bar;
- a left panel with Elements, Templates, Media and Layers tabs;
- a centre canvas with zoom, safe areas and smart guides;
- a right inspector in sections with low-code controls;
- a tale strip for the group's tales.

It then adds what another tool does not document: alignment tools, templates, RTL mirroring, more shapes and entrance animation. The document model, the SDK renderer and the save and update semantics of epic 7 stay.

## Outcome

A content manager who has never opened the studio composes a tale from a template, drags in a photo and a poll, styles text with the project font, aligns the elements and updates the tale, without reading docs. A keyboard and screen-reader user does the same without a pointer. Every element type in the registry appears in the palette and the inspector with no studio layout code.

## Requirements

R1 (parent R13; EXPERIENCE Information Architecture): **Five regions**
   The studio fills the viewport under the dashboard bar. It has a top bar, a left panel, the canvas, the inspector and the tale strip. The page never scrolls and each panel scrolls on its own. F6 and Shift+F6 move between regions. The top bar holds back to the group, the tale name, undo and redo, zoom, the safe-area toggle, Preview, the save state, the status line, **Update tale**, and a tale menu (Discard changes, Duplicate, Mirror for right-to-left, Keyboard shortcuts). The layers list moves to the left panel's Layers tab with its keyboard model unchanged. Preview opens in the inspector's place.

R2 (parent R13, R10; EXPERIENCE Registry fit, Left panel tabs): **Element palette from the registry**
   The Elements tab lists every registered, non-test element type as tiles grouped in the order Text, Media, Shapes, Stickers & emoji, Buttons & links, Interactive, More. Grouping comes from a `palette` entry on each studio descriptor: category, order, keywords and presets. A type with no `palette` entry shows under More. Search filters by label and keyword and announces the count. Limits and the project-media rule keep their reasons and leave tiles focusable.

R3 (parent R13; WCAG 2.5.7, 2.1.1; EXPERIENCE Interaction Primitives): **Add by drag or by click**
   Dragging a tile, a template element or a media item onto the canvas adds it at the drop point, snapped and clamped inside the stage. A drop outside the stage, or Escape, cancels. Click, Enter or Space on a tile adds the element at the next free spot in the safe area. Both paths select the new element, focus it on the canvas and announce it.

R4 (parent R13; EXPERIENCE Inspector contexts and sections): **Contextual inspector in sections**
   With nothing selected, the inspector shows the tale's settings. With one element, it shows a header and the sections that apply, in order: Content, Style, Position & size, Animation, Action, Accessibility, Responses. With several, it shows Align, Distribute, the bounds and the shared style props. A locked element's inspector is read-only. Sections are disclosure buttons whose open state is remembered, and a section with a problem opens itself.

R5 (parent R13, R10; EXPERIENCE Component Patterns): **Low-code controls**
   The inspector edits values with these controls:
   - colour swatches (project theme colours, colours in this tale, recent colours, and custom with hex);
   - a slider paired with a number field;
   - a segmented control;
   - a toggle;
   - a font picker that shows each font in its face, with project fonts, the theme font and system stacks, and an inline upload.

   A descriptor field names its `section` and may use the controls `slider`, `segmented`, `swatch`, `toggle` and `font`, so a configured type gets them from configuration alone. One drag or one burst of key presses on a control is one undo step.

R6 (parent R13; EXPERIENCE Canvas): **Zoom, pan and safe area**
   The zoom is Fit by default and ranges from 25% to 400%. Zoom works by menu, keys, Ctrl or Cmd with the wheel, and pinch. Pan works by Space+drag, a middle-button drag, scrollbars and keys. A safe-area overlay toggle is remembered per user and always shows while dragging. Drag, drop and snapping stay correct at every zoom.

R7 (parent R13; EXPERIENCE Component Patterns): **Multi-select, align and distribute**
   Several elements are selected by Shift or Cmd-click, a marquee, select all, and Shift selection in the layers list. Align (left, centre, right, top, middle, bottom) and distribute (horizontal, vertical) each work in one action that is one undo step, with keyboard shortcuts. A single element aligns to the canvas or the safe area. Smart guides add equal-spacing matches with distance labels.

R8 (parent R13; EXPERIENCE Tale strip): **Tale strip**
   The group's tales show as 9:16 thumbnails in order. Each shows the current tale, a Hidden mark and a changes-not-updated mark. A thumbnail opens that tale's studio after autosave flushes; a failed flush stops the switch. "+" adds a blank tale, a tale from a template or a tale from media. Duplicate, Hide or Show, Delete, and reorder by drag, with Move earlier and Move later and Alt+arrows as the alternatives, change the group's order everywhere it is shown.

R9 (parent R13; EXPERIENCE Left panel tabs): **Media tab**
   The project's media are listed with search, a filter (images, videos, stickers) and upload, by button or by dropping files on the panel or the canvas, with progress, failure, retry and remove. A media item is added by click or by drag. Dropping it on the Background target sets the tale's background.

R10 (parent R13; EXPERIENCE Left panel tabs): **Templates**
   Built-in starter tales (whole-tale documents) and element presets live as registry data in `libs/contract`, each valid against the document schema. Applying one to an empty tale fills it. On a tale with elements, it asks to Replace elements or Add as new tale. Replace is one undo step.

R11 (parent R13; EXPERIENCE Flow 3): **Right to left**
   "Mirror for right-to-left" flips each element's x position and sets text direction to RTL with start alignment, as one undo step. The preview can render the tale on a right-to-left host page. The reading order follows the tale's direction (AD-15).

R12 (parent R13, R10; EXPERIENCE What we do better): **More shapes**
   The shape type adds the kinds star, arrow and speech bubble, and a stroke (colour and width), as an additive change to the shape schema (AD-15). The Web SDK renders them. An older client skips the unknown kind, as AD-15 requires.

R13 (parent R13, R10; EXPERIENCE Inspector sections): **Entrance animation**
   Each element may carry an optional entrance (none, fade, slide up, slide from start, pop or drift) with a delay and a duration, as an additive optional field (AD-15). The Web SDK plays it once when the tale opens, skips it under reduced motion, and stays within the 50 KB budget. The Animation section edits it and can play it on the canvas.

R14 (parent R13, R10; EXPERIENCE Inspiration, Owner decisions 3): **The canvas draws components as visitors see them**
   Configured element types (poll, rating, quiz and later ones) are drawn on the canvas by the Web SDK's document renderer, inert, under the studio's selection and handles, in place of today's stand-in text. An unknown type is drawn as a labelled, locked box.

R15 (parent R13; EXPERIENCE Responsive & Platform): **Tablets and phones**
   From 1024 to 1279 px the left panel collapses to its icon rail with a flyout. From 768 to 1023 px the inspector becomes a drawer. Below 768 px the studio runs in edit-lite: a full-width canvas, a bottom toolbar (Add, Layers, Properties, Tales) opening sheets, and tap to add. Nothing obscures the focused element, and the panels reflow at 320 px.

R16 (parent R13; AD-15): **Saving and updating keep their meaning**
   Autosave, the conflict flow, undo and redo, Update tale and Discard changes behave as in epic 7 and story 8.4. A multi-element action (align, distribute, template, mirror) is one named undo step.

R17 (parent R13; NFR-007; architecture Quality Targets): **Accessible editor**
   The studio meets WCAG 2.2 AA:
   - every drag has a keyboard path and a single-pointer path (2.5.7);
   - one polite live region announces add, move (debounced), align, undo and cancel;
   - palette tiles are buttons in labelled groups;
   - swatches and segmented controls are radio groups;
   - targets have at least 24 px of hit area;
   - focus is never obscured;
   - the panels reflow at 320 px.

## Constraints

- **Contract first:** the palette metadata the server needs, starter templates, new shape kinds and the entrance field are in `libs/contract`. The registry stays the one list. Source: AD-3, AD-15.
- **Additive document changes only:** the document version stays 1, and older SDKs skip what they do not know. Source: AD-15.
- **No HTML or CSS from content.** Source: AD-16.
- **Web SDK budget** of 50 KB gzipped and 1.5 s to first content. Source: architecture Quality Targets.
- **WCAG 2.2 AA**, including 2.5.7 and 2.4.11. Source: architecture Quality Targets, NFR-007.
- **No another tool brand names, text, icons or screenshots.** The research is paraphrased only. Source: AD-12, NFR-004, NFR-005.

## Done when

- On the deployed dashboard, Flow 1 of EXPERIENCE.md runs end to end. A person picks a template, drags a photo and a poll onto the canvas, styles a heading in a project font, aligns three elements and updates the tale, and the sample page shows the tale as the preview did.
- Flow 2 runs with only a keyboard and a screen reader, recorded in the accessibility review, and the automated WCAG 2.2 AA scan of the studio at 1440, 1024, 768 and 390 px wide is clean.
- A test element type registered with a descriptor (palette entry and sectioned fields) appears in the palette and inspector with no studio layout change, and one registered without a palette entry appears under More.
- The Web SDK stays at or under 50 KB gzipped with the new shapes and entrance animation, and the existing tales render unchanged.
- The owner has reviewed the layout (story 11.2) and confirmed or changed each owner decision.

## Boundaries

- **In:** the studio's layout, palette, inspector, canvas tools, tale strip, Media and Templates tabs, RTL mirroring, new shape kinds, entrance animation and responsive modes.
- **Out:** element groups, which need a group type in the document; project-saved templates, a later story; a brand kit beyond the theme and project fonts; GIF search; AI assist; collaborative editing; locale variants; a floating toolbar over the canvas.
- **Must not change:** the tale document's meaning, version and validation rules; the draft and published documents and the 409 conflict flow; Update tale and Discard changes; the layers list's keyboard model; contrast warnings, which never block; the Delivery API.
- Touch point: interactive components' descriptors (`tale-element-types.ts`) and the configured inspector (`tale-fields-inspector.ts`). Stories 4.4 to 4.7 add descriptors and fields there in the current shape. Owner: epic-interactive-components.
- Touch point: the native renderer (epic 9) skips new shape kinds and the entrance field until it adds them. Owner: epic-native-mobile.
- Touch point: tale reorder and duplicate in the `tales` module. Owner: epic-tale-studio and epic-ux-rework (8.11).

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R13, R10)
- design — `_bmad-output/initiative-taleart/ux-tale-studio-2/DESIGN.md`
- design — `_bmad-output/initiative-taleart/ux-tale-studio-2/EXPERIENCE.md` (Owner decisions to confirm at the end)
- design — `_bmad-output/initiative-taleart/ux-tale-studio-2/mockups/tale-studio-2.html` (and `.png`)
- architecture — `_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md`, AD-3, AD-12, AD-15, AD-16, Quality Targets
- epic — `_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md` (R1 to R18; Boundaries "Post-MVP" list)
- research — `_bmad-output/initiative-taleart/research-another tool-competitive-teardown/digests/studio-r4-1.md`

## Notes

- Decision (2026-10-24, owner request): the left palette with drag and drop and the right properties inspector, like low-code apps, better than another tool's studio.
- Decision (2026-10-24, autopilot): the tracer bullet is story 1, "Tracer: the studio in five regions". It moves today's controls into the new shell with click to add, so the owner can review the layout (story 2) before the palette, drag and drop and inspector are rebuilt.
- Decision (2026-10-24, autopilot): one epic of 18 stories rather than two. Every story touches the one studio component, so they form one ordered lane either way. The owner may split it after story 9, into "layout" (1 to 9) and "power features" (10 to 15).
- Decision (2026-10-24, autopilot): templates and animation, which epic 7 listed as post-MVP, are pulled in here at the owner's request for a studio "better than another tool". Project-saved templates stay out.
- Assumption: the owner decisions listed at the end of EXPERIENCE.md stand until story 2 confirms or changes them. They are layers in the left panel, animation in scope, the canvas drawn by the SDK renderer, new shape kinds, built-in templates only, the RTL mirror action, edit-lite on phones, Discard and Duplicate in the tale menu, and strip reorder changing the group order.
- Open question (architect, before story 15, recorded as its unknown): drawing configured types on the canvas with the SDK renderer means the dashboard imports more of `@taleart/web-sdk` than `/preview` exposes today (AD-16). Is a renderer entry point for one element acceptable?
- Open question (architect, before story 13, recorded as its unknown): where the entrance field lives (an element-level `motion` beside `a11y`, or inside `props`), and its effect on the SDK budget.
- Waits on epic 7 because: the studio it rebuilds (7.1 to 7.17) must be merged first, including its accessibility review (7.15) and sweep (7.16).
- Waits on epic 4 because: story 4.3 (quiz) is being merged now. Stories 4.4 to 4.7 add descriptors and inspector fields in the files that stories 3 and 6 rewrite. Whichever merges second carries the other's change. A descriptor added in today's shape still works, under More with its fields in Content, so no story waits for the other to finish.
