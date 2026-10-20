# Digest: Storyly Recipes and API surface (round 1, researcher 3)
accessed: 2026-10-20 | 7 distinct sources fetched | all undated | publisher: Storyly

## PREMISE CHECK
- NO "Recipes" section exists on docs.storyly.io. Closest: "User Guides" and "SDK Integration Guides" (Android, iOS, React Native, Flutter, Web). Source: https://docs.storyly.io/ (confidence high). The user's reference to Recipes is not matched by any public section found; to confirm with the user.

## Findings
- claim: External REST API at base https://api.storyly.io with endpoints under /external/... Resources: apps, instances, story groups, stories, audiences, segments. | source: https://docs.storyly.io/llms.txt | confidence: high | class: api
- claim: 18 External API reference pages: list apps; list instances; get/create/update/delete story group; get story group stats; get/create/update/delete story; get story stats; list/create/update audiences; list/create/delete segments. | source: https://docs.storyly.io/llms.txt | confidence: high | class: api
- claim: Story endpoints: GET /external/story?story_group_id= (required); POST /external/story (multipart/form-data; required title, story_group_id, status, type; optional file, media_url, deep_link, sort_order, ts_start, ts_end); PATCH /external/story. Create page documents no CTA or duration fields. | source: https://docs.storyly.io/reference/createstory.md ; getstories.md | confidence: high | class: api
- claim: Get-stories story object fields: id, title, media, media_raw, studio_image, mime_type, status, type, story_group_id, account_id, deep_link, outlink, button_text, sort_order, ts_created, ts_start, ts_updated, ts_end, name, settings, target_cap, thumbnail. Query params typed as strings even where numeric. | source: https://docs.storyly.io/reference/getstories.md | confidence: medium (model-summarized; may be incomplete) | class: entity-model
- claim: App object: id, token, title, category, store_type, store_id, account_id, is_inbox_story, settings, detailed_info. No story or instance objects in sample. | source: https://docs.storyly.io/reference/listapps.md | confidence: medium | class: entity-model
- claim: Auth: HTTP bearer with JWT; no scopes defined. Header name not stated (Authorization: Bearer presumed, not documented). | source: listapps.md ; createstory.md ; getstories.md | confidence: high for scheme, low for header | class: limit
- claim: JWT generation/rotation not documented. A snippet calls the placement token "the JWT token from the Storyly dashboard" (refers to SDK placement; may be a different credential). | source: listapps.md; docs.storyly.io search snippet | confidence: medium (snippet) | class: limit
- claim: Android SDK: STRPlacementDataProvider(applicationContext); STRPlacementConfig.Builder().build(token = "<placement_token>"); STRPlacementView + STRListener. Content "fetched at runtime" as server-driven config; endpoint not named. Identifier is a placement token. | source: https://docs.storyly.io/docs/android-placement-initial-setup.md | confidence: high for calls, low for fetch mechanism | class: ui-only
- claim: Android callbacks: onWidgetReady (width/height ratio), onVisibilityChange, onActionClicked (URL and payload). setTheme(STRTheme.DARK); dark mode also enabled in dashboard Widget Design page. | source: android-placement-initial-setup.md | confidence: high | class: ui-only
- claim: Storyly MCP server at https://mcp.storyly.io/sse: eight SDK-knowledge tools (guides, API reference, troubleshooting, search), no resources. Documentation server, not a content-management API. No auth described. | source: https://docs.storyly.io/docs/storyly-integration-mcp-server.md | confidence: high | class: api
- claim: Documented data movement is third-party or dashboard-based: import audiences from MoEngage; export audiences to MoEngage; import from TikTok; create stories from Instagram; dashboard report download; analytics to third-party platforms; CleverTap webhook setup. No generic import/export path. | source: https://docs.storyly.io/llms.txt (pages not fetched) | confidence: high that pages exist, low on details | class: other

## Not found
- Recipes pages (checked home, llms.txt, search).
- Bulk import/export for stories or groups; content JSON schema.
- Storyly-originated content webhooks (only CleverTap-specific).
- JWT generation, rotation, scopes, rate limits.
- Changelog or versioning for External API.
- SDK-facing content endpoint URL and response shape.
- Auth header name.

## Leads
- getstorygroupstats.md, getstorystats.md (analytics shape); updatestory.md (PATCH semantics).
- importing-audiences-from-moengage.md; clevertap-webhook-setup.md.
- initial-web-sdk-setup, placement-web-initial-setup (web SDK fetch pattern, unchecked).
- Storyly SDK repositories on GitHub (not searched): may reveal the real SDK content endpoint and JSON model.

## Budget
10 tool calls (1 ToolSearch, 2 WebSearch, 7 WebFetch).
