# Autopilot report — foundation epic

Branch: `autopilot/foundation` (nothing pushed; `main` untouched). Started 2026-10-20.

<!-- The final summary is written here when the run ends. -->

## Stories

### 1.11 — Align the prototype with the architecture

- **Status:** built
- **Commits:** `b05cfd4` Story 11: align the prototype with the architecture
- **What changed:** project and zone routes moved to `/api/v1` behind the `access` and `zones` modules; `libs/contract` holds the OpenAPI 3.1 document and generated types; Nx tags enforce the module boundaries; errors use the standard body.
- **Assumptions made:** a `projectId` that isn't a UUID is treated as an unknown project; a malformed JSON body returns 400 `validation_failed`.
- **Not fixed (by review rule):** request bodies that are too large or wrongly encoded return 500 instead of a 4xx.
- **How to review:** start the API (`npm exec nx serve api`) and dashboard (`npm exec nx serve dashboard`), open `http://localhost:4200`, add a project and a zone, then try adding a zone without choosing a project: the API's own message appears.
- **Blocking condition:** none.
