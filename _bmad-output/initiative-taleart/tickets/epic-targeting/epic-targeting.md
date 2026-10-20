---
type: epic
title: Tag and audience targeting
parent: initiative-taleart
id: 5
covers: [R5, R12]
after: [epic-web-zones]
refined: false
risk: medium
---

# Tag and audience targeting

## Description

Decides which groups a viewer sees, from tags on tale groups combined with AND or OR, from user lists imported by CSV and matched to the external user ID, and from segments, dynamic rule-based groups of end users built from user attributes (SDK `setUserAttributes`). "Audience" is the dashboard heading of the targeting section (tags, segments, user lists), not an entity.

## Outcome

A team can target a tale group to a segment of viewers, and the viewer sees only the groups that match.

## Done when

- A test matrix over AND, OR and no-tag cases returns the expected groups.
- A user list CSV imports and matches the external user ID.

## Boundaries

- Schedules belong to epic 3, not here.
- Campaigns are not targeting; they belong to epic 3 (post-MVP).

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R5, R12)
- naming — `_bmad-output/initiative-taleart/research-storyly-competitive-teardown/naming-targeting-and-campaigns.md`, sections 1 to 5

## Notes

- Assumption: a group with no tags passed shows when active. Confirm before refinement.
- Decision (2026-10-20): names approved by the user: tag (dashboard label "Targeting tags"), segment (`segments`), user list (`userLists`, replaces audience and member), user attributes (`setUserAttributes`), external user ID (`externalUserId`, replaces external user key).
- Open: segments and user attributes have names but no PRD requirement yet; decide at refinement whether segments are MVP.
