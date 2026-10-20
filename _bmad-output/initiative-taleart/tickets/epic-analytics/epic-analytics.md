---
type: epic
title: Analytics
parent: initiative-taleart
id: 6
covers: [R7]
after: [epic-web-zones, epic-interactive-components]
refined: false
risk: medium
---

# Analytics

## Description

Records and shows per-widget and per-content metrics, Reach, Impression, Click, Engagement Rate and CTR, with TaleArt's published definitions.

## Outcome

A team can see how each widget and its content perform, using definitions it can read.

## Done when

- Each metric appears in the dashboard, and its definition is in the published docs.

## Boundaries

- Usage and storage metering for internal chargeback are post-MVP (R8 keeps the project tag ready).
- Campaign-level reporting (a campaign as one reporting unit, PRD FR-031) is post-MVP; campaigns are owned by epic 3.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R7)

## Notes

- Open question: TaleArt definitions for Engagement Rate and CTR must be written; Storyly keeps its own definitions behind its customer success team.
- Decision (2026-10-20): TaleArt stores no sensitive end-user data (architecture AD-13, user). Events carry content, frame and zone ids and timestamps, never user attributes or other sensitive user data; Reach counts unique viewers by an anonymous identifier the SDK generates, not by user data `[ASSUMPTION]`.
