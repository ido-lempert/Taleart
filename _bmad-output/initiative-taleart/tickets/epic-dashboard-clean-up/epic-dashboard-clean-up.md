---
type: epic
title: "Dashboard clean-up: less clutter, a real preview, bulk actions"
parent: initiative-taleart
covers: []
sources: []
companions: []
after: []
refined: false
risk: medium
---

# Dashboard clean-up: less clutter, a real preview, bulk actions

## Description

Seven fixes to the management dashboard from the owner's review of 2026-11-27: pictures where they are missing, a preview that looks like the visitor's page, fewer things competing for attention in the header and on the zone and tale group pages, a clearer zone icon, and selecting several rows to act on them together. The studio itself is not part of this epic.

## Outcome

A person managing zones and tale groups sees what visitors see, finds warnings without them taking over the page, and can act on many rows in one step.

## Requirements

- R20 (owner list, item 1): each tale group and each tale shows its main picture in the lists outside the studio. Shows it was met: the tale groups list and a group's tales list show a picture on every row that has one.
- R21 (owner list, item 2): the preview opened from a zone and the preview opened from a tale group both show the content laid out and styled exactly as a visitor sees it. Shows it was met: each preview and the live page render the same tale with no visible difference.
- R22 (owner list, item 3): the header does not show the signed-in user's role. Shows it was met: an admin's header carries no role text.
- R23 (owner list, item 4): with only one project, the header shows no project dropdown, and a new project is created only from the Projects page. Shows it was met: an install with one project has no dropdown, one with two projects has it, and the Projects page creates a project in both.
- R24 (owner list, item 5): the icon beside a zone's title has no surrounding frame and a larger inner glyph, a square with squares inside it. Shows it was met: the zone page shows that glyph large and unframed, approved by the owner on screen.
- R25 (owner list, item 6): on the zones list, the tale groups list and a tale group's page, warnings are a coloured marker (orange, red, or green) beside the name, with the detail in a tooltip, never open text blocks. Shows it was met: a page with warnings shows no open warning text, and hovering or focusing the marker shows the reason.
- R26 (owner list, item 7): lists such as zones, tale groups, API tokens and other lists let the user select several rows and run any action that works on one row on the whole selection. Shows it was met: select three tale groups and delete them in one action; select two API tokens and revoke them together.

## Constraints

- A visual change refreshes whatever shows it: docs images, previews, and sample apps (owner's standing rule).

## Done when

- The header carries no role label and no project dropdown for a one-project install.
- A zone's preview and a tale group's preview match the visitor's page.
- Tale group and tale lists show main pictures; warnings are tooltips on a coloured marker.
- Several rows of a list can be selected and acted on together.
- The docs images that show these screens are refreshed.

## Boundaries

- Out: anything inside Tale Studio.
- Out: sign-in and 2FA screens, which belong to the two-factor epic.
- Must not change: what each warning says and when it appears; only where it is shown.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`; requirement ids R20 to R26 extend its numbering after the two-factor epic's R14 to R19 and need adding there when this epic is adopted.

## Notes

- Decision (2026-11-27): R23 a new project is created only from the Projects page; R24 the zone icon is a square with squares inside it; R21 both the zone Preview and the tale group Preview are in scope.
- Decision (2026-11-27): R26 reaches API tokens and other lists as well as zones and tale groups.
- Decision (2026-11-27): R26 selection reaches every list whose rows have a single-row action: zones, tale groups, API tokens, members, invitations, tales, media, fonts, user lists, and tags.
- Assumption: tooltips open on keyboard focus and are read by screen readers, as the dashboard's accessibility reviews require.
- Assumption: R20 to R26 extend the initiative's numbering after R19.
- Unknown: the epic's position in `tickets.toml` (build order) is not set; it waits on the owner's call.
