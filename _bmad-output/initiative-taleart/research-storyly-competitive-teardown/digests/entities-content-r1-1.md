# Digest: Storyly entities and content model (round 1, researcher 1)
accessed: 2026-10-20 | 6 pages fetched + search snippets | all sources undated (pub_date unknown) | publisher: Storyly

## Entities and hierarchy (Q1)
- claim: View hierarchy is Instance -> Story Group -> Story. An instance is a Storyly view on an app page with a unique token; created in App Settings; the API lists but does not create instances. | source: https://integration.storyly.io/getting-started/core-concepts.html ; https://docs.developers.storyly.io/ ; (instance creation: search snippet of https://docs.storyly.io/docs/creating-placements) | confidence: high | class: entity-model
- claim: Story group = up to 100 stories; has id, title, icon, index (bar position), seen/unseen state; status (integer), optional ts_start/ts_end, segments and settings JSON; optional dark-mode cover; no expiry unless end time set. | source: core-concepts; https://docs.storyly.io/reference/createstorygroup ; https://docs.storyly.io/page/creating-a-story-group-from-scratch | confidence: high | class: entity-model
- claim: Story = full-screen media of type image, GIF, video, or IVoD (interactive/shoppable video). Has id, title (defaults to group title), optional internal name, media component, index, seen state. Durations: 7 s image/GIF, 15 s video, up to 30 min IVoD. IVoD sits alone in a single-story group. | source: core-concepts | confidence: high | class: entity-model
- claim: Placement is distinct from instance: a location in an app or site (homepage, PDP, category page) holding one widget or flow, or none ("No Widget"). Requires unique name, app, platform; one token per platform. | source: https://docs.storyly.io/docs/creating-placements | confidence: medium | class: entity-model
- claim: "Showcase app" is a preview tool: scan a QR code from the dashboard to preview stories. No link to placements or instances found. | source: search snippet of https://docs.storyly.io/docs/preview-your-web-in-app-stories | confidence: low | class: entity-model

## Content structure and ordering (Q2)
- claim: Stories ordered by index within a group. Groups ordered dynamically by default; a fully-viewed group moves to the end unless pinned. Viewers resume at last unseen story. | source: core-concepts | confidence: high | class: entity-model
- claim: Inside a story: text (3 sizes; alignment, colors, highlight, bold, italic), stickers (uploads or GIPHY), and 7 interactives: Poll (question + 2 options); Rating (emoji drag-and-drop); Multiple Choice/Quiz (survey shows %, quiz marks correct answer, 2-4 answers); Emoji Reaction (3-5 emojis); Countdown (title, date, optional reminder); Product Tags (title, optional price, redirect URL, brand colors, icon; only interactive usable more than once per story); Promo Code (copyable sticker). CTA types: Button, Swipe Up, Custom Image CTA Button. | source: https://docs.storyly.io/page/adding-interactive-components-and-using-storyly-studio | confidence: high | class: entity-model
- claim: Stories are authored in the Studio as one media canvas with overlaid elements. Slide/page structure is NOT described; this is an inference. | source: same Studio page | confidence: medium | class: ui-only

## Identifiers (Q3)
- claim: API identifiers: app_id, instance_id (numeric, required on group create), story_group_id, story_id, sub_user_id (UUID), user_identifier (e.g. email), audience_id, audience_identifier (CSV column). Instance and placement tokens are SDK-side keys. Segments are string labels. | source: https://docs.developers.storyly.io/ ; createstorygroup | confidence: high | class: api
- claim: Auth: dashboard token (Settings > Account Settings) as `token` query parameter; base URL https://api.storyly.io/external; read and write; JSON bodies; multipart/form-data with JSON `data` field for uploads. | source: https://docs.developers.storyly.io/ | confidence: high | class: api
- claim: Create Story Group takes 9 multipart fields: instance_id (req), title (req, max 255), status (req, int), file, media_url, segments (JSON string), settings (JSON string), ts_start, ts_end. No index, pinned, or external-ID field. | source: createstorygroup | confidence: high | class: api
- claim: API resources: apps (list), instances (list), segments (list/create/delete), story-group (create/get/list/update/delete), story (create/get/list/update/delete), sub-user (create, get by user_identifier), audience (create/update from CSV, attached to sub user). Some may not match dashboard. | source: docs.developers.storyly.io | confidence: high | class: api
- claim: Docs errors: sub-user create example uses `/story` path; group create example uses `click_target_cap` but entity field is `clicked_target_cap`; example has `cta_macro` not in the entity table. Verify against live API before importing. | source: docs.developers.storyly.io | confidence: high | class: api
- claim: No external ID or slug for apps, instances, groups, stories, placements, or audiences found. | source: docs.developers.storyly.io ; createstorygroup | confidence: medium | class: api

## Audience and segmentation (Q4)
- claim: Labels are created under Settings > Data Management, set on a group's Audience section; SDK passes labels to match. AND labels: group shows only if all passed. OR labels: shows if any passed. No labels passed: all active groups show. Labels in use cannot be deleted. Lowercase recommended (case-sensitive). | source: https://docs.storyly.io/page/using-labels-to-distribute-your-stories-to-right-audience (search snippet); https://docs.storyly.io/docs/creating-a-story-group-from-scratch | confidence: medium | class: entity-model
- claim: Segments are string labels for include/exclude targeting on groups; API exposes list/create/delete; group `segments` JSON schema undocumented. | source: docs.developers.storyly.io ; createstorygroup | confidence: medium | class: entity-model
- claim: Audience built from CSV, attached to a sub user (UUID sub_user_id + user_identifier). A group can be type `audience` referencing an audience_id. Groups filterable by sub_user_id. CSV schema beyond audience_identifier not described. | source: docs.developers.storyly.io | confidence: medium | class: entity-model
- claim: Targeting configured in dashboard; SDK inputs are labels/segments passed in. No per-user content or event data model found. | source: labels guide (snippet) | confidence: low | class: other

## Not found
- Slide/page structure and story JSON schema.
- Ordering/index or pinned flags in the REST API (SDK StoryGroup has pinned; REST does not document it).
- External IDs, slugs, or custom keys for any entity.
- Placement-to-showcase-app or placement-to-instance mapping.
- Dates on any fetched page.
- Per-user data or event model.
- Plan limits: a 5-group Free cap appeared in a snippet, unverified (same as usage digest).

## Leads
- Analytics docs (discovering-story-story-group-analytics): metrics model and poll/quiz CSV export.
- Audience guide "Having Custom Audience for Story Groups": CSV schema, audience and sub-user model.
- Full API reference index: story and group update schemas, pinned/index fields.
- SDK placement pages (web, iOS, React Native): runtime use of labels and placement tokens.
- Android SDK classes (com.appsamurai.storyly: Poll, Quiz, StoryGroup): field names more reliable than marketing docs.
