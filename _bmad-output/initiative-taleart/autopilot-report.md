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

- **Status:** built (added on the user's request: "It needs to look like Storyly not website from 90s")
- **Commits:** `8a48e94` new story; the story 14 commit after it.
- **Assumptions:** TaleArt's own identity (ember orange, Inter, own mark), Storyly-like patterns only, no Storyly assets or colors; filled buttons use a darker ember `#C73E1D` for WCAG AA contrast (awaiting the user's confirmation); no UI component library.
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
