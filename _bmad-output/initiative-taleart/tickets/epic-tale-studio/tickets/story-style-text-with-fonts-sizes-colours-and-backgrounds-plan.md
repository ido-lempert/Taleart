---
title: 'Style text with fonts, sizes, colours and backgrounds'
type: 'feature'
ticket: '4'
created: '2026-10-21'
status: 'in-review'
baseline_revision: '901ba7e'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-undo-redo-and-autosave-without-losing-work-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-web-zones/tickets/story-set-the-project-theme-in-the-dashboard-plan.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A text element has one fixed look (`TEXT_ELEMENT_STYLE`). A content manager cannot choose its font, size, weight, italic, colour, alignment, direction, line height or background (epic R4), and the studio does not warn when text is hard to read (R12).

**Approach:** Contract first. Add optional, additive style props to `text.schema.json`, a font registry (four system stacks), and `resolveTextStyle` and `textContrast` helpers in `libs/contract`. The studio canvas and the SDK renderer both read these helpers, so they cannot drift. The server validates the props through the schema plus `isFontFamily`. The SDK applies them through CSSOM only and sets `dir`. A grouped, named, keyboard-usable inspector in Tale Studio edits them through the history, so every change can be undone and is autosaved to the draft.

## Boundaries & Constraints

**Always:**
- The schema change is additive. All new text props are optional, `additionalProperties: false` still holds, and the document version stays 1. A text without them renders as before (system sans, 4 % of the canvas height, 1.25 line height, white, centred, `dir="auto"`). New text elements store every setting explicitly, `direction: 'auto'` included.
- Props:
  - `font`: one of `{ source: 'system', stack }` (`sans`, `serif`, `rounded` or `monospace`), `{ source: 'theme' }`, or `{ source: 'name', family }`. `family` must pass `isFontFamily`: its pattern, at most 200 characters, and no CSS-wide keyword.
  - `fallback`: a system stack key.
  - `size`: a fraction of the canvas height, from 0.01 to 0.2. The presets are small 0.03, medium 0.04 and large 0.06.
  - `weight`: `regular`, `medium` or `bold`.
  - `italic`: a boolean.
  - `color`: `#RRGGBB` or `#RRGGBBAA`.
  - `align`: `start`, `center` or `end`.
  - `direction`: `auto`, `rtl` or `ltr`.
  - `lineHeight`: from 0.8 to 3.
  - `background`: `none`, `box` or `highlight`, with `backgroundColor`.
- The SDK sets styles through CSSOM properties only (AD-16), with values from the contract's registry or values it checks again. It sets the text's `dir` as an attribute, sets text with `textContent`, and loads no font file. The theme font is applied as `var(--ta-font, <fallback>), <fallback>`, so it follows the delivered theme and any SDK override.
- Alignment uses logical `start` and `end`, so it follows the direction.
- Contrast is a warning only and never blocks a save or a publish. It is checked at 4.5:1, or 3:1 for large text, against the text's own opaque box or highlight, or against the canvas colour when the tale has no media. Otherwise it says the contrast can't be checked over media.
- The inspector is grouped in fieldsets, every control is named, and it can be used with the keyboard alone. Each change is one history step, is announced, and is refused while the layer is locked.
- `web-sdk:size` and `sdk-sample:perf` budgets hold.

**Never:** project fonts or font loading (story 7.17), new npm packages, `innerHTML`, `setAttribute('style')` or CSS text built from content, shadows, outlines or gradients (post-MVP), blocking a save on contrast, a document version bump, reformatting unchanged code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Legacy text | props `{ text }` only | renders as before; inspector shows the defaults | — |
| System font | `font {source:'system',stack:'serif'}` | serif stack in the studio and the SDK | unknown stack → 400 `/elements/0/props/font/stack` |
| Theme font | `font {source:'theme'}`, theme `Georgia, serif` | studio `Georgia, serif, <fallback>`; SDK `var(--ta-font, <fb>), <fb>` | theme font unset → fallback stack |
| Named font | `family:'Inter'` | `Inter, <fallback stack>` | `inherit`, `x;color:red`, `'a' + 201 chars` → 400 at `.../font/family`; studio marks the field and keeps the old value |
| Font combo | `source:'system'` with `family` | — | 400 (no extra field) |
| Size | preset large / custom 12 % | 0.06 / 0.12 × canvas height (`cqh`) | 0, 0.005, 0.5, `"big"` → 400 at `.../props/size`; studio refuses outside 1–20 % |
| Weight, italic | `bold`, `true` | 700, italic | `heavy` → 400 |
| Colour | `#ff0000cc` | colour applied | `red; background:url(x)`, `red`, `#12345` → 400 at `.../props/color` |
| Align | `start` with Hebrew text, direction auto | right-aligned; with `ltr` left-aligned | `left` → 400 |
| Direction | `rtl` / `ltr` / `auto` | `dir` attribute set to it | `up` → 400 |
| Line height | 1.6 | applied | 0.5, 4 → 400 |
| Background box | `box`, `#000000` | box filled behind the text | bad colour → 400 |
| Highlight | `highlight`, `#ffcc00` | each line's glyphs highlighted (`box-decoration-break: clone`) | — |
| Contrast low | white on `#ffff00` box, small text | studio warning with its ratio; save allowed | — |
| Contrast media | tale with media, no box | "Can't check contrast over media" | — |
| Undo | change font, then undo | the previous style returns; autosaved draft | locked layer → refused, announced |
| SDK defence | delivered `color:'red;x'`, `family:'inherit'` | that field falls back to its default | no throw |

</intent-contract>

## Code Map

- `libs/contract/tale-document/element-types/text.schema.json`: the new props.
- `libs/contract/src/lib/text-style.ts` (new, + spec): the font registry, presets, ranges, `DEFAULT_TEXT_PROPS`, `resolveTextStyle`, `textContrast`; exported from `src/index.ts`. `tale-document.ts`: `TEXT_ELEMENT_STYLE` keeps the defaults.
- `libs/server/tales/src/lib/tale-document.ts` (+ spec): the text props rule re-checks `isFontFamily`. `apps/api/src/app.spec.ts`: the refusal rows over HTTP.
- `libs/web-sdk/src/lib/document/text.ts`, `renderer.ts` (+ spec): CSSOM styles, `dir`, box and highlight, alignment.
- `apps/dashboard/src/app/pages/tale-text-style.ts` (new, + spec): the inspector component. `tale-studio.ts` (+ spec): canvas styling from `resolveTextStyle`, the theme font via `ThemeService`, commit and announce, new text defaults.
- `apps/sdk-sample/a11y-review.mjs`, `a11y-scan.mjs`: a styled-text tale; contrast, RTL, text-spacing and phone-width checks.

## Tasks & Acceptance

**Execution:**
- [x] contract: schema props, `text-style.ts`, `contract:generate`, tests (schema ↔ registry, pattern ↔ `FONT_FAMILY_PATTERN`, resolve, contrast).
- [x] server-tales + api: rule and tests for every refusal row.
- [x] web-sdk: renderer and tests (each setting, defence, no `style` attribute writes).
- [x] dashboard: inspector and studio wiring, with component tests per matrix row.
- [x] sdk-sample: a styled-text tale in the scan and the review checks.

**Acceptance Criteria:**
- Given a text styled with each setting, when it is published, then the sample page shows the same font, size, weight, italic, colour, alignment, direction, line height and background as the studio canvas, at 390 and 360 px widths.
- Given Hebrew text with direction auto and alignment start, then it is right-aligned and mixed English reads correctly.
- Given the full verification run, all projects lint, test and build; `web-sdk:size` ≤ 50 KB; `sdk-sample:a11y` and `sdk-sample:a11y-review` pass with 0 violations; `sdk-sample:perf` cold p75 ≤ 1.5 s.

## Implementation Notes

- Assumptions. None of them is a product decision the epic settles; each is recorded for review.
  - **Props are flat and optional** on `text.schema.json`, so the change is additive and the document version stays 1. `font` is an object keyed by `source` (`system` with `stack`, `theme`, or `name` with `family`). The schema's `if`/`then` rules refuse a field that does not belong to the source, and project fonts (story 7.17) can join as another source. `background` and `backgroundColor` are separate fields, so the colour is kept when the background is switched off and on again.
  - **Font registry:** `sans` is the stack text used before styling. The other stacks are `serif` (Georgia, Cambria, Times New Roman), `rounded` (ui-rounded, SF Pro Rounded, Arial Rounded MT Bold, Nunito, Quicksand, then system sans) and `monospace` (ui-monospace, Menlo, Consolas, Cascadia Mono, Liberation Mono). Each is a fixed constant, never content.
  - **A font name** accepts what the theme's `isFontFamily` accepts: a comma-separated list of at most 200 characters with no CSS-wide keyword. The fallback stack is always appended after it.
  - **Theme font:** the SDK writes `var(--ta-font, <fallback>), <fallback>`, so it follows the delivered theme and any SDK override (story 3.9), and shows the fallback when the theme sets no font. The studio reads the project theme through `ThemeService`. It cannot see SDK configuration overrides.
  - **Ranges:** size from 1 % to 20 % of the canvas height, with presets small 3 %, medium 4 % and large 6 %; line height from 0.8 to 3; colours `#RRGGBB` or `#RRGGBBAA`, like the canvas colour. The weights map to regular 400, medium 500 and bold 700.
  - **Defaults** (`DEFAULT_TEXT_STYLE`) keep the look before styling: system sans, 4 %, 1.25, white, centred, `dir="auto"`. The one change is the weight. It was 600, which is not one of the three weights, so it is now bold (700).
  - **New texts** store every setting explicitly, `direction: 'auto'` included. Older texts that have only `{ text }` render with the defaults and are not migrated.
  - **Box and highlight:** a solid box fills the element's box, with 0.5 em of inline padding. A highlight is drawn on the inline glyphs with `box-decoration-break: clone` and 0.25 em of inline padding. The contract holds both padding values.
  - **Alignment and direction:** alignment is `text-align: start | center | end`. Direction is the `dir` attribute on the paragraph in the SDK and on the canvas element and in-place editor in the studio.
  - **Contrast** is a warning only. It shows in the inspector (`role="status"`) and as "Low contrast" in the layer row. The check uses 4.5:1, or 3:1 for large text. Large text means at least 24 px, or 18.67 px when bold, on a 640 px canvas (a 360 px wide phone).
    - The backdrop is the text's opaque box or highlight. Otherwise it is the canvas colour (over the black stage when that colour is translucent), with a translucent box or highlight drawn over it.
    - When the tale has media and nothing opaque is behind the text, the inspector says "Contrast can't be checked over media".
    - Layers lying under a text are not counted.
  - **Locked layers:** the whole inspector is a disabled fieldset. `restyle` also refuses the change and announces the lock message.
  - **Typed values that break a rule** (font name, custom size, line height, hex colours) stay in the field, marked with `aria-invalid` and an error message. They are announced and not applied. Choosing "Font name loaded by the page" or "Custom" size changes nothing until a valid value is typed.
- Design.
  - `libs/contract/src/lib/text-style.ts` holds the registry, presets, ranges, `resolveTextStyle` (each invalid field falls back to its default), `textFontFamily`, `textSizePreset`, `textContrast`, `compositeColor` and `isLargeText`. The studio's `textView` and the SDK's `renderText` both read it, so the canvas and the viewer cannot drift.
  - The SDK paragraph is now `p.ta-text` (a flex column, centred vertically) > `span.ta-line` (block, takes the alignment) > `span.ta-glyphs` (inline: the text node, the pointer target and the highlight). The studio's canvas button uses the same structure.
  - The server's text rule calls `isFontFamily` again after the schema pattern, so a font name reaches CSS only when both agree.
  - The inspector is its own component (`tale-text-style.ts`), with its styles in `styles.css`. It emits `{ label, patch, said }`. The studio's `restyle` turns that into one history step through `change()` and announces it, so every change is undoable and autosaves to the draft.
- Budgets.
  - The Web SDK grew from 14.54 KB to 15.54 KB gzipped.
  - The dashboard's initial bundle is 498.41 KB, still under its 500 KB warning. The contract is not tree-shaken in the dashboard's main chunk: the theme page's contrast strings were already there, so the new helpers land in main too. The lazy studio chunk is 76 KB.
- Not verified by hand: a signed-in browser walk of the studio and a real screen reader. Component tests cover each inspector row. The review's new section 11 drives the built SDK at 390 and 360 px.

## Plan Change Log

## Review Triage Log

## Auto Run Result

**Summary:**
- **Contract:** optional style props on the text element schema (an additive change), and `text-style.ts` with the font registry, presets, ranges, defaults, `resolveTextStyle`, `textFontFamily` and `textContrast`. `contract:generate` was run.
- **Tales module and API:** the schema checks every style prop, and the text rule checks font names again with `isFontFamily`.
  - Refused: `inherit`, `x;color:red`, `url(x)`, names over 200 characters, wrong combinations of font fields, `red; background:url(x)`, sizes 0, 0.005 and 0.5, a line height of 4, and unknown enums or fields.
  - Each refusal is a 400 naming the JSON pointer of the field.
- **Web SDK:** styles are applied through CSSOM only, after every value is checked again: font with its fallback stack, size in `cqh`, weight, italic, colour, logical alignment, line height, box or per-line highlight. The direction is set as the `dir` attribute.
- **Dashboard:** a text style inspector in Tale Studio.
  - It is grouped into Font, Colour, Alignment and Background. Every control is named and works with the keyboard alone.
  - Each change is one undoable history step and is announced.
  - A low-contrast warning shows in the inspector and in the layer row; contrast over media cannot be checked and is marked so.
  - The canvas draws text exactly as the SDK does, including the project theme font.
- **Sample page review:** section 11 adds a styled text tale at 390 and 360 px. It checks sizes, fonts (stack, page-loaded name, theme), right-to-left text and alignment, box and highlight contrast, text spacing and axe. The scan's markup check allows the renderer's line span.

**Verification:**
- `run-many -t lint test build` on the 12 projects passes. Test counts: contract 150, server-tales 136, web-sdk 296, dashboard 317, api 398.
- `web-sdk:size`: 15.54 KB gzipped (14.54 KB before).
- `sdk-sample:a11y`: no violations.
- `sdk-sample:a11y-review`: all 147 checks pass, with 0 axe violations in 21 states.
- `sdk-sample:perf`: cold p75 first content 1,257 ms, warm p75 754 ms.

**Residual risks:**
- The dashboard's initial bundle has only about 1.6 KB of headroom left under its 500 KB warning, because the contract is not tree-shaken there.
- The studio cannot see SDK configuration theme overrides, so a theme-font text may preview in the project theme's font while a page with an override shows another.
- If an edit is refused while editing is held (during discard or keep-as-copy), a select can keep showing the refused choice until the next render.
- Existing texts change weight from 600 to 700.

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w1_test npm exec nx -- run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-storyly --skip-nx-cache` -- expected: all succeed.
- `NX_DAEMON=false npm exec nx -- run web-sdk:size` -- expected: ≤ 50 KB gzipped.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:a11y` and `sdk-sample:a11y-review` -- expected: 0 violations; styled-text checks pass.
- `NX_DAEMON=false npm exec nx -- run sdk-sample:perf` -- expected: p75 cold first content ≤ 1.5 s.
