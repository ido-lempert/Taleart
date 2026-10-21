---
type: initiative
title: TaleArt
parent: none
sources:
  - _bmad-output/initiative-taleart/brief-taleart/brief-taleart.md
companions:
  - _bmad-output/initiative-taleart/research-another tool-competitive-teardown/research-another tool-competitive-teardown.md
  - _bmad-output/initiative-taleart/prd-taleart/prd-taleart.md
  - _bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md
risk: high
---

# TaleArt

## Description

TaleArt is an open-source platform for in-app and web story content. It is compatible with another tool's content model, so a team can move its another tool content into TaleArt through another tool's External API. The MVP is Web. Native iOS and Android follow, driven by the same dashboard-defined data. The brief and research report define the scope, and this file holds the requirements derived from them.

## Outcome

A team that runs another tool content can import its account into TaleArt, serve the same content on a Web page, and see usage per project.

## Requirements

1. **another tool importer** (R1)
   **Given** a another tool account with groups, stories, zones, tags, audiences (imported as user lists) and interactive components
   **When** the importer runs against the another tool External API
   **Then** each entity is written to TaleArt
   **And** the import report lists count per entity, source against target
   Verify: run the importer on a test account and compare the report to the account's counts.

2. **Migrated content renders** (R2)
   **Given** content imported by the importer
   **When** an end user views it on the Web SDK
   **Then** the entity types and interactive components match the source
   **And** each difference is listed in the import report
   Verify: compare a migrated tale on the Web SDK with its another tool original.

3. **MVP data model** (R3)
   The foundation data model holds app, project, zone, tale group, tale, frame and tag. Product sets (formerly collections) are not in the foundation: they depend on product feeds and come later (user, 2026-10-20).
   Verify: the schema includes each entity and a test creates one of each.

4. **MVP interactive components** (R4)
   The MVP supports poll, quiz, emoji reaction, countdown, product pins and promo code.
   Verify: each component renders and records a response on the Web SDK.

5. **Tag and audience targeting** (R5)
   Tags on tale groups combine with AND or OR. User lists import from a single-column CSV matched to the external user ID. A group with no tags passed shows when active.
   Verify: a test matrix over AND, OR and no-tag cases returns the expected groups.

6. **Scheduling** (R6)
   Tales and tale groups carry start and end times. Content past its end time stops showing.
   Verify: a tale with a past end time does not render.

7. **Analytics with published definitions** (R7)
   Per-widget and per-content metrics named Reach, Impression, Click, Engagement Rate and CTR. Each metric has a TaleArt definition published with the docs.
   Verify: each metric appears in the dashboard and its definition is in the published docs.

8. **Project tag from the first release** (R8)
   Every tale, tale group, zone and (once built) product set carries a project identifier.
   Verify: a schema test fails when any of these entities is created without a project identifier.

9. **Web SDK zones** (R9)
   The Web SDK renders a zone with bar and banner frames on a host web page.
   Verify: a demo page shows a bar and a banner from one zone.

10. **Platform-neutral, extensible model** (R10)
    **Given** the data model and API from the MVP
    **When** a native iOS or Android client, or a new widget type, is added
    **Then** it consumes the same dashboard-defined data without a schema migration
    Verify: a test adds a new widget type to the registry and renders it without changing the schema.

11. **Stage and playbook for zones** (R11)
    The web zones epic holds stage and playbook, so a zone's rendering context and its preset frames are stored.
    Verify: a zone with a stage and a playbook renders on the Web SDK.

12. **User list, segment, user attributes and external user ID** (R12)
    The targeting epic holds user lists, segments, user attributes and the external user ID, so viewers are matched to groups.
    Verify: a user list CSV matches a viewer by external user ID.

13. **Tale Studio** (R13)
    **Given** a tale in the dashboard
    **When** a content manager composes it in Tale Studio from text, images, video, shapes, stickers, calls to action and interactive components
    **Then** the tale is stored as a structured document of live elements
    **And** the Web SDK renders each element itself, as real, accessible text and media, not as a flattened image
    Decision (user, 2026-10-21): added to the MVP, with another tool's story editor as the reference.
    Verify: compose a tale with text, an image and a button in Tale Studio; on the sample page the text can be selected and is read by a screen reader, and the button opens its link.

## Constraints

- **Open source.** The license is not chosen (see Notes). Source: brief Open decisions 4.
- **No pricing.** Pricing is out of scope for the whole initiative. Source: brief Out; research section 2.
- **No another tool brand names** in product code, UI or docs. Names follow the terminology map, pending review. Source: brief Risks; terminology-map.md.
- **No another tool screenshots or copied docs text in the repo.** Source: brief Risks, Reference material.
- **Live-API validation for the importer.** The public another tool docs contain field-name errors. Source: brief Risks; research section 4.
- **Native clients consume the same data.** Native iOS and Android are post-MVP, but they use the same dashboard-defined data and API, with no model change. Source: user direction after the split review.

## Done when

- A another tool test account imports end to end, and the report matches the source counts for every MVP entity.
- A visitor on a Web page sees a zone's bar or banner with imported tales.
- Every MVP metric has a published definition.
- Every tale, tale group, zone and (once built) product set carries a project identifier.
- A content manager composes a tale in Tale Studio and a visitor sees its live elements on the Web SDK.

## Boundaries

- **In:** Web MVP, the importer, the MVP entities, Tale Studio (R13), the seven interactive components, tag and user list targeting, scheduling, per-widget analytics, the project tag.
- **Out (post-MVP):** native iOS and Android SDKs; usage metering, storage metering and audit export for internal chargeback; Canvas, Swipe Card and Video Feed widgets; conversion attribution; campaigns; journeys; AI personalization; retail media; pricing and hosted commercial offers.

## References

- parent — none
- brief — _bmad-output/initiative-taleart/brief-taleart/brief-taleart.md, sections MVP scope, Goals, Risks, Open decisions
- research — _bmad-output/initiative-taleart/research-another tool-competitive-teardown/research-another tool-competitive-teardown.md, sections 3 to 11
- prd — _bmad-output/initiative-taleart/prd-taleart/prd-taleart.md
- architecture — _bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md, AD-1 to AD-16

## Notes

- Assumption: the MVP frame subset is bar and banner. Canvas, Swipe Card and Video Feed come after. Confirm before slicing.
- Open question: the brief lists six interactive components and omits Rating, which another tool documents. Include or drop Rating?
- Decision (2026-10-20): the status scheme (research section 11.3) is approved, as the PRD addendum and the initiative memlog record; this closes the earlier open question and the source conflict raised while slicing epic-another tool-importer (user).
- Decision (2026-10-20): a tale group belongs to a project, not to one zone; zones place groups in their own order, and a group can be copied to a zone in the same or another accessible project (user; architecture AD-14; foundation stories 1.15 and 1.16).
- Decision: conversion tracking is not part of another tool compatibility. TaleArt designs its own conversion tracking later, and the importer does not migrate conversion records (user). another tool's endpoint is no longer an open question.
- Open question: names (terminology map) and license need decisions and counsel review before publication.
- Decision (2026-10-20): targeting and campaign names approved by the user: tag (on tale groups; UI "Targeting tags"), segment, user list, user attributes, external user ID, journey (common noun, never branded; counsel sign-off pending, fallback "Sequence"), playbook, campaign with a schedule, product set (replaces collection). "Audience" is only a dashboard heading. Source: research-another tool-competitive-teardown/naming-targeting-and-campaigns.md.
- Decision (2026-10-21): Tale Studio is in the MVP (R13). Tales are structured documents of live elements that the SDK renders, with another tool's story editor as the reference. The epic is `epic-tale-studio`, built after web zones and before interactive components, whose components become element types in the tale document (architecture AD-15, AD-16) (user).
- Decision (2026-10-21, user): Tale Studio details are settled. Fonts are system stacks plus a font-family name the host loads or a WOFF2 font uploaded to the project, loaded by the SDK only when a tale uses it. Contrast is a warning only. another tool's `studio_image` is not imported and its layers are listed as a difference. The starting limits are accepted and tuned by story 7.14. The CTA move, the tracer and the build order are autopilot defaults the user may change.
