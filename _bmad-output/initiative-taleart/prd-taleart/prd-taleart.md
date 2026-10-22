---
title: TaleArt PRD
status: final
created: 2026-10-20
updated: 2026-10-23
---

# TaleArt — Product Requirements

## Vision

TaleArt is an open-source, self-hostable platform for in-app and web story content. Teams can run their story content on TaleArt with a content model compatible with another tool, and move existing another tool content across through another tool's External API. Native iOS and Android experiences come after the Web MVP and read the same dashboard-defined data.

## Problem

Teams that run story-style content in their apps and sites depend on a single commercial vendor. Moving away means rebuilding every tale, zone and user list by hand. The research found no open-source platform with a comparable content model, and no migration path from another tool beyond manual work.

Organizations with several teams and project budgets also cannot see usage per project, because another tool publishes no rate limits, quotas, or usage and audit exports.

## Users

- **Content managers** build tales, tale groups, zones and (later) product sets, and read analytics. They need fast authoring and a preview.
- **Developers** integrate the Web SDK into a host site or app, and later the native SDKs. They need stable identifiers, a clear event model, and a documented import path.
- **Organization administrators** set up projects, issue zone keys, and (after the MVP) read usage per project for internal charging. `[ASSUMPTION]` Usage reporting is a post-MVP need.

## Scope

**MVP (Web):** the features in FR-001 to FR-030 that are not marked post-MVP, and Tale Studio (FR-032, FR-033; user decision, 2026-10-21).

**Post-MVP:** native iOS and Android SDKs; campaigns (FR-031); journeys, multi-step sequences that show different content over time or by behaviour; usage and storage metering with audit export; Canvas, Swipe Card and Video Feed widgets; conversion tracking (TaleArt's own design, not another tool's conversion endpoint); AI personalization; retail media; in-story checkout.

**Out of scope for the initiative:** pricing and any hosted commercial offer.

## Features and requirements

### Projects and access

- **FR-001** An administrator creates a project. Every zone and tale belongs to exactly one project.
- **FR-002** A content manager signs in to the dashboard and sees only the zones of their project.
- **FR-003** An administrator issues a site key for a project, which is shown once. The key can be rotated and revoked. A revoked key is refused. Zone keys issued before 2026-10-23 keep working and can still be rotated and revoked (owner decision D6, 2026-10-23).
- **FR-004** Every tale, tale group, zone and product set carries its project identifier from creation. An item cannot be created without one.

### Zones and displays

- **FR-005** A content manager creates a zone in a project. A zone is one spot in an app or site where tales appear, with one display (owner decision D1, 2026-10-23; until then a zone could show several frames).
- **FR-006** A content manager sets a zone's display: a frame type and its settings, changeable at any time. The MVP frame types are bar and banner (confirmed by the user). The UI calls the frame the zone's "display".
- **FR-007** A new frame type is added by configuration, appears in the frame picker, and saves without a schema change.
- **FR-008** A content manager picks a template when creating a zone. A template is a preset display for a goal, applied once (owner decision D7, 2026-10-23; it replaces the playbook, and stages are removed: each stage became its own zone, D1). Templates belong to the web zones work. A template is not a journey: a journey is a multi-step sequence that shows different content over time or by behaviour, and is post-MVP. "Journey" is used only as a common noun, never branded, pending legal review.
- **FR-009** The Web SDK renders a zone's display on a host page, using the project's site key and the zone's name (`zone="home-top"`). Pages that use a zone key, with or without a stage, keep working (owner decision D6, 2026-10-23).

### Tales and tale groups

- **FR-010** A content manager adds a tale to a tale group. A tale is full-screen media: image, GIF, video or an interactive clip. A tale group holds up to 100 tales.
- **FR-011** A content manager orders tale groups and the tales within them, and reorders them by drag.
- **FR-012** A content manager duplicates a tale into the same or another tale group.
- **FR-013** A content manager sets a start time and an end time on a tale and on a tale group. Content outside its window does not show.

### Interactive components

- **FR-014** A content manager adds poll, quiz, emoji reaction, countdown, product pins, promo code and Rating to a tale.
- **FR-015** A viewer responds to an interactive component on the Web SDK, and the response is recorded.
- **FR-016** A tale can carry a call to action: a button, a swipe-up link, or a custom image button, each with a destination.

### Tale Studio

User decision (2026-10-21): Tale Studio is in the MVP. another tool's story editor is the reference for its features and flow; the research is in `research-another tool-competitive-teardown/digests/studio-r4-1.md`.

- **FR-032** A content manager composes a tale in Tale Studio, an editor in the dashboard. A tale is built from text, images, video, shapes, stickers and emoji, calls to action (FR-016) and interactive components (FR-014), placed on a 9:16 canvas with safe areas. Text uses system font stacks, a font-family name the host page loads, or a WOFF2 font uploaded to the project (user decision, 2026-10-21). The editor has a layers list, undo and redo, a preview that matches what the Web SDK shows, and full keyboard and screen-reader access.
- **FR-033** A tale is stored as a structured document of elements. The SDKs render each element live, so text stays real text: accessible, editable, translatable and sharp. A tale is never flattened into one image, and native SDKs later render the same document.

### Tags, segments, user lists and targeting

Names follow the terminology map: a **tag** is a content label on a tale group; a **segment** is a dynamic, rule-based group of end users built from **user attributes** (SDK `setUserAttributes`); a **user list** is an uploaded static list of end users; the **external user ID** (`externalUserId`) is the end-user identifier the host passes. "Audience" is only the dashboard heading of the targeting section.

- **FR-017** A content manager creates tags and assigns them to tale groups (the dashboard labels them "Targeting tags"). A tale group shows to a viewer when the viewer's tags match, under AND or OR logic.
- **FR-018** A tale group with no tags passed by the host shows when it is active. `[ASSUMPTION]` matches the another tool behavior; to be confirmed.
- **FR-019** An administrator imports a user list from a single-column CSV. Each row is an external user ID.
- **FR-020** A viewer whose external user ID is in a user list sees the tale groups assigned to that user list. A viewer outside every user list sees only public content.

### Product sets and product feeds

Product sets (formerly "collections") depend on product feeds and come after the platform foundation (user decision, 2026-10-20).

- **FR-021** A content manager creates a product set, a saved filter over a product feed.
- **FR-022** A content manager builds an automated shoppable tale group from a product set. The system fills it with items and rotates them on a schedule.

### Analytics

- **FR-023** The dashboard shows metrics per frame (Reach, Impression, Click, Engagement Rate, CTR) and per content item (tale group, tale).
- **FR-024** Each metric has a published TaleArt definition, linked from the dashboard.
- **FR-025** Metrics can be filtered by project and by date range, and exported as CSV.

### Migration from another tool

- **FR-026** An administrator connects a another tool account by its API credential and starts an import.
- **FR-027** The import brings across groups, stories, zones, tags, audiences (as user lists) and interactive components through the External API.
- **FR-028** The import ends with a report listing each entity type, the source count and the imported count, and each difference found.
- **FR-029** The import validates each record against the live API before writing it. It does not rely on the published field names alone.

### Post-MVP

- **FR-030** *(post-MVP)* Usage and storage are metered per project, from TaleArt's own event stream, and can be exported with an audit trail of status changes and content edits, for internal charging.
- **FR-031** *(post-MVP)* A content manager creates a campaign: a name, a goal (a conversion event), a set of tale groups, and a schedule (start date and end date, `startsAt` / `endsAt`). Campaigns are optional; a tale group keeps its own start and end time inside the campaign's schedule, and the campaign is one reporting unit. "Promotion" is reserved for offers and promo codes.

## Non-functional requirements

- **NFR-001** The project is licensed under Apache-2.0, including the SDKs and the API.
- **NFR-002** The platform is self-hostable, with no dependency on a hosted service of TaleArt's own.
- **NFR-003** Site keys, zone keys (legacy, from before 2026-10-23) and user sessions are the only credentials the platform issues. Credentials are not stored in plain text.
- **NFR-004** another tool brand names do not appear in product code, UI or docs. Names follow the approved terminology map.
- **NFR-005** another tool screenshots and copied another tool documentation text are not committed to the repository.
- **NFR-006** Performance targets (page load, render time, import throughput) are deferred to architecture, which sets them as numbers.
- **NFR-007** The accessibility level for the dashboard and the Web SDK is deferred to architecture.

## Success measures

- **M-1** A test another tool account imports with counts matching the source for every MVP entity.
- **M-2** A migrated tale renders on the Web SDK with the same entity types and interactive components as its another tool original. Each difference is listed in the import report.
- **M-3** Every MVP metric has a published definition.
- **M-4** Every tale, tale group, zone and product set carries a project identifier.
- **Counter-measure:** the import report must not hide differences. A clean report that misses a difference is a failure, even when all counts match.

## Open decisions

Deferred to architecture (owner: the user; revisit when `bmad-architecture` starts):
1. **Performance targets** (NFR-006): page load, render time and import throughput. Architecture sets numbers.
2. **Accessibility level** (NFR-007) for the dashboard and the Web SDK. Architecture sets the level.

## Decided inputs

- Status scheme for tales and tale groups: the HTTP-based scheme in the research report, §11.3 (approved). The dashboard shows it as On / Off for a tale group and Shown / Hidden for a tale (draft and paused both read Off or Hidden; archive is in the ⋯ menu); turning a group On shows its tales by default and each tale can be hidden; every zone, group and tale says whether it is visible on the site and why not (owner decisions D2, D3, 2026-10-23; architecture AD-6).
- Terms (owner decisions, 2026-10-23, UX review): **zone** = one spot where tales appear; **display** = how a zone looks (bar or banner; "frame" internally); **template** = a preset picked when creating a zone (formerly playbook); **stage** is retired. Tale Studio's "Update tale" copies edits to the site; "Publish" and "On" mean only visibility (D4).
- Entity names: the approved terminology map (approved).
- Rating is in the MVP (approved in the split review and the foundation epic). Collections, now product sets, are no longer in the foundation: they depend on product feeds and come later (user, 2026-10-20; supersedes the earlier "collections in the MVP" decision).
- Targeting and campaign names (tag, segment, user list, user attributes, external user ID, journey, campaign, schedule, product set): approved by the user on 2026-10-20 (`research-another tool-competitive-teardown/naming-targeting-and-campaigns.md`).
- Native clients consume the same data through the same API (R10, C6).
- Project tag on all content from the first release (R8).
- Tale Studio and live-element tales are in the MVP (FR-032, FR-033), with another tool's story editor as the reference (user, 2026-10-21).

## Sources

- Product brief: `_bmad-output/initiative-taleart/brief-taleart/brief-taleart.md`
- Initiative requirements: `_bmad-output/initiative-taleart/initiative-taleart.md`
- Research report: `_bmad-output/initiative-taleart/research-another tool-competitive-teardown/research-another tool-competitive-teardown.md`
- Technical detail and decided architecture inputs: `addendum.md` in this folder
