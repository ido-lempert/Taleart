---
title: TaleArt PRD
status: final
created: 2026-10-20
updated: 2026-10-20
---

# TaleArt — Product Requirements

## Vision

TaleArt is an open-source, self-hostable platform for in-app and web story content. Teams can run their story content on TaleArt with a content model compatible with Storyly, and move existing Storyly content across through Storyly's External API. Native iOS and Android experiences come after the Web MVP and read the same dashboard-defined data.

## Problem

Teams that run story-style content in their apps and sites depend on a single commercial vendor. Moving away means rebuilding every tale, zone and audience by hand. The research found no open-source platform with a comparable content model, and no migration path from Storyly beyond manual work.

Organizations with several teams and project budgets also cannot see usage per project, because Storyly publishes no rate limits, quotas, or usage and audit exports.

## Users

- **Content managers** build tales, tale groups, zones and collections, and read analytics. They need fast authoring and a preview.
- **Developers** integrate the Web SDK into a host site or app, and later the native SDKs. They need stable identifiers, a clear event model, and a documented import path.
- **Organization administrators** set up projects, issue zone keys, and (after the MVP) read usage per project for internal charging. `[ASSUMPTION]` Usage reporting is a post-MVP need.

## Scope

**MVP (Web):** the features in FR-001 to FR-030 that are not marked post-MVP.

**Post-MVP:** native iOS and Android SDKs; usage and storage metering with audit export; Canvas, Swipe Card and Video Feed widgets; conversion tracking (TaleArt's own design, not Storyly's conversion endpoint); AI personalization; retail media; in-story checkout.

**Out of scope for the initiative:** pricing and any hosted commercial offer.

## Features and requirements

### Projects and access

- **FR-001** An administrator creates a project. Every zone and tale belongs to exactly one project.
- **FR-002** A content manager signs in to the dashboard and sees only the zones of their project.
- **FR-003** An administrator issues a zone key, which is shown once. The key can be rotated and revoked. A revoked key is refused.
- **FR-004** Every tale, tale group, zone and collection carries its project identifier from creation. An item cannot be created without one.

### Zones and frames

- **FR-005** A content manager creates a zone in a project. A zone is a location in an app or site that shows one or more frames.
- **FR-006** A content manager assigns a frame type to a zone. The MVP frame types are bar and banner (confirmed by the user).
- **FR-007** A new frame type is added by configuration, appears in the frame picker, and saves without a schema change.
- **FR-008** A zone can hold a stage and a playbook. A playbook is a preset set of frames for a goal. Stage and playbook belong to the web zones work.
- **FR-009** The Web SDK renders a zone's frames on a host page, using the zone key.

### Tales and tale groups

- **FR-010** A content manager adds a tale to a tale group. A tale is full-screen media: image, GIF, video or an interactive clip. A tale group holds up to 100 tales.
- **FR-011** A content manager orders tale groups and the tales within them, and reorders them by drag.
- **FR-012** A content manager duplicates a tale into the same or another tale group.
- **FR-013** A content manager sets a start time and an end time on a tale and on a tale group. Content outside its window does not show.

### Interactive components

- **FR-014** A content manager adds poll, quiz, emoji reaction, countdown, product pins, promo code and Rating to a tale.
- **FR-015** A viewer responds to an interactive component on the Web SDK, and the response is recorded.
- **FR-016** A tale can carry a call to action: a button, a swipe-up link, or a custom image button, each with a destination.

### Tags, audiences and targeting

- **FR-017** A content manager creates tags and assigns them to tale groups. A tale group shows to a viewer when the viewer's tags match, under AND or OR logic.
- **FR-018** A tale group with no tags passed by the host shows when it is active. `[ASSUMPTION]` matches the Storyly behavior; to be confirmed.
- **FR-019** An administrator imports an audience from a single-column CSV. Each row is an external user key.
- **FR-020** A viewer whose external user key is in an audience sees the tale groups assigned to that audience. A viewer outside every audience sees only public content.

### Collections and product feeds

- **FR-021** A content manager creates a collection, a filtered list of items from a product feed.
- **FR-022** A content manager builds an automated shoppable tale group from a collection. The system fills it with items and rotates them on a schedule.

### Analytics

- **FR-023** The dashboard shows metrics per frame (Reach, Impression, Click, Engagement Rate, CTR) and per content item (tale group, tale).
- **FR-024** Each metric has a published TaleArt definition, linked from the dashboard.
- **FR-025** Metrics can be filtered by project and by date range, and exported as CSV.

### Migration from Storyly

- **FR-026** An administrator connects a Storyly account by its API credential and starts an import.
- **FR-027** The import brings across groups, stories, zones, tags, audiences and interactive components through the External API.
- **FR-028** The import ends with a report listing each entity type, the source count and the imported count, and each difference found.
- **FR-029** The import validates each record against the live API before writing it. It does not rely on the published field names alone.

### Post-MVP

- **FR-030** *(post-MVP)* Usage and storage are metered per project, from TaleArt's own event stream, and can be exported with an audit trail of status changes and content edits, for internal charging.

## Non-functional requirements

- **NFR-001** The project is licensed under Apache-2.0, including the SDKs and the API.
- **NFR-002** The platform is self-hostable, with no dependency on a hosted service of TaleArt's own.
- **NFR-003** Zone keys and user sessions are the only credentials the platform issues. Credentials are not stored in plain text.
- **NFR-004** Storyly brand names do not appear in product code, UI or docs. Names follow the approved terminology map.
- **NFR-005** Storyly screenshots and copied Storyly documentation text are not committed to the repository.
- **NFR-006** Performance targets (page load, render time, import throughput) are deferred to architecture, which sets them as numbers.
- **NFR-007** The accessibility level for the dashboard and the Web SDK is deferred to architecture.

## Success measures

- **M-1** A test Storyly account imports with counts matching the source for every MVP entity.
- **M-2** A migrated tale renders on the Web SDK with the same entity types and interactive components as its Storyly original. Each difference is listed in the import report.
- **M-3** Every MVP metric has a published definition.
- **M-4** Every tale, tale group, zone and collection carries a project identifier.
- **Counter-measure:** the import report must not hide differences. A clean report that misses a difference is a failure, even when all counts match.

## Open decisions

Deferred to architecture (owner: the user; revisit when `bmad-architecture` starts):
1. **Performance targets** (NFR-006): page load, render time and import throughput. Architecture sets numbers.
2. **Accessibility level** (NFR-007) for the dashboard and the Web SDK. Architecture sets the level.

## Decided inputs

- Status scheme for tales and tale groups: the HTTP-based scheme in the research report, §11.3 (approved).
- Entity names: the approved terminology map (approved).
- Rating and collections are in the MVP (approved in the split review and the foundation epic).
- Native clients consume the same data through the same API (R10, C6).
- Project tag on all content from the first release (R8).

## Sources

- Product brief: `_bmad-output/initiative-taleart/brief-taleart/brief-taleart.md`
- Initiative requirements: `_bmad-output/initiative-taleart/initiative-taleart.md`
- Research report: `_bmad-output/initiative-taleart/research-storyly-competitive-teardown/research-storyly-competitive-teardown.md`
- Technical detail and decided architecture inputs: `addendum.md` in this folder
