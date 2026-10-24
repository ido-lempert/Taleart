# Recipes

Exact commands for common tasks. Every command takes `--json` and prints one JSON document on stdout.
Replace `"Shop"` with the user's project (name or id) and the names with theirs. Before a recipe, run
`taleart whoami --json` once; before a command you have not used in this session, its help:
`taleart help <group> <command> --json`.

In a recipe, stop at the first command that exits non-zero, read the error on stderr and decide by the
exit code ([troubleshooting.md](troubleshooting.md)). Do not run the remaining steps blindly.

## 1. A zone with a bar, and its install snippet

```bash
taleart zones create --name "Home top" --slug home-top --project "Shop" --json
taleart zones display home-top --type bar --project "Shop" --json
taleart site-keys get --project "Shop" --json
taleart zones snippet home-top --project "Shop" --json
```

- `zones create --template stories-bar` instead of `zones display` gives the zone a bar in one step;
  `taleart zones display-types --json` lists the display types and their settings. Settings:
  `taleart zones display home-top --set size=large --set gap=8 --project "Shop" --json`.
- A banner: `taleart zones display home-top --type banner --project "Shop" --json`.
- `site-keys get` answers `null` when the project has no site key yet. Then, with the user's agreement
  (a project needs one to show anything), issue it:

  ```bash
  taleart site-keys issue --project "Shop" --json
  ```

  The answer's `key` is shown **once**: give it to the user to keep, do not write it to a file. When
  the project already has a key, `issue` answers exit 6 (`site_key_exists`) and changes nothing: the
  user has the key; never rotate to get it back.
- `zones snippet` answers `snippet` (the HTML for the page) and `testPageUrl`. Without
  `--site-key` the snippet says `YOUR_SITE_KEY`: the user puts their key there. Right after issuing,
  `taleart zones snippet home-top --site-key "<the key>" --project "Shop" --json` fills it in.

## 2. A tale group with image tales from local files, turned On

```bash
ls ./img
taleart groups create --name Summer --zone home-top --project "Shop" --json
taleart tales create --group Summer ./img/sunrise.png ./img/ocean.png --project "Shop" --json
taleart groups on Summer --project "Shop" --json
taleart groups get Summer --project "Shop" --json
```

- One tale per file, in the order given, each titled after its file (`--title` for one file only).
  Images (PNG, JPEG, WebP, GIF) and videos (MP4, WebM) are read by their first bytes; a bad file stops
  the command before anything is created (exit 7).
- If `tales create` stops part way, its error lists `created` (the tales made) and the `file` that
  failed. Report both; do not create the made ones again.
- Without `--zone`, the group belongs to the project and is placed nowhere: place it with
  `taleart groups place Summer --zone home-top --project "Shop" --json`.
- `groups on` warns (stderr `warnings`) when the group has no tales or no zone: pass that on.
- When the project already has a site key, `groups on` puts the group live on the site at once. The
  user asked for it here; when a task did not say "turn it On", ask first.
- Check `visibility` in the `groups get` answer; see recipe 5 when it is false.
- Hide one tale without deleting it: `taleart tales hide <tale id> --json` (`tales show` to undo).

## 3. Target a group with tags

```bash
taleart groups tags Summer --tag vip --tag beta --match all --project "Shop" --json
```

- The tags given become the group's whole set; missing tags are created in the project.
- `--match any` (the default) shows the group to a viewer with at least one of the tags; `--match all`
  only to a viewer with every one. A viewer whose page sets no tags always passes.
- Change only the match: `taleart groups tags Summer --match any --project "Shop" --json`.
- Remove every tag (the group then shows to everyone; confirm with the user first):
  `taleart groups tags Summer --clear --project "Shop" --json`.
- The page sets the viewer's tags with the Web SDK's `setTags`; the docs' Targeting page shows how.

## 4. A user list from a CSV, and a group targeted to it

The CSV holds one external user ID per row (a single column). **Never read its values**: do not
open, `cat`, `head`, print, count by value or summarise it. Ask the user whether its first row is a
header (a column name such as `user_id`) and pass `--header` only if they say yes; the upload report
then gives the counts.

```bash
taleart user-lists create --name VIPs --project "Shop" --json
taleart user-lists upload VIPs ./vips.csv --header --project "Shop" --json
taleart groups audience Summer --list VIPs --project "Shop" --json
taleart groups get Summer --project "Shop" --json
```

- `--header` skips the first row, as the user answered; leave it out when they say the first row is
  an ID. If the user does not know, upload without `--header`: a header row is then one extra ID (or
  a refused row), which they can judge from the counts.
- The upload is all or nothing: refused rows are reported by line number, never by value. Report
  `added`, `alreadyPresent`, `refused` and `idCount`; warn when `emailLike` or `phoneLike` is above 0.
- `groups audience` sets the group's whole set of user lists (`--list` again for more). The group then
  shows only to viewers whose ID is in one of them, and its tag rule still applies.
- Remove the audience (the group then shows to every viewer; confirm first):
  `taleart groups audience Summer --clear --project "Shop" --json`.
- The page sets the viewer's ID with the Web SDK's `setExternalUserId`.
- Deleting a list is destructive (its groups lose that audience and stay hidden until someone sets a
  new one): `taleart user-lists delete VIPs --project "Shop" --yes --json`, only after the user agrees.

## 5. Why is something not visible?

```bash
taleart zones get home-top --project "Shop" --json
taleart groups list --zone home-top --project "Shop" --json
taleart groups get Summer --project "Shop" --json
taleart tales list --group Summer --project "Shop" --json
taleart site-keys get --project "Shop" --json
```

- Read `visibility.reasons[].code` on the zone, the group and each tale, most useful first. Map each
  code to its fix with the table in [troubleshooting.md](troubleshooting.md#visibility-reasons), tell
  the user what is wrong and which command would fix it, and run the fix only if they ask.
- Everything visible but nothing on the page: check the page's snippet uses this zone's slug and the
  project's current site key (`site-keys get` answers its `prefix`), and the viewer passes the
  group's tags and user lists.
- This recipe only reads: a read-only token is enough.

## 6. Copy a group to another zone

```bash
taleart zones list --project "Shop" --json
taleart groups copy Summer --zone footer --project "Shop" --json
```

- The copy is an independent group with the **same name**, the same tales and tags, placed after the
  zone's groups. From then on the name matches two groups (exit 6), so use the copy's `id` from the
  answer: `taleart groups get <copy id> --json`, and rename it if the user wants
  (`taleart groups update <copy id> --name "Summer footer" --json`).
- The copy starts Off (`draft`), whatever the original's status. Turn it On with
  `taleart groups on <copy id> --json` if the user wants it showing, then check its `visibility`.
- Another project's zone: pass the zone's id (from `taleart zones list --project "Other" --json`).
  The copy does not take the original's user lists there (`audience-removed` until someone sets one).
- To show the **same** group in a second zone instead of a copy:
  `taleart groups place Summer --zone footer --project "Shop" --json`.

## 7. Rotate a site key safely

Rotating replaces the project's site key: the old one stops working **at once** on every page and in
every zone of the project, until each page has the new key. It is destructive.

```bash
taleart site-keys get --project "Shop" --json
taleart zones list --project "Shop" --json
```

1. Tell the user: the project, the current key's prefix, the zones that will stop showing until their
   pages are updated, and that the new key is shown once.
2. Wait for a clear yes. If they want to plan first (for example deploy the pages right after), stop
   here.
3. Only then:

   ```bash
   taleart site-keys rotate --project "Shop" --yes --json
   ```

4. Give the user the new `key` once, and the snippet with it:
   `taleart zones snippet home-top --site-key "<the new key>" --project "Shop" --json`. Do not write the
   key to a file.

`taleart site-keys revoke --project "Shop" --yes --json` turns every zone of the project off with no new
key: the same confirmation, stronger wording.

## Other changes

- Rename: `taleart zones update home-top --name "Home banner" --project "Shop" --json`,
  `taleart groups update Summer --name "Summer 2026" --project "Shop" --json`.
- Change a slug (destructive: pages with the old slug stop showing the zone):
  `taleart zones update home-top --slug home-banner --project "Shop" --yes --json`, only after the
  user agrees.
- Turn a group Off: `taleart groups off Summer --project "Shop" --json`.
- Take a group out of a zone (it stays in the project):
  `taleart groups unplace Summer --zone home-top --project "Shop" --json`.
- Delete a tale (destructive, for good): `taleart tales delete <tale id> --yes --json`, only after the
  user agrees; `tales hide` is the undoable alternative.
- Imports from another platform are read only here: `taleart imports list --project "Shop" --json`.
