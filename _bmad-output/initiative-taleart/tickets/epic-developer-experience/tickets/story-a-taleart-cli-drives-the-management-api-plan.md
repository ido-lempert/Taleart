---
title: 'A taleart CLI drives the Management API'
type: 'feature'
ticket: '3'
created: '2026-10-24'
status: built
baseline_revision: 'f5f75d8'
route: 'full'
route_source: 'auto'
risk: 'medium'
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-developer-experience/epic-developer-experience.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-developer-experience/tickets/story-create-list-and-revoke-api-tokens-for-scripts-plan.md'
  - '{project-root}/libs/contract/openapi/openapi.yaml'
  - '{project-root}/libs/contract/src/lib/core.ts'
  - '{project-root}/apps/dashboard-e2e/scripts/start-api.mjs'
warnings:
  - 'A credential on disk: the config file holds the token (0600, never printed).'
deferred:
  - 'Groups archive/restore, schedules, ordering, covers, Tale Studio documents, fonts, theme, starting an import: the API has them, the CLI does not yet.'
  - 'Publishing the CLI to npm; today it is a workspace bin (dist/apps/cli, with its own package.json and a `taleart` bin).'
---

<intent-contract>

## Intent

**Problem:** with 10.1 a script can call the Management API with a token, but every task is raw
HTTP, and 10.4's agent skill needs a stable, documented tool to drive.

**Approach:** `apps/cli`, a Node and TypeScript Nx app built by webpack into one runnable file
(`dist/apps/cli/taleart.js`, `#!/usr/bin/env node`, executable) with no runtime dependency: Node's
`fetch`, `util.parseArgs`, `fs` (`openAsBlob` for uploads) and the contract's generated types and
helpers (`@taleart/contract/core`: `installSnippet`, `testPageLink`, `apiTokenPrefix`). It is built
for agents first: `taleart <group> <verb> [args] [flags]`, the same verbs everywhere, `--json`
everywhere, never a prompt unless a person is at a terminal, and documented exit codes.

## Boundaries & Constraints

**Always:**
- Grammar: `taleart <group> <verb> [positional] [--flags]`. Groups: `projects`, `zones`,
  `site-keys`, `groups`, `tales`, `user-lists`, `imports`; top level `login`, `logout`, `whoami`,
  `config`, `help`. Verbs reuse `list`, `get`, `create`, `update`, `delete` wherever they fit; the
  rest are named for what they do (`on`, `off`, `hide`, `show`, `copy`, `place`, `unplace`,
  `tags`, `display`, `snippet`, `upload`, `issue`, `rotate`, `revoke`, `use`).
- `--help` (and `-h`) on every group and command, `taleart help <topic>` for every group plus the
  topics `config`, `output`, `exit-codes`, `concepts`; `taleart --version`.
- `--json`: stdout holds exactly one JSON document (the API's answer, or for the CLI's own commands
  a stated shape); nothing else goes to stdout. Without it, readable tables and key/value lines.
  Messages, warnings and errors always go to stderr; with `--json` an error is
  `{"error":{"code","message","status","exitCode"}}` on stderr.
- Exit codes: 0 ok; 1 unexpected; 2 usage (unknown command or flag, missing argument, bad value);
  3 not authenticated (no URL or token, 401); 4 forbidden (403, read-only token); 5 not found
  (404, or a name or slug that matches nothing); 6 conflict (409, or a name that matches several);
  7 refused input (400, 408, 411, 413, 415, 422); 8 rate limited or server error (429, 5xx);
  9 the API cannot be reached (network, timeout); 10 confirmation needed (a destructive command
  without `--yes` and no terminal to ask at).
- Destructive commands (`site-keys rotate|revoke`, `tales delete`, `user-lists delete`) need `--yes`;
  without it they ask only when stdin and stderr are both terminals and `--json` is off, else they
  stop with exit 10 and do nothing.
- Configuration, in order: flags (`--api-url`, `--project`), then `TALEART_API_URL`,
  `TALEART_TOKEN`, `TALEART_PROJECT`, then the config file. The file is
  `$TALEART_CONFIG_DIR/config.json`, else `$XDG_CONFIG_HOME/taleart/config.json`, else
  `%APPDATA%\taleart` on Windows, `~/Library/Application Support/taleart` on macOS,
  `~/.config/taleart` elsewhere. Written with mode 0600 (its folder 0700), re-applied on every write;
  a file readable by others gives a warning on stderr.
- The token is never printed, logged or put in an error: not by `whoami`, `config show`, `login`
  or `--json`; only its display prefix (`tat_` + 6). `login --token-stdin` keeps it out of the
  process list and shell history; `login` checks it against the API before saving.
- References: projects by id or exact name, zones by id or slug, groups and user lists by id or
  exact name (within `--project`), tales by id. A name that matches nothing is exit 5, several exit 6.
- `--project` defaults from config (`taleart projects use`) or `TALEART_PROJECT`; a command that needs
  one and has none is exit 2 with a hint.
- Every request carries `Authorization: Bearer <token>` and goes to `<url>/api/v1`; the URL may be
  given with or without `/api/v1`. A request times out after 60 s (uploads 300 s).

**Never:** a new dependency; a prompt when not at a terminal; a token on stdout or stderr; a change
to the API, the docs app or the contract.

## Design

- **Files:** `apps/cli/src/main.ts` (entry), `cli.ts` (`run(argv, io)` returns the exit code; `io`
  carries stdout, stderr, env, stdin, TTY flags and `fetch`, so tests run it in process),
  `args.ts` (global flags, per-command `parseArgs` specs, strict), `config.ts`, `client.ts` (fetch,
  JSON and raw uploads, `ErrorBody` to `CliError`), `errors.ts` (exit codes), `output.ts` (JSON,
  tables, records), `resolve.ts` (id, name, slug), `media.ts` (content type from extension and
  magic bytes), `help.ts` (topics), `commands/*.ts` (one module per group, a typed registry).
- **Commands (Management API routes):** projects list/get/create/use (`/projects`); zones
  list/get/create/update/display/display-types/snippet (`/zones`, `/zones/{id}`,
  `/zones/{id}/frame` POST or PATCH by whether it has one, `/frame-types`, `/install` with
  `installSnippet` and `testPageLink`); site-keys get/issue (`ifNone: true`)/rotate/revoke
  (`/projects/{id}/site-key`); groups list (project, or `--zone`)/get/create (project, or placed with
  `--zone`)/update/on (`live`)/off (`paused`)/tags (names to ids, missing tags created, `--match`,
  `--clear`)/copy/place/unplace; tales list/get/create (one tale per file: `POST
  /tale-groups/{id}/tales` then `PUT /tales/{id}/media`; a failed upload deletes its tale)/media/
  hide (`paused`)/show (`live`)/delete; user-lists list/get/create/upload (`text/csv`, `--header`)/
  delete; imports list/get (read only).
- **Build:** `webpack.config.js` with `NxAppWebpackPlugin` (node target, `taleart.js`, no source map),
  a banner with the shebang and a chmod 755 after emit; `apps/cli/package.json` (`bin.taleart`)
  copied next to it. ESLint: `scope:cli` may depend on `type:contract` only.
- **Tests:** unit tests for parsing, help coverage (every command answers `--help` with exit 0),
  output and errors, config (paths, 0600, precedence, never the token) and the client against a
  fake `fetch`; an integration test (`cli.integration.spec.ts`) that starts the built API
  (`dist/apps/api/main.js`) on a free port and a database derived from `TEST_DATABASE_URL`
  (`<name>_cli_test`, dropped and created, so it never races the API's own tests on the same
  database), inserts an admin and two tokens (read-write, read-only) as hashes, and runs the built
  `taleart.js` through the verify flow and the error paths.

## Review fixes (2026-10-24)

- **API:** `GET /api/v1/api-tokens/current` (`getCurrentApiToken`, schema `CurrentApiToken` = `ApiToken` +
  `allProjects` + `user`), a token only (a session gets 403 `forbidden`), `Cache-Control: no-store`.
  `whoami` reads it; the write probe is gone.
- **One JSON document per stream with `--json`:** warnings are gathered; a failure folds them into the
  error document (`warnings`), a success writes `{"warnings":[…]}` to stderr only when there are any, so
  stdout keeps the API's shape. Errors carry details: `tales create` stopping part way adds `file`,
  `created` (the tales made) and `leftWithoutMedia` when its cleanup failed. Progress (`Created tale`,
  `Created tag`) is for people only.
- **Prompts:** end of input is "Not confirmed" (exit 10); CI=true and TALEART_NO_INPUT=1 never ask.
- **Tokens:** anything shaped `tat_…` is redacted from every error; `login --token` always warns;
  `--token-stdin` refuses a terminal; a warning before a token goes over plain http to another machine.
- **Help for agents:** each command declares `mutates` and `result` (schema name); `help commands --json`
  is `{ version, globalOptions, commands }` with structured options, `globalFlags`, `auth`,
  `destructive`; `help exit-codes|output --json` are structured; a group without a command and `--json`
  prints JSON help (stdout) and the usage error (stderr), exit 2.
- **Safety:** `zones update --slug` is destructive (confirm); destructive commands resolve names
  exactly; the site-key confirmation names the project.
- **Display:** a new `--type` with `--set` merges into that type's defaults from `/frame-types`;
  values that look like numbers or booleans as text need `--settings`.
- **Config:** temporary file `wx` with a random name; an existing folder keeps its mode; login, logout
  and `config path` work with a corrupt file.
- **Robustness:** a 2xx whose body breaks off exits 9 (`response_interrupted`); EPIPE stops quietly.

## Verify

Story verify line: with a token, a script creates a zone, sets a bar display, creates a group with
two image tales from local files and turns it On; the Delivery API (and the test page link) shows it;
every command has `--help` and `--json`; tests run the CLI against a test API. A shell script does
that against the built API on port 3611 and its transcript is kept with the token redacted. Then the
full lint/test/build run.

</intent-contract>
