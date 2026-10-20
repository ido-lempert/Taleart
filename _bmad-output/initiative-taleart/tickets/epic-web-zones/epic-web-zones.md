---
type: epic
title: Web zones
parent: initiative-taleart
id: 3
covers: [R6, R9, R11]
after: [epic-platform-foundation]
refined: false
risk: medium
---

# Web zones

## Description

Renders a zone on a Web page as a bar or banner frame, and applies each tale's and group's start and end times.

## Outcome

A visitor sees a zone's published tales on a Web page, and content outside its schedule stays hidden.

## Done when

- A demo host page shows a bar and a banner from one zone.
- A tale past its end time does not render.

## Boundaries

- Frame types beyond bar and banner come with later widget-type entries (R10).
- Native rendering is post-MVP.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R6, R9)

## Notes

- Assumption: bar and banner are the MVP frame subset (brief open decision 5). Confirm before refinement.
- Requirement from the user (2026-10-20): customers change the style of rendered tales and frames (colors, fonts, corner radius, ring style and the like) either in the Web SDK configuration or in the dashboard, with the SDK configuration overriding the dashboard. Sofia to slice it into this epic's stories.
