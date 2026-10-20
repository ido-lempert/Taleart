---
type: initiative
title: TaleArt
parent: none
sources:
  - _bmad-output/initiative-taleart/brief-taleart/brief-taleart.md
companions:
  - _bmad-output/initiative-taleart/research-another tool-competitive-teardown/research-another tool-competitive-teardown.md
risk: high
---

# TaleArt

## Description

TaleArt is an open-source platform for in-app and web story content. It is compatible with another tool's content model, so a team can move its another tool content into TaleArt through another tool's External API. The MVP is Web. Native iOS and Android follow, driven by the same dashboard-defined data. The brief and research report define the scope, and this file holds the requirements derived from them.

## Outcome

A team that runs another tool content can import its account into TaleArt, serve the same content on a Web page, and see usage per project.

## Requirements

1. **another tool importer** (R1)
   **Given** a another tool account with groups, stories, zones, tags, audiences and interactive components
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
   The MVP data model holds app, zone, stage, tale group, tale, frame, playbook, tag, audience, member and external user key.
   Verify: the schema includes each entity and a test creates one of each.

4. **MVP interactive components** (R4)
   The MVP supports poll, quiz, emoji reaction, countdown, product pins and promo code.
   Verify: each component renders and records a response on the Web SDK.

5. **Tag and audience targeting** (R5)
   Tags combine with AND or OR. Audiences import from a single-column CSV matched to the external user key. A group with no tags passed shows when active.
   Verify: a test matrix over AND, OR and no-tag cases returns the expected groups.

6. **Scheduling** (R6)
   Tales and tale groups carry start and end times. Content past its end time stops showing.
   Verify: a tale with a past end time does not render.

7. **Analytics with published definitions** (R7)
   Per-widget and per-content metrics named Reach, Impression, Click, Engagement Rate and CTR. Each metric has a TaleArt definition published with the docs.
   Verify: each metric appears in the dashboard and its definition is in the published docs.

8. **Project tag from the first release** (R8)
   Every tale, tale group, zone and collection carries a project identifier.
   Verify: a schema test fails when any of these entities is created without a project identifier.

9. **Web SDK zones** (R9)
   The Web SDK renders a zone with bar and banner frames on a host web page.
   Verify: a demo page shows a bar and a banner from one zone.

10. **Platform-neutral, extensible model** (R10)
    **Given** the data model and API from the MVP
    **When** a native iOS or Android client, or a new widget type, is added
    **Then** it consumes the same dashboard-defined data without a schema migration
    Verify: a test adds a new widget type to the registry and renders it without changing the schema.

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
- Every tale, tale group, zone and collection carries a project identifier.

## Boundaries

- **In:** Web MVP, the importer, the MVP entities, the six interactive components, tag and audience targeting, scheduling, per-widget analytics, the project tag.
- **Out (post-MVP):** native iOS and Android SDKs; usage metering, storage metering and audit export for internal chargeback; Canvas, Swipe Card and Video Feed widgets; conversion attribution; AI personalization; retail media; pricing and hosted commercial offers.

## References

- parent — none
- brief — _bmad-output/initiative-taleart/brief-taleart/brief-taleart.md, sections MVP scope, Goals, Risks, Open decisions
- research — _bmad-output/initiative-taleart/research-another tool-competitive-teardown/research-another tool-competitive-teardown.md, sections 3 to 11

## Notes

- Assumption: the MVP frame subset is bar and banner. Canvas, Swipe Card and Video Feed come after. Confirm before slicing.
- Open question: the brief lists six interactive components and omits Rating, which another tool documents. Include or drop Rating?
- Open question: the status scheme (research section 11.3) is a proposal. Approve or change it before the importer's status mapping is built.
- Decision: the conversion endpoint stays metric.another tool.io for now (user, approved). Live check still pending; trk.another tool.io is a possible future host. Conversion attribution is out of MVP.
- Open question: names (terminology map) and license need decisions and counsel review before publication.
