# Digest: content state model and endpoints (round 2, researcher 1)
accessed: 2026-10-20 | sources: llms.txt, reference pages (updatestory, updatestorygroup, getstories, getstorygroups, getstorystats, getstorygroupstats), useful-actions guide, developers home | all undated | publisher: Storyly

## Status values
- claim: Story-group status codes: 1 ACTIVE, 2 PASSIVE, 3 CAP_REACHED, 4 END_DATE_REACHED, 9 ARCHIVED; only ACTIVE shown by SDK. | source: https://docs.developers.storyly.io/ | confidence: medium (fetched summary, not verbatim) | class: entity-model
- claim: Story status codes: 1 ACTIVE, 2 PASSIVE, 3 PASSIVE_BY_STORY_GROUP, 4 END_DATE_REACHED, 5 CAP_REACHED, 6 WAITING_MEDIA_IMPORT, 7 FAILED_MEDIA_IMPORT, 9 ARCHIVED; only ACTIVE shown by SDK. Page spells WAITING_MEDIA_IMPORT. | source: same | confidence: medium | class: entity-model
- claim: Meanings beyond the SDK display rule are not defined. | source: same | confidence: medium | class: entity-model
- claim: Dashboard groups: Active, Inactive, Test, Waiting for Approval; stories: Active, Inactive. Groups inactive over 30 days are archived automatically. Inactive items hidden in app and web; archived found via Content filter. | source: https://docs.storyly.io/docs/useful-actions-on-stories-story-groups.md | confidence: high | class: ui-only
- claim: Dashboard guide does not define passive, passive-by-group, end-date, cap, or media-import states. Dashboard states (Test, Waiting for Approval) have no API counterpart on these pages. | source: same | confidence: high | class: ui-only
- claim: Status in GET responses and stats responses is a plain integer; reference pages do not name values. | source: reference pages | confidence: high | class: api

## Update endpoints
- claim: PATCH https://api.storyly.io/external/story: multipart/form-data, Bearer JWT. Fields: id (string integer; required by text, not schema), deep_link, file, media_url, name (max 255), title (max 255), sort_order, status, ts_start, ts_end. No read-only fields marked. Response: message and status. Partial-update implied, not stated. | source: https://docs.storyly.io/reference/updatestory.md | confidence: high | class: api
- claim: PATCH https://api.storyly.io/external/story-group: multipart/form-data, Bearer JWT. Required: id, status. Optional: file, media_url, pinned (boolean typed as string), segments (JSON string), settings (JSON string), sort_order, title (max 255), ts_start, ts_end. | source: https://docs.storyly.io/reference/updatestorygroup.md | confidence: high | class: api
- claim: Story PATCH requires id by description only; group PATCH marks status required on every update. | source: both | confidence: high | class: api

## Stats endpoints
- claim: GET /external/story/stats: app_id, instance_id, story_group_id, story_id (optional); ts_start, ts_end required (YYYY-MM-DD). Per-story objects with total, daily, weekly, monthly buckets. Metrics: impression, reach, click, click_impression, average_watch_length, close, complete, next, prev, share_count, shared_count. No definitions, units, time zone. | source: https://docs.storyly.io/reference/getstorystats.md | confidence: high | class: api
- claim: GET /external/story-group/stats: instance_id, story_group_id (optional); ts_start, ts_end required. Metrics: active_users, reach, share_count, total_click, total_complete, total_impression, total_open, total_skipped. No definitions. | source: https://docs.storyly.io/reference/getstorygroupstats.md | confidence: high | class: api

## Ordering, pinning, external IDs
- claim: Ordering = sort_order on story and group. Pinning = pinned boolean on group update and read only; absent on story schemas. No external ID on any page. Read schemas expose id, account_id, story_group_id, instance_id, app_id, user_id. | source: updatestory, updatestorygroup, getstories, getstorygroups | confidence: high | class: api
- claim: Read responses include ts_created and ts_updated ("YYYY-MM-DD HH:MM:SS", no timezone). | source: getstories, getstorygroups | confidence: high | class: api

## Not found
- Definitions of any status code; partial-update semantics stated explicitly; metric definitions; external IDs; any documentation last-updated date.
- Create and delete HTTP methods not verified this round.

## Leads
- Verify status enum against raw OpenAPI; check createstory.md status field.
- v2.0 reference path (docs.storyly.io/v2.0/reference/updatestorygroup) may differ.
