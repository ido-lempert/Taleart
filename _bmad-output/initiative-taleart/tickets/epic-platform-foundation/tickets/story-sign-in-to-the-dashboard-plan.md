---
title: "Sign in to the dashboard"
ticket: 7
status: blocked
blocked_at: "2026-10-20"
blocked_reason: "Intent gap: how users are created (first-run admin, sign-up, or invite), how they sign in (password or email link), what administrators and content managers may each do (PRD FR-001 to FR-003), and whether a user belongs to one project or many."
---

## Auto Run Result

- **Status:** blocked
- **Blocking condition:** intent gap. The story, the PRD and the architecture settle sessions in an http-only cookie (AD-9) but not the account model.
- **Questions for the user:**
  1. How does a user account come to exist: a first-run setup that creates the first administrator, open sign-up, or an administrator who creates or invites users?
  2. How does a user sign in: email and password, or an email link (which needs a mail server in every self-hosted install)?
  3. What may an administrator do that a content manager may not? The PRD gives administrators project creation and zone keys (FR-001, FR-003), and content managers sign-in and zones (FR-002).
  4. Does a user belong to one project, or to several with a project switcher?
- **No code changed.**
