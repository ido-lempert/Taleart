---
name: Tale Studio 2
description: The low-code tale editor of the TaleArt dashboard. It inherits the dashboard's design tokens (apps/dashboard/src/styles.css) and specifies only the editor's delta.
status: final
updated: 2026-10-24
companions:
  - EXPERIENCE.md
colors:
  # Inherited from the dashboard, restated for reference. Values live in styles.css; that file wins.
  ember: '#F2542D'
  ember-strong: '#C73E1D'
  ember-tint: '#FEECE7'
  ink: '#111827'
  text-secondary: '#4B5563'
  text-muted: '#6B7280'
  surface: '#FFFFFF'
  surface-sunken: '#F3F4F6'
  canvas: '#F6F6F9'
  border: '#E5E7EB'
  border-strong: '#D1D5DB'
  danger: '#D92D20'
  focus: '#F2542D'
  # Editor delta.
  workspace: '#E9EAF0'          # the area around the 9:16 stage
  selection: '#2563EB'          # selection outline and handles; never ember, so it never reads as an error or the brand
  selection-tint: '#DBEAFE'
  guide: '#DB2777'              # smart guides and distance labels
  safe-area: '#2563EB'          # safe-area overlay outline at 40% while idle, 100% while dragging
  drop-target: '#0D9488'        # drop zones (canvas, Background, tale strip slot)
  drop-target-tint: '#CCFBF1'
typography:
  # Inter Variable from the dashboard; the editor adds only a dense panel ramp.
  panel-heading:
    fontFamily: 'Inter Variable'
    fontSize: 13px
    fontWeight: '600'
    lineHeight: '1.3'
  panel-label:
    fontFamily: 'Inter Variable'
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.3'
  panel-value:
    fontFamily: 'Inter Variable'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.4'
  numeric:
    fontFamily: 'Inter Variable'
    fontSize: 12px
    fontWeight: '500'
    letterSpacing: 0.01em
rounded:
  control: 8px      # dashboard --radius-control
  card: 12px        # dashboard --radius-card
  tile: 10px        # palette tiles and strip thumbnails
  pill: 9999px
spacing:
  # Dashboard 4px scale (--space-1 .. --space-12) inherited. Editor sizes:
  topbar-height: 56px
  left-rail: 56px           # icon tabs of the left panel
  left-panel: 280px         # tab content beside the rail
  inspector: 320px
  strip-height: 112px       # tale strip, thumbnails 54x96
  control-height: 32px      # dense inspector controls; targets stay at least 24px
  section-gap: 16px
components:
  palette-tile:
    background: '{colors.surface}'
    border: '{colors.border}'
    radius: '{rounded.tile}'
    size: 76px square, icon 24px, label below in {typography.panel-label}
    hover: '{colors.surface-sunken}'
    focus: 2px ring '{colors.focus}'
  palette-tile-dragging:
    opacity: 0.4 on the source tile; the ghost is the element at its real canvas size
  canvas-stage:
    background: the tale's background
    frame: 1px '{colors.border-strong}', shadow --shadow-raised
  selection-box:
    outline: 1.5px '{colors.selection}'
    handles: 8px squares, white fill, '{colors.selection}' border; hit area 24px
  smart-guide:
    line: 1px '{colors.guide}'
    label: '{typography.numeric}' white on '{colors.guide}', '{rounded.pill}'
  safe-area-overlay:
    outline: 1px dashed '{colors.safe-area}'
    shade: outside area at 8% ink
  inspector-section:
    header: '{typography.panel-heading}', 40px tall, chevron at end
    divider: 1px '{colors.border}'
  swatch:
    size: 24px circle, 1px '{colors.border-strong}' ring
    selected: 2px '{colors.ink}' ring outside a 2px white gap
  segmented:
    track: '{colors.surface-sunken}', '{rounded.control}'
    selected: '{colors.surface}' with --shadow-card, text '{colors.ink}'
  slider:
    track: 4px '{colors.border-strong}', filled part '{colors.ink}'
    thumb: 16px circle, hit area 24px
  strip-thumb:
    size: 54x96 (9:16), '{rounded.tile}'
    current: 2px '{colors.selection}' ring
    hidden: 50% opacity and an eye-off badge
    changed: 8px '{colors.ember}' dot, top end
  button-update:
    background: '{colors.ember-strong}'
    foreground: '#FFFFFF'
    radius: '{rounded.control}'
---

## Brand & Style

Tale Studio 2 is a working tool, so it looks quiet. The tale is the loudest thing on screen, and the editor chrome is neutral grey and white around it. It follows the posture of design tools like Figma and Canva: thin panels, dense controls, generous canvas. It keeps the TaleArt dashboard's identity, with the same Inter type, ember brand colour, 4px spacing scale and radii. The editor does not restyle the dashboard; it adds the few tokens an editor needs for selection, guides, safe areas and drop targets.

Spines win on conflict with the mock. The composition reference is `mockups/tale-studio-2.html`. Today's studio is in `current-studio/`, as a before picture.

## Colors

- **Ember** stays the brand and primary-action colour. In the studio it is used only for **Update tale**, the focus ring and the "changes not updated" dot. It is never used for selection.
- **Selection blue (`{colors.selection}`)** marks what is selected: outlines, handles, the current tale in the strip and the selected layer row. It is a separate colour so that a selected element never looks like an error or a brand accent.
- **Guide pink (`{colors.guide}`)** is only for smart guides and distance labels, which show while something moves. A contrasting hue keeps them readable on top of tale photos.
- **Safe-area blue** is dashed and faint while idle and full strength during a drag.
- **Drop teal (`{colors.drop-target}`)** marks where a drop will land: the canvas, the Background target and a slot in the tale strip.
- **Workspace grey (`{colors.workspace}`)** surrounds the stage, so white tales keep their edge.

All chrome text meets 4.5:1 on its surface. Guide labels are white on `{colors.guide}`, at 4.6:1. Selection and focus indicators meet 3:1 against both the workspace and white.

## Typography

The dashboard's Inter ramp is inherited. The panels use a dense ramp: `{typography.panel-heading}` for section headers, `{typography.panel-label}` for field labels, and `{typography.panel-value}` for inputs. Numeric fields use `{typography.numeric}` with tabular figures. The font picker shows each font name in its own face, which is the only place the chrome uses a font other than Inter.

## Layout & Spacing

Five regions: top bar (`{spacing.topbar-height}`), left panel (rail `{spacing.left-rail}` plus content `{spacing.left-panel}`), centre canvas, right inspector (`{spacing.inspector}`) and bottom tale strip (`{spacing.strip-height}`). The studio fills the viewport under the dashboard top bar. The page itself never scrolls; each panel scrolls on its own. The canvas centres the 9:16 stage, at Fit zoom by default, with 32px of workspace on every side. Breakpoints are set in EXPERIENCE.md, Responsive & Platform.

## Elevation & Depth

Panels are flat, separated by 1px `{colors.border}` lines. Only three things float, with `--shadow-raised`: the stage, the drag ghost and open popovers (the font picker, the colour picker and menus). Phone sheets use the same shadow.

## Shapes

Controls use `{rounded.control}`. Palette tiles and strip thumbnails use `{rounded.tile}`. Swatches and the slider thumb are circles. Selection handles are square, so they never get confused with circular swatches or the slider thumb.

## Components

- **Palette tile.** An icon above a label, in a 3-column grid per category. Text presets show their sample text in the preset style instead of an icon. Interactive tiles show a small picture of the component. On hover, a tile gets a sunken fill and a "drag or click" hint in its tooltip.
- **Drag ghost.** The element at the size it will have on the canvas at the current zoom, at 80% opacity, with a teal outline when over a valid drop target.
- **Selection box.** A blue outline with eight resize handles and a rotation handle above. Each handle's hit area is 24px. A locked element shows a lock badge and no handles.
- **Smart guides.** Pink 1px lines for centre, edge and equal-spacing matches, with distance pills.
- **Inspector section.** A header button with a title and chevron. Its body holds controls in a two-column grid. Number fields come in pairs (X and Y, W and H).
- **Swatch row.** The project theme colours first, then colours used in this tale, then recent colours, then a "+" that opens the custom picker with a hex field. A text colour swatch shows a small contrast badge (AA, AA large, or a warning) against the colour behind it.
- **Segmented control.** Two to five options in one track, with icons for alignment and direction and words elsewhere.
- **Slider.** A track with a number field beside it, which shows the exact value and its unit.
- **Font picker.** Shows the current font in its face. Its list has groups for Project fonts, Theme font and System. Each option is drawn in its own face. "Upload font…" is the last item.
- **Tale strip thumbnail.** A 9:16 miniature of the draft, with its position number below. It shows the current-tale ring, a hidden badge and a changed dot.
- **Update tale.** The only primary button in the top bar, with the status line beside it.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Keep the tale the most colourful thing on screen | Tint panels or use brand colour for chrome |
| Use selection blue for anything selected | Use ember for selection or hover |
| Show every value as a control and an exact number | Hide a value behind a slider with no number |
| Draw interactive components as visitors see them | Show grey placeholder boxes on the canvas |
| Keep targets at least 24px, even dense ones | Shrink handles or swatches below 24px of hit area |
| Paraphrase competitors and draw our own icons | Copy Storyly text, icons or layouts pixel for pixel |
