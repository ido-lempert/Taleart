# Setup: the CLI, the token, the project

## Get the CLI

Check first:

```bash
command -v taleart && taleart --version --json
```

If `taleart` is not on the PATH, it is built from the TaleArt repository (Node 22 or later, no other
runtime):

```bash
node_modules/.bin/nx run cli:build
node dist/apps/cli/taleart.js --version --json
```

The build is one file, `dist/apps/cli/taleart.js`. Either put it on the PATH once
(`ln -s "$PWD/dist/apps/cli/taleart.js" ~/.local/bin/taleart`, with the user's agreement) or write
`node <repo>/dist/apps/cli/taleart.js` wherever these files say `taleart`.

## Install this skill

```bash
taleart skill install            # for the user: ~/.claude/skills/taleart
taleart skill install --project  # for this repository: .claude/skills/taleart
taleart skill install --dir ~/.agents/skills   # another agent's skills folder
```

The CLI carries the skill's files. When the folder already holds different files, it stops (exit 6)
unless `--force` is given. Copying the `skills/taleart` folder of the repository to one of those places
does the same.

## The API URL and the token

The CLI reads, first match wins:

- API URL: `--api-url`, then `TALEART_API_URL`, then the config file.
- Token: `TALEART_TOKEN`, then the config file.
- Project: `--project`, then `TALEART_PROJECT`, then the config file (`taleart projects use`).

The user creates the token in the dashboard: **Settings > API tokens**. It starts `tat_`, is shown
once and can be limited to some projects and to read-only. Ask the user to put it in the environment
themselves (their shell profile or a secret manager), for example:

```bash
export TALEART_API_URL=https://taleart.example.com
export TALEART_TOKEN=...   # the user types or pastes this in their own terminal, never in the chat
```

Or, to store it in the CLI's config file (mode 0600), the user runs in their terminal:

```bash
taleart login --url https://taleart.example.com --token-stdin < token.txt
```

`--token-stdin` keeps the token out of the shell history and the process list. Never use the
`--token` flag of `taleart login`, never `echo` the token, never write it to a file you keep, and never ask for it
in the chat. If the user pastes a token into the chat anyway, do not repeat it; suggest they revoke it
and create another.

An agent runs with the user's environment, so `TALEART_TOKEN` is within its reach. Keep it unread:

- Never run `env`, `printenv`, `set`, `export -p`, `declare -x` or `set -x` (they print every
  variable, the token included), and never `echo $TALEART_TOKEN` or expand it in any command.
- Never read, `cat`, open, copy or search the CLI's config file (`taleart config path` says where it
  is) or any file that holds a token (such as `token.txt` above).
- To see what is set, use `taleart whoami --json` or `taleart config show --json`: they name the
  source of the URL and the token (`env` or `config`) and show the token's prefix only.

Check:

```bash
taleart whoami --json
taleart config show --json
```

`whoami` answers the user, role, token name, `readOnly`, `allProjects`, `expiresAt`, the projects the
token reaches and the default project, and only the token's prefix. `config show` says where each
setting comes from.

## Read-only or read-write

- A task that only reads (list zones, explain why a group does not show, report statuses) needs only a
  read-only token. If the user has one for such tasks, ask them to use it.
- A read-only token answers exit 4 (`forbidden`) to any change: tell the user a read-write token is
  needed rather than looking for a way around it.
- An admin's read-write token can issue, rotate and revoke zone keys (one zone each) and site keys (every zone of the project, server-side only).

## Choose the project

```bash
taleart projects list --json
```

Pass `--project <id|name>` on each command (safest when the token reaches several), or, with the
user's agreement, make one the default in the config file:

```bash
taleart projects use "Shop" --json
```

## Non-interactive by design

The CLI never asks a question when stdin or stderr is not a terminal, with `--json`, or when `CI=true`
or `TALEART_NO_INPUT=1` is set. A destructive command then stops with exit 10 and changes nothing.
Set `TALEART_NO_INPUT=1` in your environment to be sure no prompt ever waits for input.
