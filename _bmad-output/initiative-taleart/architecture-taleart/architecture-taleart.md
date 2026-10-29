---
name: 'TaleArt'
type: architecture-spine
purpose: build-substrate
altitude: initiative
paradigm: 'modular monolith with ports-and-adapters edges'
scope: 'TaleArt initiative: the API, dashboard, Web SDK and the contract native SDKs will use; keeps its eight epics coherent'
status: final
created: '2026-10-20'
updated: '2026-10-23'
binds: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, NFR-006, NFR-007]
amended: '2026-10-23: UX rework (owner decisions D1 to D7): AD-2, AD-5, AD-6, AD-9, AD-14, AD-15 amended; AD-17 added; stages and playbooks superseded'
sources:
  - _bmad-output/initiative-taleart/initiative-taleart.md
  - _bmad-output/initiative-taleart/prd-taleart/prd-taleart.md
  - _bmad-output/initiative-taleart/prd-taleart/addendum.md
---

# Architecture Spine — TaleArt

## Design Paradigm

A **modular monolith**: one deployable API process and one PostgreSQL database, split into domain modules that each own their tables and expose a public interface. Edges are ports and adapters: HTTP adapters in `apps/api`, a storage port for media, and the another tool client inside the importer.

| Layer | Lives in |
| --- | --- |
| HTTP adapters (Management API, Delivery API), worker | `apps/api` |
| Domain modules (logic + tables + public interface) | `libs/server/<module>` |
| Shared contract (OpenAPI, generated types, schemas, event names, status map) | `libs/contract` |
| Clients | `apps/dashboard`, `libs/web-sdk`; post-MVP `libs/android-sdk`, `libs/ios-sdk`, `libs/mobile-sdk` |

## Invariants & Rules

```mermaid
flowchart TD
  dashboard[apps/dashboard] --> contract[libs/contract]
  websdk[libs/web-sdk] --> contract
  native[native SDKs, post-MVP] --> contract
  api[apps/api] --> modules[libs/server/* public interfaces]
  api --> contract
  modules --> contract
  modules -. other module only via its public interface .-> modules
```

Clients never import `libs/server`. Modules never import `apps/*`.

### AD-1 — Modular monolith `[ADOPTED]`

- **Binds:** all
- **Prevents:** an early split into services, and modules reading or writing each other's tables.
- **Rule:** One deployable API and one PostgreSQL database. Each domain module is an Nx lib under `libs/server/` and owns its tables. Another module reaches them only through that module's public interface. Nx module-boundary lint tags enforce the direction in the diagram above.

### AD-2 — Two API surfaces

- **Binds:** R9, R10, FR-002, FR-003, FR-009
- **Prevents:** SDK credentials reaching content writes, and web and native clients using different data paths.
- **Rule:** The Management API (`/api/v1`) serves the dashboard, accepts sessions only, and reads and writes. The Delivery API (`/delivery/v1`) serves every SDK, web and native, accepts delivery keys only (a project's **site key**, AD-9), reads published content, and writes events. Its zone response lists the tale groups placed in the zone, in that zone's placement order (AD-14), and carries the links to their published media, which are public and need no key (AD-11). No client reads the database or a module directly.
- **Amended 2026-10-23 (owner decision D6):** a request names its zone by **site key plus zone slug** (`zone="home-top"` on the page). One site key serves every zone of its project, and the response describes one zone with its one display (AD-17). An unknown slug is refused like a refused key.
- **Amended 2026-10-22 (owner decision, UX rework story 8.7):** no host page used the legacy zone keys, the `stage` attribute or the pre-rework SDK build, so they are removed. A Delivery request needs the site key and the zone slug; every refusal (missing or unknown key, missing or unknown slug) is the same 401. The Delivery filter and the dashboard's visibility indicator call one function (AD-6).

### AD-3 — Contract first `[ADOPTED]`

- **Binds:** dashboard, web-sdk, native SDKs, api
- **Prevents:** request and response shapes drifting between server and clients.
- **Rule:** The OpenAPI 3.1 document in `libs/contract` is the source of truth for both APIs. TypeScript types are generated from it. Native SDKs generate from the same document. A shape change starts in the document.

### AD-4 — Project-scoped shared schema

- **Binds:** R8, FR-001, FR-004, FR-030, AD-14
- **Prevents:** data leaking across projects, and a backfill when usage metering arrives.
- **Rule:** One shared schema. Every content (tale group, tale, zone placement of a tale group), zone, frame, targeting (tag, segment, user list), campaign, product set and event table has `project_id uuid NOT NULL` referencing `projects`. A placement's zone and tale group belong to the same project. A module checks every project it acts on against the caller's credential. It never trusts a `project_id` it has not authorized.

### AD-5 — Frame types are data `[ADOPTED]`

- **Binds:** R10, R11, FR-006, FR-007
- **Prevents:** a migration per frame type, and web and native renderers disagreeing on settings.
- **Rule:** A frame row stores `type` (a registry key) and `settings` (JSONB). Each type has a JSON Schema in `libs/contract`, and the API validates `settings` against it on write. A new type is a registry entry, a schema and a renderer, with no migration. Clients skip frame types they don't know instead of failing.
- **Amended 2026-10-23 (D1):** a zone has at most one frame, called its **display** in the UI (AD-17); the frame row and its id stay, so events keep `frame_id` (AD-10).

### AD-6 — Status keys `[ADOPTED]`

- **Binds:** tales, tale groups, importer
- **Prevents:** modules storing different representations of the same status.
- **Rule:** The status keys and their HTTP codes are `draft` 204 `[ASSUMPTION]`, `live` 200, `scheduled` 202, `processing` 102, `invalid-media` 422, `paused` 403, `blocked-by-group` 423, `expired` 410, `quota-reached` 429, `archived` 404, defined once in `libs/contract`. New tale groups and tales start `draft`; rows that existed before `draft` was added migrate to `live`. The key a person or process sets is stored. `scheduled` and `expired` are never stored: they are computed when content is read, from the stored `live` key and the start and end times, so no job moves them. The Delivery API returns only `live` content whose schedule window, and its group's, contains the current time.
- **Amended 2026-10-23 (owner decisions D2, D3): shown status over stored keys.** The stored keys and their HTTP codes do not change. The dashboard shows them through one mapping in `libs/contract`:
  - **Tale group:** **On** = `live`; **Off** = `draft` or `paused`; Archived = `archived`, offered only from the ⋯ menu. New groups start `draft` (Off). Turning a group Off stores `paused`.
  - **Tale:** **Shown** = `live`; **Hidden** = `draft` or `paused`; Archived = `archived`. New tales are stored `live`, so a group that is On shows all its tales by default and each tale is hidden one by one. Hiding stores `paused`. A duplicated tale's default is Hidden `[ASSUMPTION]` (owner to confirm before Tale Studio story 7.12).
  - `blocked-by-group` applies to every tale of a group that is `draft` or `paused`, not only `paused`.
  - `processing` and `invalid-media` stay stored keys shown as warnings; `scheduled` and `expired` stay computed.
  - A tale is delivered only when it also has a published document (AD-15); edits stay private until "Update tale".
  - **Visibility indicator:** one function in the `tales` module, with its reason codes in `libs/contract`, decides whether a zone, a placement of a group in a zone, and a tale are visible now, and lists why not (group off, tale hidden, group blocked, archived, no shown tales, not in any zone, starts at, ended at, zone has no display, zone not installed, media processing, media problem, not updated yet). The Delivery filter uses the same function, so the dashboard and the site cannot disagree.
  - **Migration:** tales stored `draft` in groups that were never `live` become `live`; `draft` tales in live groups stay `draft` (Hidden), so no visitor sees a change.

### AD-7 — Identity and import links

- **Binds:** R1, R2, FR-026 to FR-029
- **Prevents:** duplicate content on re-import, and another tool ids leaking into the model.
- **Rule:** Every primary key is a UUID generated by the database. Source-system ids live only in the `import_links` table (source system, source type, source id, target type, target id, project id), owned by the importer. Re-running an import updates the linked records instead of creating new ones.

### AD-8 — Importer as a background job `[ADOPTED]`

- **Binds:** R1, R2
- **Prevents:** imports inside HTTP requests, and the importer writing other modules' tables.
- **Rule:** An import is a job row in PostgreSQL, processed by a worker in the same deployable. The importer writes through other modules' public interfaces, checks each another tool record against the live response before mapping it, and stores a report with counts and differences per entity type.

### AD-9 — Credentials `[ADOPTED]`

- **Binds:** FR-002, FR-003, NFR-003
- **Prevents:** credentials stored in plain text, and one credential type working on both surfaces.
- **Rule:** Dashboard users sign in with passkeys (WebAuthn) only; there are no passwords. The first user on an empty install becomes the admin; every later user joins through a one-time invitation an admin creates for a project. After sign-in, sessions are server-side behind an http-only cookie. Delivery keys are random secrets, shown once and stored hashed. Rotating issues a new key and revokes the old one.
- **Amended 2026-10-29 (sign-in methods, owner decisions):** the "passkeys only, no passwords" rule above is amended. Dashboard users may sign in with a passkey, a **username and password** (scrypt hash, `N=2^15, r=8, p=1`, 64-byte key, random 16-byte salt, compared in constant time), or a **provider identity** (Google, Apple, or a generic OpenID Connect provider an admin adds), each turned on or off by an admin. Registration stays **invitation only**, plus the first admin on an empty install: no open sign-up and no domain auto-join. Provider secrets (a client secret, the Apple private key) are encrypted at rest with AES-256-GCM under `TALEART_SECRET_KEY` (32 random bytes, base64) and are never returned by the API. Password recovery is an **admin-issued one-time reset link** (24 hours, stored hashed), since TaleArt sends no email. A provider flow never creates or matches an account by email alone: an identity attaches to a user only when redeeming an invitation or the first-admin setup, with a verified email equal to the invitation email, or when a signed-in user links it. API tokens are unchanged. Spec: `_bmad-output/initiative-taleart/sign-in-methods/spec.md`.
- **Amended 2026-10-23 (D6):** a project has at most one active **site key**, a random secret with its own prefix, shown once, stored hashed, rotated and revoked under the same rules, owned by the `access` module. New zones get no zone key; existing zone keys stay valid, rotatable and revocable (AD-2). NFR-003's credential list reads: sessions, site keys and legacy zone keys.
- **Amended 2026-10-22 (owner decision, UX rework story 8.7):** site keys only. Zone keys are removed and their table dropped; a zone is installed while its project has an active site key. NFR-003's credential list reads: sessions and site keys.
- **Amended 2026-10-24 (epic developer experience, story 10.1):** personal **API tokens** for scripts, the CLI and the docs' API reference, owned by the `access` module on the site-key pattern: `tat_` and 32 random bytes, shown once, stored only as a SHA-256 hash with a display prefix, revocable, optionally expiring. The Management API accepts `Authorization: Bearer tat_…` as an alternative to the session cookie (an exception to AD-2's "sessions only"); the token acts as its user, whose role and project membership are read on every request, narrowed to the token's projects (or all of the user's) and, when read-only, to GET and HEAD. When a request carries an `Authorization` header the cookie is not read. A token can never create, list or revoke tokens, use `/auth/*`, manage passkeys or sessions, or create invitations; a token limited to some projects cannot create projects. A token follows its user's role and projects as they are at each request: an all-projects token widens when its user is made an admin, and an admin's read-write token can do what the admin can in its projects, rotating site keys included. Failed bearer attempts are limited per address (past the limit a failed attempt answers 429; a valid token keeps working). At most 50 active (unexpired, unrevoked) tokens per user; an admin can revoke every token of a user. The Delivery API refuses tokens and the Management API refuses site keys. NFR-003's credential list reads: sessions, site keys and API tokens.

### AD-10 — Events `[ADOPTED]`

- **Binds:** R7, FR-015, FR-023, FR-025, FR-030
- **Prevents:** metrics that can't be keyed to frames or projects, and metering that needs a backfill.
- **Rule:** SDKs post events to the Delivery API. Each event row records `project_id`, `zone_id`, `frame_id`, `tale_group_id` and `tale_id` where they apply, the event name, and client and server timestamps. Events are append-only, in a table owned by the analytics module. Metrics are computed from events only. Event names are defined in `libs/contract`.

### AD-11 — Media storage port `[ADOPTED]`

- **Binds:** FR-010, FR-012
- **Prevents:** modules writing to disk paths directly, which would block a later move to object storage, and media of unpublished content leaking.
- **Rule:** Media goes through a storage port (put, get and delete by key). The default adapter writes to local disk. Content stores the storage key, never a path or URL. Media of published content is served from public, unguessable URLs that need no key, so an `<img>` or `<video>` loads it directly; the Delivery API returns these URLs with the zone's data. Media of unpublished content is not public: its public URL answers 404 and only the Management API, with a session, serves it. A copied tale group shares its media's storage keys (AD-14): a shared key is public while any published tale references it and is deleted only when nothing references it. The server does not transcode media.

### AD-12 — Names `[ADOPTED]`

- **Binds:** all
- **Prevents:** another tool terms entering the product, and two names for one entity.
- **Rule:** The terminology map binds code, schema and API names. "another tool" appears only inside the importer module, as the source system. Targeting and campaign names approved 2026-10-20: `tags` (on tale groups), `segments`, `userLists`, user attributes (`setUserAttributes`), `externalUserId`, `campaigns` with a schedule (`startsAt`, `endsAt`), `productSets`, and journey (a common noun, never branded). "Audience", "member", "external user key" and "collection" are not entity names.

### AD-13 — No sensitive end-user data

- **Binds:** R5, R7, R9, R12, FR-015, FR-017 to FR-020, FR-023
- **Prevents:** TaleArt becoming a store of the host's end-user data, and targeting that needs that data on the server.
- **Rule:** TaleArt stores no sensitive end-user data. Sensitive user data, such as user attributes (`setUserAttributes`), stays on the client side of the host and is never sent to TaleArt. Targeting that uses user data is evaluated in the SDK on the client: the Delivery API returns the rules and candidate content, and the SDK decides. Events carry content and frame ids, never user attributes. The external user ID is the host's opaque identifier and is not treated as sensitive `[ASSUMPTION]`.

### AD-14 — Tale groups belong to the project; zones place them

- **Binds:** R3, R8, R9, FR-010, AD-2, AD-4, AD-11
- **Prevents:** duplicating a tale group to show it in a second zone, edits that reach only one of the copies, and a zone's order that moves another zone's order.
- **Rule:** A tale group, with its tales, tags, cover and media, belongs to a project. A zone shows an ordered list of placements (`zone_tale_groups`: zone, tale group, position, project), owned by the `tales` module; zones reach them only through its public interface. The same group can be placed in several zones of its project; an edit to the group shows in every zone, and each zone keeps its own order. Removing a group from a zone deletes only that placement; a group placed in no zone still exists in the project. A zone's groups, in the dashboard and the Delivery API, are read through its placements. **Copy to zone** creates an independent tale group, with copies of its tales and tag links and the same media storage keys (files are not duplicated), placed in a zone of the same project or of another project the user can access; the caller must be authorized for both projects (AD-4). In another project, tags are matched by name and created when missing. A storage key referenced by several tales is public while any published tale references it, and its file is deleted only when no tale or cover references it `[ASSUMPTION]` (AD-11). Migration: every existing tale group, from foundation stories 1.3, 1.4 and 1.5 and web-zones story 3.1, becomes a project group with one placement in its current zone, keeping its position.
- **Amended 2026-10-23 (D1):** a zone is one spot (AD-17), so placements are per spot: two spots on one page show different groups by having their own placements, not by needing a second key. When stages and extra frames become zones (AD-17 migration), each new zone gets a copy of the original zone's placements in the same order; afterwards each zone's list changes on its own. The dashboard's group status is shown per placement, since "not in any zone" and the zone's display and install state are part of it (AD-6).

### AD-15 — Tale document model

- **Binds:** R2, R4, R10, R13, FR-010, FR-012, FR-014, FR-016, FR-032, FR-033, NFR-007, AD-3, AD-5, AD-11
- **Prevents:** tales flattened into images, whose text is not accessible, not editable, not translatable and not sharp; web and native renderers placing elements differently; a migration for each new element type; and markup or style injection through tale content.
- **Rule:** Each tale holds one **tale document**: versioned JSON stored as JSONB on the tale row and owned by the `tales` module. The schema lives in `libs/contract` as JSON Schema (`tale-document/v1.schema.json`), with generated TypeScript types. Its shape is `{ version, canvas, durationMs?, elements[] }`.
  - **Version:** an integer, 1 at launch. Additive changes keep the number: a new optional field, or a new element type. A breaking change raises it, and `libs/contract` ships a forward migration that the server applies when it reads or writes a stored document.
  - **Canvas:** a 9:16 stage. It has a background, either a colour or one media element, and it defines its **safe areas** as contract constants: top 12% (progress bar and close control), bottom 16% (swipe-up and CTA) and 4% on each side. These are starting values, tuned by Tale Studio story 7.14 (user, 2026-10-21).
  - **Elements:** a discriminated union keyed by `type` from an **element-type registry** in `libs/contract`, like frame types (AD-5). The MVP types are `text`, `image`, `video`, `shape`, `emoji`, `sticker` (an image sticker) and `button`, plus at most one `swipe-up` per tale. An emoji is its own type: one RGI emoji stored as text, named by its `a11y.label`, checked on the server with the RegExp `v` flag (`\p{RGI_Emoji}`, Node.js 22 or later; the accepted set follows the runtime's Unicode version, and the API does not start without the flag). Interactive components (poll, quiz, emoji reaction, countdown, product pins, promo code, Rating) join as further element types, each with its own schema, and the document version stays the same.
  - **Every element has:**
    - `id`: a UUID, unique in the document, used for undo, analytics and later locale variants.
    - `type`.
    - `box`: `{ x, y, w, h, rotation }`. Positions and sizes are fractions (0 to 1) of the canvas width and height, so one document fits every screen and every platform.
    - Size-like properties such as font size and corner radius are fractions of the canvas height.
    - `hidden` and `locked`, which are editor state only.
    - `a11y`: `{ label?, decorative? }`.
    - type-specific `props`.
  - **Z-order:** the order of the `elements` array, first at the bottom.
  - **Reading order:** visual, top to bottom, then along each row in the tale's direction (amended 2026-10-23, story 7.10 review, owner decision). Positions are where elements show (a rotated box by its upright bounds, the swipe-up link at its pinned box). An element joins the row of the row's first element when its vertical centre lies within that element's top and bottom, or the two overlap by at least half the smaller height. An element taller than half the canvas is a row of its own. The direction is the tale's own, never the host page's: the majority direction of its visible texts (each text's set direction, or with `auto` its first strong character), with ties going to the first text (top, then left). It is left to right when no text has a direction. A row reads left to right by left edge, or right to left by right edge. Ties keep the z-order, bottom first. The one rule is `readingOrder` in `libs/contract`.
  - **Text:** plain Unicode strings, never HTML or Markdown.
  - **Styles:** enumerated or range-checked values, such as a colour as `#RRGGBB` or `#RRGGBBAA`. Raw CSS strings are never stored.
  - **Fonts:** a text element's font is a system stack key from the font registry in `libs/contract`, the project theme font, a font-family name that passes the theme's font-list rules (`isFontFamily`) and that the host loads, or the id of a **project font**, each with a fallback system stack. A project font is a row in `project_fonts` (project, family, weight, style, fallback stack, storage key, licence confirmation), owned by the `tales` module. Its file is WOFF2 only, checked by magic bytes, and at most 500 KB. It is media under AD-11: public, served as `font/woff2` with CORS that allows any origin, while a published tale's document references it.
  - **Draft and published** (user decision, 2026-10-22): each tale keeps two documents of this shape, each with its own revision.
    - The **draft** is what Tale Studio edits and autosaves. Every save raises the draft revision, and a save based on an older one is refused with 409, so undo, redo, autosave and the conflict flow all work on the draft and never change what visitors see.
    - The **published** document is what the Delivery API serves. "Update tale" (named "Publish changes" until 2026-10-23, owner decision D4; "Publish" now means only visibility) copies the draft to it in one compare-and-set on both revisions (409 when either is stale), raising the published revision. "Discard changes" (formerly "Discard draft") resets the draft to the published document the same way.
    - Setting a tale `live` (AD-6) while nothing of it is published yet, from any status, also publishes its draft in the same transaction, after checking it again; a tale that already has a published document keeps it on resume. A draft that no longer passes is not published: the tale still goes live, and the answer flags it for the dashboard to say so.
    - Publishing a tale with no draft is refused (409 `nothing_to_publish`), so publishing never empties the published document.
    - A tale whose document existed before drafts gets it as both, at the same revision. Keeping a refused version as a new tale stores it as that tale's draft, with nothing published.
    - Both are columns on the tale row (`draft_document` and `document`), an additive change.
  - **Validation on every write:** the Management API checks the document against the schema, with no additional properties, and then applies semantic rules. A refusal uses the standard error body naming the JSON pointer of the field it refused.
    - The document is at most 128 KB, with at most 60 elements and at most 1,000 characters per text. These are starting values, tuned by story 7.14.
    - Element ids are unique, and numbers are finite and inside their ranges.
    - Link targets are absolute `http` or `https` URLs of at most 2,048 characters. Any other scheme, `javascript:` included, is refused.
    - Every media reference is a storage key that belongs to the tale's project.
    - An image, a video, an image sticker and an image button need alt text unless `decorative` is set.
  - **Delivery:** the Delivery API returns the published document, never the draft, with each published tale, after removing hidden elements and editor-only fields and resolving storage keys to public media URLs. Media is referenced by storage key, never by URL (AD-11), and a key that a published tale's document references counts as referenced and public.
  - **Clients:** they ignore unknown fields and skip element types they do not know, so an older SDK still shows the rest of a tale. Native SDKs render the same document with the same registry (R10).
  - **Migration:** a tale that existed before the document gets a version 1 document with one full-bleed media element for its media.
  - **Later additions:** text locale variants are an additive field keyed by element id, added later.

### AD-16 — SDK document renderer

- **Binds:** R9, R13, NFR-006, NFR-007, AD-2, AD-15
- **Prevents:** tale content running script or style in the host page, the studio preview differing from what visitors see, and the renderer pushing the Web SDK past its budget unnoticed.
- **Rule:** The Web SDK renders a tale document as DOM inside its Shadow DOM.
  - **Stage:** a 9:16 stage sized with container units. Each element is an absolutely positioned node placed from its `box`.
  - **Text:** set only as text nodes (`textContent`), never through `innerHTML`, `insertAdjacentHTML` or a template string.
  - **Styles:** set through CSSOM properties from validated values, never `setAttribute('style', …)`, so the SDK works under a strict host CSP.
  - **Native elements:**
    - Images are `<img alt>`.
    - Videos are `<video muted playsinline>`. One exception (Tale Studio story 7.11, R16): the tale's own media (`taleMedia`), while it is the bottom element filling the canvas on a colour background, is drawn full-bleed in the stage with the playback rules tale media had before documents: a video plays with sound where the browser allows it, for its whole length, with no 15 s cap or stall rule (epic Boundaries: those rules must not change). A tale sent without a document is drawn as before.
    - Links are `<a>` elements with `rel="noopener noreferrer"`, and the SDK checks again that the scheme is `http` or `https`.
    - Buttons and links are focusable, with accessible names.
  - **Renderer modules:** one renderer module per element type, keyed by the element-type registry under `libs/web-sdk/src/lib/document/`. An unknown type renders nothing.
  - **Studio preview:** the dashboard's Tale Studio preview mounts the same renderer, imported from `libs/web-sdk`, on the unsaved document, so preview and visitor rendering cannot diverge.
  - **Bundle budget:** the renderer counts toward the 50 KB gzip budget. While the whole SDK stays at or below 40 KB gzipped, it ships as one bundle. When it crosses 40 KB, the viewer, the document renderer and the element renderers move to a chunk loaded on first open, and the entry chunk keeps only what first zone content needs, so the 1.5 s target holds. The size check then reports both chunks. The 40 KB threshold is a starting value, tuned by story 7.14.
  - **Fonts:** the SDK loads only the project fonts used by a tale that is opening, never for first zone content.
    - It fetches each font's public URL as bytes and registers it with `new FontFace(alias, bytes)` and `document.fonts.add`, under an internal alias such as `taleart-<fontId>`. It never builds CSS text such as `@font-face` or `url()`.
    - Text renders in the fallback stack until the face is ready, then swaps. A face that fails or takes over 3 s keeps the fallback.
    - System stacks, the theme font and font-family names are applied as validated `font-family` values through CSSOM, and the host page loads named fonts.

### AD-17 — A zone is a spot with one display; stages removed; templates

- **Binds:** R9, R11, FR-005, FR-006, FR-008, FR-009, AD-2, AD-5, AD-14
- **Supersedes:** the stage and playbook parts of the Structural Seed (2026-10-20) and web-zones R7 (stage) and R8 (playbook) as built behaviour.
- **Prevents:** three nouns for one idea (zone, frame, stage), a zone that is really a content channel with the real estate hidden in a stage, and presets that stay attached to a zone after they were used.
- **Rule** (owner decisions D1 and D7, 2026-10-23; UX review `ux-review-2026-10-23/ux-report.md` §3):
  - A **zone** is one spot in an app or site where tales appear. It has a name, a **slug** (lowercase letters, digits and hyphens, unique in its project; the page's `zone="…"`), at most one frame, its **display** (AD-5), and its own placements (AD-14). A zone without a display delivers nothing.
  - **Stages** are removed from the model, the Management API, the Delivery API and the SDK's documented surface; the `stage` attribute stays only as a legacy alias (AD-2).
  - **Templates** replace playbooks: registry data in `libs/contract` ("Stories bar", "Promo banner", "Blank"), applied once when a zone is created. The zone keeps only a "created from template" note (today's `playbook_key`); there is no apply action afterwards.
  - **Migration** (forward-only, `zones` module, with copies of placements through the `tales` public interface): the original zone keeps its id and becomes its first stage's zone (oldest first), or keeps its first frame when it has no stages; every further stage, and every frame no stage shows or beyond the first, becomes a new zone with that frame as its display, named from the stage (slug = stage key) or "<zone name> – <frame type> <n>". Each new zone records its original zone id and stage key, which the legacy zone key resolution uses (AD-2). A zone with no frame stays one zone with no display.
  - Internal and API names keep `frame` for the display row; the UI says Display and Template.
  - **Built 2026-10-22 (UX rework story 8.8):** the playbook rule is superseded by UX rework R5 (templates): `POST /zones` takes `template` and sets the display in the same transaction; `Zone.createdFromTemplate` is the note; the apply-playbook endpoint is gone.

## Consistency Conventions

| Concern | Convention |
| --- | --- |
| Table and column names | `snake_case`; tables plural (`tale_groups`); foreign keys `<entity>_id` |
| JSON fields | `camelCase`; ids are `id` and `<entity>Id` |
| Ids and times | UUIDs; `timestamptz` in the database; ISO 8601 UTC in JSON |
| Errors | `{ "error": { "code": "<machine_code>", "message": "<text>" } }`; `quota-reached` uses its own `code`, distinct from rate limiting |
| API versions | Path prefix `/v1`; a breaking change adds `/v2` |
| Event names | `lower_snake_case`, past tense (`tale_viewed`, `frame_impression`) |
| Migrations | Each module owns its migrations; forward-only; one runner at API start |
| Config | Environment variables only, listed in one `.env.example` |
| Logging | Structured JSON to stdout |
| Tests | Integration tests run against a database whose name ends in `_test` |

## Stack

| Name | Version |
| --- | --- |
| Node.js | 24 LTS `[ADOPTED]` (repo currently runs 22.23) |
| TypeScript | 6.0.3 |
| Express | 4.22.3 |
| Angular | 22.1.8 |
| Nx | 23.3.0 |
| PostgreSQL | 18 `[ADOPTED]` (local container runs 16) |
| node-postgres (`pg`) | 8.23.1 |
| Vitest | 4.1.12 |
| Playwright | 1.64.1 |
| OpenAPI | 3.1 |

## Structural Seed

```mermaid
flowchart LR
  subgraph clients[Clients]
    dash[Dashboard, Angular]
    sdk[Web SDK]
    nat[Native SDKs, post-MVP]
  end
  subgraph host[Self-hosted, Docker Compose]
    api[API process: Management API, Delivery API, worker]
    db[(PostgreSQL)]
    media[(Local media volume)]
  end
  another tool[another tool External API]
  dash -->|session| api
  sdk -->|site key or legacy zone key| api
  nat -->|site key| api
  api --> db
  api --> media
  api -->|import jobs| another tool
```

Environments: local (Docker Compose), staging (deployed from CI on merge to `main`), and self-hosted installs using the same Compose file.

```mermaid
erDiagram
  PROJECT ||--o{ APP : has
  PROJECT ||--o{ ZONE : has
  ZONE ||--o| FRAME : "display (AD-17)"
  PROJECT ||--o| SITE_KEY : "delivers with"
  ZONE ||--o{ ZONE_KEY : "legacy key"
  PROJECT ||--o{ TALE_GROUP : owns
  ZONE ||--o{ ZONE_TALE_GROUP : places
  TALE_GROUP ||--o{ ZONE_TALE_GROUP : placed-in
  TALE_GROUP ||--o{ TALE : contains
  TALE ||--|| TALE_DOCUMENT : holds
  TALE_DOCUMENT ||--o{ INTERACTIVE_COMPONENT : places
  TALE_GROUP }o--o{ TAG : tagged
  TALE_GROUP }o--o{ SEGMENT : targeted
  TALE_GROUP }o--o{ USER_LIST : targeted
  PROJECT ||--o{ CAMPAIGN : has
  CAMPAIGN }o--o{ TALE_GROUP : groups
  ZONE ||--o| JOURNEY : runs
  JOURNEY }o--o{ TALE_GROUP : sequences
  PROJECT ||--o{ PRODUCT_SET : has
  PROJECT ||--o{ EVENT : records
```

A tale group belongs to its project, not to a zone. `ZONE_TALE_GROUP` (table `zone_tale_groups`: zone, tale group, position, project) places a group in a zone; a zone shows its placed groups in its own order, and the same group can be placed in several zones of its project (AD-14). A zone is one spot with at most one frame, its display, which shows all of the published tale groups placed in the zone (AD-17). Stages were removed on 2026-10-23: each stage became its own zone. A template (formerly playbook) is registry data in `libs/contract`, applied once when a zone is created; the zone keeps only a "created from template" note. A project has one site key; zones migrated from before the rework keep their legacy zone keys (AD-2, AD-9). The theme is set per project (validated by a theme schema in `libs/contract`); the Web SDK configuration may override it per zone. A user list holds external user IDs (no separate member entity). User attributes are passed by the SDK at runtime, not stored as an entity. A tale's document (AD-15) is a JSONB column on the tale, not a table; interactive components are element types placed in it, and their responses live in the `interactive` module. CAMPAIGN and JOURNEY are post-MVP. PRODUCT_SET comes later, after product feeds exist.

```text
apps/
  api/            # HTTP adapters, worker, module wiring
  dashboard/      # Angular, Management API client
  docs/           # published docs, including metric definitions
libs/
  contract/       # OpenAPI 3.1, generated types, frame and theme schemas, template registry (formerly playbooks), shown-status mapping and visibility reasons, tale document schema and element-type and font registries, event names, status map
  server/
    access/       # projects, users, sessions, site keys, legacy zone keys
    zones/        # zones (slug, one display frame, created-from-template note, legacy stage mapping), journeys (post-MVP); registries live in contract
    tales/        # tale groups (owned by the project), zone placements of tale groups (zone, group, position), tales and their tale documents (AD-15), schedules, status, visibility function (AD-6), copy to zone
    interactive/  # interactive components and responses
    targeting/    # tags, segments, user lists, user attributes, external user IDs
    campaigns/    # campaigns and their schedules (post-MVP)
    product-sets/ # product sets, product feeds (later, after product feeds)
    analytics/    # events, metrics
    importer/     # another tool import jobs, import links, reports
    storage/      # media storage port and local adapter
  web-sdk/        # Delivery API client, frame renderers and the tale document renderer (AD-16), also used by the Tale Studio preview
```

## Quality Targets

| Target | Value |
| --- | --- |
| NFR-006 — Web SDK first zone content visible | ≤ 1.5 s at p75, mid-tier mobile, Fast 4G `[ADOPTED]` |
| NFR-006 — Web SDK bundle | ≤ 50 KB gzipped `[ADOPTED]` |
| NFR-006 — Delivery API reads | p95 ≤ 300 ms at 50 requests/s on a 2 vCPU, 4 GB host `[ADOPTED]` |
| NFR-006 — Management API | p95 ≤ 500 ms at the same load `[ADOPTED]` |
| NFR-006 — another tool import | 1,000 tales within 30 minutes `[ADOPTED]` |
| NFR-007 — Accessibility | WCAG 2.2 level AA, dashboard and Web SDK UI `[ADOPTED]` |

## Capability → Architecture Map

| Capability | Lives in | Governed by |
| --- | --- | --- |
| R1, R2 another tool import | `libs/server/importer`, worker | AD-7, AD-8, AD-12 |
| R3 foundation entities | `access`, `zones`, `tales` (product sets moved out of the foundation to `product-sets`, later) | AD-1, AD-4, AD-14 |
| R4 interactive components | `libs/server/interactive`, `libs/web-sdk`; each component is an element type in the tale document | AD-3, AD-10, AD-15 |
| R5, R12 targeting | `libs/server/targeting`, rules evaluated in `libs/web-sdk` | AD-2, AD-4, AD-13 |
| R6 scheduling and visibility | `libs/server/tales`, computed when read; one visibility function for Delivery and the dashboard | AD-6 |
| R7 analytics | `libs/server/analytics` | AD-10, AD-13 |
| R8 project tag | every module | AD-4 |
| R9 Web zones | `libs/web-sdk`, Delivery API (site key plus zone slug, legacy zone keys), public media URLs | AD-2, AD-3, AD-9, AD-11, AD-17 |
| R10 native-ready, extensible | `libs/contract`, frame registry | AD-3, AD-5 |
| R11 zone placement and templates (stages and playbooks until 2026-10-23) | `libs/server/zones`, template registry in `libs/contract` | AD-5, AD-17 |
| R13 Tale Studio | `apps/dashboard` (Tale Studio), `libs/server/tales` (tale document, project fonts), `libs/contract` (document schema, element-type and font registries), `libs/web-sdk` (document renderer) | AD-11, AD-15, AD-16 |
| NFR-006, NFR-007 | all clients and APIs | Quality Targets |

## Deferred

- **Analytics queue:** direct writes until load shows a need (AD-10).
- **Object storage adapter:** the storage port allows it later (AD-11).
- **External identity provider (OIDC):** built-in sessions first.
- **Native SDK internals and offline caching:** post-MVP; bound only by AD-2, AD-3 and AD-5.
- **Usage metering and audit export (FR-030):** post-MVP; AD-4 and AD-10 keep the data ready.
- **Caching and CDN for the Delivery API:** after performance is measured against the targets.
- **Horizontal scaling and worker locking:** single instance until needed.
- **Staging host provider:** chosen when the staging story starts; the user provides it.
- **Backups and restore:** documented with the self-hosting guide, before the first release.
- **Conversion tracking:** TaleArt's own design, post-MVP.
- **Campaigns (FR-031):** post-MVP, in a separate `campaigns` module rather than `tales`, so tale groups stay free of campaign logic; a campaign references tale groups through the `tales` public interface and is a reporting unit for `analytics`. A tale group in a campaign is delivered only inside both its own window and the campaign's schedule.
- **Journeys:** post-MVP, in `zones` (a zone holds a frame or a journey); distinct from playbooks.
- **Product sets (FR-021, FR-022):** after product feeds exist, in `product-sets`; out of the foundation epic (user, 2026-10-20).
- **Tale Studio beyond the MVP:** templates gallery, a brand kit beyond the project theme and project fonts, font formats other than WOFF2, animations, GIF search, AI assist, text locale variants, a reading-order override and collaborative editing. AD-15 keeps each of them additive: a new element type, a new optional field or a new registry entry.
- **Native document renderers:** post-MVP; they render the AD-15 document with the same element-type registry.
