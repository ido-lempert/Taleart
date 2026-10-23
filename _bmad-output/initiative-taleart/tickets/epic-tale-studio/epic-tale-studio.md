---
type: epic
title: Tale Studio
parent: initiative-taleart
id: 7
covers: [R13, R2, R10]
sources: [_bmad-output/initiative-taleart/initiative-taleart.md, _bmad-output/initiative-taleart/prd-taleart/prd-taleart.md]
companions: [_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md, _bmad-output/initiative-taleart/research-storyly-competitive-teardown/digests/studio-r4-1.md]
refined: true
risk: high
---

# Tale Studio

## Description

Tale Studio is an editor in the dashboard. A content manager uses it to compose a tale on a 9:16 canvas from text, images, video, shapes, stickers and emoji, calls to action, and (through epic-interactive-components) interactive components.

The tale is stored as a versioned **tale document** of elements (architecture AD-15). The Web SDK renders each element itself as DOM (AD-16). Text stays real text: accessible, editable, sharp, and ready for translation later. Native SDKs will render the same document after the MVP.

Existing tales, including imported ones, become documents with one media element. Storyly's story editor is the reference for the feature set and flow (digest `studio-r4-1.md`). Where Storyly documents no control, the scope stays lean.

## Outcome

A content manager opens a tale in Tale Studio, adds and arranges text, media, shapes, stickers and a call to action, checks them in a preview that is the SDK's own renderer, and publishes. A visitor on the sample page then sees the same tale with selectable, screen-reader-readable text and working links. Every tale that existed before still renders unchanged.

## Requirements

R1 (parent R13; PRD FR-033; AD-15): **Tale document**
   Every tale holds one tale document: `{ version, canvas, durationMs?, elements[] }`.
   - The JSON Schema and generated types live in `libs/contract`, and the `tales` module stores the document as JSONB on the tale.
   - Elements are a discriminated union keyed by `type` from an element-type registry.
   - Each element has an `id`, a `box` in fractions of the canvas, `hidden`, `locked` and `a11y` fields.
   - Array order is z-order.
   - The tale keeps a **draft** document, which the studio edits and autosaves, and a **published** document, which visitors see, each with its own revision (user decision, 2026-10-22). Publishing copies the draft to the published document; saving never changes what visitors see.
   - The Management API reads and writes the draft and publishes it. Each write carries the revision it was based on, and a write based on an older revision is refused with 409, so two editors never silently overwrite each other. Publishing compares both revisions.
   - The Delivery API returns the published document with each published tale, without hidden elements or editor-only fields, and with media keys resolved to public URLs (AD-11).
   Verify: save a document through the API and read it back unchanged; save with an old revision and get 409; the Delivery response does not show the saved draft until it is published; after publishing, the Delivery response for that tale has no hidden element and no `locked` field.

R2 (parent R13; PRD FR-032; digest: safe zone, Fit and Fill): **Canvas with safe areas**
   - The studio shows the tale on a 9:16 canvas. Its background is a colour or one media element, with `cover` or `contain` fit, and the band colour with `contain` is adjustable.
   - Safe-area guides (top, bottom and sides, values from `libs/contract`) can be shown or hidden.
   - Elements snap to the canvas centre, the safe-area edges and other elements.
   - An element that reaches outside the safe area shows a warning in its layer row. This is a warning only; saving is still allowed.
   Verify: drag a text element into the bottom safe area and see the warning; move it back and the warning clears; the background colour and media fit change the canvas and the sample page alike.

R3 (parent R13; PRD FR-032): **Layers**
   - A layers list shows every element, top of the z-order first, with its type icon and a short name taken from its content.
   - From the list, and from the keyboard, the content manager selects, reorders (bring forward, send backward, to front, to back), hides, locks, duplicates and deletes an element.
   - A locked element cannot be moved or edited on the canvas, and a hidden element is not delivered.
   - Multi-select is limited to moving, deleting and reordering several elements at once. Grouping is post-MVP.
   Verify: reorder two overlapping elements from the list with the keyboard and see the canvas and the sample page follow; a hidden element does not show on the sample page; a locked element does not move when dragged.

R4 (parent R13; PRD FR-032, FR-033; digest: text): **Text**
   A text element holds plain text, up to 1,000 characters, wrapped inside its box. Its settings:
   - **font:** one of four sources.
     - A system font stack from the font registry in `libs/contract`: sans, serif, rounded or monospace.
     - The project theme's `fontFamily` (web-zones R9).
     - A **font-family name** that the host page is expected to load. It is validated by the theme's font-list rules (`isFontFamily` in `libs/contract`: letters, digits, spaces and hyphens, optionally quoted, with no CSS-wide keywords).
     - A **project font** (R18).
     Every text element also has a fallback system stack, which is used until a named or project font is available.
   - **size** as a fraction of canvas height, through presets small, medium and large or a custom value.
   - **weight:** regular, medium or bold.
   - **italic**.
   - **colour**.
   - **alignment:** start, centre or end.
   - **line height**.
   - **background:** none, a solid box, or a per-line highlight, with its own colour.
   The SDK renders the text as a text node, so it is selectable and announced, and it stays sharp at any size.
   Verify: style a text element with each setting and see it identically in the studio preview and on the sample page; select the text on the sample page with the mouse; a screen reader reads it.

R5 (parent R13; PRD FR-032, FR-010; digest: media layers): **Image and video elements**
   - Image (including GIF) and video elements come from the project's media. They are uploaded in the studio through the storage port (AD-11, foundation story 1.12) or picked from media the project already has.
   - Each has a box, rotation, `cover` or `contain` fit, corner radius and opacity.
   - A tale has at most one video element (a starting value, tuned by story 7.14). When it has one, the tale plays for the video's length; otherwise its `durationMs` applies, 3 to 15 s with a default of 7 s.
   - An image needs alt text, or must be marked decorative, before the tale can be published (R12).
   Verify: add an image and a video from the project's media, resize and rotate them, and see the same result on the sample page; the tale plays for the video's length; publishing with an image that has no alt text is refused with a message naming the element.

R6 (parent R13; PRD FR-032; digest: stickers): **Shapes, stickers and emoji**
   - Shapes are rectangle (with corner radius), ellipse and line, each with fill, stroke colour, stroke width and opacity.
   - Stickers are of two element types: an **emoji** (its own `emoji` type), rendered as text with the platform's emoji font, and an **image sticker** (`sticker`), a PNG, WebP or GIF from the project's media, with alt text or marked decorative.
   - Each emoji has an accessible name taken from its Unicode name, and the author can edit it; a decorative emoji is hidden from screen readers.
   Verify: add a rounded rectangle, an ellipse, a line, an emoji and an image sticker, and see each on the sample page; a screen reader announces the emoji's name and skips a decorative sticker.

R7 (parent R13; PRD FR-016; digest: calls to action): **Calls to action**
   There are three kinds of call to action, each with a destination URL:
   - A **button** has a label, a style (filled or outline), colours and corner radius.
   - A **custom image button** is an image with alt text.
   - A **swipe-up link** has a label and is pinned to the bottom safe area. There is at most one per tale.
   Destinations are absolute `http` or `https` URLs, checked by the server on write and again by the SDK. A destination opens in the same tab by default, or in a new tab with `noopener`. On the Web SDK a swipe-up link also responds to a swipe-up gesture and to Enter on its focused label.
   Verify: add each kind, set destinations, and on the sample page each opens its URL, by click, by keyboard, and by swipe-up for the swipe-up link; saving a `javascript:` or `ftp:` URL is refused.

R8 (parent R13, R4, R10; AD-15): **Interactive components are element types**
   Element types are data, built from three registered parts:
   - a schema in the element-type registry in `libs/contract`,
   - a studio inspector descriptor,
   - an SDK renderer keyed by the type.
   The studio's Add menu and the inspector come from the registry. A new type, such as each component from epic-interactive-components (poll, quiz, emoji reaction, countdown, product pins, promo code, Rating), is a registry entry, a schema, an inspector and a renderer. It needs no document version change and no migration. An SDK that does not know a type skips it and still shows the rest of the tale.
   Verify: register a test element type by configuration; it appears in the Add menu, saves and validates; an SDK build without its renderer shows the tale without it and logs one warning.

R9 (parent R13; PRD FR-032): **Undo, redo and saving**
   - Every change to the document can be undone and redone, at least 100 steps per editing session, with Ctrl or Cmd+Z, Shift+Ctrl or Cmd+Z, and toolbar buttons.
   - Edits save automatically, debounced, as the draft document. A save indicator shows saved, saving or failed.
   - Saving never changes what visitors see (user decision, 2026-10-22). "Publish changes" makes the draft the published document, and "Discard draft" returns the draft to the published document after asking; discarding can be undone in the session. Setting a tale live while nothing of it is published yet also publishes its draft (if the draft no longer passes the checks, the tale still goes live and the zone page says the draft was not published). The studio says whether the tale is a draft that visitors cannot see, published, or has unpublished changes.
   - When a save is refused with 409 (R1), the content manager reloads the latest version or keeps their own copy as a new tale, and nothing is lost silently.
   - Leaving the studio with unsaved changes asks first.
   Verify: make ten edits, undo all ten and redo them; reload, and the last saved state is shown; edit the same tale in two tabs, and the second save offers reload or keep-as-copy; edits to a live tale do not show on the sample page until "Publish changes".

R10 (parent R13; AD-16): **Preview as the SDK renders it**
   The studio preview mounts the Web SDK's own document renderer, imported from `libs/web-sdk`, on the unsaved document. It shows the viewer chrome (progress, close) at phone sizes, and plays the tale for its duration.
   Verify: a tale shown in the preview and on the sample page looks the same in a side-by-side screenshot at 390x844, apart from host page chrome.

R11 (parent R13; PRD FR-012; digest: story actions): **Duplicate a tale**
   A content manager duplicates a tale, with its whole document, into the same tale group or another one in the project. The copy is a new draft with new element ids, and it shares the media storage keys, which are not copied (AD-14 rule on shared keys).
   Verify: duplicate a styled tale into another group; editing the copy leaves the original unchanged; both show their media on the sample page after publishing.

R12 (parent R13; NFR-007; digest: accessibility): **Accessibility of tales**
   - Every image, video, image sticker and image button has alt text or is marked decorative. Publishing a tale that breaks this rule is refused.
   - Text and button labels get a contrast check against what lies behind them. A ratio below 4.5:1, or below 3:1 for large text, shows a warning in the studio but does not block publishing (user decision, 2026-10-21).
   - Reading order is visual, top to bottom and then left to right, or right to left in a tale whose texts read right to left (AD-15, amended 2026-10-23).
   - The SDK names each element for screen readers, and buttons and links are focusable in reading order.
   - Animated content respects reduced motion. Video autoplays muted.
   Verify: an automated WCAG 2.2 AA scan of the sample page showing a composed tale reports no violations; a screen reader reads the tale's text, image alt text and button in reading order.

R13 (parent R13; NFR-007; architecture Quality Targets): **Accessible editor**
   Tale Studio meets WCAG 2.2 AA:
   - Every action works without a pointer, including adding, selecting, moving (arrow keys, with Shift for larger steps), resizing and rotating through numeric fields, and reordering. This covers 2.5.7, dragging movements.
   - The canvas and the layers list have a clear focus order and visible focus.
   - Every control is named.
   - Changes are announced through a live region, such as "Text moved" or "Layer hidden".
   Verify: a person composes a tale with text, an image and a button using only the keyboard and a screen reader; the automated scan of the studio reports no WCAG 2.2 AA violations.

R14 (parent R13; AD-15): **Security of tale content**
   - All document data is validated on the server on every write. The checks are the schema with no additional properties, plus the semantic rules: at most 128 KB, 60 elements and 1,000 characters per text (starting values, tuned by story 7.14); unique ids; finite numbers in range; colours as hex; font sources as in R4 (registry keys, names that pass the font-list rules, and project font ids of the tale's project); media keys of the tale's project; URLs that are absolute `http` or `https`, at most 2,048 characters.
   - The document holds no HTML, CSS or script, and the SDK sets text only as text nodes and styles only through CSSOM (AD-16).
   Verify: API tests refuse a document with an HTML string in a style field, a `javascript:` URL, a media key of another project, an unknown property, and one over each size limit; a text of `<img src=x onerror=alert(1)>` renders as visible literal text on the sample page.

R15 (parent R13; NFR-006; AD-16): **SDK budget with the renderer**
   - The Web SDK, with the document renderer and the MVP element renderers, stays within 50 KB gzipped, checked on every build.
   - p75 first zone content stays within 1.5 s on Fast 4G.
   - A composed tale's first frame shows within 1 s of opening the viewer at p75 on the same profile (starting values, tuned by story 7.14). Text paints in its fallback stack first, and project fonts swap in when they load.
   - Project fonts load only when a tale that uses them opens. They are never part of first zone content and never part of the SDK bundle.
   - Once the SDK passes 40 KB gzipped, the viewer and renderers move to a chunk loaded on first open (AD-16).
   Verify: the size check passes; the web-zones measurement target still reports p75 first content at or under 1.5 s; the same target reports p75 first tale frame at or under 1 s for a tale with 20 elements and a project font; a page whose zone uses no tale with a project font downloads no font file.

R16 (parent R13, R10; AD-15): **Existing tales become documents**
   - A one-way migration gives every tale that has media a version 1 document with one full-bleed media element (`cover`, decorative until someone adds alt text), so it renders exactly as before.
   - From then on, creating a tale with media, from the dashboard upload or from the importer, creates that same document through the `tales` public interface.
   - A tale group's default cover (web-zones R12) is the first tale's lowest media element. When a tale has no media, the bar shows the tale's background colour with the group title.
   Verify: after the migration, the sample page renders every existing tale as before; a new upload and a fresh import both create documents; a group whose first tale is text on a colour shows that colour with its title in the bar.

R17 (parent R2; importer epic R2; digest: External API): **Imported tales keep what the External API exposes**
   - The External API exposes no layers (digest `studio-r4-1.md`), so an imported Storyly story becomes a document with its background media.
   - When it has `button_text` and an `outlink` (or a `deep_link` that is `http` or `https`), it also gets a button element at the bottom of the safe area.
   - The import report lists, per tale, "text, stickers and components not readable through the API" as a difference, and lists any link with another scheme.
   Verify: import a fixture story with `button_text` and `outlink`; the tale shows a button that opens the link; the report lists the unreadable layers; a `myapp://` deep link is listed and not imported.

R18 (parent R13; PRD FR-032; user decision 2026-10-21): **Project fonts**
   An admin or content manager uploads a font to the project.
   - **Format:** WOFF2 only. The server checks the `wOF2` magic bytes and ignores the extension and the declared type.
   - **Size:** at most 500 KB (a starting value, tuned by story 7.14).
   - **Font record:** a family name (one name that passes the font-list rules), a weight (100 to 900), a style (normal or italic) and a fallback system stack.
   - **Licence:** the uploader confirms they may use and distribute the font, and the confirmation is stored with the font.
   - **Storage:** the font file goes through the storage port. It follows the AD-11 public media rules: it is public, with CORS for font loading and `font/woff2`, while a published tale's document uses it, and private otherwise.
   - **Font list:** the project's font list shows each family with its faces. A font in use by any tale cannot be deleted.
   - **Loading:** the SDK and the studio load a project font through the `FontFace` API from the fetched bytes, under an internal family alias, never from CSS text. Text renders in the fallback stack until the font is ready, which is swap behaviour. A font that fails or takes over 3 s keeps the fallback.
   Verify: upload a WOFF2 font, use it on a text element, and the sample page shows the fallback then the font; a TTF renamed to `.woff2`, a 600 KB WOFF2, and an upload without the licence confirmation are refused; a font used by a tale cannot be deleted; a sample page with no tale using the font requests no font file.

## Constraints

- **Contract first:** the document schema, element-type registry, font registry and safe-area constants live in `libs/contract`. Source: AD-3, AD-15.
- **No HTML or CSS from content:** text is rendered as text nodes and styles are enumerated values. Source: AD-16.
- **Media by storage key:** documents reference media by key, and published documents make their keys public. The server does not transcode. Source: AD-11.
- **Project scope:** a document's media keys belong to its tale's project. Source: AD-4.
- **Web SDK budget** of 50 KB gzipped and 1.5 s first content. Source: architecture Quality Targets.
- **WCAG 2.2 AA** for the studio and the rendered tale. Source: architecture Quality Targets.
- **No Storyly brand names** in code, UI or docs. The editor is "Tale Studio", and research cites Storyly only as a competitor. Source: AD-12, PRD NFR-004.
- **No copied Storyly docs text and no screenshots.** Source: PRD NFR-005.
- **Apache-2.0.** Source: PRD NFR-001.

## Done when

- On the deployed dashboard a content manager composes a tale with text in a project font, an image, a shape, an emoji, a button and a swipe-up link in Tale Studio, previews it, publishes it, and the sample page shows the same tale with live text and working links.
- Every existing and imported tale renders as before, now from a document.
- A test element type registers by configuration with no migration, which is the hook epic-interactive-components uses.
- The SDK is at most 50 KB gzipped, p75 first content stays at or under 1.5 s, and the WCAG 2.2 AA scans of the studio and the sample page are clean, with a person's keyboard and screen-reader walk recorded.

## Boundaries

- **MVP in:** the requirements above.
- **Post-MVP:** these are decided from the research. Storyly documents none of the editor-side ones, so they are not parity gaps:
  - a gallery of ready-made designs, and feed-driven templates (Storyly's are feed automation tied to product sets);
  - a brand kit beyond the project theme and project fonts, and font formats other than WOFF2;
  - animations and transitions;
  - GIF search (a third-party API with its own terms);
  - AI assist;
  - collaborative live editing (R9's revision check prevents lost writes);
  - text locale variants (the document keeps element ids stable for them);
  - grouping elements;
  - a manual reading-order override;
  - gradients;
  - text effects such as shadow and outline;
  - a story poster image rendered in the browser;
  - import from Instagram, TikTok or Canva.
- **Interactive components** (poll, quiz, emoji reaction, countdown, product pins, promo code, Rating) are built by epic-interactive-components as element types on R8's registry. This epic builds no component.
- **Events:** CTA click and component response events belong to epic-analytics and epic-interactive-components. This epic emits no events.
- **Native rendering** of documents is post-MVP. It consumes the same document (R10).
- **Touch point:** the importer's tale creation goes through the `tales` public interface (R16) and its CTA mapping (R17). The importer's owner is epic-storyly-importer; this epic's story 12 changes the mapping and the report rows.
- **Must not change:** frame rendering (bar, banner), zone keys, the Delivery API's key handling, or the playback rules of tales with one media element.

## References

- parent — `_bmad-output/initiative-taleart/initiative-taleart.md`, section Requirements (R13, R2, R10)
- prd — `_bmad-output/initiative-taleart/prd-taleart/prd-taleart.md`, FR-010, FR-012, FR-014, FR-016, FR-032, FR-033, NFR-004, NFR-005, NFR-007
- architecture — `_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md`, AD-3, AD-4, AD-5, AD-11, AD-14, AD-15, AD-16, Quality Targets
- research — `_bmad-output/initiative-taleart/research-storyly-competitive-teardown/digests/studio-r4-1.md`; `digests/entities-content-r1-1.md` (story contents)
- web zones — `_bmad-output/initiative-taleart/tickets/epic-web-zones/epic-web-zones.md`, R4 (viewer), R9 (theme), R10 (budget), R12 (cover)
- importer — `_bmad-output/initiative-taleart/tickets/epic-storyly-importer/import-mapping.md`

## Notes

- Decision (2026-10-21, user): Tale Studio is in the MVP. Tales are documents of live elements rendered by the SDK, not flattened images, with Storyly's story editor as the reference.
- Decision (2026-10-21): the tracer bullet is story 1, "Tracer: add a text element to a tale and see it in the viewer". It covers the document schema with one element type, storage with a revision, the Management and Delivery API, a minimal studio with a canvas, and the SDK renderer in the viewer (autopilot default; the user may change it).
- Decision (2026-10-21): calls to action (PRD FR-016) move from epic-interactive-components to this epic, since they are element types with no response to record. Interactive components stay in their epic and build on R8 (autopilot default; the user may change it).
- Decision (2026-10-21): the epic builds after web zones (it needs the viewer, story 3.2, and the theme, story 3.8) and before epic-interactive-components, which now waits on story 8 (the element-type registry) (autopilot default; the user may change it).
- Decision (2026-10-21, user): the starting limits are accepted. They are the safe areas (top 12%, bottom 16%, sides 4%), the document limits (128 KB, 60 elements, 1,000 characters), one video per tale, and the 1 s first tale frame. All are starting values, tuned by story 7.14.
- Decision (2026-10-21, user): contrast below the WCAG ratios is a warning only and never blocks publishing.
- Assumption: the editor's stories share one dashboard editor component, so stories 1 to 10 form one ordered lane. Migration (11) and duplication (12) touch the `tales` module and run beside the later editor stories, after story 5.
- Decision (2026-10-21, user): fonts are system stacks plus either a font-family name that the host loads or a custom font uploaded to the project. The custom font is WOFF2 only, checked by magic bytes, at most 500 KB, with a family, weight and style, and a licence confirmation. It is served under the AD-11 rules and loaded by the SDK through `FontFace` only when a tale that uses it opens (R4, R18, story 17; AD-16).
- Decision (2026-10-21, user): `studio_image` is not imported in the MVP. The layers it probably flattens are listed as a difference in the import report (R17, story 13). Revisit after the real run (importer story 2.3).

- Decision (2026-10-22, user): captions for video elements (WebVTT) and a language setting per tale and per text element are **post-MVP**. The accessibility review of web zones (3.12) found that these are missing; story 7.15 records them as known gaps. Story 7.15 also covers the WCAG scan of the web-zones dashboard screens that 3.12 left open.
- Note (2026-10-22, story 7.4): a text element stores its direction (`auto`, `rtl` or `ltr`; new texts store `auto`) and is rendered with the `dir` attribute. With `auto`, each text element takes its direction from its own first strong character, independently of the host page and of other texts: a Hebrew-first text reads right to left (and `start` alignment puts it on the right) even on a left-to-right page, and English inside it is drawn in bidi order. A text whose first strong character is Latin but which is mostly Hebrew needs `rtl` set explicitly. The sample-page review (`sdk-sample:a11y-review`, section 11) checks the visual order of a mixed Hebrew and English line.
- Note (2026-10-22, story 7.17 security review): the server checks an uploaded font's WOFF2 structure (signature, length, flavour, reserved field, table count, declared sizes, directories and compressed data inside the file) but never decompresses or parses the font tables. The tables are parsed only by the visitor's browser: OTS (the OpenType Sanitizer) in Chromium and Firefox, CoreText in Safari. A flaw in those parsers is a residual risk that TaleArt does not mitigate beyond the licence confirmation, the per-project caps, and fonts loading only in the viewer of a tale that uses them. The font-family rules reserve the `taleart-font-` prefix, so no theme or font name can reach another project's font.
- Note (2026-10-22, story 7.5, for story 7.11): a tale with a document and no `durationMs` now plays 7 s (R5's default), while a tale without a document keeps the viewer's 5 s. The R16 migration must therefore write `durationMs: 5000` into each migrated document so existing tales keep their timing. Until then, a legacy tale whose image carries a document overlay (text only so far) plays 7 s instead of 5 s. A document's video plays at most 15 s, and a video that stalls for 5 s ends its tale; a tale's own media video keeps the old rules.
- Note (2026-10-22, story 7.11): a tale's media is its documents' `taleMedia` element (an `image` or `video` prop in `libs/contract`), which the server keeps in step with `tales.media_key` (`document_media_key` records the key last brought in step). It is full canvas, decorative, and `contain`, not `cover` as R16 says: the legacy viewer drew tale media contained, and R16's rule is that every tale renders exactly as before (a pixel comparison in `sdk-sample:a11y-review` section 14 checks it). While it is the bottom element with the full-canvas box, unrotated, unrounded and opaque, the SDK draws it full-bleed in the stage with the playback rules tale media always had (a video plays with sound where the browser allows it, for its whole length, with no 15 s cap or stall rule; the epic's Boundaries say they must not change); it does not count toward the one-video limit, and a document holds one. Once a person moves it, it is an ordinary element. A re-import replaces it only while it still shows the import's key, so a person's studio edit is kept. The Delivery API keeps each tale's `media` for SDKs from before documents, always sends a document, and composes the media in for a tale whose documents are not yet in step. Under reduced motion a migrated GIF is now drawn still (R12). R12's "video autoplays muted" applies to document videos; the tale's own media video keeps sound where the browser allows it (AD-16 amended). After the review: the stage path applies only on a colour background; a tale without a document, from an older server, is drawn as before; the default cover stays "the first tale with media" (its lowest media element); a deploy beside the previous release sets TALE_MEDIA_MIGRATION=off until every instance runs the new code, and `nx run api:tale-media-rollback` undoes the data (dry run by default).
- Decision (2026-10-23, owner, UX review D2, D4): "Publish changes" is renamed "Update tale" and "Discard draft" "Discard changes" (R9's behaviour is unchanged: updating copies the draft to the published document); "Publish" now means only visibility. New tales are stored `live` (Shown) and show when their group is On, but a tale with nothing updated to the site is not delivered, so Studio edits stay private until "Update tale" (AD-6, AD-15 amended). Story 8.4 of `epic-ux-rework` makes the change; built stories are not reopened. The rework runs before 7.7 onward: 7.7 after 8.1 and 8.4, 7.9 after 8.7 and 8.12, 7.12 after 8.1, 7.14 after 8.7, 7.15 after 8.17. Open question for 7.12 (owner): a duplicated tale defaults to Hidden so it does not appear twice on the site (recommended); R11's "the copy is a new draft" then reads "the copy is Hidden".
- Note (2026-10-23, story 7.14): the starting limits are tuned by measurement and all kept. `nx run sdk-sample:perf` (Fast 4G as Chrome DevTools sets it, 4x slower CPU, 412 x 823, cold contexts, nearest-rank p75 of 10 runs) measured: the SDK 24.4 KB gzipped in one chunk (the 50 KB budget and the 40 KB split point kept; `web-sdk:size` estimates the split would move about 17.8 KB of viewer and renderers out of `index.js`); cold p75 first zone content about 1.27 s from the sample page and 1.31 s from the API's test page with the SDK from `/sdk/v1/taleart.js` (1.5 s kept); p75 first tale frame of a 20-element tale (14 texts, half in a 48 KB project font, 4 shapes, an emoji, a button) about 70 ms from the tap, and 73 ms with 60 elements, with the font in use about 240 ms after the tap, always after the first frame, and with the font response held back 1.5 s the frame still paints in about 66 ms with no font face loaded (1 s kept: the measured tale has no media, and a tale's picture arrives after its frame); no font request on a page whose tales use none. The 500 KB font cap is kept: at Fast 4G's ~1 MB/s a 500 KB font swaps in about 0.7 s after the tap, inside the 3 s give-up, and never delays the first frame. The document limits (128 KB, 60 elements, 1,000 characters) and one video per tale are kept: 60 elements cost about 3 ms more than 20. The API's `/sdk/v1/taleart.js` sent the SDK uncompressed (80.8 KB, cold p75 about 1.37 s); it now sends it gzipped to a browser that accepts gzip. The AD-16 split is not needed yet; when it is, the API must also serve the second chunk, the UMD build cannot split, and `banner.ts` and `bar.ts` share helpers with `viewer.ts` and `document/renderer.ts` that have to move first.
