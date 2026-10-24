---
title: 'Drag an element onto the canvas, or add it with a click or a key'
type: 'feature'
ticket: '4'
created: '2026-10-24'
status: built
baseline_revision: '0a1ab20'
route: 'full'
route_source: 'auto'
risk: 'high'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio-2/epic-tale-studio-2.md'
  - '{project-root}/_bmad-output/initiative-taleart/ux-tale-studio-2/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-taleart/ux-tale-studio-2/DESIGN.md'
  - '{project-root}/_bmad-output/initiative-taleart/ux-tale-studio-2/mockups/tale-studio-2.html'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio-2/tickets/story-find-any-element-in-a-grouped-searchable-palette-plan.md'
warnings: []
deferred:
  - 'Equal-spacing guides with distance pills (the pink pill in the mock): story 11.8. The drag uses today''s centre, safe-area and element-edge guides.'
  - 'Drag from the Templates and Media tabs, and the Background drop target: stories 10 and 11 reuse this drag.'
  - 'Zoom: story 11.7 maps the pointer through the zoom; today the stage is always at Fit.'
  - 'A keyboard move-to-place mode (arrows move the ghost, Enter drops): EXPERIENCE does not specify one. Enter on a tile adds at the next free spot and the arrow keys then move the element, which is the specified keyboard path.'
---

<intent-contract>

## Intent

**Problem:** the owner's core request is to drag components from the left panel onto the canvas, as in
low-code apps. Story 11.3 gave the grouped, searchable palette, but its tiles only add on a click, each
type at its own fixed box (a text across the middle, a button above the bottom safe area, a poll
wherever its descriptor says), so several adds stack on one spot, and focus goes to a different place
for each type (a text field, the alt text, the web address, the first configured field).

**Approach:** a pointer drag from a palette tile (mouse, pen, or touch after a short hold) shows a
ghost of the element at its real canvas size that follows the pointer. Over the stage the ghost
centres on the pointer, snaps to today's guides (centre, safe-area edges, other elements' edges and
centres; Alt places it freely), is clamped into the safe area (into the stage when it is larger than
the safe area), and the safe area shows at full strength with the stage outlined as a drop target.
Dropping on the stage adds the element there; dropping elsewhere, Escape or a cancelled pointer adds
nothing and says "Not added". A blocked tile does not start a drag: it shows the not-allowed cursor
and its reason by the pointer, and says it. Click, Enter or Space adds at the next free spot: the
centre of the safe area, moved 4% down and right past each spot an element already holds. Both paths
add through one function (`addFromTile(tile, at?)`), one undo step, select the new element, focus it
on the canvas (a text opens its in-place editor there) and say "<Name> added at <x>%, <y>%. Selected."
followed by what it still needs. A media or emoji tile opens its picker and the element lands where it
was dropped. The placement maths is a pure module (`tale-placement.ts`), unit tested.

## Boundaries & Constraints

**Always:**
- WCAG 2.5.7: dragging is never the only way: click, Enter or Space adds; the arrow keys and the
  position fields move. Tiles stay buttons; a blocked tile stays focusable and `aria-disabled`.
- One add is one history step, from either path; a cancelled drag records nothing and saves nothing.
- The 60-element cap, the per-type limits (one video, one swipe-up link, one poll, rating, quiz) and
  the project-media rule apply to drags exactly as to clicks.
- The swipe-up link stays pinned to the bottom safe area wherever it is dropped.
- The ghost and the safe-area overlay follow DESIGN.md: the element at its size on the canvas, 80%
  opacity, a teal (`drop-target`) outline over the stage, the source tile at 40% while dragging, guide
  pink for snap lines; the safe area always shows while dragging, even with the overlay toggled off.
- The one polite live region says the add or "Not added"; nothing is said while the pointer moves.
- Styles stay under the 4 kB per-file budget (a new `tale-studio-drag.css`); the dashboard's initial
  bundle stays under 500 kB.

**Never:** no change to the tale document, the contract, the API or the SDK; no change to the API or
server libraries (a parallel builder); no zoom, no equal-spacing guides, no Templates or Media tab
content; no change to moving elements already on the canvas.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Drag | Poll tile dragged to the lower third near the centre line | ghost under the pointer, centre snap line shows; on release the poll is added centred there (x centred), selected, focused, "Poll added at 15%, 60%. Selected." | none |
| Drag edge | released half outside the stage's bottom | the element lands inside the safe area | none |
| Alt | Alt held while dragging | no snapping; clamped into the stage | none |
| Outside | released on the workspace beside the stage | nothing added, "Not added" | none |
| Escape | Escape while dragging | ghost goes, nothing added, "Not added"; the release adds nothing | none |
| Blocked | dragging the Poll tile with a poll in the tale | no ghost; not-allowed cursor and the reason by the pointer; reason said once | none |
| Click | click, Enter or Space on a tile, empty tale | added centred in the safe area | none |
| Next free | the same tile again | added 4% down and right of the first; a third 8% | the cascade, clamped at the safe area's corner, goes up and left from the centre instead |
| Media | Image tile dropped | the media picker opens; the picked image lands at the drop point | picker closed: nothing added |
| Touch | finger held 250 ms on a tile, then moved | drag as with a mouse; a quick swipe scrolls the panel | the hold ends on a move over 8 px |
| Undo | after any add | one undo removes it | none |

</intent-contract>

## Code Map

- `apps/dashboard/src/app/pages/tale-placement.ts` (new) -- `tileBox`, `safeClamp`, `nextFreeSpot`, `dropBox`; pure, unit tested.
- `apps/dashboard/src/app/pages/tale-studio.ts` -- the palette drag (pointer handlers, touch hold, Escape, ghost signal), `addFromTile(tile, at?)` passing the box to every add, focus on the canvas, the "added at" announcement; the pickers remember the drop box.
- `apps/dashboard/src/app/pages/tale-studio.html` -- tile pointer handlers, the ghost layer, the blocked-drag tip, the stage as a drop target, the empty-canvas hint.
- `apps/dashboard/src/app/pages/tale-studio-drag.css` (new) -- ghost, drop target, dragging tile, tip.
- `apps/dashboard/src/app/pages/tale-placement.spec.ts` (new), `tale-studio.spec.ts`, `tale-*.spec.ts` -- placement maths, drag and click adds, focus and messages.
- `apps/dashboard-e2e/src/studio-drag.spec.ts` (new) -- the verify line with a real mouse drag; `studio-keyboard`, `studio-layout`, `poll`, `rating`, `quiz` follow the new focus and messages.

## Tasks & Acceptance

**Execution:**
- [x] `tale-placement.ts` + spec -- sizes per tile, safe-area clamp, next free spot cascade, drop box with snapping.
- [x] `tale-studio.*` + `tale-studio-drag.css` -- drag, ghost, cancel, blocked drag, add at a spot, focus, announcement.
- [x] Unit specs updated; new specs for drag (mouse and touch), cancel (outside, Escape), blocked, next free spot, undo.
- [x] e2e: `studio-drag.spec.ts` (real mouse drag of Poll to the lower third, drop outside, Escape, keyboard Rating, one undo per add); other studio specs follow the new focus.

**Acceptance Criteria:**
- Given the palette, when Poll is dragged to the lower third, then it lands under the pointer snapped to the centre guide, selected, focused and announced.
- Given a drag, when the tile is dropped on the workspace outside the stage, then nothing is added and "Not added" is said.
- Given the keyboard only, when Tab reaches Rating and Enter is pressed, then a rating is added at the next free spot, selected and focused on the canvas.
- Given any add, when undo is pressed once, then the element is gone.

## Implementation Notes

- Focus after an add is the element on the canvas for every type (Flow 2: "Focus is on the rating on
  the canvas"); a text opens its in-place editor, which is on the canvas at the element's place, so a
  typed heading still goes straight in. What an element still needs (alt text, a web address) is said
  after "Selected." and is one F6 away in the inspector.
- The drop is clamped into the safe area rather than only the stage (the brief; Flow 1 "no Outside safe
  area warning because snapping kept it inside"); an element larger than the safe area on an axis is
  clamped into the stage on that axis. Alt places freely and is only clamped into the stage.
- "Next free spot" checks centres: a spot is taken when an element's centre lies within 2% of it on
  both axes, so an element moved away frees its spot, and a large centred image takes the centre.
- Snapping breaks a tie towards the earlier target (the canvas centre, then the safe-area edges, then
  other elements' edges), so a poll as wide as a heading above it shows the centre guide, not the
  heading's edge (`tale-layers.ts` `nearest`; moves on the canvas get the same tie-break).
- The next free spot can overlap a larger element whose centre lies elsewhere (a rating at the centre
  over a poll dropped lower down): the design's cascade is by spot, not by overlap area.
- Review fixes (2026-10-24): a drag whose release is lost ends with "Not added" (a mouse moving with
  no button, window blur, the page hidden, lost pointer capture); a drag needs a pressed primary
  button and no Mac Ctrl-click; a 4 px Euclidean start threshold; a pen drags at once (the tiles take
  no panning once a pen is seen hovering), a finger after a 250 ms hold; a second pointer is ignored;
  no palette drag under 768 px; near the window edge the stacked page scrolls; the stage rectangle is
  read once per drag (again after a scroll) and the ghost follows once a frame; the release's click is
  ignored on that tile for 400 ms or until the next press; the announcement says "near the centre of
  the safe area" or "at left 10%, top 56% of the tale", then "Press F6 for its properties" (a text:
  "Editing its text"); the "drag or press Enter" hint is one visible note, the groups' description;
  `focusSoon` retries until the element is drawn; tiles are `position: relative` so their hidden
  "Add" words never grow the page.
- The ghost is drawn in a fixed layer over the stage's rectangle with its own size container, so it
  uses the canvas's `cqh` sizes and can follow the pointer outside the stage.
