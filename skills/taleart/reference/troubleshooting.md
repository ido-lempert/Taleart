# Troubleshooting

With `--json`, a failure prints one document on stderr:

```json
{"error":{"code":"slug_taken","message":"A zone with this slug already exists","status":409,"exitCode":6,"hint":"..."}}
```

`code` is the API's error code or one of the CLI's (`taleart help output --json` lists them); `status`
is the HTTP status when the API answered. Decide by the exit code, tell the user the `message`, and
follow the `hint`. `taleart help exit-codes --json` lists the codes.

## By exit code

**2, usage.** An unknown command or flag, a missing argument, a bad value, or no project chosen.
Do not guess another spelling: read `taleart help commands --json` (or
`taleart help <group> <command> --json`) and use what it lists. `No project chosen`: pass
`--project <id|name>` (`taleart projects list --json` lists them).

**3, not authenticated.** `no_api_url` or `no_token`: the environment has no `TALEART_API_URL` or
`TALEART_TOKEN` and nothing is stored; `invalid_token`: the value does not start `tat_`;
`unauthenticated` (401): the token is unknown, revoked or expired. Ask the user to create a token in the
dashboard (Settings > API tokens) and set it themselves; never ask for it in the chat.

**4, forbidden.** The token is read-only, does not reach that project, or the user's role does not
allow the change (for example a viewer, or a site key change by a non-admin). Tell the user which; do
not look for a way around it.

**5, not found.** An id, slug or name that matches nothing in the project. Run the matching list
(`taleart zones list --json`, `taleart groups list --project "Shop" --json`,
`taleart user-lists list --project "Shop" --json`) and use an exact name or the id. Tales are by id
only (`taleart tales list --group Summer --project "Shop" --json`). A project the token does not reach
also answers 404 or 403.

**6, conflict.** `slug_taken`: pick another slug or use the existing zone (ask the user which).
`ambiguous`: a name matches several objects; use the id. `site_key_exists`: the project already has a
site key; the user has it (never rotate just to see a key). `invalid_status_transition`: an archived or
processing group cannot be turned On or Off.

**7, refused input.** A value the API refused (`validation_failed`, the message names the field), a
local file that is missing (`file_not_found`), empty, too large or not an image or video
(`unsupported_media_type`), a CSV with refused rows (reported by line number). Fix what the message
names, then run the command again once.

**8, rate limited or server error.** Wait a few seconds and retry once. A feature turned off on the
server also lands here. Then report the message.

**9, unreachable.** `api_unreachable`, `timeout` or `response_interrupted`: check `TALEART_API_URL`
(`taleart config show --json` says where it comes from) and that the API runs. A write that timed out
may have happened: read before retrying (for example `taleart groups get Summer --json`).

**10, confirmation needed.** A destructive command without `--yes`. Nothing was changed. Ask the user,
naming what will happen; add `--yes` only after a clear yes.

**1, unexpected.** Report the message and the command; do not retry in a loop.

## Visibility reasons

`visibility.reasons[].code` on a zone, group or tale, most useful first. The dashboard shows the same
as "Visible on site" or "Not visible: <reason>".

| Code | Means | Fix (only when the user asks) |
| --- | --- | --- |
| `archived` | The group or tale is archived. | Restore it in the dashboard. |
| `group-blocked` | A process holds the group (media processing, invalid media, quota). | Wait, or fix the tales' media. |
| `group-off` | The group is Off. | `taleart groups on Summer --project "Shop" --json` |
| `not-in-any-zone` | The group is placed in no zone. | `taleart groups place Summer --zone home-top --project "Shop" --json` |
| `tale-hidden` | The tale is Hidden. | `taleart tales show <tale id> --json` |
| `media-processing` | The tale's media is still processing. | Wait, then read again. |
| `media-problem` | The tale's media is invalid or over quota. | `taleart tales media <tale id> ./img/new.png --json` |
| `not-updated-yet` | Nothing was published for the tale yet. | Publish it in Tale Studio (dashboard). |
| `starts-at` / `ended-at` | Outside the group's schedule window (`at` says when). | Change the schedule in the dashboard. |
| `zone-no-display` | The zone has no bar or banner. | `taleart zones display home-top --type bar --project "Shop" --json` |
| `zone-not-installed` | The zone has no active zone key. | `taleart zone-keys issue home-top --project "Shop" --json`, then the snippet on the page. |
| `no-tale-groups` | The zone has no groups. | `taleart groups place Summer --zone home-top --project "Shop" --json` |
| `no-shown-tales` | The group has no Shown tale with media. | `taleart tales create --group Summer ./img/one.png --project "Shop" --json` |
| `audience-empty` | The group's user lists hold no ID. | `taleart user-lists upload VIPs ./vips.csv --project "Shop" --json` |
| `audience-removed` | The group's user lists were removed (deleted, or copied to another project). | `taleart groups audience Summer --list VIPs --project "Shop" --json`, or `--clear` for everyone. |
| `no-visible-groups` | The zone has groups but none is visible. | Read each group's reasons. |

Tags are decided per viewer, so no reason code covers them: a group can read visible and still not show
to a viewer whose tags do not match (`tagMatch` any or all).

## Common mistakes

- Running a command without `--json` and parsing its table: rerun with `--json`.
- Turning a group On before it has tales: `groups on` works and warns; add the tales.
- Two zones with the same slug in different projects: pass `--project`, or the zone's id.
- A video still processing after upload reads `media-processing` for a while: that is expected.
