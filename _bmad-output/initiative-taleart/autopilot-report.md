# Autopilot report — foundation epic

Branch: `autopilot/foundation` (nothing pushed; `main` untouched). Started 2026-10-20.

## Summary

Updated 2026-10-20 evening, after the second run. Every foundation story that needs no outside input is built; the run stops here.

**Built (ready for you to try):**
- **1.1 Tracer**, **1.11 Align with the architecture**, **1.6 Frame types** — from the first run.
- **1.3 Tale groups and tales** — tales live only in tale groups; order kept.
- **1.14 Modern dashboard** (added on your request) — TaleArt's own design system, rail, project switcher, drawers, 9:16 tale cards.
- **1.12 Image and video upload** — local media storage behind a port; type sniffing; byte ranges for video.
- **1.4 Reorder** — drag and drop plus move buttons; one order request at a time per zone.
- **1.7 Passkey sign-in** — first user is admin; passkeys only; hashed session tokens.
- **1.13 Invitations** — one-time links (with Share and Copy); content managers see only their projects (403 otherwise).
- **1.5 Tag tale groups** — re-scoped by you: tags on tale groups; filter chips.
- **1.8 Zone keys** — issue, rotate, revoke; first Delivery API route `GET /delivery/v1/zone`.

**Dropped or moved:** 1.2 CI (local commits only, your decision). Collections became **product sets** and moved to the interactive components epic.

**Waiting for you:**
- **1.9 Staging demo** — needs a staging host, credentials and a way to deploy (CI was dropped). Or tell me to skip it.
- **1.10 Refactor sweep** — waits on 1.9. Deferred so far: a failed per-zone request marks the dashboard as API-down; body-parser 413/415 handling.

**Decisions you made this evening:** tales only in tale groups; first user admin, others by invitation, passkeys only; tags on tale groups; darker ember `#C73E1D` for filled buttons; names: Tag, Segment, User list, User attributes, External user ID, Journey, Campaign (with Schedule), Product set; SDK and dashboard theming is a web-zones requirement; parallel agents allowed.

**Assumptions to check:** invitations are 7-day one-time links with no mail server; invitees become content managers; one active zone key per zone; media limits 10 MB images and 100 MB videos; sessions last 7 days; reordering is off while a tag filter is on.

**How to review:** start `npm exec nx serve api` and `npm exec nx serve dashboard`, open http://localhost:4200, set yourself up as admin with a passkey, then follow each story's steps below. Everything is on `autopilot/foundation`; nothing is pushed and `main` is untouched.

## Stories

### 1.11 — Align the prototype with the architecture

- **Status:** built
- **Commits:** `b05cfd4` Story 11: align the prototype with the architecture
- **What changed:** project and zone routes moved to `/api/v1` behind the `access` and `zones` modules; `libs/contract` holds the OpenAPI 3.1 document and generated types; Nx tags enforce the module boundaries; errors use the standard body.
- **Assumptions made:** a `projectId` that isn't a UUID is treated as an unknown project; a malformed JSON body returns 400 `validation_failed`.
- **Not fixed (by review rule):** request bodies that are too large or wrongly encoded return 500 instead of a 4xx.
- **How to review:** start the API (`npm exec nx serve api`) and dashboard (`npm exec nx serve dashboard`), open `http://localhost:4200`, add a project and a zone, then try adding a zone without choosing a project: the API's own message appears.
- **Blocking condition:** none.

### 1.2 — CI runs tests and blocks merges that fail

- **Status:** blocked — waiting for you
- **Commits:** `f5e4c81` (status only; no code changed)
- **Why:** blocking a merge needs a hosted CI and branch protection on a remote repository. This repo has no remote, and the autopilot may not create one or push.
- **What you decide:** the CI host (GitHub Actions is the likely choice; `gh` is logged in as `ido-lempert`), and whether to create the GitHub repository with branch protection on `main`.
- **Knock-on effect:** story 1.8 (deploy to staging from CI) waits on this one.

### 1.3 — Add a tale to a zone, with a project required

- **Status:** blocked — waiting for you
- **Why:** the story conflicts with the PRD and the architecture. It adds a tale straight to a zone, but both documents say a tale belongs to a tale group (story 1.4). It also doesn't say whether uploading the tale's media is part of it.
- **What you decide:** whether tales live only in tale groups (then stories 1.3 and 1.4 merge or swap), and whether the first tale slice includes media upload.
- **Knock-on effect:** story 1.4 (organize tales into groups) and 1.5 (tags and collections) wait on this one.

### 1.6 — Pick a frame type for a zone

- **Status:** built
- **Commits:** `a869ddf` Story 6: pick a frame type for a zone
- **What changed:** each zone can hold frames; a frame's settings are checked against its type's schema; bar and banner are the two types; a new type is added with a registry entry and a schema file only.
- **Assumptions made:** bar and banner have no settings fields yet, and refuse any extra field; their fields come with the web zones epic. A type sent with surrounding spaces is accepted.
- **How to review:** start the API and dashboard, add a project and a zone, pick "Bar" for the zone and add it; it's listed under the zone after a reload. To see a new type: add an entry to `libs/contract/frame-types/registry.json` with a schema file, restart `npm exec nx serve api`, and it appears in the picker.
- **Blocking condition:** none.

### 1.7 — Sign in to the dashboard

- **Status:** blocked — waiting for you
- **Why:** sessions are decided (AD-9), but the account model isn't.
- **What you decide:** how accounts are created (first-run admin, sign-up, or invite); how people sign in (password or email link); what administrators can do that content managers can't; and whether a user belongs to one project or several.
- **Knock-on effect:** story 1.8 (zone keys) waits on this one.

## Story 1.3 — Create a tale group in a zone and add tales to it

- **Status:** built
- **Commits:** `cf0bbc9` re-slice of the foundation stories with the user's decisions; `30f6d10` story 3.
- **Assumptions:** a tale group belongs to one zone (the frame-to-tale-group display link comes later); a tale has a title only (media is story 1.12); a group holds at most 100 tales (FR-010), answered with 409 `tale_group_full`; group creation is serialized with a Postgres advisory lock, because the tales module may not lock the zones table (AD-1); deep imports such as `@taleart/server-zones/src/lib/frames` now fail lint everywhere.
- **Review in the dashboard:** under a zone, enter a tale group name and press "Add tale group"; in the group, add two tales; reload: both are listed in the order added.
- **Blocking condition:** none.

## Story 1.14 — Modern dashboard: app shell and design system

- **Status:** built (added on the user's request: "It needs to look like another tool not website from 90s")
- **Commits:** `8a48e94` new story; the story 14 commit after it.
- **Assumptions:** TaleArt's own identity (ember orange, Inter, own mark), another tool-like patterns only, no another tool assets or colors; filled buttons use a darker ember `#C73E1D` for WCAG AA contrast (awaiting the user's confirmation); no UI component library.
- **Review in the dashboard:** open http://localhost:4200, switch projects in the top bar, open a zone card, and create a zone, frame, tale group and tale from the drawers; try a phone-width window.
- **Blocking condition:** none. A follow-up review is recommended for three untested accessibility fixes.

## Story 1.12 — Upload an image or video to a tale

- **Status:** built
- **Commits:** `402aa44` story 12.
- **Assumptions:** accepted types JPEG, PNG, WebP, GIF (10 MB) and MP4, WebM (100 MB), checked against the file's first bytes; files go to `MEDIA_DIR` (default `.data/media`, gitignored); uploads are held in memory for now; no thumbnails or transcoding.
- **Review in the dashboard:** open a zone, click a tale card, choose an image and press Upload; reload and the card still shows it; try a PDF and see the error.
- **Blocking condition:** none.

## Story 1.4 — Reorder tale groups and tales

- **Status:** built
- **Commits:** `c9bd27b` story 4.
- **Assumptions:** reorder within the same parent only (no moving a tale to another group); an order request must list every child once (409 otherwise); drag uses `@angular/cdk`, with "Move earlier/later" buttons as the keyboard and single-tap alternative; order requests are sent one at a time per zone.
- **Review in the dashboard:** open a zone, drag a tale card by its grip, or use its arrow buttons; reload and the order is kept.
- **Blocking condition:** none.

## Story 1.5 — Tag tales and build a collection

- **Status:** blocked
- **Commits:** `e6bba66` blocked marker.
- **Blocking condition:** intent gap. The story tags tales and collects tagged tales; the PRD puts tags on tale groups (FR-017) and defines a collection as a filtered list of product-feed items (FR-021). Waiting for the user to choose.

## Story 1.7 — Set up the first admin and sign in with a passkey

- **Status:** built
- **Commits:** `fcb9f2f` story 7.
- **Assumptions:** WebAuthn with `@simplewebauthn` 14.x; RP ID `localhost` and origin `http://localhost:4200` by default (`RP_ID`, `RP_ORIGIN`); discoverable passkeys with user verification; sessions last 7 days; the dashboard calls the API through the dev proxy at `/api/v1`; role checks and project membership wait for story 13.
- **Review in the dashboard:** restart `nx serve api` and `nx serve dashboard`, open http://localhost:4200: the setup screen asks for name and email and creates a passkey; then sign out from the top bar and sign in with the passkey.
- **Blocking condition:** none. Docker stopped during the run and was restarted. The database `taleart_passkey_manual` from the manual test is left for the user to drop.

## Story 1.13 — Invite a user to a project

- **Status:** built
- **Commits:** `16f3045` the user's answers (tags on tale groups, darker ember, SDK theming); `72ad44b` story 13.
- **Assumptions:** invitations are one-time links shown once in the dashboard, valid 7 days; invitees become content managers of the invited project; admins see every project; a content manager gets 403 on other projects; inviting existing users, removing members and revoking links are later stories.
- **Review in the dashboard:** as admin, Projects → Invite on a project → Copy link; open the link in a private window, create a passkey; that user sees only the invited project.
- **Blocking condition:** none.

## Story 1.5 — Tag tale groups

- **Status:** built (re-scoped by the user: tags go on tale groups; collections wait for an answer)
- **Commits:** `3e1c267` story 5.
- **Assumptions:** tags belong to a project, 1 to 40 characters, unique ignoring case; setting a group's tags replaces the whole set; reordering is off while a tag filter is on; no renaming or deleting tags yet.
- **Review in the dashboard:** open a zone, press "Tags" on a tale group, create "summer", check it, Save; use the filter chips above the groups.
- **Blocking condition:** none.

## Story 1.8 — Issue, rotate and revoke a zone key

- **Status:** built
- **Commits:** `3335722` story 8.
- **Assumptions:** one active key per zone; key format `tak_…`, shown once, stored hashed; admin-only issue, rotate and revoke; Delivery API accepts only `Authorization: Bearer <key>`; `GET /delivery/v1/zone` returns the zone and its frames until the web zones epic adds published content.
- **Review in the dashboard:** open a zone as admin, "Issue key", copy it, then `curl -H "Authorization: Bearer <key>" http://localhost:3333/delivery/v1/zone`; rotate or revoke and call again (401).
- **Blocking condition:** none. Deferred: one failed per-zone request marks the dashboard as API-down (refactor sweep).

## Evening, part 3 — web zones, sharing and the importer (parallel agents)

- **Web zones 3.1 — sample web page shows a zone's bar:** built (`42ecf20`). Public media at `/media/{key}`, Delivery API returns tale groups and tales, `<taleart-view>` renders a bar; SDK 1.95 KB gzipped. Review: 5 patches, 1 deferred (SDK type declarations reference the unpublished contract package).
- **Foundation 1.15 — one tale group in several zones:** built (`13bf18a`). Zone placements, migration, place, remove, rename, "Also in", Tale groups page.
- **Foundation 1.16 — copy a tale group to another zone:** built (`6e3fd08`). Same or other accessible project; media shared; tags matched by name; replaced media is deleted only when unused.
- **Importer 2.1 — import a another tool app's zones and see the report:** built in a parallel worktree and merged. Jobs with owner and heartbeat, fake another tool server on port 4400, encrypted token deleted after the job. Deferred: re-import does not rename linked zones (importer story 7).
- **Merge:** four conflicts (app.ts, errors.ts, routes, test setup), resolved by keeping both sides; the merged tree passes lint, test and build for 12 projects (api 180 tests).

## Second parallel batch (2026-10-21)

- **Web zones 3.2 — full-screen viewer:** built and merged. Tap, keys, swipe, hold to pause; seen ring kept only in the visitor's browser; reduced motion respected (no autoplay or auto-advance); keys never leak to the host page. SDK 5.99 KB gzipped. Review: 12 patches. Follow-up: add axe-core as a devDependency so `sdk-sample:a11y` runs offline.
- **Web zones 3.3 — publish, pause and archive:** built and merged. Statuses on groups and tales (new content `draft`, existing rows `live`); Delivery and public media serve only live tales of live groups; media now revalidates (`no-cache`, 304 without reading storage); all migrations run under one advisory lock. Review: 5 patches, 1 rejected.
- **Importer 2.2 — tale groups and tales:** built and merged. Groups placed in their instance's zone at the source position; tales without media; no duplicates on re-run (lock-ordered link protocol, deterministic race test). Imported content arrives as `draft` until importer story 11. Review: 5 patches.
- **Merged tree:** lint, test and build pass for 12 projects (api 203, web-sdk 59).

## Third parallel batch (2026-10-21)

The user froze importer story 2.3 (real another tool run) until after the MVP. It is marked blocked, and the importer refactor sweep no longer waits on it. Stories 2.12 (audiences) and 2.13 (interactive components) still wait on it.

Built in parallel worktrees, reviewed, patched and merged into `autopilot/foundation`:

| Story | Merge | Review |
|---|---|---|
| Importer 2.4: watch an import's progress and see past imports | `Merge importer story 4` | 4 findings, all patched: a recovered job kept old progress; a failed first read never retried; the page ignored an import ID change in the address bar; no test for the re-claimed case |
| Web zones 3.5: edit bar settings in the dashboard | `c92b993` | 4 findings, all patched: the Delivery API now cleans stored settings field by field; the form shows the default for an invalid stored value; an emptied number field keeps its value; a field's error clears when the field changes |
| Web zones 3.4: schedule tale groups and tales | `5faa356` | 7 findings, 6 patched (half-typed dates, seconds kept, daylight-saving gap refused, "No schedule", "Remove schedule", tests for shared media and caching), 1 rejected as by design (a tale reads live while its group is outside its window) |

Verification on the merged tree: `nx run-many -t lint test build` passed for 12 projects (api 231 tests). The web SDK is 6.47 KB gzipped. Screenshots were sent to the user: the zone page with Live, Scheduled and Expired groups, the schedule drawer, the bar settings drawer, the bar on a phone, import progress, and past imports.

Assumptions to confirm with the user:
- Import history is for admins only, as starting an import is.
- Bar cover sizes are small 48 px, medium 64 px and large 80 px. The rounded square's corner radius is a quarter of the cover size.
- A schedule includes its start time and excludes its end time. Draft, Paused and Archived override the schedule. An expired group hides its tales. Copy to zone keeps the schedule.
- A group's `status` is now its status as read; the saved status is in `storedStatus`.
- Theme work belongs to stories 3.8 (per project) and 3.9 (override in the SDK settings), not 3.5.

Operational note: a dashboard dev server that had been running before the merges served old drawer templates, and both drawers showed empty. Restarting it fixed this.

## Fourth parallel batch (2026-10-21)

Built in parallel worktrees, reviewed, patched and merged into `autopilot/foundation`:

| Story | Merge | Review |
|---|---|---|
| Web zones 3.6: banner frame on the sample page | `48886bb` | 7 findings, all patched: a swipe swallowed the next keyboard or screen-reader activation; autoplay never resumed after reduced motion turned off; the play button could restart on the last slide without loop; the play button overlapped Next on phones (moved below the slides); focus went to the wrong frame after a reload; programmatic focus stopped autoplay; a missing two-bar test |
| Importer 2.6: check each record and list every difference | `5f05391` | 7 findings, all patched: text was cut before the token was removed, so part of the token could remain (the app name too); parent names were not bounded; work on hostile records was unbounded before the cap; distinct records merged in the dashboard; differences were not in reading order; closed groups still rendered every item |
| Web zones 3.14: tale group cover, still or animated | `176f99d` | 11 findings, all patched. Main ones: a cover of a live group placed in no zone was public (one shared "delivered group" check now serves both the Delivery API and `/media`); the video cover cap now applies before buffering; the saved frame could differ from the slider; controls stayed live during a recording; there was no cancel path; the drawer differed from the plan |

After the merges, `7d243c8` caps the height of the cover drawer's source video. A portrait video had pushed the clip preview out of view.

Verification on the merged tree: `nx run-many -t lint test build` passed for 12 projects (api 259, web-sdk 136 tests). The web SDK is 9.10 KB gzipped, and `sdk-sample:a11y` passes. In real Chromium, a recorded WebM video tale was turned into a still frame cover and then into an animated WebM cover, which shows animated in the bar on the sample page. The Odd shop import listed 22 differences. Screenshots were sent to the user.

Waiting for the user:
- whether content managers should see past imports;
- whether the bar sizes of 48, 64 and 80 px are OK;
- renaming Frame to Widget;
- whether the import report should list tale media, statuses, schedules and tags as "not carried yet" until stories 2.5, 2.8 and 2.11 (recommended: yes);
- banner slides have no visible caption; a slide shows the group's first tale's media.

Operational note: the dashboard dev server starts its own API with the default database when none is running, so the e2e API must start first.

## Fifth parallel batch (2026-10-21)

Built in parallel worktrees, reviewed, patched and merged into `autopilot/foundation`:

| Story | Merge | Review |
|---|---|---|
| Web zones 3.7: place a zone on a page with stages | `fbe2ef0` | 2 findings, both patched: an emptied key refilled itself; a stage pointing to a missing frame got the wrong warning |
| Web zones 3.8: set the project theme in the dashboard | `b736f45` | 7 findings, all patched. The main one: the defaults changed every existing embed (white background, system font). Unset values now keep the previous look: transparent background, the host page's font and text colour, and the old corner radius. Also patched: font keywords; the viewer's font shorthand; contrast pairs for the progress track and buttons; two-colour focus rings; save stores only changed fields; number fields; an end-to-end API test |
| Importer 2.5: copy tale media through the storage port | `779ec94` | Security review, 12 findings, all patched: an upload race that could delete a user's file; AD-7 (source ids only in `import_links`); dual-stack pinning; the guard now fails closed; IPv6 allows only `2000::/3` minus special ranges; allow-list entries must be `address:port`; DNS deadline; per-import budgets (5 GB, 60 min); full writes and fsync; handling when the commit outcome is unknown, plus a sweep; HTTPS tests; `.prettierrc` printWidth set to 120 |

Verification on the merged tree: `nx run-many -t lint test build` passed for 12 projects (api 306, importer 143, dashboard 187 tests). In real Chromium: the Theme page shows the contrast warning; the sample page with `stages=top,hero` shows the themed bar (solid blue ring, Georgia) and the banner; the Demo shop import copied Media 15/15. Screenshots were sent to the user.

Decisions made by the autopilot, open for the user to change:
- With no theme set, the look stays as it was before themes.
- The stage key is fixed once created.
- Media budgets per import are 5 GB and 60 minutes.

A committed self-signed test certificate and key for `media.test` (`libs/server/importer/src/lib/test-tls/`) is used only by tests.

## Sixth parallel batch (2026-10-21)

| Story | Merge | Review |
|---|---|---|
| Web zones 3.9: override the theme in the Web SDK configuration | `7081607` | 8 findings, all patched: the getter leaked the internal array (unchecked values could reach CSS); host arrays are now copied by index before checking (Proxy, iterator and sparse arrays); upgrade order (a script property wins over the attribute); `theme="null"` warns; warnings name the zone by key prefix only; the registry entry is deleted when cleared; JSDoc; a zone-key change used the wrong zone's override |
| Web zones 3.10: apply a playbook to a zone | `f2679e2` | 5 findings, all patched: a deadlock with a manual stage create (now `FOR NO KEY UPDATE`, one retry, then 409 `concurrent_change`); the conflict warning is announced; focus after apply is deterministic; frames keep their order (`clock_timestamp()`); a sample-page run for each playbook |
| Importer 2.8: import labels as tags | `416911d` | 9 findings, all patched: per-record cap; control characters are refused in tag names and shown as U+FFFD in report text (NUL had failed the job); deadlock-free ordered find-or-create; volume caps (including a 20 MB another tool response cap); counts match the differences; duplicate list records; the dashboard uses `MAX_TAG_NAME_LENGTH`; long lines; foreign-key errors told apart |

Verification on the merged tree: `nx run-many -t lint test build` passed for 12 projects (api 330, web-sdk 217, importer 171 tests). In real Chromium: the playbook drawer previews the "Promo banner" preset; applying it adds the banner frame and the `promo-banner` stage; the sample page renders the stage on a phone; the Demo shop import shows Tags 9/9.

Decisions made by the autopilot, open for the user to change:
- An element's own SDK theme override wins over the zone override.
- A zone holds one playbook; applying a different playbook is refused, and a playbook cannot be removed.
- Labels that differ only in case merge into one tag.
- A tag a person removes from an imported group is added back on the next import (story 7 may change this).

## Seventh parallel batch (2026-10-21)

| Story | Merge | Review |
|---|---|---|
| Importer 2.9: pick what to import before starting | `0f3401f` | Security-focused review, 7 findings, all patched: one overall preview deadline (30 s) enforced on reads already in flight; previews abort when the client disconnects and are capped (1 per user, 4 per process, 429 `preview_busy`); `selection: null` is refused; the key encoding must be canonical; progress labels types that were not picked; "and N more"; a long line. The signed selection key (HKDF-derived HMAC) held up |
| Web zones 3.11: first content within 1.5 s on Fast 4G | `fd7b9b8` | 12 findings, all patched: first-content work can be cancelled per render; marks only for content on the page; the zone mark once per element; canvas and motion-swapped covers go through the hold; a 1 s cap for still video covers; banner listeners; perf script cleanup and signals; a `_test` guard on the parsed connection string; seeded rows deleted after a run; serve.mjs 400 on a bad escape. Measured cold p75 is about 1.25 s (budget 1.5 s), and Delivery `GET /zone` is now private, no-cache, with an ETag |
| Importer 2.7: re-import updates instead of duplicating | `2da2db8` | 10 findings, all patched: lock order and `FOR NO KEY UPDATE` (deadlocks with manual create, place, copy and tag set); compare-and-set on tags; tag baseline vs caps; no removals reported after unreadable lists; current TaleArt names; "Untitled zone" instead of a source id; media same-bytes CAS; `movedAtSource`; removed labels reported on every run; no orphan baseline rows |

Verification on the merged tree: `nx run-many -t lint test build` passed for 12 projects (api 356, importer 229, web-sdk 246 tests). The import picker was screenshot in Chromium.

Decisions made by the autopilot, open for the user to change: an import never deletes anything; a person's edit always wins; a new source story takes its source position; a tag a person removed is not added again.

User decision (2026-10-21): add a **Tale Studio** epic to the MVP, so tales are edited with text, images, shapes, stickers, buttons and interactive components. The SDK renders them as live elements, not flattened images.

## Eighth batch (2026-10-21/22): Tale Studio starts

- **Tale Studio planning:** `4030cdf` and `4dc1fb5`. Epic 7 has R1–R18; architecture adds AD-15 (tale document model) and AD-16 (SDK document renderer); a cited studio research digest was added. User decisions: MVP; live elements; system fonts plus a font-family name or uploaded WOFF2 project fonts; contrast warns only; `studio_image` is not imported; starting limits accepted. Autopilot defaults the user may change: calls to action belong to Tale Studio; build order. Story 7.4 gained a text direction setting (`45e087a`) after a walk with Hebrew text.
- **Tale Studio 7.1, text element tracer** (merge `52287b8`): 19 review findings patched. Unicode safety (NFC; bidi overrides and lone surrogates refused; Hebrew and Arabic, isolates and ZWJ allowed), a Map registry, RFC 6901 pointers, touch selection, taps on the glyphs only, accessible names, consistent framing, validation memoised per revision, a case-insensitive body parser, and studio focus and limits. Walked in Chromium end to end with Hebrew and English text (studio → save → viewer).
- **Tale Studio 7.2, layers, background and safe areas** (merge `ea6f5bf`): 16 review findings patched. Row layout, `aria-invalid`, shortcuts redesigned (Alt+↑/↓, H, L, D, Delete or ⌫ on a Mac; matched on `event.code`), contextmenu handling, rotated-bounds snapping, a two-tone outline, the layers list as a WAI-ARIA grid with a roving tabindex, and the studio route lazy-loaded (initial bundle 669 → 637.5 KB).
- **Importer 2.10, 1,000 tales within 30 minutes** (merge `e4094c8`): retries with backoff and `Retry-After`, a shared 429 hold, bounded concurrency (8 media, 6 per host, 4 lists read ahead), report determinism, resume after a restart, `elapsedSeconds`, and the `api:import-scale` target. One review (12 findings) and one follow-up review (5 findings), all patched: stop on a lost claim, an ordered byte budget, per-hop host slots, the deadline starting only when a transfer starts, a DB pool of 20 with a cap on DB phases, and a backfill. Measured at factor 0.1: 25 s with injected failures (upper bound 4.2 min at real latency), 15 s without; re-runs about 5 s; about 200 MB peak.

Verification on the merged tree (`e4094c8`): `nx run-many -t lint test build` passed for 12 projects (api 382, importer 276, web-sdk 264 tests).

## Ninth batch (2026-10-22/23): Tale Studio core, web zones closed out

Merged into `autopilot/foundation`. Every story got an agent review (risky ones also a follow-up review), and all findings were patched.
- Foundation 1.10, refactor sweep (`fe8c9b6`): routes lazy-loaded, initial bundle 638 → 492 KB, deprecations cleared. Staging 1.9 is skipped for now (user decision).
- Web zones 3.12, accessibility review (`00894d4`): signed off by the user after the automated pass (123 checks, 8 fixes, RTL support). The manual screen-reader checklist is still open. Animated covers stop after 5 s. Captions and tale language are post-MVP.
- Web zones 3.13, refactor sweep (`17a4c82`): self-contained SDK types, `web-sdk:types-check`, a public-types drift test.
- Tale Studio 7.3, undo/redo/autosave plus draft and "Publish changes" (`901ba7e`, user decision). 7.4, text style with direction (`16e905c`). Contract entry points (`8bea2cb`, dashboard initial 490 KB). 7.17, project fonts (`ad7d3a0`: WOFF2 structure checks, `tale_fonts`, per-project caps). 7.5, images and video (`489b892`: `tale_media`, deletion guard, streaming uploads, 15 s cap). 7.6, shapes, stickers and emoji (`d2bba46`). 7.11, existing tales become documents (`e90bc09`): batched idempotent migration, `TALE_MEDIA_MIGRATION` flag, the `api:tale-media-rollback` script; the pixel comparison against the 489b892 SDK found 0 differences in 8 cases.
- Verification on `e90bc09`: `nx run-many -t lint test build` passed for 12 projects (api 487 tests). The latest screenshots show a migrated tale with a rectangle, Hebrew/English text and an emoji in the studio, published and shown on a phone.
- Incident: one agent run truncated tables in `taleart_test` (a `_test` database, allowed by the rules) by running the root vitest suite with the default `TEST_DATABASE_URL`.

### Next steps (handoff)
- Ready now: Tale Studio 7.7 (button, image button, swipe-up link). After it: 7.8 (element-type registry), then 7.9 (preview with the SDK renderer, including AD-16's deferred "studio mounts the SDK renderer" and pixel parity), 7.10, 7.12, 7.13, 7.14, 7.15 (accessibility review, including the web-zones dashboard scan), 7.16.
- Waiting for the user: the web-zones review ("web zones done" unblocks importer 2.11); the open questions in memory `user-review-gates`.
- How to continue: follow memory `autopilot-workflow` (worktree agents, review, merge, screenshots via SendUserFile).

## Tenth batch (2026-10-22): UX rework starts

- Owner decisions (2026-10-22): nobody uses the old zone keys, the `stage` attribute or the pre-rework SDK, so the epic drops R4 and story 8.7 becomes their removal; a duplicated tale (7.12) starts Hidden (`437f5c4`).
- **UX rework 8.1, group On/Off and tale Shown/Hidden** (merge on `autopilot/foundation`): contract mapping (`groupShownStatus`, `taleShownStatus`, `switchStatus`); new tales stored `live`, Off/hide store `paused`, blocked-by-group for draft or paused groups, delivery only with a published document (tales from before the step keep their old delivery); a run-once `migrateShownStatus` step (`tales_migrations` marker) makes draft tales in draft groups live, with Delivery byte-identical before and after; the importer maps another tool's status (active → Shown, otherwise Hidden); dashboard `ShowSwitch` (`role=switch`, state-neutral name, `aria-disabled` while saving). One review (11 findings) and one follow-up review (4 nice-to-have findings), all patched: migration locks draft groups `FOR SHARE`, per-tale savepoints, copies keep `created_at`, media upload does not publish over an unsaved Studio draft, stale refreshes dropped by sequence number.
- Verification on the merged tree: `nx run-many -t lint test build` passed for 12 projects (api 504, dashboard 373, server-tales 230 tests); `web-sdk:size` 21.69 KB gzipped; dashboard initial bundle 496.7 KB.
- Known: `sdk-sample:a11y-review` fails 3 of 204 checks (landscape full height, landscape contrast, R16 pixel diff at 1280x800); they predate 8.1 and come from the wide-screen viewer (`f752d74`).
- Incidents: the disk filled up (download caches cleared); a builder ran `pnpm` once, which reinstalled the shared `node_modules` in pnpm's layout (vite 8.3.5, webpack-dev-server 5.2.7); run `npm ci` when there is space.
- **UX rework 8.2, "Visible on site / Not visible: <reason>"** (merge on `autopilot/foundation`): one SQL clause per reason in `libs/server/tales/src/lib/delivery-rule.ts`; Delivery is "no clause true", the indicator lists the true ones, zone setup (a frame and an active key) is part of the same rule via fragments exported by the zones and access modules, one bound `now` per read. All 13 reasons of R7 plus zone codes `no-visible-groups` and `no-tale-groups`. Dashboard `VisibilityIndicator` (dot and text; reasons in a top-layer popover on hover, focus or press; Escape closes). An oracle test compares the pre-8.2 Delivery predicate row by row with the new one over 3,360 tales and 700 groups. Behaviour changes: a zone with no frame delivers no groups; revoking a zone's key makes its delivered media private until it has a key again. One review, 11 findings, all patched. Zones route lazy-loaded to keep the initial bundle at 493.9 KB.
- Verification on the merged tree: `nx run-many -t lint test build` passed for 12 projects (api 531, dashboard 388, contract 266 tests). The Nx local cache was cleared to free disk space.
- **UX rework 8.4, Tale Studio says "Update tale"** (merge on `autopilot/foundation`): "Publish changes" → "Update tale", "Discard draft" → "Discard changes", no "publish" left in the studio (a test scans the rendered studio); the status line uses the indicator's words ("Visible on site · up to date", "Not visible: group is off · 1 change not updated yet"), read from a new `GET /tales/{taleId}` (same per-tale authorization as the other tale routes) so it follows the server's rule; `changeCount` counts changed layers against the published version; the store's `refresh()` is single-flight; focus and tab-visible re-read the tale at most every 15 s. One review, 10 findings, all patched. Full verification passed on the merged tree; dashboard initial bundle 494.95 KB (about 5 KB headroom).
- **UX rework 8.5, one display per zone; stages fold into zones** (merge on `autopilot/foundation`): zones get a `slug` (unique per project; Hebrew names get `zone`, `zone-2`… and an "Edit name and slug" drawer) and at most one display (`frame` in the API, "Display" in the dashboard); `/frames` and `/stages` endpoints, the Stages card and the SDK `stage` attribute are gone; new `PATCH /zones/{id}`, `POST`/`PATCH /zones/{id}/frame` (type change resets settings; conditional update, 409 `concurrent_change`). Migration `foldStagesIntoZones` (one transaction, under the migration lock): each stage and each extra frame becomes its own zone with copied placements; the original zone keeps its id and key and takes its first stage's name; stage keys are kept as slugs where free (renamed ones are logged); `stages` dropped, `slug` NOT NULL, one display per zone. **Deploy note: stop every API instance before starting this release.** The SDK sample page places several zones with `?keys=a,b`; the a11y scan and review scripts were rewritten for the new shape. One review (10 findings) and one follow-up review (5 nice-to-have), all patched.
- Verification on the merged tree: `nx run-many -t lint test build` passed for 12 projects, `web-sdk:size` (21.53 KB) and `types-check` passed; the sample-page a11y scan is clean and a11y-review shows only the 3 known failures; perf p75 1.25 s.
- **Tale Studio 7.12, duplicate a tale with its document** (merge on `autopilot/foundation`): `POST /tales/{taleId}/duplicate` (same per-tale authorization; a target group of another project is refused); the copy is stored Hidden, titled "<title> (copy)", placed after the original or last in another group, with the published and draft documents copied under new element ids and the same media and font storage keys (rows recorded, so the deletion guards see the copy); a copy is a new tale (`created_at = now()`). Dashboard: a copy-icon button on tale cards and "Duplicate" in Tale Studio, sharing a drawer that preselects the first group with room. One review (no must-fix, 7 smaller findings), all patched. Full verification passed on the merged tree. Known flaky test: an autosave-timing test in `tale-studio.spec.ts` failed once under load.
- **UX rework 8.3, schedules stay out of sight until used** (merge on `autopilot/foundation`): no "No schedule" text; Schedule (and 7.12's Duplicate) live in a new reusable ⋯ `MenuButton` (WAI-ARIA menu button, top-layer popover, one menu at a time, disabled items with a reason, right-to-left aware); a chip shows a window ("Starts 1 Dec, 09:00", "Ends 3 Nov, 00:00", "Ended …"), the short form on tale cards and the whole window in the tale drawer; "Remove schedule" only when a window exists. One review (2 must-fix, 9 smaller), all patched; the dedupe of popover/positioning code is left for the refactor sweep (8.18). Full verification passed on the merged tree; dashboard initial bundle 494.3 KB.
- Incident: during 8.3's first browser check, `nx serve dashboard` started its own API on the dev database, which ran the 8.1–8.5 migrations there (the dev database now has zones with one display each). The user's dev server needs a restart on the current code.
- **UX rework 8.8, pick a template when creating a zone** (merge on `autopilot/foundation`): playbooks became templates (`libs/contract/src/lib/templates.ts`: Stories bar, Promo banner, Blank); `POST /zones` takes an optional `template` and creates the zone with its display in one transaction; `Zone.createdFromTemplate` (column `playbook_key` kept; old `home-stories-bar` notes renamed); the apply-playbook endpoint and Playbook card are gone; the New zone drawer has an accessible template radio group and hides the project picker when the user has one project; `inTransaction` is now exported by `@taleart/server-access`. One review (no must-fix, 6 smaller), all patched. Full verification passed on the merged tree; dashboard initial bundle 493 KB.
- **UX rework 8.6, project site key and zone slug** (merge on `autopilot/foundation`): one active site key per project (`tas_` + 256 random bits; SHA-256 hash and a short prefix stored; issue, rotate, revoke by admins; `GET|POST|DELETE /api/v1/projects/{projectId}/site-key`); Delivery answers `?zone=<slug>` with a Bearer site key, and every refusal (missing, unknown or revoked key, unknown or foreign slug) is the same 401; "installed" = an active site key or zone key, in the one SQL rule; Web SDK `<taleart-view site-key zone>`, shared requests per key and URL, `configureZone` accepts a slug, keys masked in warnings; a Site key card on the zone page (until the Install tab, 8.13) warns that the key opens every zone of the project. Hardening from two security reviews: a per-address token-bucket rate limit on `/delivery/v1` (LRU-capped, IPv6 grouped by /64, `DELIVERY_RATE_LIMIT_*`), strict `TRUST_PROXY` parsing, cache generation counters so a revoke takes effect at once, `no-store` on refusals and issued keys. Full verification passed on the merged tree (api 547 tests); perf p75 1.27 s; SDK 21.86 KB gzipped.
- Known flaky: an importer API test failed once when another process answered on its fake-another tool port.
- **UX rework 8.15, copy and small fixes** (merge on `autopilot/foundation`): the API-unreachable banner reads "We can't reach TaleArt. Retrying…" in a polite status region and a new `ApiReconnect` service retries with backoff (2–16 s, then 30 s; 15 s timeout per try; skipped while hidden or offline) and announces "Connected to TaleArt again." only after a real recovery; Tale Studio's keyboard help is a "?" disclosure, closed by default; the studio's back link names its group and returns to the zone the user came from (`?zone=`); "In every zone" became a disabled "Add to zone…" whose reason shows on focus and hover; no "frame" wording left in the dashboard. One review (no must-fix, 8 smaller), all patched. Full verification passed on the merged tree. **Dashboard initial bundle 497.2 KB: about 3 KB headroom left under the 500 KB budget.**
- **UX rework 8.9, zone page header, setup checklist and tabs** (merge on `autopilot/foundation`): header with the indicator, slug, template note and summary pills (Display, groups, Install); WAI-ARIA tabs Tale groups / Display (with "Style: project theme") / Install (Site key card), `?tab=` in the URL, keyboard moves replace history; a three-step setup checklist (display, site key, a visible group) whose links focus the control, with hints from group reasons and "Ask an admin…" for content managers; it shows until `zones.first_visible_at` is set (best-effort, on the first API read while visible). One review (1 must-fix, 10 smaller), all patched. Full verification passed on the merged tree.
- **Tale Studio 7.7, button, image button and swipe-up link** (merge on `autopilot/foundation`): three new element types with `props.href`; one URL rule (`linkUrlProblem`: absolute http/https only, ≤ 2,048 characters, no credentials, no control, invisible or bidi characters) used by the server, the studio and the SDK; real `<a>` links with `rel="noopener noreferrer"`, "(opens in a new tab)" in the name; at most one swipe-up link, pinned to the bottom safe area, opened by a flick up (< 500 ms, ≥ max(50 px, 8% of the stage)), click or Enter; auto-advance pauses while a link has focus; studio inspector with live URL check and warn-only contrast and small-target warnings; publishing needs an address and image-button alt text. Security review (no injection or bypass found) plus 11 interaction and a11y fixes, all patched; checked in WebKit with Playwright (a real iOS touch swipe is still unverified). Full verification passed on the merged tree; SDK 23.5 KB gzipped; perf p75 1.27 s.
- **UX rework 8.7, remove zone keys and the stage attribute** (merge on `autopilot/foundation`): zone keys are gone from the access module, the API, Delivery (one path: site key + `?zone=<slug>`, uniform 401 refusals), the contract, the Web SDK (`zone-key` now logs one warning), the dashboard and the sample page (`?zones=…#siteKey=…`; `?key=` shows a notice); `zone_keys` dropped under a lock timeout; issuing a site key also clears the public caches. **Deploy note: stop every API instance before starting this release.** The R16 visual guard now compares against committed baselines in `apps/sdk-sample/fixtures/r16-baseline/` (0 px difference in all 8 cases; the 1280x800 case was re-baselined on the wide-screen viewer by an autopilot decision the owner may change); the epic (R4 retired) and AD-2/AD-9 record the owner decision. One review (3 must-fix, 6 smaller), all patched. After the merge one 7.7 API test still used the removed zone-key helper; fixed on `autopilot/foundation`. Full verification passed; a11y-review now shows only the 2 known landscape failures; SDK 23.5 KB; perf p75 1.27 s.
- **UX rework 8.10, tale groups as a list with a switch and a ⋯ menu** (merge on `autopilot/foundation`): each placed group is one row (reorder handle and move buttons, cover, name as a disclosure, "n of m shown · max 100", tag pills, schedule chip, On/Off switch, indicator, ⋯ with Rename, Cover, Tags, Schedule, Show in another zone, Copy to zone, Remove from this zone, Archive/Restore; disabled items state their reason); Archive shows "<name> archived. Undo"; "New tale group" and a new "Add existing group" drawer below the list; closed groups render no tales (no media loads); rows stack at narrow widths. The server now refuses to place an archived group (409 `tale_group_archived`). One review (2 must-fix in the setup checklist's focus targets, 10 smaller), all patched. Full verification passed on the merged tree; dashboard initial 493.7 KB.
- **Tale Studio 7.8, register an element type by configuration** (merge on `autopilot/foundation`): `libs/contract/tale-document/element-types/registry.json` is the single source for server validation, the studio's Add menu and inspector (descriptors in `tale-element-types.ts`, a generic fields inspector for configured types) and the SDK renderer table (typed by the registry, so a type without a renderer doesn't compile); the generator checks and compiles every schema; a how-to in `libs/contract/README.md`. A test-only `test-badge` type is enabled only with `TALE_TEST_ELEMENT_TYPES=on` and `NODE_ENV=development|test` (the API refuses to start otherwise) and in dev dashboards; an SDK without its renderer skips it with one warning. Unknown stored types get a neutral inspector. One review (no production leak; 9 findings), all patched. Full verification passed on the merged tree.
- **Tale Studio 7.13, imported tales keep their call to action** (merge on `autopilot/foundation`): a source story's button text and http(s) outlink or deep link import as a `button` element at the bottom of the safe area (`setImportedButtonWhen` is the single gate: link rule and label rule); other links are listed by reason, never by value; a new tale gets a draft, and its published document is created only with its media, so a tale is never delivered as a button alone; an import writes the published document only while it is still exactly what the import made (fingerprints in the import record), otherwise only the draft ("not updated yet"); no second button to the same address; a person's edit or deletion wins; "text, stickers and components" became one count line in the report. One review (1 must-fix, 1 decision, 6 smaller), all patched. Full verification and `api:import-scale` (1,000 tales, 32 s) passed on the merged tree.
- Autopilot decision the owner may change: imports never change what visitors see on a tale a person has updated since the import; they update its draft.
- **UX rework 8.11, open a group to show or hide each tale** (merge on `autopilot/foundation`): a group opens in a modal group view (960 px drawer, full screen on phones; `?group=<id>`, Back closes it; background inert and scroll-locked; focus trapped and returned) with its switch, indicator and ⋯, and tale cards with a one-press Shown/Hidden switch, a status dot and a ⋯ (Edit in Tale Studio, Replace media, Schedule, Duplicate, Archive); drawers stack (Escape closes the top one); lazy images and videos that play only on screen; a refresh no longer reverts a pending reorder. One review (5 must-fix, 10 smaller), all patched. Full verification passed on the merged tree; dashboard initial 494.9 KB.
- **UX rework 8.14, zones list and Tale groups page show status, with filters** (merge on `autopilot/foundation`): a shared `group-row` component used by the zone page and the Tale groups page; filters All, Visible, Off, Scheduled, Not in a zone, Archived (`?filter=`, counts, archived only under Archived); a group's name opens its group view in its first zone; "New tale group" can create a group in no zone (`POST /projects/{id}/tale-groups`, names up to 100 characters); zone cards show display, group count and install state. The project group list is now light (counts instead of tales: 905 KB → 9 KB for 20 groups × 100 tales) and loaded only where needed. One review (2 must-fix, 11 smaller), all patched. Follow-up: a group in no zone cannot get tales yet; a per-project group cap.
- Verification on the merged tree: everything passed except one API auth test (`expires_at` minus `created_at`), which fails because the local Postgres clock runs about 14 minutes behind the host. Environment issue, not a code change; it passes once the database clock is synced. Dashboard initial bundle is close to the 500 KB budget.
- **UX rework 8.12, the tale drawer saves status at once and closes with Done** (merge on `autopilot/foundation`): status first (Shown/Hidden switch, Archive/Restore, saved at once and announced), "Replace media" uploads immediately with client checks, progress ("Uploading… n%", then "Saving…") and "Cancel upload"; one Done button (closing cancels an upload); controls stay focusable while busy (`aria-disabled`); hidden inputs are left out of the drawer's Tab trap. The shell's drawers are now `@defer`'d, which brought the dashboard initial bundle from 500.1 KB to 392.3 KB. One review (2 must-fix, 4 smaller), all patched. Full verification passed except the clock-skew auth test (local Postgres about 14 minutes behind).
- **Tale Studio 7.9, preview the tale exactly as the Web SDK renders it** (merge on `autopilot/foundation`): a workspace-only entry `@taleart/web-sdk/preview` mounts the SDK's own `TaleViewer` (subclass with protected hooks; the public SDK behaves as before) in a lazy studio pane at 375×667, 390×844 or 430×932, with chrome, play for the tale's duration, replay, a safe-area overlay, muted by default with a Sound switch; edits redraw in place (150 ms debounce; restarts 500 ms after the last edit); links are inert (no href) but focusable. `sdk-sample:preview-parity` compares the preview with the sample viewer: 0 differing pixels at 390×844 and 60 inside a 1440×1000 dashboard window (limit 329). One review (no security issue; 1 must-fix, 7 smaller), all patched. SDK 23.64 KB gzipped; studio chunk 217 KB raw; dashboard initial unchanged at 392 KB. Full verification passed except the clock-skew auth test.
- **UX rework 8.13, Install tab, snippet and test page** (merge on `autopilot/foundation`): the API serves the SDK at `/sdk/v1/taleart.js` (reloaded when rebuilt) and a pinned `/sdk/v1/taleart.<hash>.js` with an SRI hash; `GET /api/v1/install`; the Install tab shows the copy-ready snippet (`<script type="module">` + `<taleart-view site-key zone>`), and the key once right after issuing; "Open test page" opens a TaleArt-served page (strict CSP, noindex, key from the fragment or a pasted field, never stored or sent except as the Delivery Authorization header). Issue is conditional (`ifNone` → 409 `site_key_exists`), so a key is never rotated without confirmation. New `apps/dashboard-e2e` first-run test: sign-up to a visible tale in **15 actions** (its database must end in `_e2e_test`). First-run cuts (autopilot decisions the owner may change): the first project is created at setup ("My project"), New zone opens the new zone, a new tale group can take several files (one tale per file, checked before creating), and the first site key is issued without a confirm step (the "opens every zone" warning is on the tab). Security review (1 must-fix, 9 smaller), all patched. Full verification passed except the clock-skew auth test.
- Follow-ups: the pinned SDK URL serves only the current build (pinned pages must update their URL each release); there is no endpoint to delete a tale, so a tale whose upload failed is left Hidden.
- **UX rework 8.16, docs and README** (merge on `autopilot/foundation`): the docs app has prerendered pages (Getting started, Concepts, Install a zone, Stages and zone keys, a 404); the web-sdk README is rewritten for site key + zone; the snippet comes from one contract function used by the dashboard, docs and README; a docs check fails on retired wording; migration examples are checked against the API fold tests. One review (1 must-fix, 10 smaller), all patched. Full run: only `api:test` failed (assumed to be the known clock-skew test; not re-checked at the usage limit).
- Still open at the 2026-10-23 stop: Tale Studio 7.10 and UX rework 8.17 (automated part) were applying review fixes in their worktrees; 8.17's keyboard and screen-reader walk waits for the owner; owner questions on 8.13's four first-run cuts and the 7.10 decisions (reading direction from the tale, per-band contrast).
- **Tale Studio 7.10, contrast warnings and visual reading order** (merge on `autopilot/foundation`, clean merge; full verification on the merged tree NOT yet re-run at the usage limit — the branch passed it on its own): label contrast over media sampled from pixels (8 strips, worst strip's 10th percentile, an estimate, never blocks publishing; pooled, retried, LRU-cached reads); reading order by rows of vertical overlap, direction taken from the tale's own text (AD-15 amended); reduced motion stills (incl. AVIF); reading numbers in the layers list. One review (3 must-fix, 2 decisions, 10 smaller), all patched.
- **UX rework 8.17, accessibility review, automated part** (merge on `autopilot/foundation`; the story stays hitl): `dashboard-e2e:a11y` scans 27 states with axe (WCAG 2.2 AA) plus checks for focus visible and not obscured, target size, reflow at 320 px and text spacing, and keyboard/announcement tests for tabs, the ⋯ menu, switches, reorder and form errors; fixes: the top bar wraps under 375 px (long project names too), template description contrast, scroll padding for sticky bars, a focus ring on studio canvas elements (below 7.10's contrast badge), focus on the refused field in zone drawers. One review (1 must-fix, 13 smaller), all patched. **Waiting for the owner:** the keyboard and VoiceOver walk in `epic-ux-rework/a11y-review-8-17.md`.
- Verification on the merged tree (after 7.10, 8.16, 8.17): everything passes except the clock-skew auth test (the local Postgres clock is now about 20 minutes behind the host).
- **UX rework 8.18, refactor sweep** (merge on `autopilot/foundation`): a shared `top-layer.ts` for the dashboard's popups, one `inTransaction` from `@taleart/server-access`, one display per zone read plainly on the server and in the Web SDK (24.37 → 24.22 KB), clearer fold names, shared API fold-test helpers. Review: behaviour-neutral, no findings to fix. Follow-up candidates (behaviour changes, not done): per-project group cap; tales for groups in no zone; zone opt-out of the site key; pinned SDK URL only serves the current build; no tale delete endpoint; a fold test from the real cf1bf03 migrations; second reviews of 8.6, 8.7 and 8.13; a failed per-zone request marks the dashboard API-down; body-parser 413/415; "Show in another zone" offered on archived groups. **The UX rework epic is built; story 8.17 waits for the owner's keyboard and VoiceOver walk.**
- **Tale Studio 7.14, keep the Web SDK within budget** (merge on `autopilot/foundation`): `sdk-sample:perf` now measures a 20-element tale with a project font on Fast 4G (10 cold runs, p75) and reports every gate's margin: SDK 24.29 KB gzipped (budget 50 KB; split trigger 40 KB, with an estimate of what a split would move), first content 1.27 s (sample page) and 1.32 s (SDK from the API), first tale frame 65 ms (budget 1 s), the project font never holds up the first frame (checked with the font held back 1.5 s), no font request on pages without a project font. The API now serves the SDK gzipped (lazily, per file version, `Vary`, per-encoding ETag). One review (no must-fix, 10 smaller), all patched. Full verification passed except the clock-skew auth test.
- **Tale Studio 7.15, accessibility review, automated part** (merge on `autopilot/foundation`; stays hitl): `dashboard-e2e:a11y` adds a studio keyboard spec (22 states, 64 keyboard steps composing a whole tale by keys only, exact announcements, on-top checks after every move); fixes: the in-place text editor above other layers, a focus-ring overlay (layers keep their stacking; a wholly covered layer is raised only while focused), drawer Tab trap ignores tabindex=-1 and unchecked radios, Shift+F10 / menu key open the layer menu, emoji names read once, layer names wrap at 320 px, project cards wrap. The two long-standing landscape a11y-review failures were measurement timing during the deck's deal animation; the check now waits for the animation and expects the deck card (88 % height, 9:16, centred), also under reduced motion: 220/220 pass. One review (1 must-fix, 9 smaller), all patched. **Waiting for the owner:** the walk in `epic-tale-studio/a11y-review-7-15.md` (includes 3.12's viewer screen-reader checklist).
- **Tale Studio 7.16, refactor sweep** (merge on `autopilot/foundation`): `tale-studio.ts` 4,001 → 2,543 lines (template and styles in their own files; canvas views, contrast logic and key checks in helper modules), one `percent` and one `cleanLabel`, shared spec helpers, unused exports trimmed; the spec helper is excluded from the app build. Review: behaviour-neutral. Follow-up candidates: alt-text vs link-label whitespace rules differ; duplicated hex/opacity setters with different messages; two announce helpers; emoji painted with the browser font in contrast sampling; a real iOS swipe check; the flaky autosave-timing test; `dashboard-e2e:a11y` must run separately from `dashboard-e2e:e2e` (Nx recursive task detection).
- **Status at the end of this run (2026-10-23):** every story in the UX rework and Tale Studio epics is built and merged. Waiting for the owner: the keyboard and screen-reader walks for 8.17 and 7.15 (7.15's doc includes 3.12's viewer checklist), and the open questions listed in memory/handoff. Full verification passes except the clock-skew auth test (local Postgres clock about 20 minutes behind).
- **UX rework 8.22, cap tale groups per project** (merge on `autopilot/foundation`): at most 500 tale groups that are not archived per project (`MAX_TALE_GROUPS_PER_PROJECT`), enforced on create, create in no zone, Copy to zone, restore from archived and imports, under a per-project advisory lock taken first (15 racing requests for 3 places: exactly 3 succeed); 409 `tale_group_limit_reached` with "Archive a tale group to make room"; the importer skips new groups past the cap with a report note; index on `tale_groups(project_id)`. Autopilot decision the owner may change: archived groups do not count (otherwise a project would be full forever, since groups are never deleted). One review (1 product decision, 5 smaller), all patched.
- **UX rework 8.21, pinned SDK URLs keep working after a release** (merge on `autopilot/foundation`): the API keeps the last N SDK builds (`SDK_BUILDS_DIR`, default `.data/sdk-builds`, must persist and be shared; `SDK_BUILDS_KEPT` 2–100, default 5) and serves `taleart.<hash>.js` from them after verifying the bytes; builds are copied only once stable for 1 s, reads are re-checked against size and mtime; pinned 404s are `no-store`; the Install tab shows a "Pin this SDK version" card (URL, integrity, pinned script tag, the server's real keep count). Security review (no traversal or write-on-request issues), 11 smaller findings patched.
- The 7.12 duplicate race test got a 20 s limit (it ran past 5 s under parallel load). Full verification passed on the merged tree except the clock-skew auth test.
- **UX rework 8.19, a tale group in no zone can get tales** (merge on `autopilot/foundation`): new `GET /tale-groups/{taleGroupId}`; the Tale groups page opens every group in an in-page group view (`/tale-groups?group=<id>`) with Add tale, Shown/Hidden, reorder (queues keyed by group in both views) and Archive with Undo; groups read on their own are merged into refreshes and released when no view needs them; a failed read keeps what is shown, a gone group says so; Tale Studio works for tales no zone lists and returns to the Tale groups view. Also fixed: the API build now fails if the Web SDK bundle is missing and its cache hash includes the SDK output (it could cache an API without the SDK); the pinned SDK values on the Install tab wrap at 320 px. One review (3 must-fix, 7 smaller), all patched. Full verification passed on the merged tree except the clock-skew auth test.
- **UX rework 8.20, delete a tale** (merge on `autopilot/foundation`): `DELETE /tales/{taleId}` (admins and content managers in their projects); one transaction (group then tale lock) removes the tale, its documents and media/font rows and renumbers the group; after commit each file is deleted through the media deletion guard only when nothing references it (duplicates, copies, covers, project media keep it); the import link is kept so a re-import skips the deleted tale with a note; start-up sweeps remove orphan tale files and import rows; dashboard alertdialog confirmation from the tale ⋯ menu and the tale drawer. One review (no must-fix; 4 smaller), all patched. Full verification passed on the merged tree except the clock-skew auth test. Seen twice: `first-run.spec.ts` timed out once waiting for "New zone" after setup (passed on rerun).
- **Fix: first-run race after setup** (merge on `autopilot/foundation`): the sign-in data load could read the projects before setup's first project was saved, leaving "Create your first project" on the zones page; setup now refreshes the store after creating the project. Reproduced deterministically by delaying the create; `dashboard-e2e:e2e` passed 5 runs in a row afterwards.
- **Status (2026-10-23):** `main` = `autopilot/foundation`. All UX rework (8.1–8.22) and Tale Studio (7.1–7.17) stories are built and merged; owner walks for 8.17 and 7.15 and the open decisions remain. A fresh screenshot set of every screen was sent to the owner.

## 2026-10-23 — Follow-ups and native mobile 9.1

- **Second reviews of 8.6, 8.7, 8.13** (merge 42fe210): a slug with a NUL made Delivery answer 500 instead of the uniform 401 (fixed, `slugParam` validates with `isZoneSlug`); the Install tab's site-key drawer and in-flight answers survived a move to another project's zone, so Rotate could hit the other project (fixed, reset on project change). The flaky autosave-timing test now runs on fake timers (10/10). Open questions for the owner: a key issued while navigating away is dropped; rate limit counts per IPv6 /64; `configureZone` overrides keyed by slug only. Story 13's ticket text no longer mentions legacy zone keys.
- **Native mobile 9.1** (merge 9172da8): new epic 9 (native mobile, owner direction). `apps/taller` and `libs/mobile-sdk`, `android-sdk`, `ios-sdk` regenerated from the KMP wizard (`generateKmtProject`, Android + iOS Compose UI + tests), package `site.lempert.taleart`, one shared Compose screen; the wizard's Xcode project replaces xcodegen; iOS deployment target 18.2. Nx targets `taller:build-android`, `build-ios`, `test`, `test-ios`, `mobile-sdk:test`, `test-ios`; a Compose UI test runs on the Android host (Robolectric) and the iOS simulator. Screenshots from the emulator and the simulator were sent.
- Verification: full web run green except the known clock-skew auth test; mobile targets green.
- Incident: a reviewer's `pnpm nx` reinstalled node_modules in pnpm layout; restored with `npm ci`.

## 2026-10-23 — Native mobile 9.2

- **9.2 the shared SDK reads a zone** (merge ae33d65): Ktor 3.6.0 + kotlinx.serialization 1.12.0 Delivery client in `libs/mobile-sdk` mirroring `delivery-client.ts` (URL, Bearer key, no cookies, shared in-flight requests, isZone shape check, same messages), typed `ZoneResult`, per-field fallback decoding like the web, in-memory LRU ETag revalidation; a contract test checks the models against `openapi.yaml`. Taller has a debug settings screen (API URL, site key, zone) and lists the zone's groups and tales. Review fixes: the iOS local-network ATS exception is Debug-only (Release Info.plist checked), `close()` settles waiting callers, Android backup off. Android 17 needs `ACCESS_LOCAL_NETWORK` to reach 10.0.2.2; declared and requested in debug builds only. An unknown zone arrives as 401 (the API answers it like a bad key, by design). Screenshots from Android, iOS and the web test page sent.

## 2026-10-23 — Native mobile 9.3

- **9.3 the bar display in shared Compose** (merge 2a8a0d6): `TaleartZone` in `libs/mobile-sdk` renders a bar zone like the Web SDK (shape, size, titles, alignment, gap; ring style, colours, width, corner radius, title colour, background, generic font families), covers through Coil 3.6.3 on the SDK's cookie-less Ktor client, cover fallback in the web's order (video candidates skipped: the API sends no poster). Seen state uses the web's `taleart.seen` format and cap in an SDK store (`taleart-sdk` prefs / NSUserDefaults suite); the viewer (9.4) marks seen, not the tap. Android `TaleartView` (XML attrs, controller kept across detach, error listener) and iOS `TaleartZoneView`/`TaleartViewController`. New `android-sdk:test` (Robolectric). Not ported: named fonts, video first frames, animated covers, host theme overrides. Screenshots: Android, iOS and web bars, a group turned Off.

## 2026-10-23 — Native mobile 9.4

- **9.4 the tale viewer** (merge 3e829b3): full-screen shared Compose viewer matching the Web SDK viewer (durations, left-third back / right two-thirds forward mirrored in RTL, hold and Pause, group transitions, end of zone, keys, labels and "Group, tale N of M" announcement, reduced motion), ExoPlayer (Media3 1.11.1) and AVPlayer video with real-position progress, audio focus / playback session, pause in background, markSeen when a group is shown. Opens as a full-screen Dialog from Android `TaleartView` and as a modal from iOS `TaleartZoneView`. Review fixes: iOS presentation failure recovery, viewer survives a zone reload, stale video callbacks ignored, replay after end, player cleanup, consistent host listeners. Video verified on both devices with an AVAssetWriter-made MP4. Not ported: the wide-screen deck, document elements (9.5). Screenshots sent.

## 2026-10-23 — Native mobile 9.6

- **9.6 the banner display** (merge 4abf5c2): `TaleartBanner` in shared Compose matching the Web SDK banner (aspect ratio, autoplay, interval 3–15 s, dots, loop; buttons, dots, swipes, RTL; reduced motion now observed live in the shared helper; labels and a live region on the shown slide). Slides use the group's default cover, as the web banner does (the bar keeps the group's own cover). After the viewer closes the banner shows the last group viewed, only for requests made while that banner exists. A vertical scroll that starts on the banner no longer stops autoplay (deliberate difference from the web's pointerdown). iOS `TaleartZoneView.height` reports 0 when nothing renders. Screenshots sent: banner on iOS, web, Android and the viewer opened from a slide.

## 2026-10-23 — Native mobile 9.5

- **9.5 the viewer renders Tale Studio documents** (merge 3ba1272): every registry element type (text with styles, bands, direction; image and video with fit, radius, opacity; shapes; stickers and emoji; buttons, image buttons and the swipe-up link) placed, rotated and z-ordered on the 9:16 safe-area canvas as the Web SDK does, reading order from the contract, links opened in the system browser (http/https only, normalized). The document video runs the tale with the 15 s cap and 5 s stall check. Untrusted values re-checked: schema box bounds, 60-element cap, the contract's full WOFF2 check, bounded font download, UUID font ids. Project fonts draw on iOS; Android cannot read WOFF2 and falls back (needs a WOFF2 decoder; owner may ask). The canvas never mirrors in an RTL locale. Two review rounds (blockers: RTL mirroring, untrusted geometry, font checks). Known gaps: iOS document video under an overlapping element is drawn upright and square; animated images still. Screenshots sent: side by side Android/iOS/web, Hebrew-locale Android, font check.

## 2026-10-23 — UX rework 8.23 (owner decision)

- **8.23 visitor id per device** (merge 16f0bda): the Web SDK (localStorage `taleart.visitor`, per page when storage is blocked) and the native SDK (device store; `TaleartSdk.init(context)` / `DeliveryClient(context)` on Android before Compose) send a random UUID v4 as `X-TaleArt-Visitor`. Delivery limits per visitor (burst 600, 20/s) with a per-address backstop of 10x (IPv4 address or IPv6 /48); requests without a valid id use the address bucket. Docs say what the id is, that backups restore it, that hosts cover it in their privacy notice, and that TRUST_PROXY must be right. Verification green except the known clock-skew test.

## 2026-10-24 — Targeting 5.1

- **5.1 tags combine with All or Any** (merge f1330a0): `tagMatch` (any/all, default any) per group in the targeting module (forward-only migration, copied with the group), Management API and contract; Delivery sends tag names and the mode; the Web SDK's page-wide `setTags()` filters groups without a request (keeps an open viewer whose group still matches). Tags are NFC-normalised, trimmed and lower-cased, accents not folded; a shared JSON case table for the native port. Dashboard: the group's "Audience" drawer with Any/All and a note that tag names are public (also on the another tool import page). Verification: green except the clock-skew test; two API tests timed out once under heavy machine load and passed in isolation.

## 2026-10-24 — Interactive 4.1

- **4.1 polls, votes counted per visitor** (merge 014b774): the `poll` element type (registry, schema, one per tale), Tale Studio's Add poll, choices inspector and vote counts panel, the Web SDK poll (buttons, live-region result, focus pauses the tale, a tap never steps), `POST /delivery/v1/responses` (site key, slug, visitor id, delivered-tale check with the Delivery rule, first answer wins, write rate limit, 4 KB body limit with CORS on errors) and the new `server-interactive` module. Counts are documented as indicative (the visitor id is made on the device). Review fixes: duplicate refused at the per-tale limit, per-index option edits, FK race to 404, more tests. Web SDK 26.67 KB gzip. Mobile skips `poll` until 4.10. Found: mobile `ContractModelsTest` fails on foundation since 5.1 added `tags`/`tagMatch`; fixed in the 9.8/9.9 review commit.

## 2026-10-24 — Native mobile 9.8 and 9.9 (owner decisions)

- **9.8 host-installed fonts by family name** (merge a4038dd): the mobile SDK no longer downloads project WOFF2 files. `TaleartFonts` resolves a family name from the content (text fonts, theme `fontFamily`, bar titles, and project fonts through the new Delivery `DeliveryFont.family`) against fonts the host app installs: Android `res/font` and `assets/fonts` (space→`_`, hyphen→`__`), iOS bundle fonts listed in UIAppFonts (no system fonts, no .ttc/.otc, 10 MB cap), or `TaleartFonts.register`. Lists are read like CSS font-family. Taller bundles Lobster (res/font, UIAppFonts) and Pacifico (assets), with OFL licences.
- **9.9 live reduced motion and viewer transitions**: an open viewer follows the setting live (pauses, resumes, defers while held or away); open and close fades, a cube turn between groups that follows the finger with a spring settle, swipe-down drag; all off under reduced motion. Stage video on a TextureView (Android) and hidden while moving (iOS). Review fixes: interrupted settles, wiggle taps, onClose exactly once, iOS appear timeout. Also adds `tags`/`tagMatch` to the mobile Delivery model (fixing the contract test 5.1 broke). A lint fix in contract.spec followed the merge. Screenshots and an iOS recording sent.

## 2026-10-24 — Targeting 5.2

- **5.2 a targeted group says who it is for** (merge ff61164): a visible group with tags reads "Visible on site · for viewers tagged summer or vip" (Any) or "summer and vip" (All), up to three tags then "N more", as a button whose tooltip names every tag and the no-tags rule; on zone rows, the group view and the Tale groups page, which gains a Targeted filter (with its own empty state and an announcement when a group leaves it). Built from the existing `tags`/`tagMatch` fields; `delivery-rule.ts` unchanged. Verification green except the clock-skew test.

## 2026-10-24 — Interactive 4.2

- **4.2 rate with an emoji slider** (merge 33df01b): the `rating` element type (one per tale, emoji checked like the emoji type), Tale Studio's Add rating, emoji control (picker) and "N ratings, average X" panel; the Web SDK slider (role slider 0–100, drag with pointer capture, keys by 10, Home/End, Enter posts, mirrored in RTL; its events never swipe or step the tale; once rated the keys go back to the viewer), "Average N from M ratings" and a mark on the track. The interactive module's poll table became a per-type table; values are whole numbers 0–100 as plain decimal strings. Review fixes: totals above 100, label-in-name on the emoji button, robust drag waits, multi-touch, no `:dir()`. Web SDK 28.02 KB gzip. Verification green except the clock-skew test.

## 2026-10-24 — Interactive 4.3

- **4.3 quizzes** (merge 6b7309f): the `quiz` element type (2–4 answers with stable ids, optional correct answer, one per tale), Tale Studio's list field (add, move, remove by id, errors keyed by answer id, next free default label) and correct-answer pick; the shared choice card and server `choiceKind` now serve poll and quiz. The Web SDK marks ✓/✗ with hidden text (colour never the only cue; only marks and borders coloured, text ≥4.6:1 in every state), announces right/wrong and percentages; the server never says which answer is correct (C10; the document does). Card clicks never step the tale; Space does nothing on an answered poll, quiz or Rating. Web SDK 28.72 KB gzip. Verification green except the clock-skew test.

## 2026-10-24 — Targeting 5.3

- **5.3 user lists from a CSV, stored only as keyed hashes** (merge ae90b7c): a per-project 32-byte secret (`user_list_secrets`, never returned or logged, deleted with the last list), IDs stored only as HMAC-SHA-256 (`user_list_ids`), a streaming CSV reader (UTF-8 strict, BOM, CR/LF/CRLF, header option, row cap) with all-or-nothing uploads, refused rows reported by line and reason only, ASCII-only IDs until 5.4 defines the header encoding. Limits: 100 lists, 1M rows, 50 MB, 256 chars. The Audience page (rail item) lists names and counts only, warns on email/phone-like IDs. 1M rows in 16.7 s, API peak 137 MB; a dump and the logs held none of 1,016 sampled IDs. Security review blocker fixed: a stalled upload crashed the API (Postgres idle timeout on a client with no error listener); now a 30 s idle timer and 280 s deadline in Node, an error listener with broken clients discarded, `requestTimeout` 300 s and `pool.on('error')`. Follow-up 8.24 extends that to every checked-out client. Verification green except the clock-skew test.

## 2026-10-24 — Developer experience 10.1 (owner request)

- **10.1 API tokens for scripts** (merge 53af0f9): `tat_` tokens (32 random bytes, SHA-256 stored), created under Settings > API tokens (name, projects or all, read-only by default, expiry 30 days by default), shown once, revocable; they act as the user within their projects (re-read each request), read-only by HTTP method; never create tokens, use /auth, invite, or work on Delivery; cookie ignored when a header is present. Failed attempts are rate limited per address without locking out valid tokens; last-used writes deduplicated. Admin API to revoke all of a user's tokens (no UI yet). Docs page "API tokens". Security review found no bypass. Verification: one run under heavy load timed out a setup hook and cascaded; the re-run and the isolated auth/token tests pass (only the clock-skew test fails).

## 2026-10-24 — New logo (owner request)

- **Brand** (merge 4daf31e): the owner's new logo recreated as a hand-written SVG (`branding/taleart-logo.svg`, IoU 0.993 with the supplied PNG, speckles removed) plus 1024/2048 masters and a mono SVG. Web: favicon.svg/ico (16/32/48) and apple-touch 180 for dashboard, docs and sdk-sample; in-app mark in the dashboard rail and sign-in cards; logo in the docs header and README; data-URI favicon on the API test page. Android: launcher icons per density, adaptive icon (foreground per density, navy `#0F1330` background), monochrome themed icon; Play Store 512. iOS: opaque 1024 app icon plus dark and tinted variants. Builds green. Open: no web manifest (no PWA icons); the dashboard `theme-color` is still the old orange.

## 2026-10-24 — Tale Studio 2 11.1 (owner request)

- **11.1 the studio in five regions** (merge c4923ff): top bar (back, title, Undo/Redo, Safe area, save state and status, Preview, Update tale, ⋯ tale menu with Discard and Duplicate), a left panel with a tab rail (Elements as tiles, Templates and Media placeholders, Layers), the canvas on a workspace, a contextual inspector, and a tale strip (lazy thumbnails, current tale kept in view). F6 cycles regions; WCAG scan 0 findings in 22 studio states; every existing studio behaviour kept. Review fixes: one-row top bar at 1024–1279 px, no duplicated Font legend, tooltips, 12 px labels, logical CSS, outlines only on hover/focus/safe area. The flaky "oracle" API test got a 30 s timeout (it timed out under machine load). Owner review is story 11.2.

## 2026-10-24 — Targeting 5.4, developer experience 10.2 and 10.3

- **5.4 target groups to user lists** (merge 2db40b7): `X-TaleArt-External-User-Id` (base64url of UTF-8, strict decode, then the same normalization as uploads; non-ASCII IDs allowed again), `setExternalUserId()` page-wide in the Web SDK (memory only), Delivery matches only the HMAC and answers `private, no-store` with no ETag when the header is sent; groups targeted to lists are delivered only to matching viewers (fail closed). New reasons `audience-empty` and `audience-removed` (deleting a group's only list holds it hidden until its Audience changes; a cross-project copy is held too; a race between list delete and set/copy fixed with row locks and two-connection tests). Audience drawer lists, summaries, sample page form. Two security reviews.
- **10.2 Swagger API reference** (merge d9fea04): docs page "API reference" with vendored Swagger UI 5.33.1 (SRI), all 83 operations tagged, Authorize with an API token or a site key against a chosen API URL (changing the URL clears credentials; tokens kept in memory, masked fields), `GET /api/openapi.json`, internal references removed from the public spec, docs-e2e with axe in light and dark.
- **10.3 `taleart` CLI** (merge 66fc64a): `apps/cli`, 45 commands with `--json`, exit codes, `help commands --json` with mutates/destructive/options/result types, token from env or a 0600 config, never printed; new `GET /api/v1/api-tokens/current` for `whoami`.
- Merge notes: OpenAPI conflicts between 5.4 and 10.2 resolved without internal references; the CLI test's refused CSV row changed from non-ASCII (now accepted) to a two-column row. Verification: green except the clock-skew test (runs under load 20–40 timed out and were re-run at low load).

## 2026-10-24 — Tale Studio 2 11.3

- **11.3 a grouped, searchable palette** (merge 8931375): descriptors carry a `palette` entry (category, order, keywords, icon, presets) instead of `add[]`; categories Text, Media, Shapes, Stickers & emoji, Buttons & links, Interactive, More (fallback for types without an entry); text presets Heading/Subheading/Body/Caption/Label drawn on a clear size ladder (Body still adds the bold default); search with `/`, word-start matching ignoring case and accents, synonyms, debounced count announcement; blocked tiles stay focusable with their visible reason (per-tale limits, full tale, no project shown once). Dashboard green; e2e 53 and a11y 32 passed in the builder's run.
