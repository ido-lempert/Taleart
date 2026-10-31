---
title: TaleArt Product Brief
status: draft
created: 2026-10-20
updated: 2026-10-20
---

# TaleArt — Product Brief

## Summary

TaleArt is an open-source, self-hostable platform for in-app and web story content. The MVP is Web. Native iOS and Android follow, driven by the same dashboard-defined data.

## Decisions

Approved by the user:
- License: Apache-2.0 for all components.

Still open:
1. **MVP widget subset:** confirm bar and banner for the first release.

## Problem

Teams that run story-style content in their apps and sites are locked into a single vendor, and this research found no open-source implementation of such a platform.

Multi-team organizations also have no documented way to see usage per project. Commercial tools publish no rate limits, no quotas, and no usage or audit export, which makes internal chargeback hard.

## Users

- **Content and marketing teams** build tales (stories), tale groups, and interactive components. They need fast authoring and a preview.
- **Developers** integrate the Web SDK, and later the native SDKs, into the host app. They need stable IDs and clear events.
- **Organization admins and project managers** need to see usage per project, and later storage, so internal costs can be charged to project budgets. `[ASSUMPTION]` This is a post-MVP need.

## Goals

1. Published metric definitions: TaleArt publishes its own definition for every analytics metric.
2. An open-source codebase that a team can self-host, with project-level accounting designed in from the start.
3. Native mobile experiences that use the same dashboard data as Web, after the Web MVP.

## MVP scope (Web)

**In:**
- Entities: app, zone, stage, tale group, tale, frame (bar and banner types first), playbook (a preset set of frames), tag, audience, member, external user key.
- Interactive components: poll, quiz, emoji reaction, countdown, product pins, promo code.
- Targeting by tags (AND/OR), by audience from a CSV keyed to an external user key, and by schedule.
- Analytics per widget and per content item, using the metric names Reach, Impression, Click, Engagement Rate and CTR, with TaleArt's own published definitions.
- Project tag on all content and zones from the first release, so metering can be added later without a migration.

**Out (later):**
- Native iOS and Android SDKs. Web comes first.
- Usage metering, storage metering, and audit export for internal chargeback (post-MVP).
- Canvas, Swipe Card, and Video Feed widgets, and the flows between them.
- Conversion tracking. TaleArt designs its own later.
- AI personalization, retail media, and in-story checkout.
- Pricing and any hosted commercial offer. Out of scope for an open-source project.

## Risks

- **Scope.** Web plus native is a large first release. Keeping the MVP to the widget subset above is the main control.
