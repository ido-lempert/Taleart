---
type: epic
title: Storyly importer
parent: initiative-taleart
id: 2
covers: [R1, R2]
after: [epic-platform-foundation]
refined: false
risk: high
---

# Storyly importer

## Description

Imports a Storyly account's content through the live External API into TaleArt, reports what came across, and lists where the migrated content differs from the source.

## Outcome

A team can move its Storyly groups, stories and zones into TaleArt, and see per entity what arrived.

## Done when

- A test Storyly account imports end to end, with counts matching the source for each entity.
- Differences between source and target are listed in the import report.

## Boundaries

- Entries that need components or audiences wait on epic 4 and epic 5.
- The status mapping waits on the status scheme decision.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R1, R2)
- research — `_bmad-output/initiative-taleart/research-storyly-competitive-teardown/research-storyly-competitive-teardown.md`, sections 4 and 11.3

## Notes

- Open question: the status scheme (research §11.3) needs approval before the status-mapping entry.
