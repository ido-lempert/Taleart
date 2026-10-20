---
title: TaleArt Product Brief
status: draft
created: 2026-10-20
updated: 2026-10-20
---

# TaleArt — Product Brief

## Summary

TaleArt is an open-source, self-hostable platform for in-app and web story content. It offers a content model compatible with Storyly, a commercial product, so that teams can move their content over through Storyly's External API without rebuilding it. The MVP is Web. Native iOS and Android follow, driven by the same dashboard-defined data.

## Decisions

Approved by the user:
- Status scheme for tales and tale groups: HTTP-based, §11.3 of the research report.
- Entity names: the terminology map, including Playbook for flows. Counsel review still required before publication.
- License: Apache-2.0 for all components.
- Conversion tracking is not part of Storyly compatibility. TaleArt designs its own later.

Still open:
1. **MVP widget subset:** confirm bar and banner for the first release.

## Problem

Teams that run story-style content in their apps and sites are locked into a single vendor. Moving away means rebuilding every story, zone, and audience by hand. Storyly's public docs describe a clear content model, but this research found no open-source implementation of it, and no migration path that is not manual.

Multi-team organizations also have no documented way to see usage per project. Storyly publishes no rate limits, no quotas, and no usage or audit export, which makes internal chargeback hard.

## Users

- **Content and marketing teams** build tales (stories), tale groups, and interactive components. They need fast authoring and a preview.
- **Developers** integrate the Web SDK, and later the native SDKs, into the host app. They need stable IDs, clear events, and a documented import path.
- **Organization admins and project managers** need to see usage per project, and later storage, so internal costs can be charged to project budgets. `[ASSUMPTION]` This is a post-MVP need.

## Goals

1. A Storyly migrator: import an account's content through the External API into TaleArt, with a verification report. TaleArt also publishes its own metric definitions, which Storyly keeps behind its customer success team.
2. A compatible content model: migrated content renders with the same entity types and interactive components, and each difference is listed in the import report.
3. An open-source codebase that a team can self-host, with project-level accounting designed in from the start.
4. Native mobile experiences that use the same dashboard data as Web, after the Web MVP.

## MVP scope (Web)

**In:**
- Entities: app, zone, stage, tale group, tale, frame (bar and banner types first), playbook (a preset set of frames), tag, audience, member, external user key.
- Interactive components: poll, quiz, emoji reaction, countdown, product pins, promo code.
- Targeting by tags (AND/OR), by audience from a CSV keyed to an external user key, and by schedule.
- Analytics per widget and per content item, using the metric names Storyly now uses (Reach, Impression, Click, Engagement Rate, CTR), with TaleArt's own published definitions.
- Storyly importer: groups, stories, zones, tags, audiences, and interactive components, validated against the live API.
- Project tag on all content and zones from the first release, so metering can be added later without a migration.

**Out (later):**
- Native iOS and Android SDKs. Web comes first.
- Usage metering, storage metering, and audit export for internal chargeback (post-MVP, §11.9 of the research report).
- Canvas, Swipe Card, and Video Feed widgets, and the flows between them.
- Conversion tracking. TaleArt designs its own later; Storyly's conversion endpoint is not part of compatibility.
- AI personalization, retail media, and in-story checkout.
- Pricing and any hosted commercial offer. Out of scope for an open-source project.

## Risks

- **Storyly API drift.** The docs have field-name errors, and the status enumerations are not defined. The importer must be tested against the live API and re-tested when Storyly changes it.
- **Scope.** Web plus native plus an importer is a large first release. Keeping the MVP to the widget subset above is the main control.
- **Reference material.** The Storyly screenshots are kept outside the repo. They are for UX reference only.

## Sources

- Research report and digests: `_bmad-output/initiative-taleart/research-storyly-competitive-teardown/`
- Terminology map: `_bmad-output/initiative-taleart/research-storyly-competitive-teardown/terminology-map.md`
- Storyly documentation and What's new pages, accessed 2026-10-20. Most Storyly documentation pages carry no date, so their currency is unverified.
