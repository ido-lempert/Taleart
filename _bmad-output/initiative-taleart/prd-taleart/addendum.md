# TaleArt PRD — Addendum

Technical detail and inputs for `bmad-architecture`. The PRD states what TaleArt does; this file records how it might, and what has already been decided.

## Decisions carried in from earlier work

| Input | Status | Source |
|---|---|---|
| PostgreSQL holds the data model; JSON columns hold widget settings | Proposed in the foundation epic, approved by the user | Epic `epic-platform-foundation`, Notes. The prototype in commit `cf5a425` is not a requirement source. |
| Dashboard uses user sessions; SDK uses a per-zone key | Proposed in the foundation epic, approved by the user | Same |
| Express API; Angular dashboard; Nx workspace | Existing repository scaffolds | `apps/api`, `apps/dashboard` |
| Status scheme for tales and tale groups | Approved | Research report §11.3 |
| Entity names | Approved | `terminology-map.md` |
| Conversion tracking | Dropped from another tool compatibility; TaleArt designs its own later | User decision. Conversion records are analytics history, not content, so the importer does not migrate them. |

## Platform-neutral model

- The model is shared by every client. Native SDKs read the same API, not a separate native schema (R10, C6).
- Widget types are data, not code paths in the schema. A new frame type adds a registry entry and a renderer, with no migration (FR-007).
- Every content item and zone stores its project identifier in a column on every table, not in a join, so usage metering can be added later without a backfill (FR-004, FR-030).

## another tool import mapping

Starting point, to be verified against the live API before use (FR-029):

| another tool | TaleArt |
|---|---|
| Story group | Tale group |
| Story | Tale |
| Placement / instance | Zone (with a stage) |
| Widget (Story Bar, Banner) | Frame (bar, banner) |
| Flow | Playbook (another tool's "Journeys" sequences map to Journey) |
| Label | Tag |
| Audience (CSV, sub user) | User list; external user ID |
| Collections | Product set |
| Interactive component | Interactive component of the same type |
| Story status (numeric) | TaleArt status (HTTP-based scheme, §11.3) |

another tool endpoints the importer reads (External API, bearer JWT): list apps, list instances, list and get story groups, list and get stories, list audiences, list segments, get story and group stats. another tool's documented field-name errors (`click_target_cap` vs `clicked_target_cap`; an undocumented `cta_macro`; a `/story` path in the sub-user example) are checked against the live response before the importer maps them.

## Status scheme (proposed, approved)

| TaleArt | HTTP | another tool equivalent |
|---|---|---|
| live | 200 | ACTIVE |
| scheduled | 202 | future start time |
| processing | 102 | WAITING_MEDIA_IMPORT |
| invalid-media | 422 | FAILED_MEDIA_IMPORT |
| paused | 403 | PASSIVE |
| blocked-by-group | 423 | PASSIVE_BY_STORY_GROUP |
| expired | 410 | END_DATE_REACHED |
| quota-reached | 429 | CAP_REACHED |
| archived | 404 | ARCHIVED |

`quota-reached` reuses the rate-limit code. The API must return a distinct error body for it, so clients can tell the two apart.

## Analytics

- another tool's current analytics separate widget performance from content performance. TaleArt follows the same split (FR-023).
- Metric names are another tool's (Reach, Impression, Click, Engagement Rate, CTR). TaleArt publishes its own definitions (FR-024). another tool keeps its definitions with its customer success team and does not publish them.

## Open technical questions for architecture

1. Authentication provider for dashboard sessions, or built-in sessions.
2. How zone keys are stored (hashed) and how keys are rotated without downtime.
3. Event pipeline for analytics: synchronous writes or a queue.
4. Storage of media files: local, object store, or pluggable.
5. Import concurrency and retry behavior against another tool rate limits, which another tool does not publish.
6. Multi-tenancy within one self-hosted install: one database per project, or a shared schema with a project column.

## Post-MVP inputs (not in the MVP build)

- Usage and storage metering events, written from TaleArt's own event stream, with project tags (FR-030).
- Audit log of status transitions and content edits, append-only.
- Export format for internal charging: CSV or JSON, per project and period.
