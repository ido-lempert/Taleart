---
type: epic
title: Web zones
parent: initiative-taleart
id: 3
covers: [R6, R9, R11]
sources: [_bmad-output/initiative-taleart/initiative-taleart.md]
companions: [_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md, _bmad-output/initiative-taleart/prd-taleart/prd-taleart.md]
refined: true
risk: high
---

# Web zones

## Description

Renders a zone on a Web page through the Web SDK as a bar or banner frame, opens its tale groups in a full-screen viewer, and shows only published content: tale groups and tales that are `live` (AD-6) and inside their start and end times. Content managers set frame settings, stages, playbooks, tale group covers and the project's theme in the dashboard; developers override the theme per zone in the Web SDK configuration.

## Outcome

A visitor on a host Web page sees a zone's published tales in a bar or banner styled to the customer's brand, and content that is paused, archived or outside its schedule stays hidden; the demo host page shows both frame types from one zone.

## Requirements

R1 (parent R9): **Web SDK renders a zone from the Delivery API**
   A host page that loads the Web SDK with a zone key shows that zone's frames and their tale groups, in dashboard order, reading content only from the Delivery API (`/delivery/v1`, `Authorization: Bearer <key>`, starting from the existing `GET /delivery/v1/zone`). Media loads from the public, unguessable URLs the response carries, with no key (AD-11). A frame type the SDK does not know is skipped, and a refused key shows nothing on the page and logs one console error.
   Verify: on the sample host page, a valid key shows the zone's tale groups; a revoked key shows nothing and logs the error.

R2 (parent R9): **Bar frame**
   A bar shows one item per tale group (the group's cover (R12) with a ring, and the group's title) in a horizontally scrollable row. Its settings, validated by `libs/contract/frame-types/bar.schema.json`: `shape` (`circle` | `rounded-square`, default `circle`), `size` (`small` | `medium` | `large`, default `medium`), `showTitles` (boolean, default true), `alignment` (`start` | `center`, default `start`), `gap` (integer px 4–24, default 12).
   Verify: changing each bar setting in the dashboard changes the bar on the sample page after a reload; an out-of-range value is refused.

R3 (parent R9): **Banner frame**
   A banner shows the zone's tale groups as a carousel of slides, one per group, each showing the group's first published tale. Its settings, validated by `libs/contract/frame-types/banner.schema.json`: `aspectRatio` (`16:9` | `3:1` | `1:1`, default `16:9`), `autoplay` (boolean, default true), `intervalSeconds` (integer 3–15, default 5), `showDots` (boolean, default true), `loop` (boolean, default true). Autoplay stops when the visitor prefers reduced motion or interacts with the banner.
   Verify: a zone with a bar and a banner frame shows both on the sample page, and each banner setting changes the banner after a reload.

R4 (parent R9): **Full-screen tale viewer**
   Activating a bar item or banner slide opens that tale group in a full-screen viewer: tales play in order (images for a fixed duration, videos to their end) with progress segments; the visitor moves to the next or previous tale and tale group, pauses, and closes it, by tap, swipe or keyboard. A group the visitor has viewed shows the seen ring in the bar on later visits from the same browser.
   Verify: on the sample page, open a group, move through its tales with taps and arrow keys, swipe to the next group, close with Escape; after a reload the viewed group shows the seen ring.

R5 (parent R6): **Only live content is delivered**
   Tale groups and tales carry a status key from the AD-6 scheme, stored, with the HTTP code per key defined once in `libs/contract`. New tale groups and tales start `draft`; rows that existed before migrate to `live`. In the dashboard a content manager publishes, pauses and archives a tale group or a tale and sees its status. The Delivery API returns only `live` tale groups and their `live` tales; the tales of a paused group read as `blocked-by-group`.
   Verify: pause a tale group in the dashboard and reload the sample page: it is gone; publish it again: it is back; a paused tale inside a live group is skipped in the viewer.

R6 (parent R6): **Start and end times**
   A content manager sets an optional start and end time on a tale group and on a tale. The Delivery API returns content only when the current time is inside the window of the tale and of its group, and the dashboard shows `scheduled` before the start and `expired` after the end. Both are computed from the window when the content is read, never stored by a job (AD-6).
   Verify: a tale whose end time has passed does not render on the sample page; a group with a future start time appears once its start time passes.

R7 (parent R11): **Stage**
   A stage is a named, rendered instance of a zone on a page that shows one of the zone's frames. A content manager creates, renames and deletes stages in the dashboard, and a host page names a stage to render it; with no stage named, the SDK renders the zone's frames in order.
   Verify: on the sample page, two elements naming two stages of one zone show each stage's own frame.

R8 (parent R11): **Playbook**
   A playbook is a preset set of frames, with their settings and a stage per frame, for a goal, defined as registry data in `libs/contract` like the frame-type registry (not a table). A content manager applies a playbook to a zone in the dashboard, which records its key on the zone and creates its frames and stages, which stay editable. Two presets ship in the MVP: "Home page stories bar" (one bar frame: `circle`, `medium`, titles shown, `start`, gap 12) and "Promo banner" (one banner frame: `3:1`, autoplay, 5 s interval, dots shown, loop). Playbooks set no theme; frames use the project's theme (R9).
   Verify: apply a playbook to an empty zone; its frames appear with their preset settings and render on the sample page.
   Superseded by UX rework R5 (templates, 2026-10-22): playbooks became templates picked in the New zone drawer; the apply action is gone.

R9 (user requirement, 2026-10-20, Notes): **Theme per project from the dashboard, overridden per zone in the SDK configuration**
   The style of rendered frames and the viewer is a theme with these fields: `ringStyle` (`gradient` | `solid` | `none`), `ringColors` (1–3 colors), `seenRingColor`, `ringWidth` (1–4 px), `cornerRadius` (0–32 px), `fontFamily` (a CSS font-family list; the host page loads the font), `titleColor`, `backgroundColor`, `accentColor` (viewer progress and buttons). A content manager sets the theme once per project in the dashboard; a developer sets any of its fields for a zone in the Web SDK configuration. There is no theme per frame. Each field resolves from the SDK configuration for that zone, then the project's theme, then TaleArt's default; an invalid SDK value is ignored with a console warning.
   Verify: set the ring color in the project's theme in the dashboard and see it on the sample page; set another ring color in the SDK configuration for the zone and it wins; remove it and the project color returns.

R12 (user requirement, 2026-10-20, Notes): **Tale group cover**
   A tale group has an optional cover shown in the bar. With none set, the cover is the group's first published tale's image. For a video, the content manager picks the cover frame with a timeline knob, or makes a short animated cover (a few frames, as WebM or GIF) so the group animates in the bar. The cover, still or animated, is made in the browser in the dashboard and uploaded as media; the server does not transcode (AD-11). An animated cover is at most 300 KB `[ASSUMPTION]` so it fits the 1.5 s budget (R10).
   Verify: a group with no cover shows its first tale's image; pick a video frame as cover and the bar shows it; make an animated cover and the bar item animates; a file above the cap is refused.

R10 (architecture Quality Targets, NFR-006): **Web SDK performance budget**
   The Web SDK bundle is at most 50 KB gzipped, checked on every build, and the first zone content is visible within 1.5 s at p75 on a mid-tier mobile profile over Fast 4G, animated covers included (R12).
   Verify: the build fails when the bundle exceeds 50 KB gzipped; a throttled measurement of the sample page reports p75 first content at or under 1.5 s.

R11 (architecture Quality Targets, NFR-007): **Accessibility**
   The bar, banner and viewer meet WCAG 2.2 level AA with TaleArt's default theme: keyboard operable, named for screen readers, visible focus, reduced motion respected.
   Verify: an automated WCAG 2.2 AA scan of the sample page reports no violations, and a person completes a screen-reader and keyboard walk of bar, banner and viewer.

## Constraints

- **Delivery API with a zone key only.** The Web SDK never uses the Management API or a session; it reads published content and writes events only at `/delivery/v1`. Source: architecture AD-2.
- **Contract first.** Delivery response shapes, frame schemas, the theme schema, the playbook registry and the status map live in `libs/contract`. Source: architecture AD-3.
- **Frame types are data.** Bar and banner settings are JSONB validated against their JSON Schema; a new field or type needs no migration; clients skip unknown types. Source: architecture AD-5.
- **Status keys per AD-6.** The key a person sets is stored; new content starts `draft`; `scheduled` and `expired` are computed from the window when read. Source: architecture AD-6.
- **Public media for published content only.** Published media is served from public, unguessable URLs with no key; the zone key only calls the Delivery API; media of unpublished content is not public; no server transcoding. Source: architecture AD-11.
- **No sensitive end-user data.** This epic sends no user data to TaleArt. Source: architecture AD-13.
- **Project scope.** Stages and the project theme carry `project_id NOT NULL`; the applied playbook is a key on the zone. Source: architecture AD-4.
- **No Storyly brand names** in code, UI or docs. Source: initiative Constraints; architecture AD-12.
- **Apache-2.0.** Source: initiative Constraints; PRD NFR-001.

## Done when

- The demo host page shows a bar and a banner from one zone, each through its own stage, styled by the project's theme set in the dashboard and overridden for the zone in the SDK configuration.
- A tale past its end time, and a paused or archived tale group, does not render.
- A zone with a playbook applied renders on the Web SDK.
- A tale group shows its chosen cover, still or animated, in the bar.
- The SDK bundle is at most 50 KB gzipped, p75 first content is at most 1.5 s on Fast 4G, and the WCAG 2.2 AA scan is clean.

## Boundaries

- Frame types beyond bar and banner come with later widget-type entries (R10).
- Native rendering is post-MVP.
- Journeys and campaigns are post-MVP; this epic notes their ownership but builds neither.
- Targeting (tags, user lists, segments) decides which groups a viewer gets; it belongs to epic-targeting. This epic delivers every published group of the zone.
- Interactive components inside tales belong to epic-interactive-components; calls to action and the tale document belong to epic-tale-studio (2026-10-21).
- Events and metrics belong to epic-analytics; this epic sends no events.
- Must not change: zone keys, the Delivery API's key handling and CORS, and the foundation's frame registry behavior.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R6, R9, R11)
- architecture — `_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md`, AD-2, AD-3, AD-4, AD-5, AD-6, AD-11, AD-13, Quality Targets
- prd — `_bmad-output/initiative-taleart/prd-taleart/prd-taleart.md`, FR-006 to FR-009, FR-013
- status scheme — `_bmad-output/initiative-taleart/research-storyly-competitive-teardown/research-storyly-competitive-teardown.md`, section 11.3
- terminology — `_bmad-output/initiative-taleart/research-storyly-competitive-teardown/terminology-map.md` (stage, playbook, frame)

## Notes

- Decision (2026-10-20): bar and banner are the MVP frame types (user; PRD FR-006). Replaces the earlier assumption.
- Decision (2026-10-20): a **playbook** (R11) is a preset set of frames for a goal; a **journey** is a different, post-MVP concept, a multi-step sequence that shows different content over time or by behaviour. "Journey" is a common noun, never branded ("TaleArt Journeys"), pending legal review; fallback "Sequence" (user, approved).
- Decision (2026-10-20): this epic owns **campaigns** (PRD FR-031, post-MVP), since it owns schedules (R6): a campaign is a name, a goal (a conversion event), a set of tale groups and a schedule (`startsAt` / `endsAt`, UI "Start date" / "End date"). A tale group in a campaign shows only inside both windows. No stories yet; the module is `campaigns` (architecture Deferred). "Promotion" is reserved for offers and promo codes.
- Decision (2026-10-20): the theming requirement from the user is R9; SDK configuration overrides the dashboard (user).
- Decision (2026-10-20): stories are vertical slices a person reviews in the dashboard or on a sample web page that loads the Web SDK (user).
- Decision (2026-10-20): tracer bullet is story 1, "Tracer: a sample web page shows a zone's tale groups in a bar" (Sofia, headless; user to confirm).
- Decision (2026-10-20): the closing end-to-end suite is not planned, since no test plan exists and every story carries its tests; offered to the user (Sofia, headless).
- Decision (2026-10-20): the bar, banner and theme fields in R2, R3 and R9 are approved as proposed (user).
- Decision (2026-10-20): every frame in a zone shows all of the zone's published tale groups; frames do not pick a subset of groups (user). The architecture ER diagram now matches.
- Decision (2026-10-20): the theme is set per project in the dashboard; the Web SDK configuration can override it per zone; there is no theme per frame (user). R9, stories 8 and 9 updated.
- Decision (2026-10-20): new tale groups and tales start `draft`, a new key in the AD-6 scheme, mapped to HTTP 204 `[ASSUMPTION]` for the user to confirm; existing rows migrate to `live` (user). Story 3 updated.
- Decision (2026-10-20): a tale group gets an optional cover (R12, story 14): default the first tale's image; for a video, a frame picked with a timeline knob or a short animated cover (WebM or GIF) made in the browser in the dashboard, since the architecture rules out server transcoding (user). `[ASSUMPTION]` animated covers are capped at 300 KB to protect the 1.5 s budget.
- Assumption: the sample host page is a static page in the repo that loads the built Web SDK and takes the API URL and zone key as inputs.
- Assumption: after story 1 the tales lane (3, 4) builds in parallel with the SDK lane (2, 5, 6, 8) and the cover story 14 (after 2), and stage story 7 runs in parallel with 6 and 8 after 5; these lanes accept merge work in the files they share: the dashboard zone page, store and create drawer, the OpenAPI document and the delivery router. If the user prefers no parallel work, the table order in `tickets/tickets.toml` is a valid serial order.
- Decision (2026-10-20): the architecture is updated to match the epic (user): several stages per zone, playbooks are registry data recorded on the zone (not a table), and every frame shows all the zone's groups. Resolves the earlier source conflict with the Structural Seed ER diagram.
- Decision (2026-10-20): `scheduled` and `expired` are computed from the time window when content is read, not stored by a job (user; AD-6 amended). Story 4 is unblocked.
- Decision (2026-10-20): staging is not part of this epic's Done when; the foundation's staging demo (1.9) stays in the foundation epic (user).
- Decision (2026-10-20): the MVP ships two playbooks, "Home page stories bar" and "Promo banner" (user); their frames are in R8. Story 10 is unblocked.
- Decision (2026-10-20): published tale media is public, at unguessable URLs that need no key; the zone key is used only to call the Delivery API, which returns the zone's data and the media links; media of unpublished content is not public (user; AD-11 and AD-2 amended). Story 1 is unblocked.
- Decision (2026-10-20): TaleArt stores no sensitive end-user data; it stays on the host's client side and targeting that uses it is evaluated in the SDK (user; new AD-13). This epic sends no user data.
- Decision (2026-10-20): the epic-level gate on the whole foundation epic is lifted; each story lists its own foundation prerequisites, and story 1 needs only 1.4, 1.6, 1.8 and 1.12 (user).
- Note (2026-10-20): tale groups now belong to the project and a zone shows the groups placed in it, in its own order (architecture AD-14; foundation stories 1.15 and 1.16). Story 1 is built against the old one-zone model and is migrated by foundation story 1.15, which waits on it; every later story (2 to 14) reads a zone's groups through its zone placements, and statuses, schedules and covers belong to the group, so they show in every zone that places it.
- Decision (2026-10-23, owner, UX review D1 to D7): built behaviour of this epic changes through `epic-ux-rework`; its built stories are not reopened. R7 (stage) is superseded: a zone is one spot with one display, and each stage migrates to its own zone (AD-17); a host page's `stage` attribute keeps working as a legacy alias. R8 (playbook) is superseded: the two presets become templates picked when a zone is created, with no Playbook card. R1's zone key gives way to one site key per project plus a zone name (`zone="home-top"`); old zone keys keep working (AD-2, AD-9). R5's "publish, pause" becomes On / Off for a group and Shown / Hidden for a tale over the same stored keys; new tales start `live`, and `blocked-by-group` covers draft groups too (AD-6). R6's schedules stay as built and are hidden in the dashboard until used. The Done when line about "a bar and a banner from one zone, each through its own stage" is met after the rework by two zones on one page sharing the site key.
