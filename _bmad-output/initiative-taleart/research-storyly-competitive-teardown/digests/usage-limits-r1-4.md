# Digest: usage and quota limits (round 1, researcher 4)
accessed: 2026-10-20 | budget used: 8 tool calls, 2 Storyly pages read

## Findings
- claim: Story group may contain up to 100 stories; an IVoD story must sit alone in its own group; IVoD up to 30 minutes.
  source: https://integration.storyly.io/getting-started/core-concepts.html | publisher: Storyly (integration docs) | pub_date: unknown | confidence: high (fetched) | class: limit
- claim: Display durations: image and GIF stories 7 seconds; video stories 15 seconds.
  source: https://integration.storyly.io/getting-started/core-concepts.html | publisher: Storyly | pub_date: unknown | confidence: high (fetched) | class: limit
- claim: Free package allows 5 story groups; Starter package has no stated cap. Plan-tier-linked, flagged, not a general limit.
  source: https://docs.storyly.io/docs/shpfy-faq | publisher: Storyly | pub_date: unknown | confidence: low (search snippet only, not fetched) | class: limit
- claim: docs.storyly.io index lists User Guides (Story Bar, Banner, Video Feed, Swipe Card, Canvas, Flows, Shoppable Content, Targeting and Personalization, Analytics), SDK guides (Android, iOS, React Native, Flutter, Web), an MCP server, and a "Storyly External API" (app, instance, story-group, story, audience, segment endpoints). No limit or quota text.
  source: https://docs.storyly.io/ | publisher: Storyly | pub_date: unknown | confidence: high (index only) | class: other
- claim: External API pages likely hold rate-limit text; not retrieved (index exposed no links).
  source: https://docs.storyly.io/ | confidence: low | class: api

## Not found
- API rate limits: searched twice, results were Storyblok (different CMS). Not documented in pages read.
- Analytics or event retention: searched once, results were other products. Not found.
- MAU, event, impression, or end-user quotas: not found.
- Limit-reached behavior (throttling, 429, overage): not stated in pages read.
- Slides per story, placements per app, audience or workspace caps: not found.
- Pricing or plan limits page: out of scope, not fetched.
- https://www.storyly.io/documentation returned 404.

## Leads
- Storyly External API reference (docs.storyly.io): rate-limit headers or 429 text.
- Storyly Analytics section (Analytics Mapping, Dashboard Reports): retention text.
- Shopify FAQ (docs.storyly.io/docs/shpfy-faq): confirm the 5-group cap (plan-linked).
- SDK pages (Android, iOS, Web): media limits.

## Caveat
Only two Storyly-owned pages were read. Most rate-limit and retention questions remain open.
