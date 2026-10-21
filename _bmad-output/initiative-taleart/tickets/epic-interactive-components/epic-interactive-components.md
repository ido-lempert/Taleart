---
type: epic
title: Interactive components
parent: initiative-taleart
id: 4
covers: [R4]
after: [epic-platform-foundation]
refined: false
risk: medium
---

# Interactive components

## Description

Lets authors add interactive components to a tale and lets viewers respond on the Web SDK, including Rating.

## Outcome

A tale can carry poll, quiz, emoji reaction, countdown, product pins, promo code or Rating, and a viewer can respond.

## Done when

- Each of the seven components renders and records a response on the Web SDK.

## Boundaries

- Components beyond the seven are a later widget-type decision.
- Product sets and product feeds are not in this epic's Done when; see Notes.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R4)

## Notes

- Open question: the brief omits Rating; this epic includes it, as approved in the split review.
- Decision (2026-10-20): this epic owns **product sets** (PRD FR-021, FR-022; formerly "collections"), a saved filter over a product feed used to auto-build shoppable tale groups, because product pins share the same product data. Product sets moved out of the platform foundation; they wait for product feeds, which no epic builds yet, so no stories are sliced for them now (user, approved).
- Decision (2026-10-21): with Tale Studio in the MVP (epic-tale-studio, architecture AD-15), each component is an element type in the tale document, added through the element-type registry (Tale Studio story 7.8): a schema, a studio inspector and an SDK renderer. Responses stay in the `interactive` module. Calls to action (PRD FR-016) moved to epic-tale-studio (Sofia, headless; user to confirm).
