---
title: 'Find any element in a grouped, searchable palette'
type: 'feature'
ticket: '3'
created: '2026-10-24'
status: built
baseline_revision: '7e606ff'
route: 'full'
route_source: 'auto'
risk: 'medium'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio-2/epic-tale-studio-2.md'
  - '{project-root}/_bmad-output/initiative-taleart/ux-tale-studio-2/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-taleart/ux-tale-studio-2/DESIGN.md'
  - '{project-root}/_bmad-output/initiative-taleart/ux-tale-studio-2/mockups/tale-studio-2.html'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio-2/tickets/story-tracer-the-studio-in-five-regions-plan.md'
warnings: []
deferred:
  - 'Drag from a tile onto the canvas, and "next free spot" placement: story 11.4.'
  - 'Interactive tiles drawn as a small picture of the component (DESIGN Palette tile): they keep their icon until the canvas draws components with the SDK renderer (story 11.15).'
---

<intent-contract>

## Intent

**Problem:** story 11.1 moved today's Add menu into the Elements tab as tiles grouped by the old
Add-menu rows ("Text and media", "Shapes and stickers" ...). There is no search, one generic "Text"
tile, rows rather than categories, and tiles at the 60-element cap or without the tale's project are
plain `disabled`, so they drop out of the tab order and never say why. The epic (R2) asks for a
palette built from the registry: every registered, non-test type as tiles in the categories Text,
Media, Shapes, Stickers & emoji, Buttons & links, Interactive, More, found by searching labels and
keywords, with limits and the project rule shown on focusable tiles that say why.

**Approach:** replace each studio descriptor's `add[]` (with its `row`) by a `palette` entry:
`{ category, order, keywords, icon, action, needsProject?, limit?, presets? }`. A preset is
`{ id, label, keywords?, icon?, props?, box? }`; one type offers several tiles, as the text presets
(Heading, Subheading, Body, Caption, Label) and the shape kinds do. A pure module
(`tale-palette.ts`) turns the studio's element types into tiles (a type without a `palette` becomes
one tile under More, added through its `create`), filters them by a query and groups them in category
order. It also holds the tile-grid arrow-key logic. The Elements tab renders a search field and the
groups; the studio adds the `/` shortcut, Escape and Arrow Down from the search, arrow keys between
tiles, the count announced in the one polite live region, and focusable `aria-disabled` tiles whose
reason is their description and shows under their group.

## Boundaries & Constraints

**Always:**
- The registry stays the one list: every registered type has a tile, every tile comes from a
  registered type; a unit test checks every registry key has a tile. Test-only types are offered only
  where they are today (a development build that opts in, and tests), never in production.
- Click, Enter or Space on a tile adds the element as today (the studio's own flow per built-in type,
  `create` for a configured one). A text preset adds a text with the preset's props and box.
- Tiles are buttons in labelled groups; a blocked tile keeps focus (`aria-disabled`), describes its
  reason (`aria-describedby`), shows the reason under its group and says it when pressed. The full tale
  (60 elements), the per-type limits (one video, one swipe-up link, one poll, rating, quiz) and the
  project-media rule (image, video, sticker, image button) are all reasons.
- Search: label (`Search elements`), `/` focuses it from anywhere in the studio outside a text field
  (selecting the Elements tab first), filters by label, keywords and category name as one types,
  hides empty groups, announces "<n> elements" (debounced) in the studio's one polite live region and
  shows the count; Escape clears, a second Escape returns focus to the canvas; Arrow Down goes to the
  first result. No match says so with a Clear search button.
- Arrow keys move between tiles by position (Left, Right across groups; Up, Down by row); Home and
  End go to the first and last tile; Up from the first row returns to the search. Tab still reaches
  every tile (`tabTo` in the e2e and Tab users keep working).
- The look follows the mock and DESIGN.md: a 32 px search field with a search icon and a `/` key hint,
  13 px semibold category headings, a 3-column grid of 68 px tiles with 10 px radius; text presets
  drawn in their own size and weight; a blocked tile at reduced emphasis.
- Element ids of existing tiles stay (`studio-add-image`, `studio-add-poll` ...); limit hint ids stay.

**Never:** no drag from the palette, no change to where elements land, no Templates or Media tab
content, no inspector change, no change to the tale document, the contract, the API or the SDK, no
change to the targeting, docs or CLI areas (parallel builders).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Search | type "vote" | only Interactive shows, with Poll; "1 element" shown and announced | none |
| Search | type "text" | the five text presets show | none |
| No match | type "zzz" | "No elements match "zzz"." and a Clear search button | none |
| `/` | focus on a layer or the canvas | Elements tab selected, search focused | in a text field `/` types |
| Escape | search holds "poll" | search cleared, all tiles back, focus stays | second Escape: focus to the selected element or the canvas |
| Limit | a poll in the tale | Poll tile `aria-disabled`, focusable, described by "A tale holds one poll…" shown under Interactive; Enter says the reason | none |
| Full | 60 elements | every tile `aria-disabled` with "A tale holds up to 60 elements." | none |
| No project | tale without a project | Image, Video, Sticker, Image button disabled with the project reason | none |
| More | test build with test types on | the test badge (no palette entry) shows under More; production: absent | a type with no palette and no `create` stops the studio, as today |

</intent-contract>

## Code Map

- `apps/dashboard/src/app/pages/tale-element-types.ts` -- `PaletteEntry`, `PalettePreset`, `PaletteCategory`; every descriptor migrated from `add[]` to `palette`; `addMenuGroups` and row names removed.
- `apps/dashboard/src/app/pages/tale-palette.ts` (new) -- `paletteTiles`, `filterPalette`/`paletteGroups`, `PALETTE_CATEGORIES`, `textPresetSample`, `tileKeyTarget`; pure, unit tested.
- `apps/dashboard/src/app/pages/tale-studio.ts` -- query signal, tile blocking and reasons, add from a tile (text presets), `/`, search keys, tile arrow keys, count announcement.
- `apps/dashboard/src/app/pages/tale-studio.html` -- the Elements tab: search, count, groups, tiles, reasons; `/` in the shortcuts panel.
- `apps/dashboard/src/app/pages/tale-studio-palette.css` (new) -- search, tiles, text samples (under the 4 kB budget); tile rules move out of `tale-studio-panels.css`.
- `apps/dashboard/src/app/icon.ts` -- `search` and `puzzle` icons.
- `apps/dashboard/src/app/pages/tale-palette.spec.ts` (new), `tale-element-types.spec.ts`, `tale-studio.spec.ts`, `tale-links/poll/rating/quiz/media.spec.ts` -- updated and new tests.
- `apps/dashboard-e2e/src/studio-palette.spec.ts` (new) -- the verify line in a browser; `studio-keyboard`, `studio-layout` follow the renamed text tile.

## Tasks & Acceptance

**Execution:**
- [x] `tale-element-types.ts` -- `palette` on every descriptor; `described()` checks a type is addable.
- [x] `tale-palette.ts` + spec -- tiles, search, grouping, More fallback, arrow-key targets.
- [x] `tale-studio.*` + `tale-studio-palette.css` -- the palette UI, keys and announcements.
- [x] Unit specs updated; every registry key has a tile; test types only under More in a test build.
- [x] e2e: `studio-palette.spec.ts` (search "vote", count announced, Poll disabled with reason, `/`, Escape, arrows); a11y scan of the palette with a search and a disabled tile.

**Acceptance Criteria:**
- Given the Elements tab, when "vote" is typed, then Poll is the only tile and "1 element" is announced.
- Given a poll in the tale, when the Poll tile is focused, then it is focusable, `aria-disabled` and described by why; Enter says why.
- Given a test build with the test types on, then the test badge (registered without a palette entry) shows under More; without them (production), it shows nowhere.
- Given the registry, then every registry key has a tile (unit test).

## Implementation Notes

- Sticker sits under Stickers & emoji, not Media: EXPERIENCE lists it in both, the mock under Media; one type has one category, and the category is named for it. Media holds Image and Video.
- The Body preset is today's "Add text" exactly (same box, text "Text", DEFAULT_TEXT_STYLE, bold); only its tile draws it at regular weight (`tileProps`). Its tile id is `studio-add-text`; the old `studio-add` id is gone (the tests that used it follow).
- Limit hints show under the group of the tile they describe, in tile order, so `hintOrder` goes. The full-tale and no-project reasons are shared by several groups, so each shows once above the groups.
- The count is debounced (400 ms) so typing a word is announced once; the visible count updates at once. Adding from a tile, Arrow Down into the tiles and clearing drop a count not said yet; the count is said on its own, never taking a pending contrast note.
- Search matches the start of a word ("rect" finds Rectangle, "cta" does not match inside "rectangle").
- Text presets sit in two columns, drawn at 18, 15, 13 and 11 px (Heading, Subheading, Body, Caption), so the ladder reads at 1024 and 1440.
- Review fixes (2026-10-24): body weight kept, the no-project reason once, count timer cleared, the size ladder, no `title` on blocked tiles (the reason is visible and is the description), more synonyms.
