---
title: 'Tracer: add a poll to a tale and see a visitor''s vote counted'
type: 'feature'
ticket: '1'
created: '2026-10-23'
status: built
baseline_revision: '6177b93'
route: 'full'
route_source: 'auto'
risk: 'high'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-interactive-components/epic-interactive-components.md'
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
  - '{project-root}/libs/contract/README.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** epic-interactive-components needs one path through every layer: a `poll` element type a
content manager adds in Tale Studio, which a visitor answers on the site, recorded once per visitor
(8.23's id) and counted back to the visitor and to the studio.

**Approach:** register `poll` through 7.8's registry (schema, OpenAPI, union, server rule, studio
descriptor, SDK renderer). Add `libs/server/interactive` (its own forward-only migration and public
interface) that keeps one row per visitor, tale, element and interaction kind, first wins (C9),
after asking the `tales` module whether the tale is delivered in that zone (the AD-6 rule) and
reading the element from its published document. The Delivery API gets `POST /delivery/v1/responses`
behind the same site key, slug and rate limit as `/zone`, plus a stricter write limit, and refuses a
missing or invalid `X-TaleArt-Visitor`. The Management API gets `GET /api/v1/tales/{taleId}/responses`
for the inspector's counts.

## Boundaries & Constraints

**Always:**
- Text is plain with stated limits, rendered only as text nodes, styled only through CSSOM (AD-16).
- A tap on the poll never steps; keyboard focus inside it pauses the tale (C7); Space on an option
  answers rather than pausing.
- First answer wins (C9); a repeat answers 200 with the stored value and current result.
- The SDK keeps the visitor's choice and the result locally and shows them on a return visit without
  asking again (C11).
- The studio preview posts nothing.
- Deleting a tale deletes its responses (foreign key with ON DELETE CASCADE).
- New code in new files where possible (parallel stories 5.1, 9.8 and 9.9 touch the tags module,
  `delivery-rule.ts`, the group view and the Web SDK filter).

**Never:** a document version change; a migration in another module; user data beyond the visitor
id; HTML or CSS from content; native rendering (C1: 4.10); a change to `GET /delivery/v1/zone`.

## Design

- **Contract:** `poll.schema.json` (`question` 1-200, optional `title` 0-80, `theme` light|dark,
  `options` exactly two `{ id, label }`, id `^[A-Za-z0-9_-]{1,64}$`, label 1-60). `src/lib/interactive.ts`:
  per-tale limits (`ELEMENT_TYPE_LIMITS`, poll 1), `choiceResult` (largest-remainder percentages),
  `POLL_INTERACTION`. OpenAPI: `PollElementProps`, `InteractiveResponseRequest`,
  `InteractiveResponse`, `ChoiceResult`, `TaleResponses`, two paths, two error codes
  (`response_target_not_found`, `visitor_id_required`).
- **Server rules (tales):** plain-text checks on title, question and labels; option ids unique; the
  per-tale limit is checked for every type in `ELEMENT_TYPE_LIMITS`. A new `deliveredTaleElement`
  reads one element of a tale delivered in a zone now, built from `deliveredPlacement` and
  `deliveredTale`.
- **Interactive module:** `interactive_responses` table; `recordResponse`, `taleResponseCounts`.
- **Studio:** the descriptor (Add menu row 3, fields for question, title and theme, plus a fixed
  two-item `choices` field for the option labels), a responses panel under the inspector that reads
  the counts and says when a poll already has votes.
- **Web SDK:** `document/poll.ts` renderer; a `responses.ts` client (POST, local store); the viewer
  passes a responder to the renderer through its options, pauses on focus inside `.ta-interactive`,
  and leaves Space to a focused option. Side cards and the preview get no responder.

## Verify

Story verify line: studio adds 'Tea or coffee?', updates; sample page votes Tea by keyboard (marked,
percentages, no step); reload shows the stored choice with no second vote; a vote in the studio
preview writes no row; the inspector shows Tea 1, Coffee 0; API tests refuse an unknown element, an
option id the poll lacks, a hidden tale and another project's site key, and a repeat returns the
first; the bundle stays within the size check.

</intent-contract>
