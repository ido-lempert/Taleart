---
type: epic
title: Platform foundation
parent: initiative-taleart
id: 1
covers: [R3, R8, R10]
after: []
refined: false
risk: medium
---

# Platform foundation

## Description

The shared base every other epic builds on: a platform-neutral data model and API, the project tag on content, and CI and deploy for the existing scaffolds, with a dashboard shell.

## Outcome

Content can be created and read through the API with a project tag, deployed, and built on by the other epics.

## Done when

- The API runs in CI and deploys, with the data model and project tag live.
- A widget type can be added to the registry without a schema change.

## Boundaries

- Storyly import, rendering, targeting and analytics belong to sibling epics.
- Native SDK work is post-MVP; this epic keeps the model ready for it.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R3, R8, R10)

## Notes

- Open question: the entity names (terminology map) must be approved before this epic's data model is written. Waits on the names decision.
