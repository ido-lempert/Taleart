---
type: research
subject: Naming for TaleArt targeting and campaign concepts
date: 2026-10-20
status: draft, legal review required
---

# Naming: targeting and campaigns

**Goal:** use the words marketers already know, and avoid competitor brand names (Storyly first). **This is a naming aid, not legal advice.**
**Sources:** all URLs were accessed on 2026-10-20. Most findings come from search-result extracts of the vendor docs. Pages marked † come from a third party or an older version of the docs.

## 1. Content targeting label (now "tag"; proposed "segment")

| Vendor | Term and meaning | URL |
|---|---|---|
| Storyly | **Label**: a string set on the group in the dashboard and matched at runtime through `setLabels`. AND/OR rules apply. | https://docs.storyly.io/docs/using-labels-to-distribute-your-stories-to-the-right-audience |
| Airship | **Tags**: metadata on a channel or named user. A message sent to a tag reaches every device that carries it. | https://docs.airship.com/guides/messaging/audience/segmentation |
| OneSignal | **Data tags**: key/value strings on a user, used to build segments. | https://documentation.onesignal.com/docs/add-user-data-tags |
| Braze | **Tags**: labels that organise campaigns, Canvases and segments. They are not used for runtime targeting. | https://www.braze.com/docs/user_guide/messaging/governance/tags |
| Braze, Customer.io, CleverTap, Klaviyo | **Segment**: a group of *users* defined by rules over their data. | see concept 2 |
| Amplitude, Mixpanel | **Cohort**: a group of users, either behavioural or static. This is analytics vocabulary. | see concept 2 |

**How the terms differ:**
- A *tag* or *label* is a free-form string on an object.
- A *segment* or *cohort* is a group of users, computed from rules or uploaded.
- An *audience* is the umbrella word for "who sees this". Meta, Google and Segment Engage use it.
- *Attribute-based targeting* means rules over user key/values (concept 4).

TaleArt's concept is a string on content that the host matches at runtime. That is a tag. Calling it "segment" would make marketers expect a user group built from rules.

**Recommendation:** keep **Tag** (API `tags`). In the dashboard, call the field **"Targeting tags"** so users do not mistake them for Braze-style tags that only organise content. Alternative: **Label**, but avoid it because it is Storyly's exact term. Brand risk: none. **Do not use "segment" here.**

## 2. Dynamic, rule-based group of users (now "segment"/"audience", undecided)

| Vendor | Term | URL |
|---|---|---|
| Braze | Segment | https://braze.com/docs/user_guide/get_started/users_and_segments/ |
| Customer.io | Data-driven segment | https://docs.customer.io/journeys/segmentation/ |
| CleverTap | Segment | https://docs.clevertap.com/docs/create-segments |
| Klaviyo | Segment (dynamic) | https://developers.klaviyo.com/en/v2023-08-15/docs/introduction-to-klaviyos-data-model |
| Insider | Segment (attributes, events and lists) | https://academy.useinsider.com/docs/architect-terms-to-know |
| Iterable | Dynamic list, built with the Segmentation tool | https://support.iterable.com/hc/en-us/articles/115000770906-Importing-User-Lists- |
| Segment (Twilio) | Audience (Engage) | https://www.twilio.com/docs/segment/engage/using-engage-data |
| Amplitude / Mixpanel | Cohort | https://amplitude.com/docs/analytics/create-cohorts, https://docs.mixpanel.com/docs/analysis/advanced/cohorts |
| Storyly | "Segments" exist in the API as include/exclude strings on groups, with no rule builder. | teardown §3 |

**Recommendation:** **Segment** (API `segments`), the most common engagement-platform term. Alternative: **Audience**. Brand risk: none. "Segment" is also Twilio's product name, but the word is used generically across the industry.

## 3. Uploaded static list matched by user ID (now "audience")

| Vendor | Term | URL |
|---|---|---|
| Meta | Customer list Custom Audience | https://www.facebook.com/business/help/170456843145568 |
| Google Ads | Customer list (Customer Match) | https://support.google.com/google-ads/answer/6379332 |
| Iterable | Static list | https://support.iterable.com/hc/en-us/articles/115000770906-Importing-User-Lists- |
| Klaviyo | List (static) | https://developers.klaviyo.com/en/v2023-08-15/docs/introduction-to-klaviyos-data-model |
| Customer.io | Manual segment, filled by CSV or API | https://docs.customer.io/journeys/segmentation/ |
| CleverTap | Custom list segment | https://docs.clevertap.com/docs/custom-list-segments |
| MoEngage | File segment | https://www.moengage.com/docs/user-guide/segment/create-segments/file-segments.md |
| Amplitude | Static cohort ("Import from CSV") | https://amplitude.com/docs/analytics/create-cohorts |
| Airship | Audience list (SFTP) | https://docs.airship.com/guides/messaging/audience/segmentation |
| Storyly | Audience: a CSV matched to the custom parameter | https://docs.storyly.io/docs/having-custom-audience-for-story-groups |

**Recommendation:** **User list** (API `userLists`). It is generic, and Google's Customer Match API calls the same object a *user list*. Alternative: model it as a **Segment** whose type is `list` (the CleverTap, MoEngage and Customer.io pattern).

Keep **Audience** as the dashboard heading for the targeting section, where users choose tags, segments and lists. Do not use it as an entity name: in the industry it is a broad umbrella word, and as an entity it would copy Storyly's "Audience" object. Brand risk: low.

## 4. Key/value data about a user, passed by the SDK (not named yet)

| Vendor | Term | URL |
|---|---|---|
| Braze | Custom attributes | https://braze.com/docs/user_guide/get_started/users_and_segments/ |
| Customer.io | Attributes | https://docs.customer.io/journeys/segmentation/ |
| MoEngage | User attributes | https://moengage.com/docs/user-guide/data/imports/file-based-imports/import-user-data-using-csv |
| Insider | Attributes | https://academy.useinsider.com/docs/architect-terms-to-know |
| Airship | Attributes (tags with operators) | https://www.airship.com/docs/developer/sdk-integration/web/segmentation/ |
| Amplitude | User properties | https://amplitude.com/docs/data/user-properties-and-events |
| Mixpanel | User profile properties | https://docs.mixpanel.com/docs/data-structure/user-profiles |
| CleverTap | Profile properties | https://developer.clevertap.com/docs/user-profiles-android |
| Klaviyo | Profile properties † | https://www.nudgify.com/how-to-create-a-profile-property-klaviyo/ |
| Segment (Twilio) | Traits | https://www.twilio.com/docs/segment/connections/spec/identify |
| OneSignal | Data tags | https://documentation.onesignal.com/docs/add-user-data-tags |
| Storyly | Custom parameter (one string) | https://docs.storyly.io/v2.0/docs/migrating-to-sdk-20 |

**Recommendation:** **User attributes** (SDK `setUserAttributes`, API `attributes`). Alternative: **User properties**. Avoid "traits" (associated with Segment) and "custom parameter" (Storyly). Brand risk: none.

## 5. End-user identifier passed by the host (now "external user key")

| Vendor | Term | URL |
|---|---|---|
| Braze | `external_id` | https://braze.com/docs/user_guide/get_started/users_and_segments/ |
| OneSignal | External ID (`external_id`) | https://documentation.onesignal.com/docs/en/aliases |
| Segment (Twilio) | `userId` | https://www.twilio.com/docs/segment/connections/spec/identify |
| Amplitude | `user_id` | https://amplitude.com/docs/apis/analytics/identify |
| Iterable | `userId` | https://support.iterable.com/hc/en-us/articles/217744303-User-Profile-Fields-Used-by-Iterable |
| Customer.io | `id` (with system `cio_id`) | https://docs.customer.io/journeys/identifying-people/ |
| Mixpanel | `distinct_id` | https://docs.mixpanel.com/docs/data-structure/user-profiles |
| CleverTap | Identity | https://developer.clevertap.com/docs/concepts-user-profiles |
| MoEngage | ID (customer ID) | https://developers.moengage.com/hc/en-us/articles/4405027805844-File-Segment-API |
| Airship | Named user | https://docs.airship.com/guides/messaging/audience/segmentation |
| Storyly | Custom parameter | https://docs.storyly.io/docs/connecting-clevertap-audiences-with-storyly |

**Recommendation:** **External user ID** (API `externalUserId`). Alternative: **User ID**. Change it from "key": a key sounds like a secret, and TaleArt already has "zone key". Brand risk: none.

## 6. Multi-step sequence over time or by behaviour (the user suggested "user journey")

| Vendor | Term | URL |
|---|---|---|
| Iterable | Journeys (renamed from Workflows) | https://support.iterable.com/hc/en-us/articles/4405798856212-Journeys-Overview- |
| CleverTap | Journeys | https://docs.clevertap.com/docs/journeys |
| OneSignal | Journeys | https://documentation.onesignal.com/docs/en/journeys-overview.md |
| Airship | Journey, made of Sequences and Scenes | https://www.airship.com/docs/guides/features/orchestration-experimentation/journeys/ |
| Klaviyo | Flows | https://help.klaviyo.com/hc/en-us/articles/115005054847 |
| MoEngage | Flows | https://moengage.com/docs/user-guide/flows-cross-channel-messaging/getting-started/overview-flows/overview-flows |
| Customer.io | Campaigns (automations) and workflows | https://docs.customer.io/journeys/types-of-campaigns-and-broadcasts/ |
| Braze | **Canvas** (branded) | https://www.braze.com/docs/user_guide/get_started/campaigns_and_canvases |
| Insider | **Architect** (branded) journeys | https://academy.useinsider.com/docs/architect-terms-to-know |
| Storyly | "Journeys" for conditional story sequences, and "Flows"/"Smart Flows" for widget bundles | teardown §11.2, §11.8 |

**Recommendation:** use **Journey** for the multi-step sequence. Alternative: **Sequence**.

At least four vendors use "journey" as a generic noun, so it passes the "generic word" rule. Rules for using it:
- Always use it as a common noun ("a journey").
- Never brand it ("TaleArt Journeys", "Tale Journeys").
- Keep **Playbook** for a different concept: a preset bundle of frames, which Storyly calls a Flow.

This reverses the terminology map's earlier decision to drop "Journey". Counsel should confirm, because Storyly, a direct competitor, uses the word. The fallback is "Sequence".

## 7. Time-boxed marketing push (no entity yet)

| Vendor | Term and scope | URL |
|---|---|---|
| Google Ads | Campaign, with "start and end dates" | https://support.google.com/google-ads/answer/2404203 |
| Meta | Campaign, then ad set, then ad | https://www.facebook.com/business/help/170456843145568 |
| Google Merchant Center | Promotion, with `promotion_effective_dates` (an offer) | https://support.google.com/merchants/answer/13836990 |
| Braze | Campaign = a single-step send | https://www.braze.com/docs/user_guide/get_started/campaigns_and_canvases |
| Klaviyo | Campaign = a one-time scheduled broadcast | https://help.klaviyo.com/hc/en-us/articles/115005054847 |
| Ad operations | "Flight" / "flight dates" = when a campaign runs † | https://twilio.com/docs/sendgrid/glossary/flighting-in-advertising |
| Storyly | No campaign entity. Groups carry `ts_start`/`ts_end`. | teardown §3 |

**Does TaleArt need it?** Yes, as a thin optional entity: name, goal (a conversion event), start and end, and a set of tale groups. It gives marketers one reporting unit for a "summer sale" and lets them schedule many groups at once. Without it, they fall back on tags. A tale group can keep its own start and end inside the campaign window.

**Recommendation:** **Campaign**, in the Google and Meta sense of a top-level container with a goal. Call the date window **Schedule** (fields `startsAt`, `endsAt`; UI "Start date" / "End date"). Alternative for the window: **Flight dates**, which is media-buyer jargon and less familiar to product managers.

Keep **Promotion** for the offer or promo-code component, as Google Merchant Center uses it. Brand risk: none.

## 8. Saved filter over a product feed (now "collection")

| Vendor | Term | URL |
|---|---|---|
| Meta | Product set: a filtered sub-group of a catalogue | https://en-gb.facebook.com/business/help/620275848114281 |
| Google Ads | Product groups (Shopping) and listing groups (Performance Max) | https://support.google.com/google-ads/answer/3517331 |
| Google Merchant Center | Custom labels 0–4, used as feed attributes to filter on | https://support.google.com/merchants/answer/6324473 |
| Shopify | Collection (manual or smart, rule-based) | https://help.shopify.com/en/manual/products/collections |
| Storyly | Collections: a filtered feed list for automated shoppable stories | teardown §11.7 |

**Recommendation:** **Product set** (API `productSets`). Alternative: **Collection**.

"Product set" means exactly "a saved filter over a catalogue", and it avoids two clashes:
- Storyly uses the same word, "Collections", for the same object.
- A merchant's Shopify collections may themselves become filter inputs, which would be confusing.

Brand risk: low. "Product set" is a Meta term, but it is descriptive.

## Proposed changes to TaleArt names

| Current | Proposed | Affects |
|---|---|---|
| Tag (user proposed "segment") | **Tag** (unchanged); UI "Targeting tags" | UI label only |
| Segment / Audience (undecided) | **Segment** (rule-based) | Data model, API, UI |
| Audience (uploaded list) | **User list**; "Audience" becomes the UI section heading | Data model (`user_lists`), API, UI, Storyly importer mapping |
| (unnamed) user key/values | **User attributes** | SDK (`setUserAttributes`), API, segment rule builder |
| External user key | **External user ID** | Data model, API, SDK, docs |
| Playbook (preset frames) | **Playbook** (unchanged) | none |
| (user journey) | **Journey**; fallback "Sequence" | New entity; terminology map rule to update after legal review |
| (none) | **Campaign** with a **Schedule** (`startsAt`/`endsAt`) | New entity, API, UI, reporting |
| Collection | **Product set** | Data model, API, UI, usage-audit attribution (teardown §11.7, §11.9) |
