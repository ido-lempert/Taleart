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
   The data model holds app, project, zone, tale group, tale, frame and tag. A tale group belongs to a project, not to one zone; a zone shows an ordered list of placements (zone, tale group, position), so one group can show in several zones of its project, each zone keeping its own order. A tale group can be copied, as an independent group, to a zone in the same or another accessible project (AD-14).
   Verify: a schema test creates one of each entity and reads it back through the API; in the dashboard one tale group shows in two zones with an edit visible in both, and a copied group changes independently of its original.

R2 (parent R8): **Project tag on content**
   Every tale, tale group, zone and tag carries a project identifier.
   Verify: a schema test fails when any of these entities is created without a project identifier.

R3 (parent R10): **Platform-neutral, extensible model**
   The data model and API are platform-neutral and widget-type-extensible, so native clients and new widget types are added without a schema migration.
   Verify: a test registers a new widget type and renders it through the API without a schema change.

## Constraints

- **Apache-2.0** for all components. Source: initiative C1, decision recorded in the memlog.
- **No third-party brand names** in code, UI or docs. Source: initiative C3.
- **Native clients consume the same data** through the same API. Source: initiative C6.

## Done when

- The API deploys, with the data model and project tag live.
- A widget type can be added to the registry without a schema change.
- A tale group can be placed in several zones of its project and copied to a zone in another accessible project (stories 15 and 16), with existing groups migrated to one placement each.

## Boundaries

- Native SDK work is post-MVP; this epic keeps the model ready for it.
- Must not change: the approved entity names.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R3, R8, R10)
- architecture — `_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md`, AD-1 to AD-14, Consistency Conventions

## Notes

- Decision: the approved entity names are used in the data model (user, approved).
- Decision: a project entity is added, so apps belong to projects and every content item has a project (user, approved).
- Decision: stage and playbook move to the web zones epic (R11), and audience, member and external user key move to the targeting epic (R12) (user, approved). Renamed 2026-10-20: user list, segment, user attributes and external user ID; there is no member entity.
- Decision: collections are added to the MVP data model, since R8 requires a project tag on them (user, approved). Superseded 2026-10-20, see below.
- Decision: the dashboard uses user sessions, and the SDK uses a per-zone key (user, approved).
- Decision: PostgreSQL holds the model, with JSON columns for widget settings so new widget types need no migration (user, approved).
- Decision (2026-10-20): no remote repository or hosted CI for now; work is committed locally only, so story 2 is dropped (user, approved).
- Decision (2026-10-20): a tale exists only inside a tale group, never directly in a zone (user, approved).
- Decision (2026-10-20): the first user is the admin; every other user needs an admin's invitation; everyone signs in with a passkey, passwordless (user, approved).
- Assumption (2026-10-20): media upload is its own story (12) after tale groups and tales; invitations are one-time links shown in the dashboard, with no mail server; invited users are content managers of the projects they are invited to, and only admins create projects and invitations. Not yet confirmed by the user.
- Decision (2026-10-20): tags go on tale groups, not tales (user, approved). Story 5 is now "Tag tale groups".
- Decision (2026-10-20): a collection is renamed **product set**, a saved filter over a product feed (PRD FR-021, FR-022). Product sets depend on product feeds, which are not built, so they move out of this epic (removed from R1, R2 and Done when) and come later; the interactive components epic holds the note (user, approved). Answers the earlier open question on what a collection holds.
- Decision (2026-10-20): filled buttons use the darker ember `#C73E1D` for contrast; ember `#F2542D` stays the brand accent (user, approved).
- Decision (2026-10-20): a tale group belongs to a project, not to one zone; a zone shows an ordered list of placements (zone, tale group, position), owned by the tales module. The same group can be placed in several zones of its project; edits to the group show in every zone, each zone keeps its own order, removing a group from a zone leaves it in the others, and a group in no zone still exists in the project. A user can copy a group, with its tales, tags and media references (files not duplicated), to a zone in the same or another accessible project as an independent group; tags are matched by name in the other project and created if missing (user; architecture AD-14). This supersedes "a tale group in a zone" in story 3; built stories 3, 4 and 5 and web-zones story 3.1 get a migration in story 15 that gives each existing group one placement in its current zone at its current position. New stories 15 "Show one tale group in several zones" and 16 "Copy a tale group to another zone"; R1 and Done when updated; the sweep (10) waits on both.
- Decision (2026-10-20): story 15 waits on web-zones story 3.1, against the epic build order (foundation before web zones), because it changes the Delivery API zone query 3.1 builds; the epic declares this after on epic 3 for story 15 only, and tickets.py reports it as an order conflict on purpose. The foundation epic is therefore not done until web-zones 3.1 is built, which also holds back epics gated on the whole foundation epic (interactive components).
