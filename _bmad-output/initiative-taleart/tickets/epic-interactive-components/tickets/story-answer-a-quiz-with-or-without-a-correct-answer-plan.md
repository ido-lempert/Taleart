---
title: 'Answer a quiz, with or without a correct answer'
type: 'feature'
ticket: '3'
created: '2026-10-24'
status: built
baseline_revision: '3bf52c8'
route: 'full'
route_source: 'auto'
risk: 'medium'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-interactive-components/epic-interactive-components.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-interactive-components/tickets/story-tracer-add-a-poll-to-a-tale-and-see-a-visitor-s-vote-counted-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-interactive-components/tickets/story-rate-with-an-emoji-slider-plan.md'
  - '{project-root}/libs/contract/README.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** epic R3 needs a quiz: a question and two to four answers, one of which the author may
mark correct. After answering, the visitor sees whether they were right, the correct answer marked
and each answer's percentage; with no correct answer the quiz is a survey and shows only the
percentages. Authors need to add, remove and reorder answers by keyboard, and pick the correct one,
which the fields inspector cannot yet do (its choices are a fixed list).

**Approach:** register `quiz` through the registry path the poll and the Rating took and reuse their
machinery: `ELEMENT_TYPE_LIMITS` and `INTERACTIONS` gain `quiz`; the `interactive` module's
`RESPONSE_KINDS` gains a choice kind for it; `POST /delivery/v1/responses` and
`GET /api/v1/tales/{taleId}/responses` keep their shape (a quiz answers a `ChoiceResult`, as a poll
does). The correct answer is a prop of the published document (C10): the SDK marks right and wrong
itself, and the server's answer stays the counts. The fields inspector's choices field becomes a list
field when its schema allows a range of items (add, remove, move up and down, each one history step
applied by id to the element's current props), with an optional correct-answer pick. The Web SDK's
poll card becomes the shared choice card that the poll and the quiz both render.

## Boundaries & Constraints

**Always:**
- Props: `question` 1-200, optional `title` 1-80, `answers` 2-4 `{ id, label }` (id
  `^[A-Za-z0-9_-]{1,64}$`, label 1-60), optional `correctAnswerId` (an answer's id), `theme`
  light|dark. Plain one-line text. The server refuses duplicate answer ids and a `correctAnswerId`
  that is no answer's id, and NFC-normalises the text.
- Value: an answer id of the published quiz; anything else 422. First answer wins (C9).
- The correct answer is public (C10): it is in the delivered document. A quiz is not a secure test,
  and the docs say so.
- Inspector: answers are kept by id, so an edited label keeps its count and a moved answer keeps it;
  removing an answer drops its count from the panel (and from the visitor's result, as
  `choiceResult` already leaves unknown values out). Removing the correct answer clears the pick.
  Every list control is a button reachable by Tab, named with its visible text first (label in
  name), disabled through `aria-disabled` so focus stays put, and focus lands on a sensible control
  after each step.
- SDK: answers are buttons in a group named by the question; a press posts once and never steps the
  tale (C7); after answering the visitor's answer is pressed, with a right or wrong mark (text and a
  glyph, not colour alone) when a correct answer is set, the correct answer marked, and every answer's
  percentage; the live region says it. Focus inside pauses the tale (`.ta-interactive`). Once
  answered, Space on an answer goes back to the viewer (pause), as the Rating's keys do; the same
  holds for an answered poll. Clicks stop at the card. Kept locally for a return visit (C11).
- Text only as text nodes, styles only through CSSOM (AD-16). The studio preview records nothing.
- Stay out of the targeting module, the Audience page and CSV upload (a parallel 5.3 build).

**Never:** a document version change; a migration; a change to the response endpoint's shape or
`GET /delivery/v1/zone`; user data beyond the visitor id; native rendering (C1: 4.10).

## Design

- **Contract:** `quiz.schema.json`; registry entry; OpenAPI `QuizElementProps` and descriptions;
  `QuizElement` in the union; `elementName` case. `interactive.ts`: `ELEMENT_TYPE_LIMITS.quiz = 1`,
  `INTERACTIONS.quiz = ['answer']`, `CHOICE_PROPS` (`poll: options`, `quiz: answers`) with
  `choiceIds(type, props)` (`pollOptionIds` stays, built on it), `quizCorrectAnswerId(props)`.
- **Server rules (tales):** `PROPS_RULES.quiz` (line text, distinct ids, the correct id is an
  answer's); NFC for `answers` labels as for `options`.
- **Interactive module:** `RESPONSE_KINDS.quiz` (answer ids, `choiceResult`); a quiz's own 422
  message.
- **Studio:** the `quiz` descriptor (Add quiz on row 3, limit hint, question, title and theme fields;
  choices `answers` with item labels "Answer 1".."Answer 4", `correct: { prop: 'correctAnswerId' }`;
  create two answers, no correct one; `check`). `ChoicesField` gains `correct?`; the descriptor
  check accepts `minItems < maxItems` (a list) and a correct prop that is an optional id string.
  `ElementChange.choice` gains list edits (`add`, `remove`, `move`) by id, applied by a pure
  `applyChoiceEdit` in the studio on the current props. The responses panel is choice-generic (poll,
  quiz), names the correct answer, and gets quiz words.
- **Web SDK:** `document/poll.ts` holds the shared choice card (`renderChoiceCard`); `renderPoll`
  and `document/quiz.ts`'s `renderQuiz` call it; quiz marks via CSSOM classes. The viewer's
  `onComponent` no longer claims Space for an answered (`aria-disabled`) button.

## Verify

Story verify line: add a four-answer quiz with answer B correct; on the sample page answer C: C is
marked wrong, B right, and percentages show; a quiz without a correct answer shows only
percentages; edit B's text in the studio: its count is unchanged; remove answer D: its count no
longer shows; saving five answers or a correct id that is not an answer is refused. Unit tests cover
the list field (add, remove, reorder by keyboard, the correct pick), the renderer's marks, the
server's value checks and the API's refusals; the a11y scan covers the quiz in both themes before
and after answering; an e2e spec walks the verify line against the real API.

</intent-contract>
