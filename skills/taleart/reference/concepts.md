# TaleArt concepts

Use these words with the user; they are the dashboard's words. `taleart help concepts` prints the
same summary.

| Term | Meaning | In the CLI's JSON |
| --- | --- | --- |
| Project | Holds zones, tale groups, user lists, tags and one site key. A token may reach only some projects. | `Project` (`id`, `name`) |
| Zone | A place on the site where tales show, named by its **slug** (lowercase letters, digits and hyphens, such as `home-top`). A page places it with `<taleart-view zone="home-top">`. | `Zone` (`id`, `slug`, `name`, `frame`, `visibility`) |
| Display | How a zone shows its tale groups: a **bar** (a row of circles, one per group) or a **banner** (wide slides that rotate). A zone has at most one. | `Zone.frame` (`type`, `settings`); `taleart zones display-types` |
| Site key | `tas_...`, one per project, shown only once when issued. Pages send it to the Delivery API with the zone slug. Rotating it breaks every page that has the old one. | `IssuedSiteKey.key` (once), `SiteKeyInfo.prefix` |
| Install snippet | The script tag and `<taleart-view>` element for a page, and a test page link. | `taleart zones snippet` |
| Tale group | A set of tales, one circle in a bar or one slide in a banner. Belongs to the project; placed in one or more zones, in an order per zone. | `TaleGroup` (`id`, `name`, `status`, `storedStatus`, `zoneIds`, `tales`, `tags`, `tagMatch`, `userLists`, `visibility`) |
| On / Off | A group shows only when **On** (stored `live`). New groups start Off (`draft`); Off is `paused`. | `taleart groups on`, `taleart groups off` |
| Tale | One page of a group: an image or a video, uploaded from a file. | `Tale` (`id`, `title`, `media`, `status`, `visibility`) |
| Shown / Hidden | A tale shows only when **Shown** (`live`); **Hidden** is `paused`. New tales start Shown. | `taleart tales show`, `taleart tales hide` |
| Tags | Targeting by the viewer's tags, which the page sets with the SDK. A group with no tags shows to everyone. | `TaleGroup.tags`, `tagMatch` |
| Any / All | How a group's tags combine: **Any** shows the group to a viewer with at least one of them, **All** only to a viewer with every one. A viewer whose page sets no tags always passes. | `--match any`, `--match all` |
| User list | A list of external user IDs (the site's own customer IDs) for targeting. A group targeted to lists shows only to viewers whose ID, set by the page with the SDK, is in one of them. | `UserList` (`id`, `name`, `idCount`) |
| External user ID | An opaque ID such as `cust-1001`, never an email address or a phone number. TaleArt stores only a keyed hash of each one and reports counts, never values. | CSV rows for `taleart user-lists upload` |
| Visible on site | Whether a zone, group or tale shows on the site right now, computed by the same rule the Delivery API uses. When not, the reason codes say why. | `visibility.visible`, `visibility.reasons[].code` |

## When a zone shows a group

All of these must hold:

1. The zone has a display (bar or banner).
2. The project has an active site key, and the page sends it.
3. The group is placed in the zone and is On, inside its schedule window if it has one.
4. The group has at least one Shown tale whose media is ready.
5. The viewer passes the group's targeting: its tags (Any or All) and, if it has user lists, the
   viewer's external user ID is in one of them.

Targeting is decided per viewer, so `visibility` cannot know a viewer's tags: a group targeted by tags
reads visible when everything else holds. A group targeted only to user lists that hold no ID reads
`audience-empty`.

## Privacy

- External user IDs are personal data of the user's customers. Put them only in a CSV file the user
  gives you, uploaded with `taleart user-lists upload`. Never in a URL, a query string, a command-line
  argument, a log, a commit or your report.
- An upload report gives counts only (`added`, `alreadyPresent`, `refused`, `emailLike`, `phoneLike`,
  `idCount`) and refused rows by line number. If `emailLike` or `phoneLike` is above zero, tell the user:
  the list holds what looks like email addresses or phone numbers, which should not be used as IDs.

## References the CLI accepts

- Projects by id or exact name; zones by id or slug; tale groups and user lists by id or name within
  the project; tales by id only.
- A name that matches nothing is exit 5, several is exit 6: then use the id from a `list` command.
- Destructive commands take exact names only.
