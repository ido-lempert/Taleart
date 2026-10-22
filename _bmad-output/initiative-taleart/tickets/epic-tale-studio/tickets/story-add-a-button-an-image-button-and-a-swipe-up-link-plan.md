---
title: 'Add a button, an image button and a swipe-up link'
type: 'feature'
ticket: '7'
created: '2026-10-22'
status: 'built'
baseline_revision: 'ee3ad4a'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'thorough'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/epic-tale-studio.md'
  - '{project-root}/_bmad-output/initiative-taleart/tickets/epic-tale-studio/tickets/story-add-shapes-stickers-and-emoji-plan.md'
  - '{project-root}/_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A tale can show text, media, shapes and emoji (7.1–7.6, 7.11, 7.17) but has no call to action: epic R7 asks for a button, a custom image button and a swipe-up link, each opening a destination; R14 and AD-15/AD-16 require destinations to be absolute `http`/`https` URLs, checked on write and again by the SDK.

**Approach:** Three additive element types in the registry (`button`, `image-button`, `swipe-up`; no version change, no migration). The contract holds one URL rule (`linkUrlProblem`) that the server, Tale Studio (inline) and the Web SDK (again before rendering) all use; the server adds per-type rules, the one-swipe-up limit and its pinned box, and publish rules (a visible link needs a web address; an image button needs alt text). The SDK renders real `<a>` elements and the viewer opens the swipe-up link on a swipe up. The studio adds toolbar buttons, canvas drawing, and a link inspector with a contrast warning.

## Boundaries & Constraints

**Always:**
- Destination (`props.href`, optional in a draft): an absolute `http://` or `https://` URL (case-insensitive scheme), at most 2,048 characters, parsed by WHATWG `URL` with a host; refused: empty, other schemes (`javascript:`, `data:`, `ftp:`, `mailto:` …), relative and protocol-relative URLs, credentials (`user:pass@`, as the importer's media URL policy refuses them), and any character ≤ U+0020, DEL, C1 controls, U+2028/2029 and bidi controls anywhere (browsers strip tabs and line feeds, so `java\tscript:` would otherwise pass a looser check). The schema states `maxLength` and the scheme prefix; the server runs the full rule first so a refusal says why in words.
- `newTab: true` opens a new tab; every link has `rel="noopener noreferrer"` (AD-16), `target="_blank"` only for new tab.
- `button` props: `label` (1–80, one line), `variant` `filled|outline`, `color`, `fill` (hex), `radius` (0–0.5 of canvas height). Label size follows the box height (40%, ≤ 6% of canvas).
- `image-button` props: `mediaKey` (PNG/JPEG/GIF/WebP of the project; media under every 7.5 rule: membership, `tale_media`, locks, public route, delivery URL), `radius`. Its alt text (`a11y.label`) names the link and is required to publish; the decorative mark does not count.
- `swipe-up` props: `label`, `color`, `background` (pill). At most one per document (draft and published, hidden counted); its box must be `SWIPE_UP_BOX` (bottom safe area, centred); the studio never moves it, and the SDK draws it there whatever the box says and draws only the first.
- Publishing refuses a visible link without a valid web address, naming it ("\"See more\" needs a web address before the tale can be updated.").
- SDK: real `<a>` elements; labels as text nodes; styles through CSSOM; a link is never `aria-hidden` (decorative ignored); side cards on wide screens make links unfocusable and not clickable.
- Viewer gestures: a swipe up (≥ 50 px upward, more vertical than horizontal) opens the tale's swipe-up link, from the stage or from the link itself, and the click that may follow is swallowed; on a tale without one a vertical drag stays a tap, as before. Taps, sideways swipes, hold-to-pause and keys are unchanged. Enter on a focused link and a click are the browser's own link activation.
- Studio: Add button / Add image button (project media picker) / Add swipe-up link (marked unavailable with a hint once the tale holds one); a labelled inspector; the web address checked as typed with the server's rule and messages, applied only when valid; a contrast warning on button and swipe-up labels (warn-only, layer row too); "Update tale" wording.
- CTA click analytics are out of scope (epic-analytics).

**Never:** HTML, CSS or script in a document; a link without `noopener`; a looser URL check in any client; new npm packages or contract entry points; a document version change; studio code in the dashboard's initial bundle.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Save links | button, image button, swipe-up with https/http addresses | saved, delivered with `href`, image `url` | — |
| Bad address | `javascript:`, `java\tscript:`, `data:`, `ftp:`, `/x`, `//x`, `https://u:p@x`, control char, space, bidi override, no host, 2,049 chars | — | 400 at `/elements/i/props/href`, message in words |
| 2,048 chars | exactly the limit | saved | — |
| Second swipe-up | two swipe-up elements (one hidden) | — | 400 at `/elements/1/type` |
| Moved swipe-up | box ≠ `SWIPE_UP_BOX` | — | 400 at `/elements/i/box` |
| Publish without address | visible link without `href` | — | 400 naming the link |
| Image button alt | none, or decorative only | publish refused "\"Image button 1\" needs alt text…" | — |
| SDK scheme | `javascript:` etc. reached the SDK | link not drawn | — |
| Swipe up | upward swipe on a tale with a swipe-up link | opens it once | sideways stays group swipe |

</intent-contract>

## Code Map

- `libs/contract/tale-document/element-types/{button,image-button,swipe-up}.schema.json` (new), `registry.json`, `openapi/openapi.yaml`; `src/lib/tale-document.ts` (types, `linkUrlProblem`, `isLinkUrl`, `LINK_URL_MESSAGES`, `missingLinkUrl`, `SWIPE_UP_BOX`, style resolvers, names, image button in the media helpers, `hasAltText` type-aware); `src/lib/text-style.ts` (`linkLabelStyle`).
- `libs/server/tales/src/lib/tale-document.ts` — href and label rules, swipe-up limit and box, publish rule (`LinkUrlRequiredError`), NFC labels, draft problem names.
- `libs/web-sdk/src/lib/document/links.ts` (new), `renderer.ts` (registry, CSS, pinned swipe-up, links never hidden), `viewer.ts` (swipe-up gesture, side cards).
- `apps/dashboard/src/app/pages/tale-links.ts` (new inspector), `tale-studio.ts` (toolbar, canvas, layer warnings, contrast, pinned swipe-up, picker), `tale-media.ts` (type), `icon.ts`.
- `apps/api/src/app.spec.ts`; `apps/sdk-sample/a11y-review.mjs` (section 14b).

## Tasks & Acceptance

**Execution:**
- [x] contract: schemas, registry, OpenAPI, URL rule and helpers; `contract:generate`; tests (`tale-links.spec.ts`).
- [x] server-tales + api: rules, limit, publish rule; unit (`tale-links.spec.ts`) and HTTP tests.
- [x] web-sdk: three renderers, swipe-up gesture; tests (`document/links.spec.ts`, `viewer-links.spec.ts`).
- [x] dashboard: toolbar, canvas, inspector, warnings; component tests (`tale-links.spec.ts`).
- [x] sdk-sample: a11y-review section 14b (links, names, Tab order, focus ring, target size, axe).
- [x] Playwright walk (ports 3390/4290/4390, own `_test` DB), screenshots in the scratchpad `shots-7.7/`.

**Acceptance Criteria:**
- Given one of each link with destinations, Update tale, and the sample page, each opens its URL by click and by keyboard, the swipe-up link also by a swipe up, and the new-tab image button opens a tab without opener access.
- Given `javascript:alert(1)` or an ftp URL, the studio refuses it inline and the API answers 400; a second swipe-up link cannot be added.
- Given the full verification, all projects lint, test and build; `web-sdk:size` ≤ 50 KB; a11y scans pass (known failures excepted); perf cold p75 ≤ 1.5 s; dashboard initial bundle < 500 KB.

## Implementation Notes

- URL policy in one place, `linkUrlProblem` (contract): the server runs it before the schema (so the 400 says why), the studio uses it on input and change with the same messages, and the SDK's `linkHref` runs it again and keeps only `http:`/`https:` `URL.href`.
- `image-button` joins `MEDIA_ELEMENT_TYPES`, so 7.5's media rules cover it unchanged; delivery turns `mediaKey` into `url` and keeps `href` (hence `href`, not `url`, for destinations).
- Swipe-up pinning: the server requires `SWIPE_UP_BOX`; the studio's `commit` resets a swipe-up box, keyboard moves and drags say it is pinned, its box fields are hidden, duplicate is refused; the SDK draws it at `SWIPE_UP_BOX`.
- Viewer gesture: `TaleViewer.onPointerUp` treats an upward swipe as opening the swipe-up link (`a.click()` within the gesture's user activation, so a new tab is allowed) and sets a one-task capture-phase click guard so a release on the link does not open it twice. The layer sits outside the stage, so a click on a link never steps.
- Verification (2026-10-22, on `autopilot/foundation` with 8.6 and 8.15 merged, `--skip-nx-cache`): `run-many -t lint test build` on the 12 projects passes (contract 315, server-tales 266, web-sdk 372, dashboard 487, api 549 tests); `web-sdk:size` 23.07 KB gzipped; `web-sdk:types-check` passes; `sdk-sample:a11y` no violations; `sdk-sample:a11y-review` 213 of 216 (the 3 known failures: landscape full height, landscape contrast, R16 pixel diff; section 14b all pass); `sdk-sample:perf` cold p75 1,270 ms, p75 first tale frame 59 ms. Dashboard initial bundle 497.72 KB (three icon cases in the shared icon component, about 0.5 KB; the rest is in the lazy studio chunk).
- Playwright walk (API 3390 on `taleart_w7e2e_test`, dashboard 4290, sample 4390, virtual WebAuthn passkey): 25 of 25 checks — inline refusal of `javascript:` and `ftp:`, API 400s for both and for a second swipe-up link, the add button marked unavailable, Update tale, and on the sample page each link opening by click and by Tab + Enter, the swipe-up link by a mouse swipe up, the new-tab image button in a tab with `window.opener === null`, and a sideways swipe not opening it.
- Not verified by hand: a real touch device and a real screen reader.

## Plan Change Log

## Review Triage Log

## Design Notes

Assumptions (none blocks; each recorded for review):
- A draft may hold a link without an address (new links start without one so autosave works); publishing needs one, like alt text.
- Credentials in a URL are refused, following the importer's URL policy; spaces must be percent-encoded.
- An image button cannot be decorative: it is a link and needs a name. Without alt text (only possible if a document reached the SDK unpublished), the SDK names it by the destination host.
- Every link gets `rel="noopener noreferrer"` (AD-16), same-tab ones too.
- The swipe-up link's look: a chevron over a pill with the label; label 2.4% of canvas height; colours editable.
- Swipe up anywhere on the tale (not only on the link) opens it, as on story platforms; on tales without one nothing changes.
- Button label contrast is checked against its opaque fill (filled) or what lies behind it (outline), with the text rules (4.5:1, 3:1 large); the outline edge's 3:1 non-text contrast is not checked.

## Verification

**Commands:**
- `NX_DAEMON=false TEST_DATABASE_URL=postgres://taleart:taleart@localhost:5432/taleart_w7_test node_modules/.bin/nx run-many -t lint test build -p api dashboard contract server-access server-zones server-tales server-storage server-targeting server-importer web-sdk sdk-sample fake-another tool --skip-nx-cache` -- expected: all succeed.
- `node_modules/.bin/nx run web-sdk:size`, `web-sdk:types-check` -- ≤ 50 KB gzipped; types pass.
- `node_modules/.bin/nx run sdk-sample:a11y`, `sdk-sample:a11y-review`, `sdk-sample:perf` -- 0 violations; checks pass (3 known failures); cold p75 ≤ 1.5 s.
