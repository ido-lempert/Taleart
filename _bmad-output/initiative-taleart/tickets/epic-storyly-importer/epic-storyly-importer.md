---
type: epic
title: Storyly importer
parent: initiative-taleart
id: 2
covers: [R1, R2]
sources: [_bmad-output/initiative-taleart/initiative-taleart.md, _bmad-output/initiative-taleart/prd-taleart/prd-taleart.md, _bmad-output/initiative-taleart/prd-taleart/addendum.md, _bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md, _bmad-output/initiative-taleart/research-storyly-competitive-teardown/research-storyly-competitive-teardown.md]
companions: [_bmad-output/initiative-taleart/tickets/epic-storyly-importer/import-mapping.md]
refined: true
risk: high
---

# Storyly importer

## Description

Imports a Storyly account's content into a TaleArt project through Storyly's External API only, as a background job started from the dashboard, and reports per entity what came across and what differs. TaleArt's entities keep their own design: instances become zones, story groups tale groups, stories tales with media copied through the storage port, labels tags on tale groups, audiences user lists, and interactive components their TaleArt equivalents once those exist.

## Outcome

A team moves its Storyly content into TaleArt from the dashboard and sees, per entity, the source count, the imported count and every difference (PRD M-1, M-2).

## Requirements

R1 (parent R1; PRD FR-026, FR-027, FR-028): **Import an account**
   From a project, an admin pastes a Storyly API token and picks what to import, and the import writes into that project zones, tale groups, tales with media, tags and user lists (interactive components once they exist). The report lists source count and imported count per entity type.
   Verify: import the recorded test account and compare the report with the account's counts.

R2 (parent R2; PRD FR-028, M-2): **Differences are listed**
   Every source record or field the import does not carry across is a difference in the report. A report that misses a difference fails even when every count matches.
   Verify: import a fixture with a field TaleArt does not hold; the report names it.

R3 (PRD FR-029; AD-8): **Checked against the live shape**
   Each Storyly record is checked against the live response before mapping. A missing, renamed or unexpected field is a report difference, never a silent drop or a failed job.
   Verify: a fixture with a renamed field imports, and the report lists the rename.

R4 (AD-7): **Re-import without duplicates**
   Running the import again for the same account and project updates the linked records and creates none twice. Storyly ids live only in `import_links`.
   Verify: import twice; entity counts in TaleArt do not change, and a title changed at the source is updated.

R5 (AD-8): **Runs as a job**
   Starting an import returns at once; a worker processes the job row. The dashboard shows progress, the final state and the report, also after a reload.
   Verify: start an import, reload mid-run, and see progress continue to completion.

R6 (architecture Quality Targets, NFR-006): **Throughput**
   A 1,000-tale import finishes within 30 minutes.
   Verify: the throughput test imports 1,000 tales from the fake server with recorded latency in under 30 minutes.

## Constraints

- **Storyly appears only in the importer module** and as the source name "Import from Storyly" in the UI. Source: initiative C3, AD-12, user rule.
- **Writes go through other modules' public interfaces; media goes through the storage port.** Source: AD-8, AD-11.
- **Automated tests never call the real Storyly API**; they use a recorded or fake Storyly server. Source: user rule.
- **Fixtures carry no Storyly docs text, real tokens or end-user identifiers.** Source: PRD NFR-005; privacy.
- **Apache-2.0.** Source: initiative C1.

## Done when

- A real Storyly test account imports end to end from the dashboard, and the report's counts match the source for zones, tale groups, tales, tags, and interactive components (epic 4), user lists (epic 5) and statuses (epic 3) once those epics are done.
- Every difference between source and target is listed in the report.
- Re-running the import creates no duplicates.
- The throughput test imports 1,000 tales in under 30 minutes.
- Every importer test passes against the fake Storyly server with network access to the Storyly host blocked.

## Boundaries

- Out: conversion records and Storyly stats history (analytics history, not content); flows, collections and product feeds (no External API endpoint); any write back to Storyly; scheduled or automatic sync (a re-import is started by hand).
- Entries needing statuses and schedules wait on epic 3, components on epic 4, user lists on epic 5.
- Touch point: zones, tales, targeting and storage public interfaces — the importer adds update-by-id calls where re-import needs them; owner: epic-platform-foundation.
- Touch point: user lists — created through the targeting module's interface; owner: epic-targeting.
- Must not change: dashboard flows built in the foundation epic; the approved names (AD-12).

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R1, R2)
- mapping — `_bmad-output/initiative-taleart/tickets/epic-storyly-importer/import-mapping.md`
- prd — `_bmad-output/initiative-taleart/prd-taleart/prd-taleart.md`, FR-026 to FR-029, M-1, M-2; addendum, Storyly import mapping and Status scheme
- architecture — `_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md`, AD-4, AD-6, AD-7, AD-8, AD-11, AD-12, Quality Targets
- research — `_bmad-output/initiative-taleart/research-storyly-competitive-teardown/research-storyly-competitive-teardown.md`, sections 3, 4, 7, 11.3; `digests/`

## Notes

- Decision (2026-10-20, user rules relayed with the slicing request): migration only through the External API; AD-7 and AD-8 bind; stories are vertical slices reviewable in the dashboard; conversion records are not migrated; the mapping in `import-mapping.md`; tests use a recorded or fake server; only the real end-to-end run is hitl.
- Decision (2026-10-20): the status scheme (research 11.3) is approved (PRD addendum; initiative memlog), which closes this epic's earlier open question. The status and schedule mapping now waits only on tales and tale groups gaining status and schedule fields.
- Decision (2026-10-20): tracer bullet is story 1, an import of one app's instances as zones through job, worker, fake server, import links and report page.
- Decision (2026-10-20): the importer stays second in the epic build order, as the split review chose (importer early, riskiest path first), although stories 11, 12 and 13 wait on epics 3, 5 and 4; only those three stories wait, the rest build now.
- Waits on epic-web-zones because: story 11 needs status and schedule fields on tales and tale groups.
- Waits on epic-interactive-components because: story 13 needs the components to write into.
- Waits on epic-targeting because: story 12 needs user lists.
- Assumption: Storyly stats history is not imported, by the same reason as conversion records.
- Assumption: there is no placement endpoint, so zones come from instances (digest api-recipes-r1-3; PRD addendum "Placement / instance → Zone"). Story 3 confirms.
- Assumption: labels reach the API only as the story group `segments` JSON and the segments endpoint (digest entities-content-r1-1); those values become tags. Story 3 confirms.
- Assumption: only an admin starts an import (PRD FR-026 "an administrator"); one Storyly app imports into the existing TaleArt project the import is started from.
- Assumption: an unknown Storyly status code imports as `paused` and is listed as a difference.
- Open question: can audience members be read through the External API, or only audience names? If only names, user lists import empty and each is a difference. Story 3 answers it; story 12 waits on it.
- Open question: auth is documented both as a `token` query parameter and as a bearer JWT. Pick: bearer, falling back to the query parameter; story 3 settles it.
- Open question: is the Storyly token kept after the import? Pick: stored encrypted with the job while it runs, deleted when it ends; a re-import asks again.
- Open question: imported zones get no frame, since the API names no widget type. Pick: no frame; the report lists "frame type unknown" per zone.
- Decision (2026-10-20): the epic-level gate on the whole foundation epic is dropped; each story keeps its own `after` on the foundation stories it needs (user, with the web zones decisions).
- Open question: may recorded responses from the user's real account be committed as fixtures? Pick: only an anonymized, shape-only copy; the raw recording stays outside the repo.
- Source conflict: status scheme — initiative Notes (open question) vs PRD addendum, Status scheme, and initiative memlog (approved).
- Decision (2026-10-20): story 2 comes before the real run (story 3), against the least-sure-next rule, so the real run compares zone, tale group and tale counts and exercises the story endpoints, not zones alone.
- Decision (2026-10-20): story 6 owns the report's differences section, and stories 5, 8, 11, 12 and 13 wait on it; 7 waits on 5 and 8, and 9 on 4, so stories sharing the worker pipeline or the import page build in order rather than colliding.
- Open question: the refactor sweep (14) waits on 11, 12 and 13, so it cannot run until epics 3, 4 and 5 are done. Pick: keep it; the alternative is a sweep after 1 to 10 and a second one later.
