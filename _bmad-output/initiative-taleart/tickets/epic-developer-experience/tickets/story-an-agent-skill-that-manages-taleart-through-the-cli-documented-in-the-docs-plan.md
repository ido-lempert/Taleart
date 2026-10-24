---
title: 'An agent skill that manages TaleArt through the CLI, documented in the docs'
type: 'feature'
ticket: '4'
created: '2026-10-24'
status: built
baseline_revision: '2db40b7'
route: 'full'
route_source: 'auto'
risk: 'low'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-developer-experience/epic-developer-experience.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-developer-experience/tickets/story-a-taleart-cli-drives-the-management-api-plan.md'
  - '{project-root}/apps/cli/src/commands/index.ts'
  - '{project-root}/apps/cli/src/help.ts'
  - '{project-root}/apps/docs/src/app/app.routes.ts'
warnings:
  - 'The skill tells an agent to run commands that change a live project; its safety rules (confirm destructive commands, --yes only after the user agrees) are instructions, not enforcement. The CLI still refuses a destructive command without --yes (exit 10).'
deferred:
  - 'Publishing the skill to a skills registry or marketplace; today it ships in the repo and inside the CLI build.'
  - 'An eval suite for the skill (trigger accuracy, task success) run in a real agent session; the verify run follows the skill by hand, without a nested agent session.'
  - 'A zip download of the skill folder on the docs page (no zip dependency); each file downloads on its own.'
---

<intent-contract>

## Intent

**Problem:** the `taleart` CLI (10.3) gives scripts a stable tool, but an AI agent asked to "make a zone
with a bar and a group of two tales" does not know the CLI's commands, its JSON and exit-code contract,
the TaleArt words, or which commands it must not run without asking.

**Approach:** an Agent Skills package at `skills/taleart/` (`SKILL.md` plus `reference/*.md`) that
teaches the agent setup, concepts, operating rules, recipes and troubleshooting, every command checked
against the CLI's own registry by a test. The CLI bundles the skill and installs it in one line
(`taleart skill install [--project]`). The docs get an "AI agents" page that renders the skill text,
offers each file for download and shows the install steps and an example session.

## Boundaries & Constraints

**Always:**
- `skills/taleart/SKILL.md`: YAML frontmatter with `name: taleart` and a third-person `description`
  that says when to use it; a body under about 200 lines that links to `reference/setup.md`,
  `reference/concepts.md`, `reference/recipes.md`, `reference/troubleshooting.md`.
- Rules the skill states: `--json` always, parse stdout; errors from stderr JSON, by exit code;
  discover with `taleart help commands --json`, never guess a flag; a read-only token for read tasks;
  confirm with the user before any command whose `destructive` flag is set, and pass `--yes` only after
  they agree; run no more than the task needs; report what changed (ids, names, statuses, visibility).
- Token: in TALEART_TOKEN from the environment or `taleart login --token-stdin`; never `--token`;
  never printed, echoed, logged or written to a file the agent keeps. External user IDs only in CSV
  files or the SDK call, never in URLs or the agent's report; TaleArt keeps only keyed hashes.
- Every `taleart …` command and every `--flag` in the skill files and on the docs page is one the CLI
  has: a test parses them with the CLI's own argument parser (`locate` + `parseCommand`) and fails
  otherwise; `--yes` only on destructive commands.
- The bundled skill in the CLI is the folder's text byte for byte (a test compares, and lists the
  folder so a new reference file cannot be left out).

**Never:** a new dependency; a token in any file kept or screenshotted; a change to the API.

## Design

- **CLI, new commands:**
  - `taleart skill install [--project] [--dir <path>] [--force]` writes the bundled files to
    `~/.claude/skills/taleart` (user), `<cwd>/.claude/skills/taleart` (`--project`) or
    `<path>/taleart` (`--dir`, for other agents' skill folders). Same files already there: nothing
    written (`unchanged`). Different files there: exit 6 `skill_exists` unless `--force`, which
    replaces only the skill's own files. `auth: false`, `mutates: true`, not destructive (local
    files only). `--json`: `{ "dir", "files", "written", "unchanged" }`.
  - `taleart skill show [<file>]` prints `SKILL.md` or a reference file (`reference/recipes.md` or
    `recipes.md`); `--json` gives `{ "path", "content" }`, plus `name` and `files` (`path`, `bytes`)
    without a file.
  - Here `--project` is the command's own switch (its option overrides the global `--project <id|name>`
    in `parseCommand`); the command needs no URL, token or TaleArt project.
  - `taleart groups audience <group> [--list <name>]… [--clear]`: the 5.4 Management route
    `PUT /tale-groups/{id}/user-lists` (merged after 10.3), names resolved in the group's project,
    so the user-list recipe works. Result `TaleGroup`.
- **Bundling:** `skills/project.json` makes the folder an Nx project (`agent-skills`, tag
  `type:skill`, no targets) reached through the alias `@taleart/agent-skill/*`; `scope:cli` and
  `scope:docs` may depend on `type:skill`, and its Markdown files are its interface (an exception in
  `no-restricted-imports`). `apps/cli/src/skill-files.ts` imports each file with `?raw` (webpack rule
  `resourceQuery: /raw/` as `asset/source`; Vite reads `?raw` natively in the tests). Build and test
  inputs include `skills/taleart/**`.
- **Docs:** page `ai-agents` ("AI agents") after API reference in `DOCS_PAGES`; the skill files are
  imported as text (`with { loader: 'text' }`; the build option `loader` broke the unit-test
  build's Node built-ins) and shown in labelled, focusable `<pre>` regions, and
  copied as assets to `/skill/taleart/…` for download. Sections: what it does, safety rules, install
  (copy the folder, or `taleart skill install`), the token, an example session (tokens redacted),
  the skill text. Links from "API tokens" and "API reference". docs-e2e: the page in `DOCS_PATHS`
  (a11y in both themes) and an e2e test (headings, a download answers the file).
- **Tests:** `apps/cli/src/skill.spec.ts` (command and flag check over the skill and the docs page;
  frontmatter; SKILL.md length; bundle equals folder; install user/project/dir/unchanged/conflict/
  force; show); `groups audience` unit tests; the docs app spec renders the page with the skill text.

## Verify

Story verify line: with the skill installed and a token set, "create a zone home-top with a bar and a
group Summer with two tales from ./img, and turn it On" completes through the CLI and the test page
shows it; the docs page renders the skill and the install steps. Without a nested agent session: a
script follows the skill's recipe step by step with `--json` against the built API on port 3613
(database `taleart_d104_test`), checks Delivery and the test page, and keeps a transcript with the
token and site key redacted; Playwright screenshots of the docs page. Then the full lint/test/build run
and `docs-e2e:e2e`, `docs-e2e:a11y`.

</intent-contract>
