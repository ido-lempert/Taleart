---
type: epic
title: "Developer experience: API tokens, interactive API reference, CLI and an agent skill"
parent: initiative-taleart
id: 10
covers: [R3, R10]
sources: [_bmad-output/initiative-taleart/initiative-taleart.md]
companions: [_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md]
after: []
refined: true
risk: medium
---

# Developer experience: API tokens, interactive API reference, CLI and an agent skill

## Description

Owner request (2026-10-24): the docs get a full API reference with a Swagger UI preview that can call the API with a token; a command-line tool drives the Management API; and an agent skill (a Claude Code / Agent Skills `SKILL.md`) uses that CLI so an AI agent can manage zones, tale groups, tales and targeting. The skill and how to install it are documented in the docs site.

Today the Management API only accepts a passkey session cookie, so a token for scripts comes first.

## Outcome

A developer creates an API token in the dashboard, pastes it into the docs' API reference and tries any call; the same token drives the `taleart` CLI; an AI agent with the TaleArt skill installed performs a documented task (for example "create a zone and a tale group with two image tales and turn it On") through the CLI.

## Notes

- Tokens follow the site-key pattern (prefix, shown once, stored hashed, revocable) and act with the creating user's access, optionally limited to projects and read-only (owner may refine scopes later).
- The CLI is a Node script in the workspace (no new runtime), published as an npm bin within the repo; it reads `TALEART_API_URL` and `TALEART_TOKEN` and prints JSON with `--json`.
