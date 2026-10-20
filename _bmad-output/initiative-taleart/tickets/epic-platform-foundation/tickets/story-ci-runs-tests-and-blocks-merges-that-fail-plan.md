---
title: "CI runs tests and blocks merges that fail"
ticket: 2
status: blocked
blocked_at: "2026-10-20"
blocked_reason: "Needs a CI host and a remote: the repo has no git remote, and blocking merges needs a hosted CI (likely GitHub Actions) plus branch protection. The autopilot may not create a remote or push. User to decide the CI host and create the repository."
---

## Auto Run Result

- **Status:** blocked
- **Blocking condition:** the story's check ("a pull request with a failing test shows a red check and cannot be merged") needs a hosted CI and branch protection on a remote repository. This repo has no git remote, and the autopilot may not create one or push.
- **Questions for the user:** which CI host to use (GitHub Actions is the likely choice; `gh` is logged in as `ido-lempert`), and whether to create the GitHub repository and turn on branch protection for `main`.
- **No code changed.**
