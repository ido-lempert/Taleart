---
title: 'Tracer: turning a group On shows its tales; tales are hidden one by one'
type: 'feature'
ticket: '1'
created: '2026-10-22'
status: 'built'
baseline_revision: 'f752d74'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'thorough'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-ux-rework/epic-ux-rework.md'
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md#ad-6'
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md#ad-15'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A tale group and each of its tales had to be published separately. Groups and tales shared the same status words (Draft, Live, Paused) and the same Publish and Pause buttons, so turning a group on did not show its tales (epic R6, owner decisions D2 and D3).

**Approach:** The stored keys stay as they are (AD-6). The contract maps them to what a person reads. A group is On (`live`) or Off (`draft`, `paused`). A tale is Shown (`live`) or Hidden (`draft`, `paused`). Both can also be Archived. A switch sets `live` when turned on and `paused` when turned off. New tales are stored `live`, so a group turned On shows them. A tale is delivered only when it has a published document. A run-once migration makes the draft tales of never-live groups live, so nothing a visitor sees changes.

## Boundaries & Constraints

**Always:**
- Contract (`libs/contract/src/lib/core.ts`): `groupShownStatus`, `taleShownStatus`, `SHOWN_STATUS_LABELS`, `switchStatus`, `isSwitchable` and `NEW_TALE_STATUS`. `readTaleStatus` says `blocked-by-group` when the group is `draft` or `paused`.
- Tales module: new tales are stored `live`, and kept copies are stored `draft`. One SQL rule, `hasPublishedDocument`, decides delivery everywhere a tale, its media or its fonts are made public. To keep today's output, it also counts two kinds of legacy tale:
  - tales with media the Delivery API still composes;
  - title-only tales created before the shown-status step (identified by `created_at` against `tales_migrations.applied_at`), which keep the legacy placeholder.
- Going live from Hidden still publishes a studio draft when nothing is published yet (AD-15), through the shared helper `publishDraftGoingLive`. A tale made from uploaded media gets its published media document at creation, through the existing media sync.
- The migration `migrateShownStatus` runs once, under the migration lock and before the media step. It is recorded in `tales_migrations` in the same transaction. It sets `draft` tales in `draft` groups to `live` and publishes their draft where nothing is published. A `draft` group has never been live, because no transition sets `draft` again. `paused` and `archived` groups may have been live, so their draft tales stay Hidden.
- Dashboard: the `ShowSwitch` component is a `role=switch` button with `aria-checked`, named "Turn on <group>" or "Show <tale>". Its visible On/Off or Shown/Hidden text sits beside it, and its target is 44×24. The switch replaces Publish/Pause on group rows, tale cards and the tale drawer. Archive and Restore stay where they are. A badge appears only for states the switch does not say (scheduled, blocked by group, archived, and so on).

**Never:** new stored keys; a status history table; changing the Delivery API's key handling or the SDK; moving Archive (story 10); removing old zone keys or the stage attribute (story 8.7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| New group with three tales from media | group `draft`, tales `live` | not delivered; cards say Shown, group Off |
| Turn group On | PUT group `live` | all three delivered |
| Hide one tale | PUT tale `paused` | two delivered |
| Turn group Off | PUT group `paused` | none delivered; tales read `blocked-by-group` |
| Tale with only a draft document | stored `live`, nothing published | not delivered until published |
| Legacy title-only tale | created before the step | still delivered with the placeholder |
| Title-only tale created after the step | no document | not delivered |
| Migration (a) | draft tale in a `draft` group | made `live`; draft published if nothing is |
| Migration (b) | draft tale in a `live` group | stays `draft` (Hidden) |
| Migration (c) | draft tale in a `paused` or `archived` group | stays `draft` |
| Second start, kept copy stored `draft` | step already recorded | nothing changes |

</intent-contract>

## Verification

- `nx run-many -t lint test build` on 14 projects passed. Test counts:

  | Project | Tests passed |
  |---|---|
  | api | 494 |
  | dashboard | 370 |
  | contract | 258 |
  | server-tales | 228 |
  | server-importer | 276 |
  | web-sdk | 335 |
  | server-zones | 67 |
  | server-access | 29 |
  | server-targeting | 24 |
  | fake-storyly | 18 |
  | server-storage | 16 |

- The dashboard's initial bundle is 495.83 kB, under the 500 kB budget.
- Web SDK checks: `web-sdk:size` (21.69 KB gzipped) and `web-sdk:types-check` passed.
- `sdk-sample:perf` passed after a seed fix: a new tale is already Shown, so its studio draft is published explicitly.
- `sdk-sample:a11y` passed. `sdk-sample:a11y-review` has 3 failures in the landscape viewer and the R16 pixel comparison. They run on fixtures with an SDK this story does not touch, so they come from the base commit's wide-screen viewer.
- API tests: Delivery responses for both seeded zones are byte-identical before and after the migration. A second run is a no-op.
- Browser check on a fresh database: screenshots are in `shots-8.1/`. Delivery returned no groups with the group Off, then Tale 1, Tale 2, Tale 3 after turning it On, then Tale 1, Tale 3 after hiding Tale 2, then nothing after turning it Off again.

## Review fixes (2026-10-22)

- Legacy delivery rule: a tale created before the step with no published document is delivered as before, whatever its media's step state. This covers a tale whose media a studio save marked in step (`markTaleMediaSeen`): Delivery composes its media, as the release before did. The migration test has this fixture (b5).
- Importer (owner decision): a new tale from an ACTIVE (1) story is stored `live` (Shown); any other or missing status is stored `paused` (Hidden). Tales imported before keep their status. Start and end times (`ts_start`, `ts_end`) are left to importer story 2.11: note there that it should map them onto the tale's window.
- Migration:
  - The draft groups are share locked first, and the UPDATE is limited to those ids.
  - Each publish runs in its own savepoint: on an error the status change is kept, the publish is skipped and a warning is logged.
  - The migration functions take a `DbConnection` (one checked-out connection).
- A tale group copy carries `created_at` over, so copies of legacy title-only tales keep the placeholder.
- `findPublishedMedia` uses `deliveredGroup` for tale media.
- Media sync (owner decision): uploading or replacing media on a `live` tale that has a studio draft and nothing published leaves the published document empty ("not updated yet"). A new tale from media with no draft is still published at creation. The media migration keeps writing published documents for live tales.
- Dashboard:
  - The group switch is named "<group> on site". The tale switch keeps "Show <title>".
  - While saving, the switch is `aria-disabled` and ignores clicks, so focus stays on it.
  - The draft warning is announced only by its alert.
  - Status changes apply the PUT answer to the store at once, and an older refresh is dropped when a newer one starts.

## Deploy note: the mixed-version window

During a rolling deploy, instances of the previous release run beside this one. They create new tales as `draft`, the old default. In a group that is On, such tales stay Hidden until someone shows them; a tale created in a group that was never live is not made live, because the step runs once. Old instances also deliver every live tale, so a tale created `live` by this release with nothing published can show its legacy placeholder from an old instance until the rollout ends. Old instances still use Publish and Pause, which store the same keys the switch does. Keep the window short: deploy every instance, then let the step run on the first start of the new release.

## Review notes

- Flag: the legacy placeholder rule uses the tale's `created_at` against the step's `applied_at` instead of a new column.
- The group row header now wraps, so the name keeps at least 10rem and the actions move to their own line when they do not fit.
