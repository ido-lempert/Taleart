---
title: 'Rate with an emoji slider'
type: 'feature'
ticket: '2'
created: '2026-10-24'
status: built
baseline_revision: 'c861813'
route: 'full'
route_source: 'auto'
risk: 'medium'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-interactive-components/epic-interactive-components.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-interactive-components/tickets/story-tracer-add-a-poll-to-a-tale-and-see-a-visitor-s-vote-counted-plan.md'
  - '{project-root}/libs/contract/README.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** epic R5 needs a Rating: a question and one emoji on a slider from 0 to 100 that a visitor
sets by dragging or by the arrow keys, recorded once on release or on Enter, after which it shows the
count and average of all ratings. It is the epic's least certain component: its drag must not swipe
the viewer to another tale or group, and it needs a real keyboard slider.

**Approach:** register `rating` through the same registry path the poll took, and reuse 4.1's
machinery rather than fork it: `ELEMENT_TYPE_LIMITS` and `INTERACTIONS` gain `rating`; the
`interactive` module's per-type table (which held only the poll's choices) becomes a table of response
kinds, each saying which values are valid and how the result is counted; `POST /delivery/v1/responses`
and `GET /api/v1/tales/{taleId}/responses` are unchanged in shape except that `result` is now a
choice result or a rating result. The studio's fields inspector gains an `emoji` control that opens
the existing emoji picker (7.6); the responses panel learns a Rating's count and average. The Web SDK
gets `document/rating.ts`, an ARIA slider whose pointer and key events never reach the viewer's
gesture and key handling.

## Boundaries & Constraints

**Always:**
- Value: an integer 0..100 sent as its decimal string (`"80"`), canonical form only (no `"080"`,
  `"8.0"`); the server checks it, never trusting the client (R15).
- Keyboard: role `slider`, `aria-valuemin` 0, `aria-valuemax` 100, `aria-valuenow`, an
  `aria-valuetext`; Right/Up +10, Left/Down -10 (mirrored right to left), PageUp/PageDown +/-10,
  Home 0, End 100; Enter records. The slider is one Tab stop named "Your rating", inside a group
  named by the question (so the question is not read twice). It starts at 50.
- Pointer and touch: a press on the track moves the emoji there, a drag follows the pointer
  (pointer capture, `touch-action: none`), the release records. Pointer, click and key events of the
  slider stop at the Rating: the viewer never sees a press, swipe, tap or arrow key from it.
- First rating wins (C9); a repeat answers the stored value and current result. The result is shown
  to visitors as the average (C5) with the count; kept locally for a return visit (C11).
- Focus inside the Rating pauses the tale (C7, through 4.1's `.ta-interactive`).
- Text only as text nodes, styles only through CSSOM (AD-16); the emoji is checked again by the SDK.
- The studio preview records nothing.
- Stay out of the Audience drawer and the group rows (a parallel 5.2 build).

**Never:** a document version change; a new migration (the 4.1 table holds any element type); user
data beyond the visitor id; native rendering (C1: 4.10); a change to `GET /delivery/v1/zone`.

## Design

- **Contract:** `rating.schema.json` (`question` 1-200, optional `title` 0-80, `emoji` 1-64 checked
  as RGI by the server rule, `theme` light|dark). `interactive.ts`: `ELEMENT_TYPE_LIMITS.rating = 1`,
  `INTERACTIONS.rating = ['rate']`, `RATING_MIN/MAX/STEP`, `ratingValue` (canonical string to number
  or null), `ratingResult` (count and rounded average from counts per value), `isChoiceResult`.
  OpenAPI: `RatingElementProps`, `RatingResult`, `InteractiveResponse.result` becomes
  `oneOf [ChoiceResult, RatingResult]`; descriptions name the Rating.
- **Server rules (tales):** `PROPS_RULES.rating`: one-line text for title and question, one emoji
  (`isEmojiGlyph`); NFC as the poll's text. The per-tale limit comes from `ELEMENT_TYPE_LIMITS`.
- **Interactive module:** `RESPONSE_KINDS` per type: `valid(value, props)` and `result(counts, props)`
  (poll: option ids and `choiceResult`; rating: `ratingValue` and `ratingResult`). No migration.
- **Studio:** the `rating` descriptor (Add menu row 3 beside the poll, limit hint, fields question,
  title, emoji and theme, create with a heart, canvas text `emoji question`, `check` for one-line
  text and one emoji). `InspectorField.control` gains `emoji`: the fields inspector shows the emoji
  with "Choose emoji…", which opens `TaleEmojiPicker` and applies the choice as one history step; the
  descriptor check refuses an emoji field whose prop is not a string. The responses panel shows a
  Rating's count and average ("2 ratings, average 60") and says when it has ratings.
- **Web SDK:** `document/rating.ts` (group named by the question, the slider with the emoji thumb
  on a filled track, the average marker and text after rating, a polite live region);
  `responses.ts` keeps and checks either result kind; the poll narrows with `isChoiceResult`.

## Verify

Story verify line: add a Rating with a heart emoji; on the sample page drag it to about 80: the
average shows and the viewer stayed on the same tale and group; on another browser set 40 with the
arrow keys and Enter: the average reads 60 and the inspector shows 2 ratings averaging 60; saving a
Rating whose emoji is `ab` is refused. Unit tests cover the slider's keys, pointer drag without a
group swipe and the server's value checks; the a11y scan covers the Rating in both themes; an e2e
spec walks the verify line against the real API.

</intent-contract>
