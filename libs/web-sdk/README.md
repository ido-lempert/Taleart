# web-sdk

The TaleArt Web SDK: a `<taleart-view>` custom element that renders a zone's display (a bar or a banner) and opens its
tale groups in a full-screen viewer, reading published content from the Delivery API with the project's site key and
the zone's slug.

## Placing a zone

```html
<script type="module" src="https://api.example.com/sdk/v1/taleart.js"></script>
<taleart-view api-url="https://api.example.com" site-key="tas_…" zone="home-top"></taleart-view>
<taleart-view api-url="https://api.example.com" site-key="tas_…" zone="home-promo"></taleart-view>
```

A project has one site key (`tas_…`), issued in the dashboard; every zone of the project is placed with it and its
slug, so several elements on a page share one key. Elements that ask for the same zone at the same time share one
request. An unknown slug, or a revoked or rotated site key, renders nothing and logs one console error per element.
Rotating the site key affects every zone of the project: update every page that uses it. The key is
not a secret once it is in a page's HTML: anyone who sees it can read every zone of the project that has a display and
visible content, by its slug.

The zone page's Install tab in the dashboard gives this snippet for its zone, with the API URL filled in, and an
"Open test page" link.

- **Where the SDK comes from.** The TaleArt API serves this package's ES build at `<api-url>/sdk/v1/taleart.js`: the
  API build copies `dist/libs/web-sdk/index.js` next to its `main.js` (`WEB_SDK_FILE` names another file). The `v1`
  follows the Delivery API's version: the bundle there always reads `/delivery/v1`. A deploy replaces it at the same
  URL; it is cached for five minutes, and a running API serves a rebuilt file at once. A site may also host the file
  itself, or install the npm package.
- **Pinning it.** The same build is also served at a URL pinned to its content, `<api-url>/sdk/v1/taleart.<hash>.js`,
  cached for a year. `GET /api/v1/install` gives it (`sdkPinnedUrl`) with its Subresource Integrity value
  (`sdkIntegrity`), for a page that wants the browser to refuse any other file:
  `<script type="module" src="…/taleart.<hash>.js" integrity="sha384-…" crossorigin="anonymous">`. A pinned URL is gone
  with the next build, so a page that pins it updates it on each release.
- **The test page.** `<api-url>/sdk/v1/test-page?zone=<slug>` renders one zone with this SDK. It reads the site key
  from the URL fragment (`#siteKey=…`, which a browser never sends to a server) and removes it from the address bar,
  or from a field on the page. It stores the key nowhere and sends it only in the SDK's `Authorization` header to the
  Delivery API. It is served with a strict Content Security Policy (scripts from the API only), `noindex` and no
  referrer.

An element renders only with both a site key and a slug. Zone keys and the `stage` attribute of
earlier builds are gone.

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
for a zone, or for one element. There is no theme per frame. Each field resolves, in order, from:

1. the element's `theme` property or attribute,
2. the zone's `configureZone(zone, { theme })` option, where `zone` is the zone's slug,
3. the project's theme,
4. TaleArt's default.

```js
import { configureZone } from 'https://your-cdn.example/taleart/index.js';

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
| `cornerRadius` | integer 0–32 (px), or `null` for the frame's own |
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
  `taleart:first-content` when the element's first frame is on the page with its covers in view loaded (a render
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
  <link rel="modulepreload" href="https://your-cdn.example/taleart/index.js" />
  <!-- Connect to the API early: once for the Delivery API call (CORS, no credentials), once for media. -->
  <link rel="preconnect" href="https://api.example.com" crossorigin />
  <link rel="preconnect" href="https://api.example.com" />
  <style>
    /* Reserve the frame's height, so the page does not shift when it renders: 94 px for the default bar. */
    taleart-view { display: block; min-height: 94px; }
  </style>
</head>
```

- Serve the SDK compressed (gzip or brotli), as any CDN does.
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

### Measuring

`nx run sdk-sample:perf` builds the API and the SDK, starts the API on `TEST_DATABASE_URL` (a database whose name
ends in `_test`, as pg resolves the connection string), seeds a zone with a bar and a banner frame and eight tale
groups (an animated cover first, a group without a cover third, still covers for the rest; three 1080 x 1920 JPEG
tales each), serves the sample page and loads it in headless Chromium with Chrome DevTools' Fast 4G (165 ms latency,
9 Mbps x 0.9 down, 1.5 Mbps x 0.9 up), a 4x slower CPU and a 412 x 823 phone screen. Each run is a cold load (empty
cache) and a warm reload; it reads `taleart:first-content` and prints every run, p50, p75 and max, layout shift and
the SDK's gzipped size. It fails when cold p75 is over 1.5 s, the SDK over 50 KB gzipped, or that page requests a
font file. A second zone holds one tale of 20 texts, half in a project font: the run checks that its page requests no
font before the tale opens, then times the first tale frame and the font swap from the tap on its bar item, and fails
when p75 first tale frame is over 1 s. `PERF_RUNS` (default 10), `PERF_BUDGET_MS` (default 1500),
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

Run `nx build web-sdk` to build the library, and `nx run web-sdk:size` to check the 50 KB gzip budget.

## Running unit tests

Run `nx test web-sdk` to execute the unit tests via [Vitest](https://vitest.dev/).
