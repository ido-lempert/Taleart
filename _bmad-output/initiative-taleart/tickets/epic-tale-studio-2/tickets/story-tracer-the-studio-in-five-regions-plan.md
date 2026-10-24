---
title: 'Tracer: the studio in five regions'
type: 'feature'
ticket: '1'
created: '2026-10-24'
status: built
baseline_revision: '3a7e03f'
route: 'full'
route_source: 'auto'
risk: 'high'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio-2/epic-tale-studio-2.md'
  - '{project-root}/_bmad-output/initiative-taleart/ux-tale-studio-2/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-taleart/ux-tale-studio-2/DESIGN.md'
  - '{project-root}/_bmad-output/initiative-taleart/ux-tale-studio-2/mockups/tale-studio-2.html'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** today's studio puts the canvas, 13 unlabelled add buttons, the layers list and the
inspector in one narrow, page-scrolling column (`ux-tale-studio-2/current-studio/`). The owner wants
a low-code editor: elements on the left, the canvas in the centre, properties on the right. Before
the palette, drag and drop and the sectioned inspector are rebuilt (stories 3 to 16), the owner
reviews the new layout (story 2) on a tracer that moves today's controls into the new shell.

**Approach:** restructure `tale-studio.html` into five regions per epic R1 and the mock, with
today's controls and behaviour: a top bar (back, tale name, undo, redo, safe-area toggle, save
state and status line, Preview, Update tale, a tale menu with Discard changes, Duplicate and
Keyboard shortcuts); a left panel with a vertical tab rail (Elements: today's Add entries as tiles
grouped by their current row; Templates and Media: placeholders that say what is coming; Layers:
today's layers grid, unchanged); the canvas fitted on a grey workspace; the inspector on the right
(today's Selected and Canvas fieldsets as headed sections; the Preview pane in its place while
open); and a tale strip of the group's tales. The studio fills the viewport under the dashboard bar;
each region scrolls on its own; F6 and Shift+F6 cycle the regions. The component logic stays; the
shell adds tab, menu and region state only.

## Boundaries & Constraints

**Always:**
- Every existing behaviour keeps working: autosave and its failure and conflict flows, undo and
  redo, Update tale and Discard changes (with their disabled reasons), Duplicate, the preview, the
  layers grid's keyboard model, locks, the layer menu, shortcuts, contrast warnings, the
  poll/rating/quiz inspectors and the responses panel. Element ids (`studio-add-*`, `studio-el-*`,
  `layer-*`, `studio-x` ...) stay.
- WCAG 2.2 AA: regions are landmarks with headings (`aside` "Add and layers", a canvas region,
  `aside` "Properties", `nav` "Tales in <group>"; the top bar is a labelled region with the tale
  name as its h2); the tab rail is a WAI-ARIA tablist (arrows, Home, End, automatic activation);
  the tale menu follows the menu-button pattern; focus order follows the visual order; F6 lands on
  a useful control in each region and shows a focus ring; targets stay at least 24 px; the panels
  reflow at 320 px.
- Selection, guides and the editor chrome follow DESIGN.md: selection blue, guide pink, workspace
  grey, ember only for Update tale, focus and the changed dot.
- The one polite live region and the save alert region stay single.

**Never:** no new behaviour from later stories: no search, palette metadata, drag from the palette,
zoom, sections as disclosures, low-code controls, strip add/reorder/menu, templates or media
content, tablet drawers or phone sheets. No change to the tale document, the API or the SDK. No
change to the targeting or access modules, Audience or Settings pages (parallel builders).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Desktop | 1440×900, a text selected | top bar, tiles, canvas, inspector and strip all on screen; the page does not scroll | none |
| F6 | focus anywhere in the studio | next region: top bar (back link), left panel (selected tab), canvas (selected element, else the canvas), inspector, strip (current tale); Shift+F6 back; wraps | a drawer, picker or menu open: F6 does nothing |
| Tabs | Arrow keys on the rail | moves and selects Elements, Templates, Media, Layers; one tab stop | none |
| Tale menu | Discard with nothing to discard | item stays reachable, aria-disabled, says why | none |
| Preview | Preview pressed | the inspector column shows the preview; Close or Preview again returns focus to Preview | none |
| Strip | another tale's thumbnail | opens its studio after autosave (route guard as today) | a failed save asks, as today |
| Narrow | under 1024 px wide, or 320 px | regions stack in focus order and the page scrolls; nothing scrolls sideways | none |

</intent-contract>

## Code Map

- `apps/dashboard/src/app/pages/tale-studio.html` -- the page template, restructured into the shell.
- `apps/dashboard/src/app/pages/tale-studio.ts` -- tab, menu, help and F6 state; strip data; region focus.
- `apps/dashboard/src/app/pages/tale-studio-regions.ts` (new) -- pure region and tab helpers, unit tested.
- `apps/dashboard/src/app/pages/tale-studio-shell.css`, `tale-studio-panels.css` (new) -- shell grid, top bar, panels, tiles, strip (each under the 4 kB budget).
- `apps/dashboard/src/app/pages/tale-studio.css`, `tale-studio-canvas.css` -- canvas fit on the workspace, selection blue, guide pink.
- `apps/dashboard/src/app/pages/tale-element-types.ts` -- names for the Add rows (`addMenuGroups`), one icon per shape kind.
- `apps/dashboard/src/app/icon.ts` -- rectangle, ellipse, line, layers, templates and safe-area icons.
- `apps/dashboard/src/styles.css` -- the dense inspector control size (child inspectors are other components).
- `apps/dashboard/src/app/pages/tale-studio.spec.ts`, `tale-element-types.spec.ts` -- updated selectors, new shell tests.
- `apps/dashboard-e2e/src/studio-keyboard.spec.ts`, `studio-a11y.spec.ts` -- tabs, tale menu, F6; intent kept.
- `apps/dashboard-e2e/src/studio-layout.spec.ts` (new) -- the story's verify line at 1440×900.

## Tasks & Acceptance

**Execution:**
- [x] `tale-studio-regions.ts` -- `nextRegionIndex`, `LEFT_TABS`, `tabKeyTarget` -- pure, testable keyboard logic.
- [x] `tale-element-types.ts` -- `addMenuGroups` with row names, shape icons -- tiles grouped by today's rows.
- [x] `tale-studio.html` / `.ts` / CSS -- the five-region shell, tablist, tale menu, help dialog, inspector sections, preview in the inspector, strip, F6.
- [x] `tale-studio.spec.ts` -- update selectors where the layout changed; add tests for tabs, F6, menu, strip.
- [x] e2e: `studio-keyboard`, `studio-a11y` updated (Layers tab, tale menu); `studio-layout.spec.ts` added.

**Acceptance Criteria:**
- Given 1440×900 and a selected text, when the studio shows, then the canvas, the palette and the inspector are visible without scrolling the page.
- Given a tale composed in the new shell (text, image, shape, poll), when it is updated, then the sample page shows it as before.
- Given focus in the studio, when F6 is pressed repeatedly, then focus reaches the top bar, left panel, canvas, inspector and strip in order, and Shift+F6 goes back.
- Given the existing studio e2e and the WCAG 2.2 AA scan, when they run, then they pass.

## Implementation Notes

- Landmarks: the app shell already has `main`, so the canvas is a labelled `section` region, not a second `main`.
- The inspector keeps the Canvas (Tale) settings under the element's sections, as today, so no flow loses a control; story 5 makes it contextual.
- Below 1024 px the shell stacks (story 16 brings the rail flyout, drawer and phone edit-lite).
