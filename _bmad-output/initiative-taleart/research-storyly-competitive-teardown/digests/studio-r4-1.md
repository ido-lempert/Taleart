# Digest: Storyly's story editor ("Studio") as the reference for Tale Studio (round 4, researcher 1)
accessed: 2026-10-21 | 29 pages fetched, 3 failed (404), 6 web searches | publisher: Storyly (docs.storyly.io, integration.storyly.io, storyly.io blog and changelog) unless a row says otherwise | most pages undated (pub_date unknown); dates are given where the page states one

Method and limits:
- Pages were read through a fetch tool that returns a model-written summary of each page, so the wording and figures here rest on that summary, not on the raw HTML. Everything below is paraphrased. No Storyly text is quoted and no screenshots were taken (PRD NFR-005).
- **verified** means the cited page states the claim directly. **inferred** means we derived it and no page states it. **gap** means no fetched page documents it. A gap does not prove the feature is missing.
- The Storyly brand appears here only because this is competitor research. TaleArt names follow the terminology map: tale for story, tale group for story group, zone for placement, and **Tale Studio** for our editor.

## Canvas, safe area and background

- claim: Storyly recommends designing story creatives at 1080x2160 or 1080x2400 px, which are taller than 9:16. Story group covers are square, 400 or 500 px. | source: https://docs.storyly.io/docs/creating-the-best-story-creative.md | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: Since 2024-01-11 the editor no longer needs fixed 9:16, 9:18 or 9:20 exports. Content fills common phone screens. | source: https://www.storyly.io/whats-new-in-storyly (changelog entry dated 2024-01-11) | publisher: Storyly | accessed: 2026-10-21 | status: verified
- claim: There are two media fits. "Fit" is the default and keeps the whole image, filling the leftover bands with a colour sampled from the image that the editor can adjust. "Fill" crops the edges instead. | source: creative guide above | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: Text, the main subject and interactive elements should stay inside a safe zone. A swipe-up call to action sits pinned at the bottom of the screen. No margins in pixels or percent are published. | source: creative guide above | publisher: Storyly docs | accessed: 2026-10-21 | status: verified (exact margins are a gap)
- claim: A blank story can have a solid background colour, chosen from a picker or entered as hex. Gradients are not mentioned. | source: https://docs.storyly.io/v2.0/docs/creating-blank-image-or-video-story-in-storyly-studio | publisher: Storyly docs (v2.0 path; the current path returned 404) | accessed: 2026-10-21 | status: verified (gradient is a gap)

## Media layers

- claim: The background can be an image or GIF uploaded from the computer, one or several files at once, each shown for up to 7 s. | source: blank-story page above; https://integration.storyly.io/ios/core-concepts.html | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: A story takes one video upload of up to 128 MB. The editor page sets no length limit, but the core-concepts page says videos play for 15 s. | source: same two pages | publisher: Storyly docs | accessed: 2026-10-21 | status: verified (the two pages disagree)
- claim: Interactive video on demand is streamed video of up to 30 min, alone in its own story group. | source: core-concepts page | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: A story group holds at most 100 stories. | source: core-concepts page; blank-story page | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: No list of accepted media formats is published. The API example shows `image/jpeg` and a PNG raw URL. | source: https://docs.storyly.io/reference/getstories.md | publisher: Storyly docs | accessed: 2026-10-21 | status: partly verified

## Elements placed on the canvas

- claim: Text comes in three preset sizes, each adjustable, with alignment, colour, an optional highlight background, bold and italic. | source: https://docs.storyly.io/docs/adding-interactive-components-and-using-storyly-studio.md | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: No font choice for story text is documented. Only the story group title typeface is customisable, as a widget design setting. | source: https://docs.storyly.io/docs/using-customizable-design-elements-on-story-groups-stories | publisher: Storyly docs | accessed: 2026-10-21 | status: gap (custom fonts for story text)
- claim: Authors upload their own stickers, and search GIPHY for GIFs to drag onto the story. | source: interactive-components page above | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: Emoji appear only inside the emoji reaction and rating components. A free emoji element is not documented. | source: same | publisher: Storyly docs | accessed: 2026-10-21 | status: verified (a free emoji element is a gap)
- claim: Shapes are not documented. | source: none | status: gap
- claim: Elements can be layered on top of each other, but no layers panel and no ordering, locking, hiding or grouping controls are described. | source: interactive-components page above | publisher: Storyly docs | accessed: 2026-10-21 | status: layering verified, controls a gap

## Calls to action

- claim: There are three kinds of call to action: a button, a swipe-up and a custom image button. The author selects one, opens Edit, and sets an action URL and a title. The URL can be a deep link into the app or an external site, and the host app handles it in its action handler. Button styling is not described. | source: https://docs.storyly.io/page/cta-handling | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: The story record also carries `button_text`, `outlink` and `deep_link` fields. | source: https://docs.storyly.io/reference/getstories.md | publisher: Storyly docs | accessed: 2026-10-21 | status: verified

## Interactive components (input for epic-interactive-components)

All rows: source https://docs.storyly.io/docs/adding-interactive-components-and-using-storyly-studio.md | publisher: Storyly docs | accessed: 2026-10-21 | status: verified.
- Poll: a question and two answers.
- Rating: a question, answered by dragging an emoji along a slider.
- Multiple choice: an opinion mode that shows percentages, and a quiz mode with one correct answer. Two to four answers.
- Emoji reaction: three to five emoji in a vertical or horizontal bar.
- Countdown: a title and an end date, with an optional reminder that has its own text and time.
- Product tag: a title, an optional price, a redirect URL, brand colours and an icon. It is the only component that can appear more than once in a story.
- Promo code: a code that the viewer copies with a tap, with a "copied" confirmation.
- Shared settings: each component has a size and a light or dark theme, and its title is optional. Each component has its own analytics in the dashboard.

## Templates, brand and automation

- claim: A gallery of ready-made designs for hand-made stories is not documented. "Template Studio" is a drag-and-drop builder for templates driven by a feed, with placeholders for images, prices and product page links. | source: https://www.storyly.io/post/template-studio-the-stress-free-way-of-automating-product-stories | publisher: Storyly blog | accessed: 2026-10-21 | status: verified (manual gallery is a gap)
- claim: Templates are built in the editor and filled with data at runtime by the SDK. | source: https://integration.storyly.io/ios/core-concepts.html | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: Automated shoppable stories come from two preset template sets, plus CTA text and brand primary and secondary colours. Eight stories are generated from collection items and refreshed every 24 h. | source: https://docs.storyly.io/page/creating-automated-shoppable-stories | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: Templates can fill from product feeds (Google Merchant, Facebook catalog, XML), from RSS, and from CSV audience fields mapped to placeholders. | source: https://www.storyly.io/news/a-major-update-on-web-stories-template-studio-audiences-and-feed-stories (undated) | publisher: Storyly blog | accessed: 2026-10-21 | status: verified
- claim: No brand kit is documented. Brand colours exist only inside automated templates, and widgets have light and dark colour values. | source: pages above | status: gap
- claim: Animations, transitions, undo and redo, a per-story duration setting, localisation of story text, and AI generation of stories inside the editor are not documented. One third-party listing (TrustRadius, through a search snippet) mentions "AI-powered automation" and says users find the editor easy but limited. | source: web search, third party, unverified | accessed: 2026-10-21 | status: gap
- claim: A personalised "Recommended For You" model ranks widget tiles from a product feed, dated 2026-04-27. It does not generate content. | source: https://www.storyly.io/whats-new-in-storyly | publisher: Storyly | accessed: 2026-10-21 | status: verified

## Editing workflow around a story

- claim: The editor previews several screen ratios. The dashboard previews on a phone through a companion app reached by QR code (with labels, audience simulation and test groups), and the web previews in a new tab or by QR code. | source: creative guide; https://docs.storyly.io/page/preview-your-web-in-app-stories | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: Story actions in the editor: delete, duplicate in one click, reorder, schedule a start and end, a display title kept apart from an internal name, and replacing the background. | source: https://docs.storyly.io/docs/actions-on-stories-you-can-take-on-storyly-studio.md | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: Content can be copied into the same or another widget, dated 2026-09-15. Stories can be copied to other instances or apps in one click, with editable calls to action. Product tag and countdown stories cannot be copied to web. Whether the layers carry over is not stated. | source: whats-new page; https://docs.storyly.io/page/importing-stories-from-other-apps-websites | publisher: Storyly | accessed: 2026-10-21 | status: verified (layer carry-over is a gap)
- claim: Stories can be imported from Instagram, TikTok and Google Drive, and designed in Canva. The output format of the Canva import is not stated. | source: docs pages creating-stories-from-instagram, tiktok-import, creating-stories-using-canva; whats-new page | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: Team roles are account owner, app owner and editor, with permissions per group. A "waiting for approval" group status exists, but no review flow is described. | source: https://docs.storyly.io/page/setting-up-your-team; https://docs.storyly.io/docs/useful-actions-on-stories-story-groups.md | publisher: Storyly docs | accessed: 2026-10-21 | status: verified

## Accessibility

- claim: An image story can carry alt text, set by clicking the story's name in the editor. It needs SDK 1.24.0 or later, and screen-reader support is English only. Screen readers announce the group position, title, seen state, pinned state, CTA labels and the share and close buttons. | source: https://docs.storyly.io/page/making-storyly-accessible-for-everyone | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- inferred: Alt text is per story, not per element. Text that is drawn into an image would be invisible to screen readers unless the SDK renders it live, and that is not stated. | status: inferred

## How editor output is stored and rendered (affects the importer)

- claim: The External API's story record is flat: id, title, name, status, type, media, media_raw, studio_image, mime_type, deep_link, outlink, button_text, sort_order, story_group_id, settings (nullable, no documented structure), target_cap, thumbnail and timestamps. It has no layer, element, component or locale fields. | source: https://docs.storyly.io/reference/getstories.md | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: Creating and updating a story through the API takes a single media file or URL plus title, status, group, type, name, order, deep link and times. Layers cannot be written. | source: https://docs.storyly.io/reference/createstory.md; https://docs.storyly.io/reference/updatestory.md | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- claim: Story groups carry `template`, `templates` and `detail` fields that are nullable and undocumented. | source: https://docs.storyly.io/reference/getstorygroups.md | publisher: Storyly docs | accessed: 2026-10-21 | status: verified (meaning is a gap)
- claim: Storyly's MCP server is a knowledge base for SDK integration. It has no tools for stories or layers. | source: https://docs.storyly.io/docs/storyly-integration-mcp-server.md | publisher: Storyly docs | accessed: 2026-10-21 | status: verified
- inferred: `studio_image` is probably a picture of the editor's overlay, or of the whole story, drawn by Storyly, with `media` holding the background. If so, an importer can bring a Storyly story across only as a background plus one flattened overlay image, and its text is not live. This must be checked on a real account (importer story 2.3). | status: inferred
- inferred: The SDKs probably draw interactive components natively, since components report per-component events with a tracking payload set in the editor (digest event-analytics-r2-2). Whether text and stickers are drawn natively or as an image is not stated. | status: inferred

## What the External API exposes for an importer (summary)

| Editor capability | Visible through the External API? |
|---|---|
| Background media (image, GIF, video) | Yes: `media`, `media_raw`, `mime_type` |
| A rendered editor image | Probably: `studio_image` (meaning inferred) |
| CTA (one link and its label) | Partly: `button_text`, `outlink`, `deep_link`. The CTA kind (button, swipe-up or image button), position and style are not exposed |
| Text, stickers, GIFs, element positions and order | No |
| Interactive components and their settings | No (no component fields or endpoint) |
| Alt text | No |
| Schedule, status, order | Yes: `ts_start`, `ts_end`, `status`, `sort_order` |
| Templates | Group `template` and `templates` fields exist, undocumented |

## Not found (gaps)

A layers panel with order, lock, hide or group controls; fonts for story text; text effects; shapes; gradients; a brand kit; animations and transitions; undo and redo; a per-story duration setting; localisation; AI story generation; a list of accepted media formats; how components are stored and drawn; any layer JSON in an API.

## Failed fetches

- https://docs.storyly.io/docs/creating-blank-image-or-video-story-in-storyly-studio.md (404, and 404 without `.md`; the v2.0 path was used instead)
- https://www.storyly.io/studio/ (404)

## Leads

- A real-account run (importer story 2.3) to learn what `studio_image`, `settings` and the group `template` fields hold.
- SDK payloads (the Delivery-side JSON the Storyly SDK receives) would show how components are encoded, but they are not part of the External API. Reading them is out of scope for the importer, which uses the External API only.
