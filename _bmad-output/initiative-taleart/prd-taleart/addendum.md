# TaleArt PRD — Addendum

Technical detail and inputs for `bmad-architecture`. The PRD states what TaleArt does; this file records how it might, and what has already been decided.

## Decisions carried in from earlier work

| Input | Status | Source |
|---|---|---|
| PostgreSQL holds the data model; JSON columns hold widget settings | Proposed in the foundation epic, approved by the user | Epic `epic-platform-foundation`, Notes. The prototype in commit `cf5a425` is not a requirement source. |
| Dashboard uses user sessions; SDK uses a per-zone key | Proposed in the foundation epic, approved by the user | Same |
| Express API; Angular dashboard; Nx workspace | Existing repository scaffolds | `apps/api`, `apps/dashboard` |

## Platform-neutral model

- The model is shared by every client. Native SDKs read the same API, not a separate native schema (R10, C6).
- Widget types are data, not code paths in the schema. A new frame type adds a registry entry and a renderer, with no migration (FR-007).
- Every content item and zone stores its project identifier in a column on every table, not in a join, so usage metering can be added later without a backfill (FR-004, FR-030).

## Status scheme (approved)

| TaleArt | HTTP |
|---|---|
| live | 200 |
| scheduled | 202 |
| processing | 102 |
| invalid-media | 422 |
| paused | 403 |
| blocked-by-group | 423 |
| expired | 410 |
| quota-reached | 429 |
| archived | 404 |

`quota-reached` reuses the rate-limit code. The API must return a distinct error body for it, so clients can tell the two apart.

## Analytics

- Analytics separate widget performance from content performance (FR-023).
- Metric names are Reach, Impression, Click, Engagement Rate and CTR. TaleArt publishes its own definitions (FR-024).

## Open technical questions for architecture

1. Authentication provider for dashboard sessions, or built-in sessions.
2. How zone keys are stored (hashed) and how keys are rotated without downtime.
3. Event pipeline for analytics: synchronous writes or a queue.
4. Storage of media files: local, object store, or pluggable.
5. Multi-tenancy within one self-hosted install: one database per project, or a shared schema with a project column.

## Post-MVP inputs (not in the MVP build)

- Usage and storage metering events, written from TaleArt's own event stream, with project tags (FR-030).
- Audit log of status transitions and content edits, append-only.
- Export format for internal charging: CSV or JSON, per project and period.
