---
name: taleart
description: Manages TaleArt projects through the taleart command-line tool - zones and their bar or banner displays, tale groups and their tales, targeting by tags and user lists, site keys and install snippets. Use when the user asks to create, change, check, copy or troubleshoot TaleArt zones, tale groups, tales, targeting or site keys, or to find out why TaleArt content does not show on a site.
---

# TaleArt through the taleart CLI

TaleArt shows tales (image or video pages) on a website. The `taleart` CLI drives its Management API
with an API token. Every task here runs through that CLI; never call the API by hand when a command
exists.

## Before anything: check access

```bash
taleart whoami --json
```

- Exit 0: note `user.role`, `readOnly`, `projects` and `defaultProject`.
- Exit 3: there is no URL or token. Ask the user to set them; see [reference/setup.md](reference/setup.md).
- `taleart` not found: see "Get the CLI" in [reference/setup.md](reference/setup.md).

The token lives in the environment (`TALEART_TOKEN`) or in the config file written by
`taleart login --token-stdin`. **Never print, echo, log or write the token anywhere, never pass it with
`--token`, and never ask the user to paste it into the chat.** The CLI only ever shows its prefix
(`tat_` and 6 characters).

## Operating rules

1. **Always pass `--json`** and parse stdout: it holds exactly one JSON document, the API's answer
   (a `Zone`, a `TaleGroup`, a list...). Do not scrape the human-readable tables.
2. **Read errors from stderr.** With `--json` a failure writes one document,
   `{"error":{"code","message","status","exitCode","hint"}}`. Decide by the exit code
   (table below), explain the `message` and follow the `hint`. A success with warnings writes
   `{"warnings":[...]}` to stderr: pass them on to the user.
3. **Discover, never guess.** Run `taleart help commands --json` once per session for every command's
   options, arguments, `mutates`, `destructive` and `result` schema, or `taleart help <group> <command>`
   for one. Use only flags it lists.
4. **Read-only first.** For a task that only reads (list, check, explain), prefer a read-only token
   (`readOnly: true` in `whoami`). If the token in use can write, still run only read commands.
5. **Confirm destructive commands.** Before any command whose `destructive` flag is `true`
   (`site-keys rotate`, `site-keys revoke`, `tales delete`, `user-lists delete`,
   `zones update --slug`), tell the user exactly what it will do and what breaks, and wait for a clear
   yes. Only then add `--yes`. Never add `--yes` on your own. Without it the CLI stops with exit 10 and
   changes nothing.
6. **Confirm other changes that are hard to undo** or reach live viewers (turning a group On in a zone
   that is already installed, clearing a group's tags or audience) when the user did not ask for them
   in so many words.
7. **Run no more than needed.** No exploratory writes, no test objects, no retries of a write that
   failed with exit 4, 6 or 7 without changing something first. A read is fine to repeat.
8. **Pick the project explicitly.** Pass `--project <id|name>` (or rely on `defaultProject` when the
   user means it). Names must be exact for destructive commands.
9. **Report what changed:** for each object created or changed, its kind, name or slug, id, status
   (On/Off, Shown/Hidden) and whether it is visible on the site (`visibility.visible`, or the reason
   codes). Say what you did not do and why.
10. **Privacy.** External user IDs go only into a CSV file given to `user-lists upload`; never put
    them in a URL, a command argument, a log or your report. TaleArt stores only keyed hashes and
    reports counts. A site key (`tas_...`) is shown once: give it to the user, never write it to a file
    unless they ask.

## Exit codes

| Code | Meaning | What to do |
| --- | --- | --- |
| 0 | Success | Parse stdout. |
| 1 | Unexpected error | Report it with the message; do not retry blindly. |
| 2 | Usage error (unknown command or flag, missing argument, no project) | Re-read `taleart help commands --json`; pass `--project`. |
| 3 | Not authenticated (no URL or token, or 401) | Ask the user to set `TALEART_API_URL` and `TALEART_TOKEN`. |
| 4 | Forbidden (403: role, the token's projects, or a read-only token) | Tell the user which token or role is needed. |
| 5 | Not found (404, or a name or slug matching nothing) | List first (`zones list`, `groups list`) and use the exact name. |
| 6 | Conflict (409, or a name matching several) | Use an id, or pick another slug or name. |
| 7 | Refused input (400, 413, 415, 422, or a bad local file) | Fix the value or the file the message names. |
| 8 | Rate limited or server error (429, 5xx) | Wait and retry once; then report. |
| 9 | API unreachable or timed out | Check `TALEART_API_URL`; report. |
| 10 | Confirmation needed | Ask the user; add `--yes` only after they agree. |

More in [reference/troubleshooting.md](reference/troubleshooting.md).

## The main recipe: a zone with a bar and a group of two tales, On

User: "create a zone home-top with a bar and a group Summer with two tales from ./img, and turn it On".

```bash
taleart whoami --json
taleart zones create --name "Home top" --slug home-top --project "Shop" --json
taleart zones display home-top --type bar --project "Shop" --json
taleart groups create --name Summer --zone home-top --project "Shop" --json
taleart tales create --group Summer ./img/sunrise.png ./img/ocean.png --project "Shop" --json
taleart groups on Summer --project "Shop" --json
taleart groups get Summer --project "Shop" --json
taleart zones snippet home-top --project "Shop" --json
```

- List `./img` first and pass the image or video files it holds, in the order the user wants.
- `groups get` answers `visibility`: when `visible` is false, `reasons[].code` says why (often
  `zone-not-installed`: the project has no site key yet; see the site key recipe).
- Give the user the snippet and the `testPageUrl` from `zones snippet`.

Every other recipe (install snippet and site key, image tales, tags, user lists, why something is not
visible, copying a group, rotating a site key) is in [reference/recipes.md](reference/recipes.md).

## Concepts in one breath

A **project** holds zones, tale groups and one **site key**. A **zone** is a place on a page, named
by its **slug**, with one **display** (bar or banner). A **tale group** is a set of **tales**; it is
placed in zones and is **On** or **Off** (new groups start Off). A tale is **Shown** or **Hidden**.
**Tags** (with match **Any** or **All**) and **user lists** (external user IDs) target a group to some
viewers. "**Visible on site**" (`visibility.visible`) says whether it shows now. Details:
[reference/concepts.md](reference/concepts.md).

## Reference

- [reference/setup.md](reference/setup.md): get the CLI, the token, projects, config.
- [reference/concepts.md](reference/concepts.md): every TaleArt term and the visibility rule.
- [reference/recipes.md](reference/recipes.md): exact commands for common tasks.
- [reference/troubleshooting.md](reference/troubleshooting.md): by exit code and by visibility reason.
