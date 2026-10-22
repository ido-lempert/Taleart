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
