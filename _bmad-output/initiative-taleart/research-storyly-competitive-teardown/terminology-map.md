---
type: glossary
subject: TaleArt terminology map (vs Storyly)
date: 2026-10-20
updated: 2026-10-23 (UX rework: zone, display, template; stages and zone keys removed)
status: draft, legal review required
---

# TaleArt Terminology Map

Purpose: give TaleArt its own vocabulary, so the product does not use Storyly's brand-specific names. Concept-level structures (groups of items, locations, interactive elements) are generic industry patterns; the names below avoid Storyly's branding. **This is a naming-risk aid, not legal advice. Counsel must clear the final names.**

## Mapping

| Storyly term | TaleArt term | Notes |
|---|---|---|
| Story | **Tale** | Set by the brief. |
| Story Group | **Tale Group** | Set by the brief's pattern. Alternative if the name is too close: "Tale Set". |
| Placement | **Zone** | Set by the brief. Since the UX rework (2026-10-23): one spot in an app or site with at most one display, named on a page by its **slug** (`zone="home-top"`). |
| Showcase app | **Taller App** | Set by the brief. Preview tool. |
| Instance | (none; was **Stage**) | Retired in the UX rework (epic 8, story 8.5): each stage became its own zone, its key the zone's slug. The `stage` attribute was removed (8.7). |
| Widget (Story Bar, Banner, Swipe Card, Vertical Feed, Canvas) | **Display** (UI); **frame** stays the API and code name, with types: `bar`, `banner`, `card-deck`, `feed`, `canvas` | Use generic type names, not Storyly product names. One display per zone since the UX rework (8.5). |
| Flow / Smart Flow (preset widget bundle) | **Template** (was Playbook) | Storyly uses "Flow" as a product term, so it is avoided. A template is picked when a zone is created and sets its display once (Stories bar, Promo banner, Blank; 8.8); nothing is applied later. |
| Journeys (conditional story sequence) | **Journey** | Decided 2026-10-20, reversing the earlier rule that avoided it: at least four vendors (Iterable, CleverTap, OneSignal, Airship) use "journey" as a generic noun. Always a common noun ("a journey"), never branded ("TaleArt Journeys"). Storyly, a direct competitor, uses the word, so **counsel must sign off**; fallback "Sequence". See `naming-targeting-and-campaigns.md` §6. |
| IVoD (interactive video on demand) | **Interactive Clip** | Generic. |
| Label | **Tag** | Generic. A content label on tale groups, matched against the tags the host passes at runtime. Dashboard section label "Targeting tags". Never called "segment". |
| Segment (include/exclude strings on groups) | **Segment** | Generic industry term (Braze, CleverTap, Klaviyo); keep. In TaleArt a segment is a dynamic, rule-based group of end users (API `segments`). |
| Audience (uploaded CSV) | **User list** | API `userLists`. An uploaded static list of end users matched by external user ID. Generic; Google Customer Match uses the same name. "Audience" is kept only as the dashboard heading of the targeting section, not as an entity. |
| Sub user | (no separate entity) | An end user is known by an external user ID; a user list holds external user IDs. "Member" is retired. |
| Custom parameter | **External user ID** (API `externalUserId`) | Generic (Braze, OneSignal use "external ID"). Replaces "external user key": a key sounds like a secret, and TaleArt already has a "site key". |
| Custom parameter (as user data) | **User attributes** (SDK `setUserAttributes`, API `attributes`) | Key/value data about an end user, used by segment rules. Generic (MoEngage, Customer.io). Avoid "traits" (Segment) and "custom parameter" (Storyly). |
| Group `ts_start` / `ts_end` across many groups (no entity) | **Campaign** with a **Schedule** (`startsAt` / `endsAt`; UI "Start date" / "End date") | A thin, optional container in the Google and Meta sense: name, goal (a conversion event), a set of tale groups, and a schedule window. "Promotion" is reserved for offers and promo codes. |
| Collections (filtered product-feed list) | **Product set** (API `productSets`) | A saved filter over a product feed, used to auto-build shoppable tale groups. Avoids Storyly's "Collections" and a clash with Shopify collections. Descriptive (Meta also uses it). |
| Interactive components (Poll, Rating, Quiz, Emoji Reaction, Countdown, Product Tags, Promo Code) | Keep names | Generic UI element names. "Product Tags" may be renamed to "Product Pins" to reduce overlap. |
| Placement token | **Site key** (one per project, `tas_…`) plus the zone's **slug** | Zone keys (`tak_…`) were removed on 2026-10-22 (owner decision, story 8.7); a page places a zone with the project's site key and the zone's slug (8.6). |
| Story status (ACTIVE, PASSIVE, ...) | Define TaleArt's own statuses | Storyly's meanings are undefined (see research §7.1). |
| Conversion event | **Conversion event** | Generic. |
| Open Rate | **Open rate** | Generic metric. |

## TaleArt core entities (draft)

- **App**: a customer's application.
- **Zone**: one spot in an app or site, with at most one Display (or a Journey), named on a page by its slug. Placed with the project's site key.
- **Display**: how a zone looks (bar, banner, card-deck, feed, canvas) and its settings; "frame" in the API and code.
- **Template**: a preset picked when creating a zone (display and settings), not stored as a link.
- **Site key**: the project's one key for host pages.
- Retired in the UX rework: **Stage** (each became a zone), **Playbook** (became templates), **Zone key** (removed 2026-10-22).
- **Tale Group**: up to 100 tales.
- **Tale**: full-screen media (image, GIF, video, or interactive clip). Carries interactive components.
- **Interactive component**: Poll, Rating, Quiz, Emoji Reaction, Countdown, Product Pins, Promo Code.
- **Journey**: a multi-step sequence that shows different content over time or by behaviour. A common noun, never branded; counsel sign-off pending (fallback "Sequence").
- **Tag**: a content label on a tale group (not on a tale), matched against the tags the host passes at runtime. Dashboard label "Targeting tags".
- **Segment**: a dynamic, rule-based group of end users, built from user attributes.
- **User list**: an uploaded static list of end users, matched by external user ID.
- **User attributes**: key/value data about an end user, passed by the SDK (`setUserAttributes`).
- **External user ID**: the end-user identifier the host passes (`externalUserId`).
- **Campaign**: an optional container with a name, a goal (a conversion event), a set of tale groups and a **Schedule** (`startsAt` / `endsAt`). Not a promotion: **Promotion** is reserved for offers and promo codes.
- **Product set**: a saved filter over a product feed, used to auto-build shoppable tale groups.
- **Conversion event**: an action attributed to tales or zones (TaleArt will key this to content, unlike Storyly).

## Rules

1. No Storyly brand names in code, UI, or docs. Import tooling may refer to "Storyly" as a source system.
2. Keep generic industry terms (segment, user list, campaign, journey, conversion, open rate). "Audience" is only a dashboard section heading, not an entity name.
3. Record each name's origin in this file before using it in code.
