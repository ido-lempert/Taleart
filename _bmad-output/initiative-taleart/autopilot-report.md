# Autopilot report — foundation epic

Branch: `autopilot/foundation` (nothing pushed; `main` untouched). Started 2026-10-20.

## Summary

The run ended after about 30 minutes, not overnight: three of the remaining stories need your decisions, and every other story waits on one of those three.

**Built (ready for you to try):**
- **1.11 Align the prototype with the architecture** — `/api/v1`, `access` and `zones` modules, the OpenAPI contract, module-boundary lint, the standard error body.
- **1.6 Pick a frame type for a zone** — frames with schema-checked settings; bar and banner; new types by configuration only.
- **1.1 Tracer** (built before tonight) — still waiting for your review.

**Blocked, waiting for your decisions:**
- **1.2 CI** — which CI host to use, and whether to create the GitHub repository with branch protection. The autopilot may not create a remote or push.
- **1.3 Add a tale** — whether tales live only in tale groups (PRD and architecture) or directly in zones (the story), and whether the first tale slice includes media upload.
- **1.7 Sign in** — how accounts are created, how people sign in, what administrators and content managers can each do, and whether a user belongs to one project or several.

**Waiting on those:** 1.4 and 1.5 (on 1.3), 1.8 zone keys (on 1.7), 1.9 staging (on 1.2 and 1.8, and needs your host and credentials), 1.10 refactor sweep (on all of them).

**Assumptions made tonight:**
- A `projectId` that isn't a UUID is treated as an unknown project.
- A malformed JSON body returns 400 `validation_failed`.
- Bar and banner have no settings fields yet and refuse any extra field; their fields come with the web zones epic.
- A frame type sent with surrounding spaces is accepted.

**Not fixed, by the review rules:** request bodies that are too large or wrongly encoded return 500 instead of a 4xx.

**How to review:** run `npm exec nx serve api` and `npm exec nx serve dashboard`, open `http://localhost:4200`, add a project and a zone, then pick a frame type for the zone. Each story's section below has its own steps. All of it is on `autopilot/foundation`; merge into `main` when you're happy.

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
