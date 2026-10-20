---
type: research
research_type: competitive
subject: Storyly
decision: Scope TaleArt MVP (Web first, then iOS/Android Native) as an open-source competitor, with a Storyly-compatible content import path and a non-conflicting domain vocabulary
preset: deep
date: 2026-10-20
status: draft-complete (round 2 of deep preset)
---

# Storyly Competitive Teardown

## 1. Summary

Storyly's public documentation describes a content model of **Instance → Story Group → Story**, with **Placements** (named app locations, each holding one widget chosen at runtime) and **Flows** (preset widget bundles for a business goal). Stories are single media canvases carrying overlaid interactive components, not multi-slide objects.

The External REST API covers apps, instances, story groups, stories, audiences, and segments. It has create, read, update, and stats endpoints, and authenticates with a bearer JWT. There is no bulk import or export path and no documented content JSON schema. The docs contain field-name errors that an importer must check against the live API.

Five gaps block a faithful compatible import: status meanings are undefined, metric definitions are absent, the analytics model is keyed only to group and story, rate limits and quotas are not published, and the conversion endpoint is documented inconsistently. Section 7 lists them.

The docs have no "Recipes" section. This needs confirmation (Section 8).

## 2. Method and coverage

- Type: competitive teardown, deep preset (6 subagents at most per round, 12 sources per dimension per round, up to 3 rounds). Validation: normal.
- Dimensions, pruned per the approved plan: (1) offer and feature teardown from the Guide and API (primary); (2) usage and quota limits. Pricing was excluded because TaleArt is open source. Positioning, trajectory, and customer voice were pruned.
- Round 1: four researchers (entities, targeting/publishing/analytics, API/Recipes, limits). Round 2: three researchers on leads (content state and endpoints, event and analytics, flows and conversion).
- Sources: Storyly-owned docs and reference pages (docs.storyly.io, integration.storyly.io, docs.developers.storyly.io). Storyly publishes no dates on any fetched page, so every source here is `pub_date: unknown`. Currency of these facts is unverified.
- Digests (verbatim claims with sources and confidence): `digests/` in this folder. Memlog: `.memlog.md`.

## 3. Domain model (offer teardown)

| Storyly entity | What the docs say | Confidence | Source digest |
|---|---|---|---|
| App | Container for placements and content. REST: list only. Fields: id, token, title, category, store_type, store_id, account_id, is_inbox_story, settings. | medium | api-recipes-r1-3 |
| Placement | Named location in an app or site (homepage, PDP, category page) with a unique name, an app, and a platform. Holds one widget or none. Gets a token per platform. | medium-high | targeting-publishing-analytics-r1-2 |
| Instance | A Storyly view on an app page with a unique token; created in App Settings. REST: list only. Related to placement in the docs but the link is not explicit. | high (token), low (relation to placement) | entities-content-r1-1 |
| Widget | Runtime-chosen display type inside a placement: Story, Banner, Swipe Card, Vertical Feed, Canvas, Story Bar. | medium | targeting-publishing-analytics-r1-2 |
| Flow | Preset group of one or more widgets for a business goal (discovery, conversion, retention, loyalty), with content logic and optional AI personalization. One-to-many over widgets. No identifiers or schema documented. | high (concept), none (schema) | flows-audiences-conversion-r2-3 |
| Story Group | Up to 100 stories. Fields: id, title, icon, index, status, optional ts_start/ts_end, segments, settings, pinned (group only), sort_order. Shown as an icon in the bar. | high | entities-content-r1-1, content-state-endpoints-r2-1 |
| Story | Full-screen media of type image, GIF, video, or IVoD (interactive video on demand, up to 30 min, alone in its group). Display: 7 s image/GIF, 15 s video. Fields include title, name, media, deep_link, outlink, button_text, sort_order, status, ts_start, ts_end. | high | entities-content-r1-1, api-recipes-r1-3 |
| Interactive component | Poll, Rating, Multiple Choice/Quiz, Emoji Reaction, Countdown, Product Tags (only one usable more than once per story), Promo Code. CTA types: Button, Swipe Up, Custom Image CTA. | high | entities-content-r1-1 |
| Audience | Built from a single-column CSV matched exactly against the custom parameter the app sends to the SDK. Attached to a sub user (UUID sub_user_id + user_identifier). Groups may be type audience. | medium-high | flows-audiences-conversion-r2-3, entities-content-r1-1 |
| Label | Tag set on widgets in the dashboard. Matched at runtime via setLabels on the SDK. AND: group shows only if all labels passed. OR: shows if any passed. No labels passed: all active groups shown. | high (iOS page) | flows-audiences-conversion-r2-3 |
| Segment | String label for include/exclude targeting on groups. API: list, create, delete. | medium | entities-content-r1-1 |
| Sub user | Per-user record in the API, keyed by UUID and user_identifier. | medium | entities-content-r1-1 |
| Conversion event | Revenue or action event posted to Storyly. Attributed by Custom Parameter and Product ID, not by story or placement. View-through and click-through, 6-hour default window. | high (attribution), conflict (endpoint) | flows-audiences-conversion-r2-3, event-analytics-r2-2 |
| Showcase app | Preview tool: scan a QR code from the dashboard. No link to placements or instances found. | low | entities-content-r1-1 |

### Statuses (API enumerations, medium confidence)
- Story group: ACTIVE (1), PASSIVE (2), CAP_REACHED (3), END_DATE_REACHED (4), ARCHIVED (9). Only ACTIVE shown by SDK.
- Story: ACTIVE (1), PASSIVE (2), PASSIVE_BY_STORY_GROUP (3), END_DATE_REACHED (4), CAP_REACHED (5), WAITING_MEDIA_IMPORT (6), FAILED_MEDIA_IMPORT (7), ARCHIVED (9). Only ACTIVE shown by SDK.
- Meanings of the non-ACTIVE values are not defined in any fetched page. The dashboard uses different names (Active, Inactive, Test, Waiting for Approval). Groups inactive over 30 days are archived automatically.

### Ordering
- Stories ordered by index (sort_order via API). Groups ordered dynamically by default: a fully-viewed group moves to the end unless pinned. Viewers resume at their last unseen story.

## 4. API surface (external REST)

- Base: https://api.storyly.io/external. Auth: bearer JWT (scheme confirmed, header assumed). Generation and rotation of the JWT are not documented. Multipart uploads with a JSON `data` field.
- 18 reference pages: list apps; list instances; get/create/update/delete story group; get story group stats; get/create/update/delete story; get story stats; list/create/update audiences; list/create/delete segments.
- Story PATCH: id, deep_link, file, media_url, name, title, sort_order, status, ts_start, ts_end. No read-only fields marked. Partial-update semantics implied, not stated.
- Story-group PATCH: id and status required; optional file, media_url, pinned, segments, settings, sort_order, title, ts_start, ts_end.
- Stats: story stats and story-group stats take date ranges (YYYY-MM-DD). Metrics listed (impression, reach, click, complete, share, etc.) with no definitions or units.
- No external ID field on any entity. Pinning exists on story groups only.
- Known doc errors: the sub-user create example uses `/story`; `click_target_cap` vs `clicked_target_cap`; a `cta_macro` field appears in an example but not in the entity table.
- Not verified: HTTP methods for create and delete on story and group (only update, read, and stats pages were fetched).

## 5. Analytics and events

- Dashboard analytics: per group (CSV export), per story (filterable by status), and per interactive (polls, quizzes, product tags, countdown; CSV export). "Open Rate" = taps on the group cover; other metrics undefined.
- SDK events (iOS and Web fetched; Android, Flutter, React Native lists not obtained):
  - iOS: storylyLoaded, storylyLoadFailed, storylyStoryPresented, storylyStoryDismissed, storylyActionClicked, storylyUserInteracted (Emoji/Rating/Poll/Quiz/Countdown only), storylyEvent (catch-all).
  - Web: userEvent (story seen), renderedStoryGroups, storyViewed, storyGroupViewed, nextStory, previousStory, nextStoryGroup, previousStoryGroup, productTagExpanded, productTagClicked, userInteracted, openStoryGroup, closeStoryGroup, storyOpenFailed, noStoryGroup.
- Keying: every fetched analytics page keys events to group and story only. No placement, instance, flow, or widget key.
- Completion: no documented completion event. Reach: mentioned, not defined.

## 6. Usage and quota limits (project-manager relevant)

- Documented caps: up to 100 stories per group; IVoD up to 30 minutes and alone in its group; durations 7 s image/GIF, 15 s video.
- Plan-tier cap: a 5-group Free-plan limit appears only in a search snippet. Unverified. Kept out of the general limits.
- Not found: API rate limits, analytics retention windows, MAU or event quotas, limit-reached behavior, audience CSV size limits, slides per story, placements per app, workspace caps.
- Conversion attribution window: 6 hours default, changeable on request.

## 7. Gaps and conflicts

1. **Status meanings** undefined; names differ between API and dashboard.
2. **Metric definitions** absent for reach, impression, completion, and all stats endpoints.
3. **Analytics keying** limited to group and story; placement- and widget-level analytics not documented.
4. **Conversion endpoint conflict:** React Native page posts to `trk.storyly.io/traffic/<TOKEN>` with `payload.event_type`. Web conversion docs post to `metric.storyly.io/conversion/event/{WIDGET_TOKEN}` with type, value, currency, products. **Verify against live docs before designing any importer or event model.**
5. **Rate limits, quotas, retention** not published on any fetched page.
6. **Android, Flutter, React Native event lists** not obtained; Android labels setter unconfirmed (targeting page 404).
7. **Dates:** no fetched page shows a publication or last-updated date. Freshness cannot be established.
8. **Version drift:** iOS docs show both StorylyProductDelegate (v2.0) and STRProductDelegate (newer). Verify SDK version before copying signatures.

## 8. Premise check

The brief referred to Storyly's "Recipes" as the technical source. No Recipes section exists on docs.storyly.io. The closest equivalents are User Guides and SDK Integration Guides. The technical findings above use those. **Confirm whether a specific Recipes URL was meant.**

## 9. Implications for TaleArt (MVP)

- **Migration path:** a Storyly → TaleArt importer can map Story Group → Tale Group, Story → Tale, Placement → Zone, Flow → Journey, Label → Tag, Audience → Audience, Sub user → Member. Interactive components map 1:1 by type. The importer must read the live API, not the docs' examples, because of the field errors in Section 4.
- **Not importable from the public API:** status semantics (must be re-derived), placement-level analytics, conversion attribution to content, pinning (group-only and read-only in some schemas), and any external IDs. TaleArt should define its own stable IDs and an idempotent import key.
- **Event model:** Storyly's event names are a reasonable starting vocabulary for TaleArt's SDK events. Add placement and zone keys, which Storyly lacks, so analytics can be keyed to where content appeared.
- **Native parity:** Storyly's SDKs share a placement-token model with per-platform tokens. A single dashboard-defined data set driving Web, iOS, and Android matches this pattern.
- **Limits to match or exceed:** 100 tales per group and the 7 s / 15 s display durations are documented defaults and could be TaleArt's defaults too.

## 10. Open questions

1. Recipes: is a specific page meant? (Section 8)
2. Conversion endpoint: which of the two documented shapes is current? (Section 7.4)
3. Status values: what does each non-ACTIVE state mean? Needs a dashboard test or the SDK source.
4. Rate limits and quotas: do they exist? Ask Storyly support or inspect response headers on a trial account.
5. Android, Flutter, and React Native event lists: fetch the platform event pages.
6. Trademark: the terminology map is a naming-risk aid, not legal advice. Counsel should review the final names.

---

## 11. Addendum: round 3 (user answers and follow-ups)

### 11.1 Resolved open questions
- **Recipes (was §8):** `docs.storyly.io/recipes` exists in navigation but has no recipe pages. Its empty-state label is "No Recipes", and no recipe links appear in the page or in `llms.txt`. The technical source is therefore the Guides, the External API reference, and the SDK guides. Digest: `digests/recipes-check-r3-1.md`.
- **Conversion endpoints (was §7.4):** the user expects Storyly to move from `metric.storyly.io` to `trk.storyly.io`. Both are documented as current until verified. The importer and event design must accept either. The two payload shapes still need a live check.
- **What's new (was open):** the product blog has 10 posts, all from 2022 to January 2025. None announces an API, limit, quota, usage report, audit feature, or price change. The newest post is about 21 months old, so the "what's new" picture is stale. Digest: `digests/product-blog-r3-1.md`.

### 11.2 New Storyly vocabulary from the blog and guide index
- **"Journeys"** is Storyly's product term for conditional Story sequences (2023 post). Guide index also has "What it is a Flow?", "Creating a Flow", and "Building Storyly Journeys with Visibility Conditions". The terminology map previously proposed "Journey" for TaleArt's Flow equivalent. **That collides with Storyly's brand term and is changed in the terminology map** (see below).
- **Collections** ("Create Collections") is a Guide title with no definition fetched. Unknown whether it is a new name for groups or a separate entity. Open question.
- **Smart Sorting** (automatic ranking of Story groups by viewing behavior, enabled by contacting Storyly) is a server-side ordering rule. TaleArt needs an equivalent entry in its ordering model.
- **In-Story Checkout** and **Inbox Stories** (email embedding) are product features, not API entities. Both are candidate TaleArt modules.

### 11.3 TaleArt status scheme (decision: HTTP status-code semantics)
Per your answer, TaleArt defines its own tale and tale-group statuses using HTTP status-code meanings. Storyly's numeric codes are not reused. Proposed mapping (for review):

| TaleArt status | HTTP code | Meaning | Storyly equivalent (for migration) |
|---|---|---|---|
| `live` | 200 OK | Visible to end users | ACTIVE (1) |
| `scheduled` | 202 Accepted | Approved; goes live at its start time | (Storyly: ts_start in the future, not a status) |
| `processing` | 102 Processing | Media import in progress | WAITING_MEDIA_IMPORT (6) |
| `invalid-media` | 422 Unprocessable Content | Media could not be processed | FAILED_MEDIA_IMPORT (7) |
| `paused` | 403 Forbidden | Stopped by its owner | PASSIVE (2) |
| `blocked-by-group` | 423 Locked | Hidden because its group is paused | PASSIVE_BY_STORY_GROUP (3) |
| `expired` | 410 Gone | Past its end time | END_DATE_REACHED (4) |
| `quota-reached` | 429 Too Many Requests | A usage cap was hit (note: reuses the rate-limit code, so the API must return a distinct error body) | CAP_REACHED (5) |
| `archived` | 404 Not Found | Removed from display; restorable | ARCHIVED (9) |

Notes:
- Storyly's group status set (CAP_REACHED, END_DATE_REACHED, ARCHIVED, ...) has no separate group-level DRAFT in the API, so the mapping is one-to-one for groups as well.
- The 429 choice is the weakest mapping. Quota and rate limits should be separated in the API error model.
- The mapping is a proposal and needs review by the user before it becomes a decision.

### 11.4 Usage audit (new requirement)
Per your answer, organizations with several teams and project budgets need usage reports they can charge to project expenses. Pricing stays out of scope; metering and audit do not.

- **Metered units (proposed):** impressions, reach, interactions, conversions, API calls, stored media bytes.
- **Attribution key:** every metered event carries a tenant, project, and team tag, set when the content or zone is created.
- **Audit log:** an append-only record of status transitions and content changes, with actor and timestamp.
- **Export:** scheduled and on-demand CSV or JSON reports per project and per period.
- **Storyly gap:** Storyly has CSV exports for analytics, but no documented project-level usage, cost-center tagging, or audit export. This is a differentiator for TaleArt.

### 11.5 Terminology change
- **Flow → "Playbook"** (replacing "Journey"). "Journey" is Storyly's own product term (2023 blog, guide titles), so it is changed to avoid overlap.
- Other proposals are unchanged. Counsel review is still required.

### 11.6 Remaining open questions
1. Is the 429 mapping acceptable, or should quota states use a separate error model?
2. What are Collections (Guide title, no definition)?
3. Which conversion endpoint is current, and what is the payload shape? Needs a live check.
4. Are rate limits and quotas published anywhere? None found on any page, including the blog.

### 11.7 Collections (resolves open question 11.6.2)
- **Storyly has Collections.** A collection is a filtered sub-list of a product feed, filtered by Product ID, Product Group ID, Title, Price, or Sale Price. Automated shoppable stories are created from a collection: the system makes 8 stories with randomly selected items and rotates them every 24 hours. Digest: `digests/collections-stats-r3-2.md`.
- **Statistics:** Storyly documents statistics only at the product level: Total Cart Value, Impression, Conversion (added to cart), and Click-through rate (bottom-sheet opens over impressions). The Products tab offers a date-range picker, a best-performing sort, and CSV export. No collection-level statistics are documented.
- **Freshness:** the automated-shoppable-stories page is labeled "Updated almost 3 years ago". Treat it as possibly outdated.

**Implication for TaleArt:** a Collection entity (saved filter over a product feed) with a rotation policy for automated stories. Collection statistics can be derived by aggregating product metrics for the collection's members, but Storyly does not document that, so TaleArt would have to define it. This also gives usage-audit a natural attribution unit: project and team tags can sit on collections.

### 11.8 Current "What's new" (supersedes the blog check in §11.1)
Correction: §11.1 said the "what's new" picture was stale. That was true of the product blog only. The current page, https://www.storyly.io/whats-new-in-storyly, has entries up to **October 12, 2026**. Digest: `digests/whats-new-r3-3.md`.

Changes that affect TaleArt:
- **Widget-level analytics now exist (Oct 12, 2026).** Storyly reports Widget Performance separately from Content Performance. Banners, Swipe Cards, and Canvas have their own analytics, with a breakdown per slide, card, grid, and item. Five metrics are named and shared across widget types: Reach, Impression, Click, Engagement Rate, and CTR. Full definitions are not public; customers are referred to a customer success manager. This closes part of the earlier gap in §7.3, but definitions are still missing.
- **Metric renames:** Story Bar and Video Feed metrics became Content Reach, Content Impression, and Content Action Click.
- **Metrics in third-party systems:** the retail-media integration (May 4, 2026) tracks campaign metrics in the retailmediatools dashboard, not in Storyly's own analytics. This matters for usage audit: some metered value can live outside the platform.
- **Feed size limit raised (Sep 17, 2026)** with no number given.
- **Audience sync types (Sep 24, 2026):** Braze audiences can be daily-synced or one-time; Bloomreach shows added and removed user counts per update. This is a useful model for TaleArt's audience import status.
- **Vocabulary:** Storyly now says "Smart Flows" for flows and "Widget Library" for widget types. Neither changes the Playbook decision in §11.5.
- **Still absent:** rate limits, quotas, and usage or audit export. None appear on this page.

### 11.9 Project-level usage and storage metering (post-MVP requirement)
Confirmed: Storyly publishes no rate limits or quotas, so TaleArt has no published baseline to match. Usage metering is a TaleArt requirement.

- **Scope:** post-MVP. Not built in the first release.
- **Purpose:** an organization with several teams and project budgets can calculate internal charges per project from measured usage and storage. This is internal chargeback, not customer pricing, so pricing stays out of scope.
- **Measured per project:** usage (impressions, interactions, conversions, API calls) and storage (stored media bytes, plus content counts if useful).
- **Attribution:** every metered event and stored asset carries a project tag, set when the project is created. Teams and cost centers roll up from projects.
- **Source of truth:** TaleArt's own event stream, not third-party dashboards (see the retail-media case in §11.8).
- **Output:** scheduled and on-demand reports per project and period (CSV or JSON), with the audit log from §11.4 alongside them.
- **Dependencies for the MVP:** the data model must already carry a project identifier on content, zones, and collections, so metering can be added later without a migration.
