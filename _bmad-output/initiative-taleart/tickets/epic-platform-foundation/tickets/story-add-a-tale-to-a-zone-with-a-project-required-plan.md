---
title: "Add a tale to a zone, with a project required"
ticket: 3
status: blocked
blocked_at: "2026-10-20"
blocked_reason: "Intent gap: the story adds a tale directly to a zone, but PRD FR-010 and the architecture ERD put every tale in a tale group (story 1.4). Also unclear whether the story includes media upload (FR-010: a tale is full-screen media). Needs Sofia and the user to re-slice stories 1.3 and 1.4."
---

## Auto Run Result

- **Status:** blocked
- **Blocking condition:** intent gap. The story was written before the PRD and the architecture, and now conflicts with them.
- **Questions for the user:**
  1. Does a tale belong directly to a zone, as this story says, or only to a tale group, as PRD FR-010 and the architecture's entity diagram say? If only to a tale group, stories 1.3 and 1.4 should be merged or swapped.
  2. Does this story include media upload (image, GIF or video through the storage port, AD-11), or is a title-only tale acceptable as the first slice?
- **Evidence:** `prd-taleart.md` FR-010 ("adds a tale to a tale group"); `architecture-taleart.md` entity diagram (`TALE_GROUP ||--o{ TALE`); entry 3 in `tickets.toml` ("adds a tale to a zone").
- **No code changed.**
