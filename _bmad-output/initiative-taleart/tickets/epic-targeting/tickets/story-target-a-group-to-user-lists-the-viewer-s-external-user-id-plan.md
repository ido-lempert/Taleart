---
title: "Target a group to user lists; the viewer's external user ID picks them"
type: 'feature'
ticket: '4'
created: '2026-10-24'
status: built
baseline_revision: 'a18e707'
route: 'full'
route_source: 'auto'
risk: 'high'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-targeting/epic-targeting.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-targeting/tickets/story-create-a-user-list-from-a-csv-stored-only-as-keyed-hashes-plan.md'
  - '{project-root}/libs/server/tales/src/lib/delivery-rule.ts'
  - '{project-root}/apps/api/src/http/delivery.router.ts'
  - '{project-root}/libs/web-sdk/src/lib/delivery-client.ts'
warnings:
  - 'The audience-empty clause in delivery-rule.ts (tales module) reads the targeting module''s tables `tale_group_user_lists` and `user_lists` by name: the targeting module depends on tales, so tales cannot import an SQL fragment from it without a cycle. It is the one place one module''s SQL names another''s tables; the epic constraint puts every targeting reason in delivery-rule.ts. A targeting migration test pins the names.'
  - 'Deleting a user list removes it from every group (epic R5); a group whose only list it was then shows to every viewer. The delete dialog names the groups it targets and says so.'
deferred:
  - 'The native SDK sends no external user ID yet: it needs a public setExternalUserId, a base64url encoder in common Kotlin and the shared test table, which is story 9 (the contract''s header and encoding are fixed here).'
  - 'Segments (stories 6, 7): the Delivery API still leaves out every group with lists the viewer is not in; with segments it will keep one that has segments too.'
  - 'Replace, Remove by CSV, Empty and Erase a person (story 5); the preview as a viewer (story 8).'
---

<intent-contract>

## Intent

**Problem:** story 3 stores user lists, but no group can use one and no viewer can be matched to one.
A content manager wants a group shown only to the viewers in a list, and the host page must say who
the viewer is without the ID leaking into URLs, logs, caches or the device's visitor id.

**Approach:** a group's Audience names user lists (targeting module table, Management API, drawer).
The Web SDK gains a page-wide `setExternalUserId(id | null)` and sends the ID in a request header
defined in the contract (base64url of its UTF-8 bytes). The Delivery API decodes it, hashes it with
the project's secret, probes the lists' hash index, drops it, leaves out the groups with lists the
viewer is in none of, marks the list-matched ones, and answers `private, no-store` with no ETag when
the header was sent. A group whose audience is only empty lists gets the one new Not-visible reason,
audience-empty, as one clause of `delivery-rule.ts`.

## Boundaries & Constraints

**Always:**
- Owner decisions, exactly: the ID travels in a request header, never in a URL; the Delivery API
  never logs or stores it, and answers `Cache-Control: private, no-store` to any request that sends
  the header; it is never linked to, stored with or keyed with the visitor id (`X-TaleArt-Visitor`);
  targeting is not access control (the docs say so); audiences combine as tag rule AND (no lists or
  segments, OR in one of its lists, OR matches a segment); the only new reason is audience-empty.
- The 5.3 review: the header's encoding is defined (base64url, RFC 4648 section 5, of the UTF-8
  bytes, no padding), decoded strictly before `normalizeExternalUserId`, and the temporary
  `not-ascii` refusal goes: uploads accept any ID of at most 256 code points without control
  characters. IDs match exactly (case counts, no Unicode normalization).
- A header that is not valid base64url, not canonical, not UTF-8, or decodes to an ID the lists
  refuse, reads as no ID (and still answers `no-store`). Error objects never carry the ID or the header.
- The match is an index probe: the HMAC-SHA-256 of the ID under the project's secret, looked up by
  the `user_list_ids` primary key `(user_list_id, id_hash)`; the raw ID never reaches the database.
- A group can be targeted only to lists of its own project (composite foreign keys, AD-4); deleting a
  list or a group removes the links (cascade).
- Shared caches never hold a per-viewer answer: every zone answer stays `private` and varies by
  `Authorization` and the ID header; with the header there is no ETag and no 304.

**Never:** the ID in a URL, a log line, an error, analytics, local storage or a cookie; a change to
the access module, the auth middleware (story 10.1) or Tale Studio (story 11.1); segments.

## Design

- **Contract:** `external-user-id.ts`: `EXTERNAL_USER_ID_HEADER = 'X-TaleArt-External-User-Id'`,
  `encodeExternalUserIdHeader(id)` and `decodeExternalUserIdHeader(value)` (strict base64url, at most
  1,366 characters, canonical, fatal UTF-8, then `normalizeExternalUserId`). OpenAPI:
  `TaleGroupUserList` (id, name, idCount), `TaleGroup.userLists`, `SetTaleGroupUserListsRequest`,
  `PUT /tale-groups/{id}/user-lists`, `UserList.taleGroups` ({ id, name }), optional
  `DeliveryTaleGroup.userListMatched` (true only when the viewer is in one of its lists), reason
  `audience-empty`. `audience.ts`: list wording ("user list Loyal (1,204)", "viewers tagged summer
  in user list Loyal (1,204)") and `isTargeted` counting lists. `visibilityReasonText`:
  "its user lists are empty".
- **Targeting module:** table `tale_group_user_lists` (group, list, project; keys into both with the
  project; cascades). `setTaleGroupUserLists`, `userListsForTaleGroups`, `copyTaleGroupUserLists`
  (same project only), `taleGroupIdsForUserLists`, `userListAudiences(db, projectId, groupIds,
  externalUserId | null)` → per group `{ targeted, matched }`.
- **Tales module:** one `audience-empty` clause in `GROUP_OWN_REASON_CLAUSES`.
- **API:** the route, groups returned with `userLists`, copy keeps lists in the same project, lists
  returned with the groups they target; Delivery reads the header (CORS allow-header), filters and
  marks, and sets the cache headers; the public media and font caches are cleared on a list change.
- **Web SDK:** `setExternalUserId(id | null)`: kept in memory, every element reloads, the header
  (and `cache: 'no-store'`) sent only while an ID is set; in-flight sharing keyed by it too.
- **Dashboard:** the Audience drawer's User lists fieldset (name and count, empty ones marked), the
  summary, the Audience page's "Targets" column and the delete dialog naming them.
- **Sample page:** a viewer ID field (and `#externalUserId=` in the fragment, never the query).
- **Docs:** a targeting section in the Web SDK README and the docs app: the call, the header,
  opaque IDs, what is stored, caching, not access control.

## Verify

Story verify line: with a group targeted to list A: a viewer in A sees it on the sample page, a
viewer not in A and a viewer with no ID do not, and their Delivery responses do not contain the
group; target a group only to an empty list: it reads "Not visible: its user lists are empty" and
nobody sees it; the indicator-versus-Delivery unit test passes with the new case; the request URL
and the API log carry no external user ID. Then the full lint/test/build run, `web-sdk:size`,
`web-sdk:types-check`, `sdk-sample:a11y`, `dashboard-e2e:e2e`, `dashboard-e2e:a11y` and
`mobile-sdk:test`.

</intent-contract>
