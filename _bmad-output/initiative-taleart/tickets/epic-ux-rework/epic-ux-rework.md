---
type: epic
title: "UX rework: a zone is a spot, one switch makes content visible"
parent: initiative-taleart
id: 8
covers: [R9, R11, R6, R13, R3]
sources: [_bmad-output/initiative-taleart/ux-review-2026-10-23/ux-report.md, _bmad-output/initiative-taleart/initiative-taleart.md]
companions: [_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md, _bmad-output/initiative-taleart/prd-taleart/prd-taleart.md]
after: []
refined: true
risk: high
---

# UX rework: a zone is a spot, one switch makes content visible

## Description

The UX review of 2026-10-23 walked the built dashboard as a new user and found that "Live" does not mean "visible", that every tale has to be published by hand, that "Publish" means two things, that schedules look required, that the tale group row is overloaded, and that zone, frame, stage and playbook do not match how people think (`ux-report.md`, sections 1 and 2). The owner took every recommendation (decisions D1 to D7, 2026-10-23, in Notes).

This epic changes the concept model and the status model first, with their migrations and the Web SDK's backward compatibility, then the dashboard layout, then copy and polish. When it is done:

- A **zone** is one spot in an app or site with one **display** (today's frame: bar or banner). Stages are gone: each one became its own zone. Playbooks are **templates** picked when a zone is created.
- A host page loads the Web SDK with one **site key** per project and names the zone (`zone="home-top"`). Old zone keys and the `stage` attribute are removed (R4 retired, owner decision 2026-10-22).
- A tale group has one **On / Off** switch. When it is On, its tales show by default, and each tale can be hidden. Archive sits in the ⋯ menu. The stored status keys stay as they are (AD-6).
- Every zone, tale group and tale says **"Visible on site"** or **"Not visible because…"**, computed by the same rule the Delivery API uses.
- Tale Studio's "Publish changes" is **"Update tale"**; "Publish" and "On" only mean visibility.
- The zone page has a setup checklist and three tabs (Tale groups, Display, Install), the tale groups are a scannable list with a switch and a ⋯ menu, schedules stay out of sight until used, and the Tale groups page gets filters and a "New tale group" button.

## Outcome

A content manager who has never used TaleArt goes from sign-up to a tale visible on a test page in about 15 actions (35 today, report section 6), and at every step the dashboard says whether each zone, group and tale is visible and, if not, why.

## Requirements

R1 (parent R9, R11; report §3; D1): **A zone is one spot with one display**
   A zone has a name, a **slug** (lowercase letters, digits and hyphens, unique in its project; the value a host page puts in `zone="…"`), and at most one **display**: a frame type from the registry (bar or banner) with its settings, validated as today (AD-5). A content manager changes the display's type and settings at any time; changing the type resets the settings to that type's defaults. Stages do not exist in the dashboard, the Management API or the Delivery API. A zone without a display delivers nothing and says so (R7).
   Verify: create a zone, set a bar display, switch it to a banner and back; the Management API refuses a second display, a duplicate slug in the project, and a slug with spaces; no stage endpoint or card remains.

R2 (parent R11, R3; report §3 Migration; D1): **Stages and frames migrate into zones**
   A forward-only migration turns every existing zone into zones with one display each, so no content and no page placement is lost:
   - A zone with stages: the original zone keeps its id and becomes the zone of its first stage (oldest first); every further stage becomes a new zone. Each takes the stage's name and its key as slug, and the stage's frame as its display.
   - A frame that no stage shows, and every frame of a zone without stages beyond the first, becomes a new zone named "<zone name> – <frame type> <n>", with that frame as its display. In a zone without stages the original zone keeps its first frame.
   - Every new zone gets a copy of the original zone's tale group placements, in the same order (AD-14).
   - Each new zone records the original zone's id and, when it came from a stage, the stage key, so old zone keys keep resolving (R4).
   - A zone that had no frame stays one zone with no display. The `playbook_key` stays only as a "created from template" note.
   - Slugs are derived from the zone name when there is no stage key, made unique in the project with a numeric suffix.
   Verify: on a database seeded with a zone of two stages and an unstaged frame, and a zone of two frames without stages, the migration yields five zones with one display each, the right names and slugs, and identical placement lists; running it twice changes nothing.

R3 (parent R9; report §3 Impact; D6): **One site key per project, zones named on the page**
   A project has at most one active **site key**: random, shown once, stored hashed, rotated and revoked like a zone key (AD-9). A host page places a zone with `<taleart-view site-key="…" zone="home-top">` (or the same as properties); several `<taleart-view>` elements on a page share one site key. The Delivery API answers a site key plus a zone slug with that zone's display and its tale groups, and refuses an unknown slug like a refused key: the element renders nothing and logs one console error. A theme override in the SDK configuration is set per zone slug.
   Verify: issue a site key, place two zones of the project on the sample page with it, see each zone's own display and groups; an unknown slug and a revoked site key render nothing and log one error each; a theme override for one slug changes only that zone.

R4 (parent R9, R10; report §3 Impact; D6): **Old zone keys and the `stage` attribute keep working** — RETIRED (owner decision 2026-10-22, see Notes): nobody used them; story 7 removed zone keys, the `stage` attribute and `configureZone(zoneKey)`. Kept below for the record only.
   - A zone key issued before the rework keeps working, with the current SDK and with an SDK build from before the rework.
   - A zone key with `stage="key"` shows the zone migrated from that stage.
   - A zone key with no `stage` shows what it showed before: every display migrated from that zone, in the old frame order, each with its own zone's tale groups.
   - `configureZone(zoneKey, …)` keeps applying its theme override.
   - Zone keys can still be rotated and revoked from the zone's Install tab (R13); new zones get no zone key.
   Verify: the sample page's legacy-SDK check passes unchanged against the reworked API with a pre-rework key, with and without `stage`; the current SDK shows the same with the same key; rotating the old key refuses the old secret.

R5 (parent R11; report §6 #11; D7): **Templates are picked when a zone is created**
   The New zone drawer offers the templates "Stories bar" and "Promo banner" (today's playbook presets) and "Blank". A template sets the zone's display and settings once; nothing links the zone to the template afterwards except the "created from template" note. The Playbook card and the apply-playbook action are gone. When the user can access only one project, the drawer preselects it and hides the picker.
   Verify: create a zone from each template and see the preset display; with one project the drawer shows no project picker; no Playbook card or apply action exists.

R6 (parent R6; report §4; D2, D3): **On / Off and Shown / Hidden, with the stored keys kept**
   - The stored status keys of AD-6 stay. The dashboard shows a group as **On** (`live`) or **Off** (`draft` or `paused`), and a tale as **Shown** (`live`) or **Hidden** (`draft` or `paused`); Archived appears only from the ⋯ menu and in filters.
   - Turning a group Off stores `paused`; hiding a tale stores `paused`; turning On or showing stores `live`.
   - New tale groups start Off (`draft`). New tales start Shown (`live`), so turning a group On shows all its tales; a tale is hidden one by one.
   - A tale is delivered only when it has a published document (AD-15). A new tale made from uploaded media has its media document published at creation; a tale whose Studio draft was never updated to the site is not delivered and says "Not visible: not updated yet" (R7, R15).
   - A tale in a group that is `draft` or `paused` reads `blocked-by-group`, not only in a paused group.
   - Migration: tales stored `draft` in a group that was never live become `live`, so they show when the group is turned On; draft tales in a live group stay `draft` (Hidden), so nothing becomes visible on any site through the migration.
   Verify: on the sample page, create a group with three tales from media, turn the group On: all three show; hide one: it is gone, the others stay; turn the group Off: nothing shows and each tale reads blocked by group; a database snapshot taken before the migration and the Delivery responses for every zone are identical after it.

R7 (parent R6, R9; report §1, §4; D2): **One "Visible on site / Not visible because…" indicator**
   The Management API returns, for each zone, each placement of a group in a zone, and each tale, whether it is visible on the site now and the reasons it is not, from one function that the Delivery API also uses, so the indicator and the site cannot disagree. Reasons: group off, tale hidden, group blocked, archived, no shown tales, not in any zone, starts at (time), ended at (time), zone has no display, zone not installed (its project has no active site key; zone keys removed 2026-10-22), media still processing, media problem, not updated yet. The dashboard shows a filled dot and "Visible on site", or a hollow dot and "Not visible:" with the first reason in plain words (all reasons on hover and focus). Every tale card shows a dot, Shown tales included.
   Verify: for each reason, a fixture puts content in that state and the indicator names it while the sample page shows nothing; once fixed, the indicator says "Visible on site" and the sample page shows it; a unit test runs the indicator and the Delivery filter on the same fixtures and they agree on every case.

R8 (parent R6; report Note 1, §6 #7): **Schedules stay out of sight until used**
   Schedule is an item in the ⋯ menu of a group and of a tale. No "No schedule" text appears anywhere. When a window exists, a chip shows it ("Starts 1 Dec 09:00", "Ends 3 Nov"), and the schedule drawer offers "Remove schedule" only then. A window that hides content is a reason in the indicator (R7).
   Verify: a group and a tale without a window show no schedule text or button outside the ⋯ menu; set a future start: the chip and "Not visible: starts …" appear; remove it: both are gone.

R9 (parent R9; report §5, §6 #6): **Zone page: a header, a setup checklist and three tabs**
   The zone page header shows the zone name, the indicator (R7) and a summary (display type, group count, Installed or Not installed). Tabs: **Tale groups** (default), **Display** (type, settings, a link "Style: project theme" to the theme page) and **Install** (R13), as a keyboard-operable tab list whose selection is in the URL. Until the zone is first visible, a checklist shows its steps (a display, an installed key, a group that is On with a shown tale), each ticked when done and linking to where it is done.
   Verify: a new zone opens on Tale groups with the checklist showing three open steps; completing each ticks it; once the zone is visible the checklist is gone and stays gone; reloading on the Display tab keeps the tab.

R10 (parent R9; report Note 3, §5; D5): **Tale groups as a list with status**
   On the zone page each placed group is one row: reorder handle (drag and keyboard), cover, name, tales count ("3 of 4 shown"), the On/Off switch, the indicator text, and a ⋯ menu with Rename, Cover, Tags, Schedule, Show in another zone, Copy to zone, Remove from this zone and Archive. A menu item that cannot apply is disabled with its reason ("Already in every zone"), never replaced by grey text. Below the list: "New tale group" and "Add existing group". Clicking a row opens the group (R11). At 390 px wide the row stacks into two lines with no horizontal scroll and no word broken mid-letter. A card view is out of scope (D5).
   Verify: a zone with three groups lists them with their counts and indicators; switching a group On updates its indicator and the sample page; each ⋯ item works; at 390x844 a screenshot shows full names and no horizontal scrollbar.

R11 (parent R6, R13; report §5, §6 #3, #14): **Group view with per-tale show and hide**
   A group opens in a wide drawer (a page on phones) with its tale strip, "Add tale", and on each tale card a Shown/Hidden toggle, the indicator dot and a ⋯ menu (Edit in Tale Studio, Replace media, Schedule, Archive). Hiding or showing a tale takes one action and saves at once.
   Verify: open a group of four tales, hide one from its card in one action: the sample page shows three; show it again: four.

R12 (parent R13; report §6 #8): **The tale drawer saves status at once and closes with Done**
   In the tale drawer, the Shown/Hidden toggle and status actions sit at the top and save immediately; "Replace media" is its own action; the footer has one "Done" button. Nothing in the drawer suggests that closing it discards a status change.
   Verify: hide a tale in the drawer and press Done: it stays hidden; replace its media: the new media shows on the sample page.

R13 (parent R9; report §5, §6 #10; D6): **Install tab: key, snippet and test page**
   The Install tab issues, rotates and revokes the project's site key (shown once, with the warning that rotating affects every zone of the project), shows the copy-ready snippet with the API URL and this zone's slug filled in, with a Copy button, and an "Open test page" link that renders the zone with the Web SDK on a TaleArt-served test page, using the key just issued or one pasted there. A zone migrated from a zone key also lists that legacy key with rotate and revoke (R4).
   Verify: issue a site key on the Install tab, copy the snippet into a blank HTML page: it shows the zone; "Open test page" shows the same; a migrated zone shows its legacy key.

R14 (parent R9; report §5, §6 #9, #12): **Zones list and Tale groups page show status**
   The zones list shows each zone with its indicator, display type, group count and Installed or Not installed. The Tale groups page uses the same list row as R10 (with the zones each group is in), filters Visible, Off, Scheduled, Not in a zone and Archived, and a "New tale group" button.
   Verify: with zones and groups in every state, each filter lists exactly the matching groups; "New tale group" creates a group from that page; zone rows show the right indicator and install state.

R15 (parent R13; report Note 2, §4; D4): **Tale Studio says "Update tale"**
   Tale Studio's "Publish changes" is renamed **"Update tale"** and "Discard draft" is **"Discard changes"**; the word "Publish" no longer appears in the studio. The status line uses the indicator's words: "Visible on site · changes not updated yet", "Visible on site · up to date", or "Not visible: <reason> · <n> changes not updated yet". The behaviour stays as AD-15 defines it: updating copies the draft to the published document.
   Verify: edit a visible tale: the status line says changes are not updated yet and the sample page is unchanged; press Update tale: the sample page shows the edit and the line says up to date; in a group that is Off the line says "Not visible: group is off".

R16 (parent R9; report §6 #13, #15 to #18): **Copy and small fixes**
   The API-unreachable banner says "We can't reach TaleArt. Retrying…" with no developer text; the Tale Studio keyboard help is a "?" popover, closed by default; the Studio's back link names its group ("Back to Summer sale"); no screen names a frame "Frame 1 · Bar".
   Verify: stop the API: the banner shows the new text; Tale Studio opens with the help closed and the back link names the group.

R17 (parent R9, R10; report §3): **Docs say site key and zone, and explain the move**
   The Web SDK README, the docs app and the dashboard's terms use Zone, Display, Template, Tale group, Tale and Theme as the report's glossary defines them. The docs show the `site-key` and `zone` snippet, say that the old `zone-key` and `stage` attributes were removed in story 8.7 (owner decision 2026-10-22, R4 retired) and how to move a page to the site key and the zone's slug, and explain what the migration did to stages and frames.
   Verify: the README and docs pages contain no instruction to create a stage or apply a playbook, and the snippet in the docs renders a zone when pasted into the sample page.

R18 (parent R9; architecture Quality Targets, NFR-007): **Accessible rework**
   Every reworked screen meets WCAG 2.2 AA: switches and toggles are named and expose their state; ⋯ menus follow the menu button pattern; tabs follow the tab pattern; reorder works by keyboard and is announced; status changes are announced in a live region; targets are at least 24 by 24 px (2.5.8); focus is never hidden by the drawer or sticky headers (2.4.11).
   Verify: an automated WCAG 2.2 AA scan of the zones list, zone page (each tab), group drawer, tale drawer, Tale groups page and Tale Studio status bar reports no violations, and a person completes the first-run path with only a keyboard and a screen reader.

## Constraints

- **Contract first.** The status display mapping, visibility reasons, template registry, site key and zone slug shapes start in `libs/contract`. Source: AD-3.
- **Stored status keys stay.** No new stored status key; On/Off and Shown/Hidden are display names over AD-6 keys. Source: AD-6 (amended 2026-10-23).
- **Frame types are data.** A display is a frame row with a registry type and JSONB settings. Source: AD-5.
- **Credentials hashed, shown once.** Site keys follow the zone key rules. Source: AD-9, NFR-003.
- **Forward-only migrations, owned by their module.** Source: architecture Consistency Conventions.
- **Web SDK budget** of 50 KB gzipped and 1.5 s p75 first content. Source: architecture Quality Targets.
- **WCAG 2.2 AA** for the dashboard and Web SDK UI. Source: architecture Quality Targets.
- **No Storyly brand names.** Source: AD-12, PRD NFR-004.

## Done when

- A new user signs up, creates a zone from a template, adds a group with two tales from media, turns it On, and sees the tales on the test page in at most 15 actions, with no tale published by hand.
- Every zone, group and tale shows "Visible on site" or "Not visible: <reason>", and an automated check shows it agrees with the Delivery API on every reason.
- A database from before the rework migrates with every zone, stage and frame accounted for. (The pre-rework SDK build and zone keys are no longer supported: R4 retired, owner decision 2026-10-22.)
- The Install tab's snippet with a site key and zone slug renders the zone on a blank page.
- The WCAG 2.2 AA scans of the reworked screens are clean and a person's keyboard and screen-reader walk of the first-run path is recorded.

## Boundaries

- Not in this epic: a card or grid view of tale groups (D5, later); folding the schedule into the visibility control ("On between…", report Note 1 option C, later); campaigns and journeys (post-MVP).
- The tale document, its draft and published copies and the Studio editor belong to epic-tale-studio; this epic only renames the Studio's update control and its status line (R15).
- Analytics events keep `zone_id` and `frame_id` (AD-10); a display keeps its frame id, so no event field changes.
- Touch point: importer — a Storyly zone imports as one TaleArt zone; status mapping (importer story 2.11) uses the stored keys and R6's defaults; owner: epic-storyly-importer.
- Touch point: Tale Studio publish bar and tale status calls — renamed and re-worded here (R15); owner: epic-tale-studio.
- Must not change: what any existing host page shows (R2, R4), the tale document and its delivery (AD-15), frame rendering, theme resolution order, and the 50 KB / 1.5 s budget.
- Tracer path: status model (story 1) and indicator (story 2) change what every later screen shows; the zone fold (stories 5 to 8) changes the API and SDK the Install tab (13) and docs (16) describe.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R3, R6, R9, R11, R13)
- ux review — `_bmad-output/initiative-taleart/ux-review-2026-10-23/ux-report.md`, sections 1 to 7; screenshots in the same folder
- architecture — `_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md`, AD-2, AD-5, AD-6, AD-9, AD-14, AD-15, AD-17, Quality Targets
- prd — `_bmad-output/initiative-taleart/prd-taleart/prd-taleart.md`, FR-003, FR-005, FR-006, FR-008, FR-009, FR-013
- web zones — `_bmad-output/initiative-taleart/tickets/epic-web-zones/epic-web-zones.md`, R5 to R8 (built behaviour this epic changes)
- tale studio — `_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md`, R1, R9

## Notes

- Decision (2026-10-23, owner, D1): a zone is one spot on a page or app screen with one display style ("Display" is today's frame: bar or banner). Stages are removed and folded into zones; existing data migrates, each stage becoming its own zone, as the report proposes (R1, R2).
- Decision (2026-10-23, owner, D2): when a tale group is On, its tales show by default; each tale can be hidden individually. Tale Studio edits stay private until the person presses "Update tale" (R6, R11, R15).
- Decision (2026-10-23, owner, D3): the UI shows Draft and Paused as one "Off" (Hidden for a tale); Archive moves to the ⋯ menu; stored statuses stay as they are (R6).
- Decision (2026-10-23, owner, D4): Tale Studio's "Publish changes" is renamed "Update tale"; "Publish" and "On" only mean visibility (R15).
- Decision (2026-10-23, owner, D5): the zone page lists tale groups as a list with status (cover, name, tales count, On/Off switch, indicator, ⋯ menu); a card view comes later (R10).
- Decision (2026-10-23, owner, D6): the SDK uses one site key per project plus a zone name (`zone="home-top"`); old zone keys keep working (R3, R4).
- Decision (2026-10-23, owner, D7): playbooks become templates chosen when creating a zone; no lasting Playbook card (R5).
- Decision (2026-10-23, Sofia): build order is status model and migrations first (stories 1 to 8), then layout (9 to 14), then polish, docs, accessibility review and the refactor sweep (15 to 18). The tracer bullet is story 1: it changes the contract, the API, the Delivery filter and the dashboard labels at once, and every later screen depends on its words.
- Decision (2026-10-23, Sofia): the epic runs before the remaining Tale Studio stories (7.7 onward): 7.7 waits on stories 1 and 4 (it shares the studio publish bar), 7.9 waits on the SDK changes (story 7) and the last group-view layout story (12), 7.14 on story 7, 7.12 on story 1, and 7.15 on this epic's accessibility review (story 17). Importer story 2.11 waits on story 1.
- Assumption (2026-10-23): a zone key with no `stage` keeps showing every display migrated from its zone, stacked in the old order (R4), rather than only the first migrated zone as the report suggests, so no live page loses content. See Open question below.
- Assumption (2026-10-23): migrated `draft` tales in never-live groups become `live`, and draft tales in live groups stay `draft` (Hidden), so the migration changes nothing any visitor sees (R6).
- Assumption (2026-10-23): "Installed" means the zone has an active site key or legacy zone key; TaleArt does not detect whether the snippet is on a page. A "last seen" signal can be added with analytics.
- Decision (2026-10-22, owner, answers the open question on zone keys without `stage`): no host page uses the old zone keys, the `stage` attribute or the pre-rework SDK build, so backward compatibility is not required. R4 is dropped: zone keys, the `stage` attribute and `configureZone(zoneKey)` may be removed, the migration (R2) does not need to record the original zone id or stage key, the Install tab (R13) shows no legacy key, and "Installed" means the project has an active site key. Story 7 becomes the removal of the legacy key paths.
- Decision (2026-10-22, owner): a duplicated tale (Tale Studio story 7.12) is stored Hidden (`paused`) so it does not appear twice on the site.
