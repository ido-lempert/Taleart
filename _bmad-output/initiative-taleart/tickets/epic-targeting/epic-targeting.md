---
type: epic
title: Tag and audience targeting
parent: initiative-taleart
id: 5
covers: [R5, R12]
sources: [_bmad-output/initiative-taleart/initiative-taleart.md, _bmad-output/initiative-taleart/prd-taleart/prd-taleart.md]
companions: [_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md, _bmad-output/initiative-taleart/research-another tool-competitive-teardown/naming-targeting-and-campaigns.md]
after: []
refined: true
risk: high
---

# Tag and audience targeting

## Description

Decides which tale groups a viewer sees. A tale group can be targeted by **targeting tags** combined with All (AND) or Any (OR), by **user lists** (uploaded CSVs of external user IDs, matched to the ID the host passes), and by **segments** (rules over **user attributes** the host passes to the SDK). "Audience" is the dashboard heading of the targeting section, not an entity (naming decision 2026-10-20).

Targeting narrows what the Delivery API and the SDKs show; it does not change whether content is "Visible on site" (epic UX rework R7), which stays a property of the content, the same for every viewer. When it is done:

- A group's Audience section holds its targeting tags with All or Any, its user lists and its segments. A group with none of them shows to everyone, as today.
- The host page tells the SDK who the viewer is: `setTags`, `setExternalUserId` and `setUserAttributes`, on the Web SDK and on the native SDK.
- User lists are stored as keyed hashes, never as raw IDs, and can be emptied, replaced or deleted, and one person's ID can be erased from every list of a project.
- User attributes never leave the viewer's device: tag and segment rules are evaluated in the SDK (AD-13). Only user-list matching happens on the server, from the external user ID.
- The dashboard says who a targeted group is for, and can preview a zone as a given viewer.

Already built (foundation story 1.5, importer story 2.8): tags per project (`tags`, unique by lower-cased name, 1 to 40 characters), tags on tale groups (`tale_group_tags`), the tag endpoints, the tag picker in the dashboard, and another tool labels imported as tags, all in `libs/server/targeting`. No match mode, user list, segment, user attribute or external user ID exists in code yet, and no SDK sends any viewer identity.

## Outcome

A content manager targets a tale group to viewers by tag, user list or segment, and a viewer on the sample page (and in the native sample app) sees only the groups that match, checked by the R5 test matrix.

## Requirements

R1 (parent R5; PRD FR-017): **Targeting tags combine with All or Any**
   A tale group's Audience section shows its targeting tags and a match mode: **Any** (OR, the default) or **All** (AND). The mode is stored per group in the targeting module and returned with the group by the Management API. A group copied or duplicated keeps its tags and mode. Tags themselves stay as built (project-scoped, case-insensitive names).
   Verify: set two tags and All on a group, reload: both and All are kept; copy the group to another zone: the copy has the same tags and mode.

R2 (parent R5; PRD FR-017, FR-018; research digest flows-audiences-conversion-r2-3, Labels): **The tag rule a viewer is matched by**
   The host passes the viewer's tags to the SDK. Matching ignores case and surrounding spaces. A group delivered by the Delivery API shows to a viewer when its tag rule passes:
   - the group has no tags: it passes;
   - the host passed no tags: it passes (every delivered group shows, as on the source platform);
   - Any: at least one of the group's tags is among the viewer's tags;
   - All: every one of the group's tags is among the viewer's tags.
   One rule function and one table of test cases live in `libs/contract`; the Web SDK, the native SDK and the dashboard preview use them (the native SDK runs the same table).
   Verify: the contract test table covers no group tags, no viewer tags, Any with one, none and all matching, All with one missing and all present, and case and space differences; each SDK passes the table, and the sample page shows exactly the expected groups for three viewer tag sets.

R3 (parent R12; PRD FR-019): **User lists from a CSV**
   A project's admin or editor creates a **user list** (name unique in the project, at most 100 lists per project) and uploads a single-column CSV (UTF-8, at most 50 MB, at most 1,000,000 rows). Each non-empty row, trimmed, is one external user ID of at most 256 characters with no control characters; matching is exact and case-sensitive. The upload reports added, already present, and refused rows (with the first refused line numbers). The dashboard warns, without refusing, when most values look like email addresses or phone numbers, and recommends opaque IDs. A list shows its name, its ID count, the groups it targets, and when it last changed; it never shows the IDs. The targeting module's public interface lets another module (the importer, story 2.12) create a list and add IDs to it.
   Verify: upload a 10-row CSV with a duplicate, an empty row and a 300-character value: the list shows 8 IDs and the report names the refused line; upload a CSV of emails: the warning appears and the list is still created.

R4 (parent R12; PRD FR-020): **Target a group to user lists by external user ID**
   A group's Audience section can name user lists and segments (R6). A group with any of them shows to a viewer only when the viewer's external user ID is in one of its user lists, or the viewer matches one of its segments, and its tag rule (R2) also passes. A viewer with no external user ID, or one in none of its lists, sees only groups with no user list (FR-020's "public content"), plus groups whose segments they match. The SDK sends the external user ID to the Delivery API in a request header, never in the URL; the Delivery API leaves out a group targeted only to user lists the viewer is not in, and marks a group the viewer is matched to by list, so the SDK need not know the lists.
   Verify: with a group targeted to list A, a viewer whose ID is in A sees it, a viewer not in A and a viewer with no ID do not, and the Delivery response for the latter two does not contain that group at all.

R5 (parent R12; AD-13; owner direction "privacy matters here"): **How user lists are stored and deleted**
   - **Stored as keyed hashes.** Each external user ID is stored only as HMAC-SHA-256 of the trimmed ID, keyed by a random secret generated per project and stored with the project. Raw IDs are never written to the database, a log, an error report, the import report, or any API response. The uploaded CSV is read as a stream and not kept.
   - **Not in the request path's traces.** The Delivery API reads the external user ID header, hashes it for the lookup, and drops it; it is not logged, not stored, and never put in analytics events (epic 6); a response to a request that carries one is `Cache-Control: private, no-store`.
   - **Deleted for real.** Deleting a user list removes the list and all its hashes in one transaction, with no soft delete, and removes it from every group's Audience. A list can be emptied, replaced by a new CSV, or have the IDs in a CSV removed. "Erase a person" removes one external user ID from every list of the project in one action and reports how many lists held it. Deleting a project deletes its lists. Database backups are the installer's to rotate; the docs say so.
   - **Targeting is not access control.** A group's content is not secret from viewers outside its audience; the docs say not to use targeting to protect content.
   Verify: after an upload, a database dump and the API logs contain no uploaded ID in clear; delete the list: no row of it remains; erase one ID: each list that held it is one smaller and the sample page no longer shows that viewer the list's groups; a Delivery request with an ID answers `no-store` and the API log has no trace of the ID.

R6 (parent R12; PRD Names; AD-13): **Segments from user attributes**
   A **segment** is a named, project-scoped rule over user attributes: a list of conditions joined by All or Any, each an attribute key, an operator (equals, does not equal, is one of, contains, greater than, less than, is set, is not set) and a value typed string, number or boolean. The host passes the viewer's attributes with `setUserAttributes`; they stay on the device. The Delivery API returns, with each group, its segments' rules, and the SDK decides (AD-13). A missing attribute fails every condition but "is not set". One evaluator and one test table live in `libs/contract`, used by every SDK and the preview. A segment in use cannot be deleted until it is removed from its groups, and the dashboard says which groups use it.
   Verify: a segment "plan equals pro AND visits greater than 3" shows its group to a viewer with those attributes and not to one with `visits = 2`; the browser's network log shows no attribute value in any request; deleting a segment in use is refused with the names of its groups.

R7 (parent R5, R12; epic UX rework R7): **The indicator says who a targeted group is for**
   Targeting does not make a group "Not visible": a targeted group that is delivered reads "Visible on site · for <audience summary>" ("viewers tagged summer or vip", "user list Loyal (1,204)", "segment Pro users"), on the group row, the group view and the Tale groups page, which also gets a "Targeted" filter. One reason is added to the visibility rule, because no viewer can match: **audience-empty**, when a group's audience is only user lists and every one of them holds no ID. Like every reason it is one clause in `delivery-rule.ts`, so the Delivery filter and the indicator still agree.
   Verify: a group with tags reads "Visible on site · for viewers tagged …"; target it to an empty list only: it reads "Not visible: its user lists are empty" and the sample page shows it to nobody; the indicator-versus-Delivery unit test passes with the new case.

R8 (parent R5, R12): **Preview a zone as a viewer**
   On the zone page a content manager enters viewer tags, an external user ID and user attributes, and sees which of the zone's delivered groups that viewer would see, and for each group left out, why (tag rule, not in its lists, no matching segment). The preview uses the same rule functions as the SDKs; the attributes are evaluated in the dashboard and not sent, and the external user ID is sent to the Management API only for the list lookup, not stored.
   Verify: for the zone of the R5 test matrix, the preview lists, for each viewer row, the same groups the sample page shows.

R9 (parent R12; parent R10 native-ready): **The native SDK targets the same way**
   The native SDK in `libs/mobile-sdk` offers `setTags`, `setExternalUserId` and `setUserAttributes`, sends the external user ID in the same header, and evaluates tags and segments with a Kotlin port that passes the contract's test tables. User attributes are not sent and not persisted by the SDK.
   Verify: the shared test tables pass on the JVM and iOS targets; the Android sample app shows the expected groups for two viewers.

R10 (parent R5, R12; architecture AD-12): **Docs for targeting and its privacy**
   The docs app and the SDK READMEs explain tags with All and Any, user lists and their CSV, segments and user attributes, the external user ID (opaque, not an email), the SDK calls on web and native, the rule of R2 and R4, what TaleArt stores and how to delete it (R5), and that targeting is not access control.
   Verify: each SDK snippet in the docs, pasted into the sample page or app, shows the documented result; the privacy section names every stored item of R5.

## Constraints

- **No sensitive end-user data.** User attributes are never sent to TaleArt; tag and segment rules run in the SDK; only the external user ID is sent, and is stored only hashed in user lists. Source: AD-13.
- **One visibility rule.** Any targeting reason is a clause in `libs/server/tales/src/lib/delivery-rule.ts` read by both the Delivery filter and the indicator; viewer-dependent matching is separate from the reasons and never makes the indicator disagree with the site. Source: AD-6, epic UX rework R7.
- **Contract first.** Match mode, the Delivery group targeting fields, the header name, segment rule shapes and the rule functions with their test tables start in `libs/contract`. Source: AD-3.
- **Module owns its tables.** Match modes, user lists, their hashes and segments are tables of `libs/server/targeting`; other modules reach them through its public interface. Source: AD-1.
- **Project-scoped.** Every targeting table carries `project_id`; a group can only be targeted to lists and segments of its own project. Source: AD-4.
- **Names.** `tags`, `userLists`, `segments`, `setUserAttributes`, `externalUserId`; "Audience" only as a heading; no another tool names. Source: AD-12.
- **Web SDK budget** of 50 KB gzipped and 1.5 s p75 first content; Delivery reads p95 at most 300 ms. Source: architecture Quality Targets.
- **WCAG 2.2 AA** for the Audience screens and the preview. Source: architecture Quality Targets, NFR-007.

## Done when

- The R5 test matrix (no tags, Any, All, no viewer tags) returns the expected groups in the contract tests, on the sample page and in the native sample app.
- A user list CSV imports and matches a viewer by external user ID on the sample page, and a database dump holds no ID in clear.
- Deleting a list, replacing it, and erasing one person each leave no trace of the removed IDs in the database.
- A segment over user attributes shows its group to a matching viewer, and no attribute leaves the browser.
- Every targeted group in the dashboard says who it is for, and the indicator and the Delivery filter agree on the audience-empty case.
- The closing end-to-end suite runs the matrix in CI and once on the staging sample page, and the WCAG scan of the Audience screens is clean.
- Every story is merged to `main` and deployed to staging, where the sample page and the dashboard show targeting working.

## Boundaries

- Not in this epic: exclude rules ("not tagged", "not in list"); user lists fed from third-party tools (CleverTap, Braze and the like); event- or behaviour-based segments; A/B tests and frequency caps; campaigns and journeys (post-MVP); per-tale targeting (targeting is per tale group).
- Schedules and the On/Off status stay in epic UX rework and web zones; targeting never changes a stored status.
- Touch point: another tool audiences imported as user lists, importer story 2.12, through R3's interface; owner: epic-another tool-importer.
- Touch point: analytics events must carry no external user ID or attribute (AD-13); owner: epic-analytics.
- Touch point: `delivery-rule.ts` and the indicator, extended by one reason (R7); owner: epic-ux-rework (built).
- Must not change: what an untargeted group shows to anyone; what a page that calls none of the new SDK functions shows (only groups with user lists or segments disappear for it); the Delivery API's site key and slug contract; the SDK budget.
- Tracer path: story 1 runs a tag rule from the dashboard through the Delivery response to the Web SDK; stories 3 and 4 add the server-side list match on the same path; stories 6 and 7 add segments in the SDK.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R5, R12)
- prd — `_bmad-output/initiative-taleart/prd-taleart/prd-taleart.md`, section "Tags, segments, user lists and targeting" (FR-017 to FR-020)
- architecture — `_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md`, AD-1, AD-2, AD-3, AD-4, AD-6, AD-12, AD-13, data model, Quality Targets
- naming — `_bmad-output/initiative-taleart/research-another tool-competitive-teardown/naming-targeting-and-campaigns.md`, sections 1 to 5
- research — `_bmad-output/initiative-taleart/research-another tool-competitive-teardown/digests/flows-audiences-conversion-r2-3.md` (custom audience CSV, labels AND/OR) and `digests/entities-content-r1-1.md` (Q4)
- ux rework — `_bmad-output/initiative-taleart/tickets/epic-ux-rework/epic-ux-rework.md`, R7 (indicator), R10 (group row ⋯ menu)
- code — `libs/server/targeting` (tags), `libs/server/tales/src/lib/delivery-rule.ts`, `apps/api/src/http/delivery.router.ts`, `libs/web-sdk/src/lib/delivery-client.ts`, `libs/mobile-sdk/.../delivery/DeliveryClient.kt`

## Notes

- Decision (2026-10-20): names approved by the user: tag (dashboard label "Targeting tags"), segment (`segments`), user list (`userLists`, replaces audience and member), user attributes (`setUserAttributes`), external user ID (`externalUserId`, replaces external user key).
- Decision (2026-10-20): TaleArt stores no sensitive end-user data (AD-13); user attributes stay in the host's client, segments are evaluated in the SDK.
- Decision (2026-10-23, Sofia, refinement): the epic file's whole-epic gate on epic-web-zones is replaced by per-story `after` pins (1.5, 1.14, 3.1, 8.2, 8.6, 8.10, 8.14, 8.16, 9.2, 9.3); web zones and the UX rework are in review, so only those stories matter.
- Decision (2026-10-23, Sofia): tracer bullet is story 1 (tag match mode from the Audience drawer through the Delivery response to the Web SDK filter); the least certain story, user-list matching by external user ID with its privacy rules, follows as 3 and 4. Build order and lanes are in `tickets/tickets.toml`.
- Decision (2026-10-23, Sofia): a refactor sweep (11) and a closing end-to-end suite (12) close the epic, since R5's Verify is a test matrix.
- Waits on epic-web-zones and epic-ux-rework because: the zone, the Delivery response, the group row ⋯ menu and the indicator are what targeting extends (pinned per story).
- Waits on epic-native-mobile because: story 9 extends its Delivery client and zone composable (9.2, 9.3). Only story 9 waits on epic 9.
- Decision (2026-10-23, Sofia): the device visitor id of UX rework story 8.23 (header `X-TaleArt-Visitor`, owner decision) is a separate header from the external user ID and is never linked to it, stored with it, or used for targeting.
- Decision (2026-10-24, story 5.3 security review): until story 4 defines how the external user ID travels in its request header, user lists accept only ASCII IDs (a row with any other character is refused as `not-ascii`, "only ASCII IDs are supported for now"), so no uploaded ID can be one a header could never match. Story 4 must define the header's encoding (percent-encoded or base64url UTF-8) and decode it before `normalizeExternalUserId`; then non-ASCII IDs can be allowed. IDs match exactly: case counts and no Unicode normalization is applied.

- Decision (2026-10-24, story 4, unreviewed): the external user ID travels in `X-TaleArt-External-User-Id` as base64url (RFC 4648 section 5, no padding) of its UTF-8 bytes (`libs/contract/src/lib/external-user-id.ts`); the API decodes it strictly (canonical base64url, fatal UTF-8) before `normalizeExternalUserId`, so the `not-ascii` refusal of story 3 is lifted. A header that carries no valid ID reads as no ID, and any request with the header answers `private, no-store` with no ETag and never a 304. The SDK sends the header only while an ID is set, with `cache: 'no-store'`, and keeps the ID in memory only. The Delivery response marks a list-matched group `userListMatched: true` and leaves out a group with lists the viewer is in none of. A copy keeps its lists only within the project.
- Decision (2026-10-24, story 4 security review, coordinator): deleting a list never makes a group public. A group whose only list was deleted, and a copy to another project of a group with lists (or of a held group), is held hidden in the targeting module's `tale_group_audience_holds` and reads "Not visible: its user lists were removed" (reason `audience-removed`, one clause in `delivery-rule.ts`) until a person saves its Audience (its tags or its lists). The delete dialog says "Groups targeted only to this list will stop showing until you change their Audience." This adds a second targeting reason beside audience-empty.
- Accepted risk (2026-10-24, story 4 security review): `POST /delivery/v1/responses` (interactive components) accepts a response for any delivered tale and does not check the group's user lists; the external user ID is never sent there. Targeting is not access control (R5); the docs say so.

### Owner decisions to confirm

Made unattended on 2026-10-23 by Sofia; each is the pick I would defend, and each can be reversed before the story that carries it starts.

- Assumption (confirm, R2, stories 1 and 12): when the host passes no tags, every delivered group shows, tagged or not, as on the source platform, so imported content behaves the same; a group with no tags always shows. The stricter alternative (a tagged group never shows to an untagged viewer) is one line in the rule function.
- Assumption (confirm, R1): the match mode is per group, default Any. A per-project default was not chosen.
- Assumption (confirm, R2): tag matching ignores case, as tag names are unique ignoring case; user-list IDs match exactly, case included.
- Assumption (confirm, R2, R6, AD-13): tag and segment rules run in the SDK, so the Delivery response for tags stays the same for every viewer; only user lists are matched on the server. Consequence: the tags and segment rules of a zone's groups are readable by anyone with the site key.
- Assumption (confirm, R4): audiences combine as: tag rule AND (no lists and no segments, OR in one of its lists, OR matches one of its segments). Lists and segments are alternatives; tags narrow.
- Assumption (confirm, R5): external user IDs are stored as HMAC-SHA-256 with a per-project secret, never in clear, so the dashboard can show counts but never list or export the IDs; the source CSV is the team's own copy. A per-project secret in the database protects against dumps, logs and cross-project matching, not against an attacker who holds the whole database and can guess IDs; an installation-level secret can be added later.
- Assumption (confirm, R5, architecture AD-13 `[ASSUMPTION]`): the external user ID is not treated as sensitive, so it may be sent to the Delivery API (in a header, over TLS) and matched there. If the owner rules it sensitive, user-list matching would need the lists on the client, which would expose every ID to every viewer; I recommend keeping it on the server.
- Assumption (confirm, R5): anyone holding the public site key can test whether a given ID is in some targeted list by watching which groups come back. The docs recommend opaque IDs and say targeting is not access control; the dashboard warns on email-like and phone-like values but does not refuse them.
- Assumption (confirm, R3): limits are 100 lists per project, 1,000,000 IDs and 50 MB per CSV, 256 characters per ID; starting values, changeable later.
- Assumption (confirm, R6): segments are in this epic (R12 holds them, though the PRD has no FR for them) and come after tags and user lists (stories 6 and 7), so they can be cut without touching stories 1 to 5.
- Assumption (confirm, R7): targeting is not a "Not visible" reason; a targeted, delivered group reads "Visible on site · for …". The only new reason is audience-empty.
- Assumption (confirm, R8): the preview sends the typed external user ID to the Management API for the list lookup, unstored; attributes are evaluated in the dashboard.
- Open question (owner, not blocking): should "Erase a person" also be offered through the Management API for automation (a data-subject request pipeline)? Story 5 builds it as an endpoint with a dashboard action, so the answer only changes the docs.
