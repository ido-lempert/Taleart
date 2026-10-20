# Digest: targeting, publishing, analytics (round 1, researcher 2)
accessed: 2026-10-20 | 5 pages fetched, 4 search-only, 1 404 (docs.storyly.io/docs/web-shoppable-stories) | undated unless noted | publisher: Storyly

## Placements (Q1)
- claim: Placement = named app location (homepage, PDP, category page), created with unique name, app, platform, optional widget ("No Widget" allowed); gets a token per platform. | source: https://docs.storyly.io/docs/creating-placements | confidence: high | class: entity-model
- claim: Placement token passed to SDK init as `token`; determines rendered placement, active widget type, content and rules at runtime. App does not hardcode widget type. | source: https://docs.storyly.io/docs/placement-web-initial-setup | confidence: high | class: api
- claim: Web placement is a host element (<storyly-placement>) rendering a runtime-chosen widget: Story, Banner, Swipe Card, Vertical Feed, Canvas, Story Bar. Render modes (in-list / in-app / full-screen) NOT described. | source: placement-web-initial-setup | confidence: medium | class: ui-only
- claim: Placement linked to a "Flow" (pre-configured widget set for a goal: discovery, conversion, retention, loyalty); Flow decides what appears and when; edited without app changes. Flow-token relationship not documented. | source: placement-web-initial-setup; snippet of docs.storyly.io/docs/introduction (unfetched) | confidence: medium | class: entity-model
- claim: Placement events: widgetReady (sizing), actionClicked (payload with url and payload). | source: placement-web-initial-setup | confidence: medium | class: api

## Targeting (Q2)
- claim: Audiences = lists of user identifiers, uploaded or imported from integrations (Braze, CleverTap, MoEngage, Iterable, Bloomreach), assigned to content; custom audiences are single-column CSVs matched against a custom parameter the app passes. | source: snippets of docs.storyly.io/docs/vf-android-targeting and having-custom-audience-for-story-groups (unfetched) | confidence: medium | class: entity-model
- claim: Labels are tags set on widgets (Settings > Data Management > Labels, then Audience step). SDK requests by segment or label combination; only related widgets shown. Label rulesets for rule-based audiences; labels in use cannot be deleted. AND/OR matching and how user labels are set NOT specified. | source: https://docs.storyly.io/docs/using-labels-to-distribute-your-stories-to-the-right-audience | confidence: high (label-widget relation); low (matching) | class: entity-model
- claim: Schedule per story group as start and end dates; no end date means live indefinitely. Target caps and audience filters editable after creation. | source: snippets of creating-video-feed-content and useful-actions-on-stories-story-groups | confidence: medium | class: entity-model
- claim: Flow/placement manages what, when, and to whom; placement config holds targeting context; userProperties and setLabels(labels) passed before init (VTEX example). Triggers, A/B or variants not documented in reachable pages. | source: placement-web-initial-setup | confidence: medium | class: api

## Publishing (Q3)
- claim: POST /external/story takes required title, type (int), status (int), story_group_id; optional name, file, media_url, deep_link, sort_order, ts_start, ts_end. No status enum values in spec; labels, caps, audience, placement absent. | source: https://docs.storyly.io/reference/createstory | confidence: high (fields); low (status meaning) | class: api
- claim: Developer API story statuses: active, passive, passive by story group, end date reached, cap reached, waiting for media import, failed media import, archived. Only ACTIVE stories displayed by SDK. | source: search snippet only (not fetched) | confidence: medium | class: api
- claim: Preview before going live: desktop/mobile web views from the Content page; mobile in-app preview via Storyly Showcase app QR scan. Going live = save as test, then bulk-set groups live (older, v2.0-era wording). | source: snippets of preview-your-web-in-app-stories and storyly.io blog how-to-create-web-stories | confidence: low-medium | class: ui-only
- Not found: explicit draft/published/version model with a publish action; version history; A/B variants.

## Analytics (Q4)
- claim: Analytics per story group (CSV export, date picker), per story within group (filterable by status), and per interactive component (polls, quizzes, product tags, countdown; CSV export). | source: https://docs.storyly.io/docs/discovering-story-story-group-analytics | confidence: high | class: entity-model
- claim: "Open Rate" = taps on the story group cover image, per group. CTR per story compared within a group, no formula. Impressions, clicks, responses per interactive, no definitions. | source: same page | confidence: high (Open Rate); low (others) | class: entity-model
- claim: Web SDK fires userEvent on story seen (impression, reach); clicking group icon fires openStoryGroup. React Native/Flutter onEvent receives group, story, component objects with event name (sample StoryImpression). Mobile dismiss/close event. | source: snippets of v2.0 web-analytics, react-native-analytics, iOS event-handling (unfetched) | confidence: medium | class: api
- Not found: documented completion or view event; placement- or widget-level analytics keys; reach/view definitions; conversion keying (page listed, unfetched).

## Leads
- docs.developers.storyly.io root (full status enum and other endpoints).
- docs.storyly.io/docs/conversion-attribution-tracking.
- docs.storyly.io/docs/introduction (flow concept).
- integration.storyly.io/ios/event-handling.html (full event list).
