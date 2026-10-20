# Import mapping

What the importer reads from the Storyly External API and what it writes in TaleArt. Facts come from the research digests in `_bmad-output/initiative-taleart/research-storyly-competitive-teardown/digests/` (cited per row); every shape is checked against the live response before mapping (FR-029), and the real run (story 3) confirms or corrects this table.

## Source endpoints

Base `https://api.storyly.io/external`, multipart or JSON, read only. Auth is documented two ways: a dashboard `token` query parameter (digest entities-content-r1-1) and an HTTP bearer JWT (digests api-recipes-r1-3, content-state-endpoints-r2-1).

| Endpoint (read) | Used for | Source |
|---|---|---|
| list apps | the app picker; one app imports into one TaleArt project | api-recipes-r1-3 |
| list instances | zones | entities-content-r1-1 |
| list and get story groups (filter by instance) | tale groups | entities-content-r1-1, content-state-endpoints-r2-1 |
| `GET /story?story_group_id=` | tales | api-recipes-r1-3 |
| list segments; story group `segments` JSON | tags on tale groups | entities-content-r1-1 |
| list audiences | user lists | api-recipes-r1-3, flows-audiences-conversion-r2-3 |

There is no placement, label, flow, collection or interactive-component endpoint among the 18 reference pages (api-recipes-r1-3). No create, update or delete call is ever made against Storyly.

## Entity mapping

| Storyly | TaleArt | Fields carried | Not carried (reported as a difference) |
|---|---|---|---|
| App | the project the admin picks | — | app settings |
| Instance (placement) | zone | title → name | frame type (no widget type in the API); per-platform tokens |
| Story group | tale group | title → name, sort_order → position | icon / cover, pinned, settings JSON, `clicked_target_cap`, dark-mode cover |
| Story | tale | title, sort_order → position, media → media key via the storage port | deep_link, outlink, button_text, settings, target_cap, studio_image, thumbnail, IVoD length |
| Segment / label value | tag on the tale group | value → tag name | AND / OR match mode, unless the live response carries it |
| Audience | user list (targeting epic) | name, members if readable | members, if the API returns names only |
| Story status, ts_start, ts_end | status key and schedule (AD-6, web zones epic) | per the status table in the PRD addendum | — |
| Interactive component | the component of the same type (interactive components epic) | per type, if the live story response carries them | any type TaleArt lacks |
| Conversion events, stats | not imported | — | listed once in the report as "not imported by design" |

## Status table (approved, PRD addendum)

ACTIVE → `live`; future ts_start → `scheduled`; WAITING_MEDIA_IMPORT → `processing`; FAILED_MEDIA_IMPORT → `invalid-media`; PASSIVE → `paused`; PASSIVE_BY_STORY_GROUP → `blocked-by-group`; END_DATE_REACHED → `expired`; CAP_REACHED → `quota-reached`; ARCHIVED → `archived`. An unknown code is a difference and imports as `paused`.

## Known documentation errors to check live

`click_target_cap` vs `clicked_target_cap`; `cta_macro` in an example but not the entity table; the sub-user example's `/story` path (content-state-endpoints-r2-1, entities-content-r1-1).
