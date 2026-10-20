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
- Journeys and campaigns are post-MVP; this epic notes their ownership but builds neither.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R6, R9)

## Notes

- Assumption: bar and banner are the MVP frame subset (brief open decision 5). Confirm before refinement.
- Decision (2026-10-20): a **playbook** (R11) is a preset set of frames for a goal; a **journey** is a different, post-MVP concept, a multi-step sequence that shows different content over time or by behaviour. "Journey" is a common noun, never branded ("TaleArt Journeys"), pending legal review; fallback "Sequence" (user, approved).
- Decision (2026-10-20): this epic owns **campaigns** (PRD FR-031, post-MVP), since it owns schedules (R6): a campaign is a name, a goal (a conversion event), a set of tale groups and a schedule (`startsAt` / `endsAt`, UI "Start date" / "End date"). A tale group in a campaign shows only inside both windows. No stories yet; the module is `campaigns` (architecture Deferred). "Promotion" is reserved for offers and promo codes.
- Requirement from the user (2026-10-20): customers change the style of rendered tales and frames (colors, fonts, corner radius, ring style and the like) either in the Web SDK configuration or in the dashboard, with the SDK configuration overriding the dashboard. Sofia to slice it into this epic's stories.
