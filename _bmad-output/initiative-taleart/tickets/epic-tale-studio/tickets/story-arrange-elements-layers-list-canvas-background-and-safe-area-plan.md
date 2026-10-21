---
title: 'Arrange elements: layers list, canvas background and safe areas'
type: 'feature'
ticket: '2'
created: '2026-10-21'
status: 'built'
baseline_revision: '45e087a'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'thorough'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-tracer-add-a-text-element-to-a-tale-and-see-it-in-the-viewer-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 7.1 lets a content manager add and move text, but not arrange it: there is no layers list, no way to reorder, hide, lock or duplicate an element, no way to pick the canvas colour, and nothing shows the safe areas the viewer's controls and calls to action cover (epic R2, R3, R13).

**Approach:** The contract gains safe-area geometry helpers next to its `TALE_SAFE_AREA` constants. Tale Studio gets a layers list (top of the z-order first) with a shared actions menu (row button, context menu, Shift+F10) and keyboard shortcuts, multi-select for move, delete and reorder, a Canvas panel for the background colour and the safe-area guides, snapping while dragging, and a per-row safe-area warning. The schema already holds everything this needs (z-order is array order, `hidden`, `locked`, `canvas.background.color`), so it stays unchanged; the Web SDK paints the canvas colour behind a tale's media.

## Boundaries & Constraints

**Always:**
- Document schema unchanged (AD-15): z-order is the `elements` order, `hidden` and `locked` are the existing fields, the background is the existing `{ type: 'color', color }`. Validation stays server-side; the Delivery API already drops hidden elements and the editor-only fields.
- Safe areas come from `TALE_SAFE_AREA` (top 12%, bottom 16%, sides 4%). An element is outside when the bounds of its rotated box (on the 9:16 canvas) reach past them. The warning never blocks saving.
- Every action has a non-pointer path and a visible way in (WCAG 2.2 AA, 2.5.7): row buttons, the actions menu (also on right-click, Shift+F10 and the ContextMenu key), and shortcuts on focused canvas elements and layer rows. Targets are at least 24×24 px (2.5.8). Every change is announced in the live region.
- Locked elements cannot be moved (drag, arrows, position fields) or have their text edited; they can still be selected, reordered, hidden, duplicated and deleted. Hidden elements are not drawn on the canvas, stay in the list and are not delivered.
- Multi-select is limited to moving, deleting and reordering; hide, lock and duplicate act on one layer.
- SDK: the colour is set through CSSOM from a value that passes the colour pattern; a tale without a document is unchanged. Within `web-sdk:size` and `sdk-sample:perf`.

**Never:** Grouping, undo or autosave (story 7.3), media backgrounds or fit (7.5), new element types, a reading-order override, new npm packages, `innerHTML` or style attributes from content, changes to bar or banner rendering.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Layers list | elements A, B, C (C on top) | rows C, B, A; type icon and name from text; "Empty text" for none | — |
| Reorder by keyboard | focus row A, Alt+ArrowUp | A above B in the array and on the canvas; "Layer brought forward" | at the top: "Already at the front", no change |
| To front / back | Alt+Shift+ArrowUp / Alt+Shift+ArrowDown or menu | selection moves to the end / start, keeping its own order | — |
| Multi reorder | A and C selected, send backward | each selected block moves down one, relative order kept | — |
| Multi select | Shift or Cmd (Ctrl off a Mac)+click, or Shift+Space on a row or element; Ctrl/Cmd+A | rows `aria-selected` (grid), canvas elements `aria-pressed`; inspector shows "2 layers selected" | — |
| Multi move | 2 selected, Shift+ArrowRight / drag | both move by the same step, clamped as a group | locked ones in the selection stay; announced |
| Multi delete | 2 selected, Delete or menu | both removed; focus to the next element or row | — |
| Hide | row Hide toggle or H | element gone from the canvas, row marked hidden; save → Delivery omits it | — |
| Lock | Lock toggle or L | drag, arrows, position fields and text editing refused with "Layer is locked" | — |
| Duplicate | menu or D | copy with a new UUID just above the original, offset 2% (back the other way at an edge), selected | at 60 elements: refused, announced |
| Context menu | right-click, Shift+F10, ContextMenu key or "More actions" | menu with roving focus (arrows, Home, End); Escape or Tab closes and returns focus | — |
| Safe area | box reaching into the bottom 16% (rotation counted) | row shows "Outside safe area"; element described by it; clears when moved back | save still allowed |
| Guides | "Show safe areas" toggle | guide overlay shown/hidden, `aria-hidden`, no pointer events | — |
| Snapping | drag within 6 px of canvas centre, safe-area edge or another element's edge or centre | box lands on it; guide line shown while dragging; Alt disables | — |
| Background | colour picker or hex field `#112233` | canvas shows it; saved; Delivery returns it; sample stage paints it behind the media | hex `red;x` refused in the field (`aria-invalid`), value restored; server refuses as before |

</intent-contract>

## Code Map

- `libs/contract/src/lib/tale-document.ts` (+ spec): `elementBounds`, `safeAreaBounds`, `isOutsideSafeArea`.
- `apps/dashboard/src/app/pages/tale-layers.ts` (new, + spec): pure z-order, duplicate, group-move and snapping functions, layer names, shortcut parsing.
- `apps/dashboard/src/app/pages/tale-layer-menu.ts` (new): the actions menu component (role `menu`, roving focus).
- `apps/dashboard/src/app/pages/tale-studio.ts` (+ spec): selection set, layers list, Canvas panel, guides, snapping, lock and hide rules, shortcuts, announcements.
- `apps/dashboard/src/app/icon.ts`: text, eye, eye-off, lock, unlock and more icons.
- `libs/web-sdk/src/lib/viewer.ts`, `document/renderer.ts` (+ specs): the canvas colour behind a document tale's media; hidden elements skipped defensively.
- `apps/api/src/app.spec.ts`: delivery keeps array order and the background colour, drops hidden and `locked`.
- `apps/sdk-sample/a11y-scan.mjs`: the text tale gets a non-black background, checked on the stage.

## Tasks & Acceptance

**Execution:**
- [x] contract: safe-area helpers with tests.
- [x] dashboard: `tale-layers.ts` with tests for reorder, duplicate, group move, snapping and shortcuts.
- [x] dashboard: menu component, icons, studio wiring, with component tests for every matrix row.
- [x] web-sdk: background behind media, hidden skip, with tests.
- [x] api: delivery test for order, colour, hidden and locked.
- [x] sdk-sample: background check in the scan.

**Acceptance Criteria:**
- Given three text elements, when a person reorders two overlapping ones from the layers list with the keyboard only and saves, then the canvas and the delivered document follow the new order.
- Given a hidden element and a locked element, when saved, then the Delivery API omits the hidden one, and dragging the locked one on the canvas does not move it.
- Given an element dragged into the bottom safe area, then its row shows the warning, which clears when it moves back.
- Given a background colour set in the studio and saved, then the sample page's viewer shows it behind the tale.
- Given the SDK build, `web-sdk:size` stays at or under 50 KB gzipped and `sdk-sample:perf` p75 cold first content at or under 1.5 s.

## Implementation Notes

- Assumptions. None is a product decision the epic settles; each is recorded for review.
  - No schema change was needed: z-order is array order, `hidden` and `locked` exist since story 1, and the background is the existing `{ type: 'color', color }`. `contract:generate` has nothing new to generate.
  - Lock blocks moving (drag, arrow keys, Left and Top fields) and text editing, on the canvas and in the inspector (read-only fields). A locked layer can still be selected, reordered, hidden, duplicated and deleted, from the list, the menu or the Delete key, as in common design tools. In a multi-selection, locked layers stay put while the others move, and the announcement says so.
  - Hidden layers are not drawn on the studio canvas and stay in the list (name struck through, "Hidden"). The SDK also skips a `hidden: true` element defensively, for the R10 preview of unsaved documents; delivered documents never hold one.
  - The safe-area warning uses the upright bounds of the rotated box on the 9:16 canvas, with 0.001 tolerance, so a box placed exactly on an edge is inside. It is a warning in the row (visible text "Outside safe area", referenced by the row and the canvas element through `aria-describedby`), never a save block.
  - Safe-area guides default to shown and are an editor preference, not saved in the document.
  - Snapping applies to dragging only (arrow keys and fields stay exact), within 6 screen pixels, to the canvas centre, the safe-area edges, and the left/centre/right and top/middle/bottom of every other shown layer (unrotated boxes). A multi-selection snaps by its bounding box. Holding Alt places freely. A guide line shows while snapped.
  - Shortcuts (after review; only while focus is on a canvas element or in the layers list, never in a text field, so WCAG 2.1.4 is met): Alt+Up/Down forward/backward, Alt+Shift+Up/Down to front/back; H hide, L lock, D duplicate (letters by `event.code`, so any layout works); Ctrl/Cmd+A select all; Delete deletes, and Backspace too on a Mac. The context menu opens on the `contextmenu` event (right-click, Mac Ctrl+click, Shift+F10, the context-menu key). Labels show ⌥ ⇧ ⌘ ⌫ on a Mac. Multi-select: Shift or Cmd+click (Ctrl+click off a Mac), or Shift/Ctrl+Space. Hide, lock and duplicate from a shortcut act on the focused layer.
  - The layers list is a WAI-ARIA grid (`aria-multiselectable`, rows `aria-selected`): one tab stop with roving tabindex; up and down move between layers in the same column, left and right between the name, Hide, Lock and More actions, Home and End within a row, Ctrl+Home and Ctrl+End to the top and bottom layers.
  - Hide, lock and duplicate act on one layer (epic: multi-select is limited to move, delete and reorder); the menu for a multi-selection offers only reorder and delete.
  - A duplicate gets a new UUID, sits just above its original, offset 2% down and right (clamped to the canvas), and is selected. At 60 layers it is refused and announced.
  - The background colour is set with a native colour input or a hex field (`#RRGGBB` or `#RRGGBBAA`, `#` optional; anything else is restored and announced). In the SDK, a document tale with media gets its colour on the stage behind the media (seen in the bands a contained image leaves, and fully for tales without media as before); tales without a document keep the black stage. A media background with fit is story 7.5.
- Design.
  - `apps/dashboard/src/app/pages/tale-layers.ts` holds the pure logic (reorder, duplicate, group clamp, snapping, shortcut parsing), `tale-layer-menu.ts` the WAI-ARIA menu (roving focus, Escape/Tab close and return focus, a press outside closes without stealing focus). Layer list and menu styles live in `styles.css` to keep the studio component under its style budget.
  - Focus is put back on the invoking control after a reorder, because moving DOM nodes drops focus. Delete moves focus to the next layer where the command came from (canvas: the next shown element above, else below, else the canvas; list: the next row down, else up, else Add text).
- Dashboard initial bundle: 669 KB before review; after review the studio route is lazy-loaded (`loadComponent`) and the initial bundle is 637.5 KB (the studio is a 38 KB lazy chunk). The 500 KB warning budget was already exceeded at baseline.
- Not verified by hand: a browser walk with a screen reader. Component tests cover every matrix row.

## Plan Change Log

## Review Triage Log

### 2026-10-21 — Coordinator review
- **Verdicts:** 16 findings, all patched. `autopilot/foundation` was merged first (already up to date).
- **Findings:**
  1. `[patch]` Layer row layout could hide the name. The state ("Hidden", "Locked", "Outside safe area") is now a second line inside the name cell, which takes the free width and ellipsises; text selection on Shift+click is off. Checked in Chromium at 1280 and 390 px wide: every target is at least 32 px, every name visible (screenshots in the report).
  2. `[patch]` A refused hex value was silently restored. The entry now stays, with `aria-invalid="true"` and `aria-describedby` pointing at a visible message; the canvas keeps its colour. Tested.
  3. `[patch]` Shortcuts clashed with the browser (Ctrl+D bookmark, Ctrl+[ ] navigation in some browsers). Reorder is now Alt+Up/Down (forward, backward) and Alt+Shift+Up/Down (front, back); hide, lock and duplicate are H, L and D; Ctrl/Cmd+A selects all (prevented only in the studio). Tested.
  4. `[patch]` Letter shortcuts depended on the layout. They match `event.code` (KeyH, KeyL, KeyD, KeyA) with an `event.key` fallback; tested with Hebrew characters.
  5. `[patch]` Delete only, and `aria-keyshortcuts` named unreachable keys. Backspace deletes on a Mac too (only on a canvas element or in the list). `aria-keyshortcuts` uses ARIA key values and sits only where the keys work (canvas elements, name cells, Hide `H`, Lock `L`), not on menu items; visible labels use ⌥ ⇧ ⌘ ⌫ on a Mac. Tested.
  6. `[patch]` With several layers selected, hide, lock and duplicate shortcuts had no clear target. They act on the focused layer. Tested through the shortcuts.
  7. `[patch]` The menu opened from keydown (Shift+F10), so the native menu could still appear. It now opens on the `contextmenu` event (mouse, Mac Ctrl+click, Shift+F10, the context-menu key), placed at the pointer or below the control, and `contextmenu` is prevented there and on the menu items. Tested.
  8. `[patch]` "More actions" did not toggle. A press on its own anchor is ignored by the outside-press handler, and the button closes an open menu. Tested.
  9. `[patch]` Mac Ctrl+click toggled the selection. It is the context menu there; Cmd+click and Shift+click add to the selection, and the hint says so per platform.
  10. `[patch]` Snapping used the unrotated box. It uses `elementBounds` for the moving selection and the targets, so the snapped edge is the visible one and the guide is drawn there, matching the safe-area warning. Tested with a quarter-turned layer snapping to the top safe edge.
  11. `[patch]` Arrow moves included hidden layers. Hidden layers neither move nor hold the group back, as when dragging. Tested.
  12. `[patch]` Pressing a locked member of a selection stopped the whole drag. The unlocked others move, the locked one stays, and the announcement says so. Tested.
  13. `[patch]` A duplicate at an edge sat on its original. It is offset the other way when there is no room. Tested.
  14. `[patch]` Canvas outlines could fall under 3:1. Element outlines are white dashed with a dark outline, the selection is ember with a white inner and black outer ring, and snap lines are ember with white and black rings.
  15. `[patch]` The layers list had a tab stop per button. It is a WAI-ARIA grid with one tab stop and roving tabindex (see Implementation Notes); selection is `aria-selected` on rows. Tested.
  16. `[patch]` The studio was in the initial bundle. The route uses `loadComponent`; the initial bundle went from 669 KB to 637.5 KB.

## Auto Run Result

**Summary:**
- **Contract:** `safeAreaBounds`, `elementBounds` (rotation on the 9:16 canvas) and `isOutsideSafeArea`, next to `TALE_SAFE_AREA`. No schema change.
- **Dashboard (Tale Studio):** a layers list (top first, type icon, name from text) with per-row select, hide, lock and "More actions"; an actions menu (row button, right-click, Shift+F10, ContextMenu key) with bring forward, send backward, to front, to back, hide, lock, duplicate and delete; keyboard shortcuts; multi-select for move, reorder and delete; locked layers that cannot be moved or edited; hidden layers off the canvas; a per-row "Outside safe area" warning; toggleable safe-area guides; snapping while dragging with a guide line (Alt to place freely); a Canvas panel with background colour picker and hex field; every change announced in the live region.
- **Web SDK:** a document tale's canvas colour fills the stage behind its media; hidden elements are skipped defensively.
- **API test:** delivery keeps the saved order and colour, drops hidden layers and `locked`; a non-hex colour is refused with its pointer.
- **Sample scan:** the text tale has a non-black canvas colour, checked on the stage.

**Files changed:** `libs/contract/src/lib/tale-document.ts` (+ spec); `apps/dashboard/src/app/pages/tale-studio.ts` (+ spec), `tale-layers.ts` (+ spec, new), `tale-layer-menu.ts` (new), `icon.ts`, `styles.css`; `libs/web-sdk/src/lib/viewer.ts`, `document/renderer.ts` (+ specs); `apps/api/src/app.spec.ts`; `apps/sdk-sample/a11y-scan.mjs`.

**Verification:**
- `run-many -t lint test build` on the 12 projects: all pass (dashboard lint re-run after one fix). Test counts: api 376, web-sdk 264, dashboard 246, contract 109, server-tales 96.
- After the review fixes: `run-many -t lint test build` on the 12 projects passes; dashboard 251 tests. `web-sdk:size` 13.88 KB gzipped; `sdk-sample:a11y` 0 violations in 14 scans; `sdk-sample:perf` cold p75 1,256 ms, warm p75 754 ms. Dashboard initial bundle 637.5 KB with the studio as a 38 KB lazy chunk. A Playwright walk of the production build with a mocked API screenshots the layers panel at 1280 and 390 px; smallest target 32 px.
- `web-sdk:size`: 13.88 KB gzipped (was 13.85 KB).
- `sdk-sample:a11y`: 0 violations; the background check passes.
- `sdk-sample:perf`: cold p75 first content 1,247 ms, warm p75 753 ms.

**Residual risks:**
- The studio canvas is still Angular, not the SDK renderer (R10), so the background shows over the whole 9:16 canvas in the studio but over the stage (frame) in the viewer; both are behind contained media.
- Single-key shortcuts (H, L, D) apply only inside the canvas and the layers list; a screen reader in browse mode may take those keys first, and every action also has a button or menu path.
- No undo yet (story 7.3): delete and reorder are immediate.

## Verification

**Commands:**
- `NX_DAEMON=false npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool --skip-nx-cache` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size` -- expected: 50 KB or less gzipped.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:a11y` -- expected: 0 violations; background check passes.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:perf` -- expected: p75 cold first content 1.5 s or less.
