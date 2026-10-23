# web-sdk

The TaleArt Web SDK: a `<taleart-view>` custom element that renders a zone's display (a bar or a banner) and opens its
tale groups in a full-screen viewer, reading published content from the Delivery API with the project's site key and
the zone's slug.

## Terms

These are the words the dashboard and the docs app use (the UX review's glossary):

| Term | Meaning |
| --- | --- |
| Project | Your app or site: its zones, tale groups, theme, fonts and site key. |
| Zone | One spot in your app or site where tales appear, named on a page by its slug (`home-top`). |
| Display | How a zone looks: a bar or a banner, plus its settings. One per zone (the API and code call it a frame). |
| Template | A preset picked when a zone is created (Stories bar, Promo banner, Blank). It sets the display once. |
| Tale group | A set of tales shown as one item: one circle in a bar or one slide in a banner. On or Off. |
| Tale | One full-screen page of a group, made in Tale Studio. Shown or Hidden. |
| Theme | Colours, rings and fonts for every zone of the project. |
| Site key | The project's one key for host pages (`tas_…`). |

## Placing a zone

The zone page's Install tab in the dashboard gives this snippet for its zone, with the API URL and the zone's slug
filled in (and the site key, right after it is issued):

```html
<script type="module" src="https://api.example.com/sdk/v1/taleart.js"></script>
<taleart-view api-url="https://api.example.com" site-key="YOUR_SITE_KEY" zone="home-top"></taleart-view>
```

Several zones of a project go on one page with one script tag and one element per zone, all with the same site key:

```html
<taleart-view api-url="https://api.example.com" site-key="YOUR_SITE_KEY" zone="home-promo"></taleart-view>
```

A project has one site key (`tas_…`), issued in the dashboard; every zone of the project is placed with it and its
slug, so several elements on a page share one key. Elements that ask for the same zone at the same time share one
request. An unknown slug, or a revoked or rotated site key, renders nothing and logs one console error per element.
Rotating the site key affects every zone of the project: update every page that uses it. The key is
not a secret once it is in a page's HTML: anyone who sees it can read every zone of the project that has a display and
visible content, by its slug.

The Install tab also has a Copy button and an "Open test page" link (below).

- **Where the SDK comes from.** The TaleArt API serves this package's ES build at `<api-url>/sdk/v1/taleart.js`: the
  API build copies `dist/libs/web-sdk/index.js` next to its `main.js` (`WEB_SDK_FILE` names another file). The `v1`
  follows the Delivery API's version: the bundle there always reads `/delivery/v1`. A deploy replaces it at the same
  URL; it is cached for five minutes, and a running API serves a rebuilt file at once. Deploy a new file atomically:
  write it elsewhere on the same disk, then rename it over the old one (the API reads again a file that changes while
  it reads it, but never keeps half of one). A site may also host the file itself, or install the npm package.
- **Pinning it.** The same build is also served at a URL pinned to its content, `<api-url>/sdk/v1/taleart.<hash>.js`,
  cached for a year. The zone page's Install tab shows that URL and its Subresource Integrity value, each with a Copy
  button, and copies the whole tag, for a page that wants the browser to refuse any other file:
  `<script type="module" src="…/taleart.<hash>.js" integrity="sha384-…" crossorigin="anonymous">`
  (`GET <api-url>/api/v1/install` gives them too, as `sdkPinnedUrl` and `sdkIntegrity`, with `sdkBuildsKept`, to a
  signed-in user). By default the API keeps the last 5 SDK builds this server served at their pinned URLs, the
  current one included, so a pinned page keeps working through the next 4 SDK builds the server serves; update the
  pin before then. The Install tab says the server's own number. With only the current build kept, a pinned URL
  stops working at the next SDK build. An older or unknown hash answers 404, which no cache keeps.
  - For the people who run TaleArt: the API writes each build it serves to `SDK_BUILDS_DIR`, at start and once the
    bundle file has not changed for a second, and deletes the oldest beyond `SDK_BUILDS_KEPT` (default 5, from 2 to
    100: during a rolling deploy an old and a new process each keep their build). Unset or empty, the folder is
    `.data/sdk-builds` from the folder the API starts in, outside the build output, which a rebuild replaces.
    `off` (or `false`, `none`, `no`, `0`, in any case) keeps only the current build. The folder must persist across
    deploys (a volume, in a container) and be shared by every API process that serves the same URLs, on hosts whose
    clocks are in sync (the newest build is the most recently written file). In production the API warns at start
    when the folder holds no build.
- **The test page.** `<api-url>/sdk/v1/test-page?zone=<slug>` renders one zone with this SDK. It reads the site key
  from the URL fragment (`#siteKey=…`, which a browser never sends to a server) and removes it from the address bar,
  or from a field on the page. It stores the key nowhere and sends it only in the SDK's `Authorization` header to the
  Delivery API. It is served with a strict Content Security Policy (scripts from the API only), `noindex` and no
  referrer.

An element renders only with both a site key and a slug. Put the key only in `site-key` (or `siteKey`), never in a
query string: the SDK sends it only in the `Authorization` header. Slugs are not access control (they are often easy
to guess), so treat what a visible zone shows as public. The Delivery API limits how often one visitor may ask (by
default bursts of 600, then 20 a second), and one address ten times that in all; over the limit it answers 429, and
the element renders nothing and logs one console error.

**The visitor id.** Each browser gets a visitor id: a random UUID v4 the SDK makes once and keeps in the host page's
local storage under `taleart.visitor`. It holds no personal data and is tied to no account; the SDK sends it only to the
Delivery API, in the `X-TaleArt-Visitor` header, which limits requests per visitor rather than per address, so many
visitors behind one network each get their own allowance. Clearing the site's data makes a new one. Where local storage
is blocked, the id lasts one page load; a request without an id is limited by its address. The native SDKs keep the same
kind of id in the SDK's own device store, where it lasts until the app is reinstalled or its data is cleared.

<!-- docs-check:removed -->
### Removed: zone keys and the `stage` attribute

Builds before the zone rework placed a zone with its own zone key (`tak_…`, the `zone-key` attribute or `zoneKey`
property) and picked one of its stages with `stage="…"`. They were removed in the zone rework (story 8.7, owner
decision 2026-10-22): such an element renders nothing. The `zone-key` attribute logs one console warning per element;
the `zoneKey` property, the `stage` attribute and `configureZone` with a zone key are ignored without a word. The
upgrade (story 8.5) turned every stage, and every frame beyond a zone's first, into a zone of its own with one display
and a copy of the zone's tale groups. A stage's key became its zone's slug (with a `-2`, `-3` suffix where another zone
already had it); a zone made from a frame took the original zone's new slug plus `-<type>-<n>`, counting that zone's
frames of the type oldest first (`top-bar-2` for the second bar of a zone that became `top`). To move a page, issue the project's site key and replace the
element with the Install tab's snippet for the zone that came from the stage. The docs app's "Stages and zone keys"
page has the details.
<!-- /docs-check:removed -->

Loading the SDK registers `<taleart-view>`. The ES build exports the API below; the UMD build puts the same exports on
`window.TaleartWebSdk`.

| Attribute / property | Meaning |
| --- | --- |
| `api-url` / `apiUrl` | The TaleArt API origin. |
| `site-key` / `siteKey` | The project's site key (`tas_…`) issued in the dashboard. |
| `zone` / `zone` | The zone's slug, such as `home-top`, shown on the zone page. |
| `theme` / `theme` | Theme fields for this element (JSON in the attribute, an object in the property); see below. |

## Theme

The project's theme, set in the dashboard, styles the zone's display and the viewer. A host page can override any of its fields
for a zone, or for one element. There is no theme per display. Each field resolves, in order, from:

1. the element's `theme` property or attribute,
2. the zone's `configureZone(zone, { theme })` option, where `zone` is the zone's slug,
3. the project's theme,
4. TaleArt's default.

Import `configureZone` from exactly the URL of the page's script tag (the pinned one, if the page pins it): another
URL loads a second copy of the SDK, whose settings the elements never read.

```js
import { configureZone } from 'https://api.example.com/sdk/v1/taleart.js';

// Every <taleart-view> with zone="home-top"; other zones keep the project's theme.
configureZone('home-top', { theme: { ringStyle: 'solid', ringColors: ['#0055ff'] } });

// One element only.
document.querySelector('taleart-view').theme = { cornerRadius: 0 };
```

```html
<taleart-view api-url="…" site-key="tas_…" zone="home-top" theme='{"fontFamily": "Georgia, serif"}'></taleart-view>
```

| Field | Values |
| --- | --- |
| `ringStyle` | `"gradient"`, `"solid"` or `"none"` |
| `ringColors` | 1–3 colours, `#rrggbb` |
| `seenRingColor` | `#rrggbb` |
| `ringWidth` | integer 1–4 (px) |
| `cornerRadius` | integer 0–32 (px), or `null` for the display's own |
| `fontFamily` | a CSS font-family list (names, quoted or bare; the host page loads the font), or `null` for the host page's |
| `titleColor` | `#rrggbb`, or `null` for the host page's text colour |
| `backgroundColor` | `#rrggbb` or `"transparent"` |
| `accentColor` | `#rrggbb`: the viewer's progress and buttons |

- A field left out (or `undefined`) falls through to the next source; `null`, where allowed, is a value and wins.
- Each value is checked with the same rules as the dashboard's. An invalid or unknown field is ignored with one console
  warning naming it, and the next source's value applies. An override that is not an object (or attribute text that is
  not JSON) is ignored with one warning. Values only ever reach CSS custom properties, never style text.
- The value is copied, checked and kept when set: assign the property again, or call `configureZone` again, to change
  it. Reading `el.theme` returns a copy of that element's own override fields that passed (not the zone's or the
  project's). Rendered elements restyle at once, with no new request.
- `el.theme = null`, removing the attribute (or setting it empty), `configureZone(zone)` or `configureZone(zone, {})`
  removes an override. A `theme` attribute of `null` or of JSON that is not an object warns once and sets none.
- A `theme` property set by script before the SDK defines `<taleart-view>` is applied when the element upgrades and wins
  over a `theme` attribute already present then, which is left unread and logs nothing; later attribute changes apply
  as usual.
- Warnings about a zone's theme name the zone by its slug, or a site key passed by mistake by its first 8 characters (`tas_…`) only.
- With an override, colour contrast is the host page's responsibility: keep titles at 4.5:1 and rings at 3:1 against the
  background (WCAG 2.2 AA).

## Fast first content

The budget (NFR-006) is the first zone content visible within 1.5 s at p75 on a mid-tier phone over Fast 4G, with
the SDK at most 50 KB gzipped. What the SDK does:

- The display's covers in view load first, eager and at high fetch priority; every other picture (bar covers out
  of view) waits until they have loaded, at most 3 s. Bar covers out of view stay lazy, including
  still canvas covers (animated images under reduced motion). A new render (another key) starts over, and an
  element removed from the page starts no more downloads.
- A still video cover (a first frame, metadata-only preload) counts as loaded at its first frame, or 1 s after its
  metadata when the browser loads no frame data up front.
- A banner loads the slide shown, then the slides next to it once that slide has its picture; the rest stay lazy.
- Covers and slides have fixed boxes, so nothing inside the element shifts when pictures arrive.
- The Delivery API answers `Cache-Control: private, no-cache` with an ETag: a repeat visit revalidates the zone and
  gets 304 while it is unchanged, and a paused or unpublished group still disappears at once.
- Performance marks, for your own monitoring, each once per element: `taleart:zone` when the zone first arrives, and
  `taleart:first-content` when the element's display is first on the page with its covers in view loaded (a render
  replaced or removed before that never marks). With several elements, the earliest is the page's first zone content.

```js
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) if (entry.name === 'taleart:first-content') console.log(entry.startTime);
}).observe({ type: 'mark', buffered: true });
```

What the host page does:

```html
<head>
  <!-- Fetch the SDK early. -->
  <link rel="modulepreload" href="https://api.example.com/sdk/v1/taleart.js" />
  <!-- Connect to the API early: once for the Delivery API call (CORS, no credentials), once for media. -->
  <link rel="preconnect" href="https://api.example.com" crossorigin />
  <link rel="preconnect" href="https://api.example.com" />
  <style>
    /* Reserve the display's height, so the page does not shift when it renders: 94 px for the default bar. */
    taleart-view { display: block; min-height: 94px; }
  </style>
</head>
```

- Serve the SDK compressed (gzip or brotli), as any CDN does. The API's `/sdk/v1/taleart.js` sends it gzipped to
  a browser that accepts gzip.
- Give tale groups a cover in the dashboard: a still cover is a 320 px JPEG of about 20 KB, while a group without one
  shows its first tale's lowest media element (its full-size image, often 300 KB or more) in the bar, or that tale's
  background colour when it has no media.

### Project fonts

A text in a tale can use a WOFF2 font uploaded to the project (Tale Studio). The SDK never loads one for first zone
content: it fetches a font only when the viewer opens a tale that uses it, once per page, from its public URL on the
API (CORS, no credentials). It registers the bytes with `new FontFace(...)` and `document.fonts.add`, under an internal
name made of the font's id, and builds no `@font-face` or `url()` text. The text shows its fallback stack until the
font is ready and then swaps; a font that fails, or takes over 3 s, is dropped and the fallback stays. A page whose
tales use no project font downloads no font file. Under a CSP, the API origin must be allowed in `connect-src`, as it
already is for the Delivery API.

### Images and video in tales

A tale's images and its video (Tale Studio) load only when the viewer opens that tale, never for first zone content.
Images are `<img>` elements with their alt text; decorative ones are hidden from assistive technology. The video is a
muted, inline `<video>` that plays with the tale, pauses with the viewer and ends it: a tale with a video lasts as long
as the video, at most 15 s, and moves on if the video stalls for 5 s; one without lasts its set duration (7 s by
default). When the visitor prefers reduced motion, the video waits on its first frame until Play, and a GIF, WebP or PNG
is drawn once to a canvas. Under a CSP, the API origin must be allowed in `img-src` and `media-src`, as it already is
for tale media.

### Shapes, emoji and stickers in tales

Shapes (rectangles, ellipses and lines) are built from their checked colours and sizes through CSSOM, never from SVG
or CSS text, and are hidden from assistive technology unless they have a label. An emoji is text in the platform's
emoji fonts (no emoji images are downloaded), announced by its label, the emoji's name. An image sticker is an image of
the project's media shown whole, with its alt text or hidden when decorative, and still under reduced motion. An SDK
that predates a type skips it and shows the rest of the tale.

### Buttons, image buttons and the swipe-up link

Calls to action are real `<a>` links with `rel="noopener noreferrer"` (and `target="_blank"` when set to open a new
tab), named by their label or, for an image button, its alt text. The SDK checks each destination again with the
contract's rule (an absolute `http` or `https` URL of at most 2,048 characters, no credentials or control characters)
and does not draw a link that fails it. The swipe-up link sits in the bottom safe area and opens on a click, on Enter
when focused, or on a flick up anywhere on the tale. A flick is one pointer (a second finger makes the press a pinch,
which opens nothing), released within 500 ms, travelling upwards more than sideways by at least 50 px or 8% of the
stage's height, whichever is more; a hold that drifts up, or a slower drag, is not one. On a tale without a swipe-up
link a vertical drag stays a tap, and the viewer's taps, sideways swipes and hold to pause are unchanged. A link that
opens a new tab says "(opens in a new tab)" in its accessible name. While a link has keyboard focus the tale waits,
and when the tale goes (by a key or the arrows) focus returns to the viewer.

### Budgets

The Web SDK's budgets (NFR-006; epic Tale Studio R15) on a mid-tier phone over Fast 4G, checked by the two targets
below:

| Budget | Limit | Checked by |
| --- | --- | --- |
| The SDK's ES chunks together, gzipped | at most 50 KB | `web-sdk:size`, `sdk-sample:perf` |
| The chunk the page loads (`index.js`), gzipped | at most 40 KB, else the viewer splits out | `web-sdk:size`, `sdk-sample:perf` |
| First zone content, cold, p75 | at most 1.5 s | `sdk-sample:perf` |
| First tale frame of a 20-element tale with a project font, from the tap, p75 | at most 1 s | `sdk-sample:perf` |
| Font requests by a page whose tales use no project font | none | `sdk-sample:perf` |
| Project font | after the first tale frame, only when its tale opens | `sdk-sample:perf` |

Past 40 KB gzipped, the viewer and the document renderers move to a chunk the SDK loads when the viewer first opens
(AD-16), and `web-sdk:size` reports both chunks. Until then the SDK is one chunk, and the check reports what that split
would move, as lower bounds (from `dist/libs/web-sdk-modules.json`, the module report the build writes beside the
package; it is not published). Sizes are measured at gzip level 9 (what the API sends) and level 6 (most servers' and
CDNs' default), and judged on the larger. The split also needs the API to serve the second chunk under `/sdk/v1` and the UMD build to keep working.

### Measuring

`nx run sdk-sample:perf` builds the API and the SDK, starts the API on `TEST_DATABASE_URL` (a database whose name
ends in `_test`, as pg resolves the connection string), seeds a zone with a bar display and eight tale
groups (an animated cover first, a group without a cover third, still covers for the rest; three 1080 x 1920 JPEG
tales each), serves the sample page and loads it in headless Chromium with Chrome DevTools' Fast 4G (165 ms latency,
9 Mbps x 0.9 down, 1.5 Mbps x 0.9 up), a 4x slower CPU and a 412 x 823 phone screen. Each run is a cold load (empty
cache) and a warm reload; it reads `taleart:first-content` and prints every run, p50, p75 and max, layout shift and
the SDK's size per chunk. It fails when cold p75 is over 1.5 s, the SDK over its size budget, or that page requests a
font file. A second zone holds one composed tale of 20 elements (14 texts, every other one in a project font, 4 shapes,
an emoji and a button): the run checks that its page requests no font before the tale opens, then times the first tale
frame (all 20 elements placed and painted, the texts in their fallback) and the font swap from the tap on its bar item,
and fails when p75 first tale frame is over 1 s. Three more runs hold the font's response back 1.5 s: they fail when
the first frame then takes over 1 s (it waited for the font) or paints with the project font already loaded. Last, it
loads the first zone from the API's test page, which loads the SDK from `/sdk/v1/taleart.js` as a host page does, and
fails when cold p75 there is over 1.5 s or the SDK did not come gzipped. It ends with every gate, its limit and its
margin. `PERF_RUNS` (default 10), `PERF_BUDGET_MS` (default 1500),
`PERF_FRAME_BUDGET_MS` (default 1000) and `PERF_DEBUG=1` (the first load's requests) tune it.

What a run adds to the database, and deletes again at the end (also when it fails or gets SIGINT/SIGTERM): an admin
user and their session (inserted directly, as the API tests sign in), and through the Management API a project, its
zone, its bar display, eight tale groups with their zone placements, covers and 24 tales, and the project's site key; and a
project font with a second zone, its bar display, group and tale. The media files go
to a temporary folder that is removed with them. A run killed outright (SIGKILL) leaves those rows, whose media keys
then name files that no longer exist.

## Tale Studio preview (workspace only)

`@taleart/web-sdk/preview` (`src/preview.ts`) is the entry point the dashboard's Tale Studio imports to preview a tale
exactly as visitors see it (AD-16, epic Tale Studio R10). It is not part of the published bundle: `index.js` does not
include it, so the host page's bundle and its public types are unchanged. It exports:

- `TalePreview`: the SDK's own `TaleViewer` and document renderer embedded in a host element's Shadow DOM: shown in
  place as a region described as a preview (not a modal dialog, never taking focus, Close labelled "Stop preview"),
  always laid out as on a phone (no wide-screen deck), letting the page scroll, with the viewer's chrome, playing the
  tale for its duration. It starts muted; `setSound(true)` gives the tale's own video sound, as visitors have it.
  `show(tale)` takes a changed tale 150 ms after the last change and redraws it in place (on the timer, or around the
  tale's own running video), or plays it from its start 500 ms after the last change when its duration or a video
  changed; an unchanged tale changes nothing, and another tale starts over. Also `replay()`, `togglePause()`,
  `setTheme(theme)`, `setSafeArea(on)` and `destroy()`.
- `previewDocument(draft, mediaUrl)`: the studio's draft as the Delivery API would deliver it (hidden layers and
  editor fields left out, media keys as URLs). The server additionally validates a document when it is updated to the
  site and delivers none that fails; the preview draws the draft as it stands, with the SDK's own checks.
- `PREVIEW_SIZES`: 375 × 667, 390 × 844 (default) and 430 × 932.

Links in the preview render with the visitor's look and stay focusable (`role="link"`, `tabindex="0"`, so the tale
waits while one has focus), but without `href` or target, and clicks on them are cancelled: a draft's destination
never becomes a live link in the dashboard. `nx run sdk-sample:preview-parity` compares the preview with the sample
page's viewer pixel by pixel at 390 × 844, in a phone-sized window and inside a 1440 × 1000 window.

## Building

Run `nx build web-sdk` to build the library, and `nx run web-sdk:size` to check the size budget (all chunks at most
50 KB gzipped, the page's chunk at most 40 KB; see "Budgets").

## Running unit tests

Run `nx test web-sdk` to execute the unit tests via [Vitest](https://vitest.dev/).
