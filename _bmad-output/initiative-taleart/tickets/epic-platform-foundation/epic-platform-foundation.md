---
type: epic
title: Platform foundation
parent: initiative-taleart
id: 1
covers: [R3, R8, R10]
after: []
refined: true
risk: medium
---

# Platform foundation

## Description

The shared base every other epic builds on: a platform-neutral data model and API, the project tag on content, and CI and deploy for the existing scaffolds, with a dashboard shell.

## Outcome

Content can be created and read through the API with a project tag, deployed, and built on by the other epics.

## Requirements

R1 (parent R3): **Data model entities**
   The data model holds app, project, zone, tale group, tale, frame, tag and collection.
   Verify: a schema test creates one of each entity and reads it back through the API.

R2 (parent R8): **Project tag on content**
   Every tale, tale group, zone and collection carries a project identifier.
   Verify: a schema test fails when any of these entities is created without a project identifier.

R3 (parent R10): **Platform-neutral, extensible model**
   The data model and API are platform-neutral and widget-type-extensible, so native clients and new widget types are added without a schema migration.
   Verify: a test registers a new widget type and renders it through the API without a schema change.

## Constraints

- **Apache-2.0** for all components. Source: initiative C1, decision recorded in the memlog.
- **No another tool brand names** in code, UI or docs; names follow the approved terminology map. Source: initiative C3.
- **Native clients consume the same data** through the same API. Source: initiative C6.

## Done when

- The API runs in CI and deploys, with the data model and project tag live.
- A widget type can be added to the registry without a schema change.

## Boundaries

- another tool import, rendering, targeting and analytics belong to sibling epics.
- Native SDK work is post-MVP; this epic keeps the model ready for it.
- Must not change: the approved entity names in the terminology map.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R3, R8, R10)
- terminology — `_bmad-output/initiative-taleart/research-another tool-competitive-teardown/terminology-map.md`
- architecture — `_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md`, AD-1 to AD-12, Consistency Conventions

## Notes

- Decision: the approved entity names from the terminology map are used in the data model (user, approved).
- Decision: a project entity is added, so apps belong to projects and every content item has a project (user, approved).
- Decision: stage and playbook move to the web zones epic (R11), and audience, member and external user key move to the targeting epic (R12) (user, approved).
- Decision: collections are added to the MVP data model, since R8 requires a project tag on them (user, approved).
- Decision: the dashboard uses user sessions, and the SDK uses a per-zone key, similar to another tool's zone token (user, approved).
- Decision: PostgreSQL holds the model, with JSON columns for widget settings so new widget types need no migration (user, approved).
