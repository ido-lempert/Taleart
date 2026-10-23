---
title: 'A targeted group says who it is for'
type: 'feature'
ticket: '2'
created: '2026-10-24'
status: built
baseline_revision: 'c861813'
route: 'full'
route_source: 'auto'
risk: 'low'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-targeting/epic-targeting.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/epic-ux-rework.md'
  - '{project-root}/libs/server/tales/src/lib/delivery-rule.ts'
warnings: []
deferred:
  - 'List and segment wording of the summary (stories 4 and 7) and the audience-empty reason (story 4).'
---

<intent-contract>

## Intent

**Problem:** a tale group targeted by tags (story 5.1) reads only "Visible on site", the same as a
group every viewer sees, so a content manager cannot tell from the row or the group view that the
site shows it to some viewers only, and the Tale groups page cannot list the targeted groups.

**Approach:** a pure `audienceSummary` in `libs/contract` (its own file, `audience.ts`, so the Web
SDK bundle is untouched) words a group's audience from the fields the Management API already
returns with every group (`tags`, `tagMatch`): "viewers tagged summer or vip" (Any), "summer and
vip" (All), none for an untargeted group. The dashboard indicator takes it as an input and, when
the group is visible, reads "Visible on site · for viewers tagged summer or vip" on the group row
(zone page and Tale groups page) and the group view. The Tale groups page gets a Targeted filter.

## Boundaries & Constraints

**Always:**
- Targeting is not a Not-visible reason (epic R7, owner decision): `delivery-rule.ts` is not changed,
  so the indicator and the Delivery filter keep agreeing; the summary is added only to a visible
  group's line, never to the reasons.
- The summary is in the indicator's accessible name: a targeted, visible group's line is a button
  (as a not-visible one already is) whose name is the whole line and whose tooltip says the full
  audience and that a page passing no tags shows the group to every viewer (epic R2, owner decision).
- Long tag sets stay readable: the line names at most three tags and "N more"; the tooltip names all.
- `isTargeted` (contract) is the one test for "has an audience", used by the filter and the summary,
  so stories 4 and 7 extend both in one place.
- Targeted lists groups that are not archived, as every filter but Archived does.

**Never:** a change to the Delivery API, the Web SDK, `delivery-rule.ts` or the OpenAPI document;
a migration; work in Tale Studio, the SDK renderers or the interactive module (story 4.2 in parallel).

## Design

- **Contract:** `src/lib/audience.ts`: `isTargeted(group)`, `audienceSummary(group, { maxTags })`
  (tags as `{ name }` or strings, `tagMatch` defaulting to any), `audienceNote(group)` for the
  tooltip; exported from `core`. Unit tests: no tags, one, two Any/All, three, more than the cap,
  missing match mode.
- **Dashboard indicator:** `audience` input (the group's targeting fields); `line` appends
  " · for <summary>" when visible and targeted; `interactive` also when visible and targeted; the
  tip shows the full audience and the no-tags note, and describes the button.
- **Group row, group view:** pass the group to the indicator.
- **Tale groups page:** `targeted` filter (label "Targeted") after Scheduled, counted like the others.
- **Tests:** contract unit tests; dashboard unit tests for the line, the button name, the tooltip,
  no summary when untargeted or not visible, and the Targeted filter; a Playwright e2e spec that
  makes visible groups through the API and asserts the summaries by accessible name (Any, All,
  untargeted), the group view, and the Targeted filter, plus an ARIA snapshot of the indicator.

## Verify

Story verify line: a group tagged summer and vip with Any reads 'Visible on site · for viewers tagged
summer or vip', with All 'summer and vip'; an untagged group shows no summary; the Targeted filter
lists exactly the tagged groups; an accessibility-tree assertion finds the summary in the indicator's
accessible name. Then the full lint/test/build run, `dashboard-e2e:e2e` and `dashboard-e2e:a11y`.

</intent-contract>
