---
type: epic
title: Web zones
parent: initiative-taleart
id: 3
covers: [R6, R9, R11]
sources: [_bmad-output/initiative-taleart/initiative-taleart.md]
companions: [_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md, _bmad-output/initiative-taleart/prd-taleart/prd-taleart.md]
after: [epic-platform-foundation]
refined: true
risk: high
---

# Web zones

## Description

Renders a zone on a Web page through the Web SDK as a bar or banner frame, opens its tale groups in a full-screen viewer, and shows only published content: tale groups and tales that are `live` (AD-6) and inside their start and end times. Content managers set frame settings, stages, playbooks and a theme in the dashboard; developers override the theme in the Web SDK configuration.

## Outcome

A visitor on a host Web page sees a zone's published tales in a bar or banner styled to the customer's brand, and content that is paused, archived or outside its schedule stays hidden; the demo host page shows both frame types from one zone.

## Requirements

R1 (parent R9): **Web SDK renders a zone from the Delivery API**
   A host page that loads the Web SDK with a zone key shows that zone's frames and their tale groups, in dashboard order, reading content only from the Delivery API (`/delivery/v1`, `Authorization: Bearer <key>`, starting from the existing `GET /delivery/v1/zone`). A frame type the SDK does not know is skipped, and a refused key shows nothing on the page and logs one console error.
   Verify: on the sample host page, a valid key shows the zone's tale groups; a revoked key shows nothing and logs the error.

R2 (parent R9): **Bar frame**
   A bar shows one item per tale group (a cover with a ring and the group's title) in a horizontally scrollable row. Its settings, validated by `libs/contract/frame-types/bar.schema.json`: `shape` (`circle` | `rounded-square`, default `circle`), `size` (`small` | `medium` | `large`, default `medium`), `showTitles` (boolean, default true), `alignment` (`start` | `center`, default `start`), `gap` (integer px 4–24, default 12).
   Verify: changing each bar setting in the dashboard changes the bar on the sample page after a reload; an out-of-range value is refused.

R3 (parent R9): **Banner frame**
   A banner shows the zone's tale groups as a carousel of slides, one per group, each showing the group's first published tale. Its settings, validated by `libs/contract/frame-types/banner.schema.json`: `aspectRatio` (`16:9` | `3:1` | `1:1`, default `16:9`), `autoplay` (boolean, default true), `intervalSeconds` (integer 3–15, default 5), `showDots` (boolean, default true), `loop` (boolean, default true). Autoplay stops when the visitor prefers reduced motion or interacts with the banner.
   Verify: a zone with a bar and a banner frame shows both on the sample page, and each banner setting changes the banner after a reload.

R4 (parent R9): **Full-screen tale viewer**
   Activating a bar item or banner slide opens that tale group in a full-screen viewer: tales play in order (images for a fixed duration, videos to their end) with progress segments; the visitor moves to the next or previous tale and tale group, pauses, and closes it, by tap, swipe or keyboard. A group the visitor has viewed shows the seen ring in the bar on later visits from the same browser.
   Verify: on the sample page, open a group, move through its tales with taps and arrow keys, swipe to the next group, close with Escape; after a reload the viewed group shows the seen ring.

R5 (parent R6): **Only live content is delivered**
   Tale groups and tales carry a status key from the AD-6 scheme, stored, with the HTTP code per key defined once in `libs/contract`. In the dashboard a content manager publishes, pauses and archives a tale group or a tale and sees its status. The Delivery API returns only `live` tale groups and their `live` tales; the tales of a paused group read as `blocked-by-group`.
   Verify: pause a tale group in the dashboard and reload the sample page: it is gone; publish it again: it is back; a paused tale inside a live group is skipped in the viewer.

R6 (parent R6): **Start and end times**
   A content manager sets an optional start and end time on a tale group and on a tale. The Delivery API returns content only when the current time is inside the window of the tale and of its group, and the dashboard shows `scheduled` before the start and `expired` after the end.
   Verify: a tale whose end time has passed does not render on the sample page; a group with a future start time appears once its start time passes.

R7 (parent R11): **Stage**
   A stage is a named, rendered instance of a zone on a page that shows one of the zone's frames. A content manager creates, renames and deletes stages in the dashboard, and a host page names a stage to render it; with no stage named, the SDK renders the zone's frames in order.
   Verify: on the sample page, two elements naming two stages of one zone show each stage's own frame.

R8 (parent R11): **Playbook**
   A playbook is a preset set of frames, with settings and theme, for a goal, defined as data in `libs/contract` like the frame-type registry. A content manager applies a playbook to a zone in the dashboard, which records it on the zone and creates its frames, which stay editable.
   Verify: apply a playbook to an empty zone; its frames appear with their preset settings and render on the sample page.

R9 (user requirement, 2026-10-20, Notes): **Theme from the dashboard and the SDK configuration**
   The style of rendered frames and the viewer is a theme with these fields: `ringStyle` (`gradient` | `solid` | `none`), `ringColors` (1–3 colors), `seenRingColor`, `ringWidth` (1–4 px), `cornerRadius` (0–32 px), `fontFamily` (a CSS font-family list; the host page loads the font), `titleColor`, `backgroundColor`, `accentColor` (viewer progress and buttons). A content manager sets the theme in the dashboard; a developer sets any of its fields in the Web SDK configuration. Each field resolves from the SDK configuration, then the dashboard, then TaleArt's default; an invalid SDK value is ignored with a console warning.
   Verify: set the ring color in the dashboard and see it on the sample page; set another ring color in the SDK configuration and it wins; remove it and the dashboard color returns.

R10 (architecture Quality Targets, NFR-006): **Web SDK performance budget**
   The Web SDK bundle is at most 50 KB gzipped, checked on every build, and the first zone content is visible within 1.5 s at p75 on a mid-tier mobile profile over Fast 4G.
   Verify: the build fails when the bundle exceeds 50 KB gzipped; a throttled measurement of the sample page reports p75 first content at or under 1.5 s.

R11 (architecture Quality Targets, NFR-007): **Accessibility**
   The bar, banner and viewer meet WCAG 2.2 level AA with TaleArt's default theme: keyboard operable, named for screen readers, visible focus, reduced motion respected.
   Verify: an automated WCAG 2.2 AA scan of the sample page reports no violations, and a person completes a screen-reader and keyboard walk of bar, banner and viewer.

## Constraints

- **Delivery API with a zone key only.** The Web SDK never uses the Management API or a session; it reads published content and writes events only at `/delivery/v1`. Source: architecture AD-2.
- **Contract first.** Delivery response shapes, frame schemas, the theme schema, the playbook registry and the status map live in `libs/contract`. Source: architecture AD-3.
- **Frame types are data.** Bar and banner settings are JSONB validated against their JSON Schema; a new field or type needs no migration; clients skip unknown types. Source: architecture AD-5.
- **Status keys are stored.** Source: architecture AD-6.
- **Project scope.** Stages and playbook records carry `project_id NOT NULL`. Source: architecture AD-4.
- **No Storyly brand names** in code, UI or docs. Source: initiative Constraints; architecture AD-12.
- **Apache-2.0.** Source: initiative Constraints; PRD NFR-001.

## Done when

- The demo host page shows a bar and a banner from one zone, each through its own stage, styled by a theme set in the dashboard and overridden in the SDK configuration.
- A tale past its end time, and a paused or archived tale group, does not render.
- A zone with a playbook applied renders on the Web SDK.
- The SDK bundle is at most 50 KB gzipped, p75 first content is at most 1.5 s on Fast 4G, and the WCAG 2.2 AA scan is clean.

## Boundaries

- Frame types beyond bar and banner come with later widget-type entries (R10).
- Native rendering is post-MVP.
- Journeys and campaigns are post-MVP; this epic notes their ownership but builds neither.
- Targeting (tags, user lists, segments) decides which groups a viewer gets; it belongs to epic-targeting. This epic delivers every published group of the zone.
- Interactive components and calls to action inside tales belong to epic-interactive-components.
- Events and metrics belong to epic-analytics; this epic sends no events.
- Must not change: zone keys, the Delivery API's key handling and CORS, and the foundation's frame registry behavior.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R6, R9, R11)
- architecture — `_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md`, AD-2, AD-3, AD-4, AD-5, AD-6, Quality Targets
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
- Assumption: the bar, banner and theme fields in R2, R3 and R9 are Sofia's proposal; the user confirms or changes them before stories 5, 6 and 8 start.
- Assumption: every frame in a zone shows all of the zone's published tale groups; frames do not pick a subset of groups.
- Assumption: the theme is stored per frame, under the frame's settings, validated by a shared theme schema in `libs/contract/frame-types/`.
- Assumption: new tale groups and tales start `paused` and are published by the content manager; existing rows migrate to `live` so the foundation demo keeps showing content.
- Assumption: a bar item's cover is the group's first published tale's media.
- Assumption: the sample host page is a static page in the repo that loads the built Web SDK and takes the API URL and zone key as inputs.
- Assumption: after story 1 the tales lane (3, 4) builds in parallel with the SDK lane (2, 5, 6, 8), and stage story 7 runs in parallel with 6 and 8 after 5; these lanes accept merge work in the files they share: the dashboard zone page, store and create drawer, the OpenAPI document and the delivery router. If the user prefers no parallel work, the table order in `tickets/tickets.toml` is a valid serial order.
- Source conflict: architecture Structural Seed ER diagram — `ZONE ||--o| STAGE` allows one stage per zone, while R7 needs several; `ZONE ||--o{ PLAYBOOK` reads as a table, while R8 keeps playbooks as registry data recorded on the zone; `FRAME }o--o{ TALE_GROUP` lets a frame pick groups, against the assumption that every frame shows all the zone's groups. Update the architecture or change the epic?
- Open question: AD-6 stores status keys. Are `scheduled` and `expired` stored (moved by a job at the start and end times) or worked out from the window when read? Story 4 waits on this (its `unknown`).
- Open question: production delivery. The foundation's staging demo (1.9) is still planned; should this epic's Done when include the sample page running against staging?
- Open question: the AD-6 scheme has no `draft` key. Should new content start `paused`, or should a `draft` key be added to the status map? Story 3 waits on this (its `unknown`).
- Open question: should tale groups get their own cover image (uploaded in the dashboard) instead of the first tale's media? A video-only group otherwise needs a video frame as its cover, which weighs on the 1.5 s target.
- Open question: is the theme set per frame (assumed), per zone, or per project?
- Open question: which playbooks ship in the MVP, and what goal, frames, settings and theme each one presets? Story 10 waits on this (its `unknown`).
- Open question: an `<img>` or `<video>` tag cannot send `Authorization: Bearer`. May the Delivery API return short-lived signed media URLs for the zone's media, or must the SDK fetch media with the key header?
- Open question: the epic file waits on the whole foundation epic (including the staging demo 1.9 and the sweep 1.10), while its stories need only zone keys (1.8) and media upload (1.12). Story 1 needs only 1.4, 1.6, 1.8 and 1.12. Remove the epic-level gate so story 1 can start now?
