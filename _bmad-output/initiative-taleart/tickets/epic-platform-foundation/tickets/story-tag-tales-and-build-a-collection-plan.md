---
title: "Tag tales and build a collection"
ticket: 5
status: blocked
blocked_at: "2026-10-20"
blocked_reason: "Intent gap: the story tags tales and builds a collection from tagged tales, but PRD FR-017 and the architecture ERD put tags on tale groups, and PRD FR-021 defines a collection as a filtered list of product-feed items, not tales. Needs the user to choose."
---

## Auto Run Result

- **Status:** blocked
- **Blocking condition:** intent gap. The story was written before the PRD and the architecture and conflicts with them.
- **Questions for the user:**
  1. Do tags go on tales, as this story says, or on tale groups, as PRD FR-017 ("assigns them to tale groups") and the architecture's entity diagram (`TALE_GROUP }o--o{ TAG`) say? Tags drive targeting: a tale group shows when the viewer's tags match.
  2. Is a collection a saved list of tales filtered by tag, as this story says, or a filtered list of products from a product feed, as PRD FR-021 says (used to build automated shoppable tale groups, FR-022)? If it is product-feed based, product feeds are not built yet, and the collection part may belong in a later epic.
- **Evidence:** `prd-taleart.md` FR-017, FR-021, FR-022; `architecture-taleart.md` entity diagram and module tree (`targeting/` owns tags, `collections/` owns collections and product feeds); entry 5 in `tickets.toml`.
- **No code changed.**
