// Renders the Web SDK's own output for the docs' Web guide (not shipped: a script for the docs' images).
//
// Serves the built SDK (dist/libs/web-sdk, run `pnpm nx run web-sdk:build` first) and a sample zone from a
// local server, which stands in for the Delivery API (GET /delivery/v1/zone, media under /media/), then loads
// host pages with <taleart-view> in headless Chromium and writes screenshots to apps/docs/public/images.
//
// Usage: node apps/docs/scripts/web-sdk-shots.mjs
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../../..');
const sdkDir = join(root, 'dist/libs/web-sdk');
const imagesDir = join(root, 'apps/docs/public/images');

// --- PNG encoding (no dependencies): a flat-colour scene per tale, drawn pixel by pixel. ---
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y, w, h);
      const o = y * stride + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// A sky-to-ground gradient with a sun or a moon on it: a stand-in for a tale's photo.
function scene(top, bottom, disc, discAt = [0.5, 0.38]) {
  return (x, y, w, h) => {
    const t = y / h;
    const c = [0, 1, 2].map((i) => Math.round(top[i] + (bottom[i] - top[i]) * t));
    const dx = x - w * discAt[0];
    const dy = y - h * discAt[1];
    return dx * dx + dy * dy < (w * 0.17) ** 2 ? disc : c;
  };
}

// --- The sample zone: one bar, one banner (the same groups), with tales in English and Hebrew. ---
const SCENES = {
  beach: scene([255, 196, 120], [18, 110, 170], [255, 244, 214]),
  sunset: scene([120, 60, 140], [255, 120, 80], [255, 210, 120]),
  mountain: scene([120, 180, 230], [40, 90, 60], [240, 240, 250], [0.3, 0.3]),
  shoes: scene([240, 240, 236], [90, 90, 96], [230, 80, 60], [0.7, 0.4]),
  snow: scene([200, 225, 245], [245, 250, 255], [255, 255, 255], [0.5, 0.25]),
  cabin: scene([40, 50, 80], [150, 100, 60], [255, 220, 150], [0.75, 0.3]),
};
const MEDIA = Object.fromEntries(Object.keys(SCENES).map((name) => [name, null]));
for (const name of Object.keys(SCENES)) MEDIA[name] = png(360, 640, SCENES[name]);

const GROUPS = [
  {
    id: 'g-summer',
    name: 'Summer',
    cover: null,
    tales: [
      { id: 't-beach', title: 'Beach', media: 'beach' },
      { id: 't-sunset', title: 'Sunset', media: 'sunset' },
    ],
  },
  {
    id: 'g-new',
    name: 'New arrivals',
    cover: null,
    tales: [{ id: 't-shoes', title: 'Shoes', media: 'shoes' }],
  },
  {
    id: 'g-winter',
    name: 'Winter',
    cover: null,
    tales: [
      { id: 't-snow', title: 'Snow', media: 'snow' },
      { id: 't-cabin', title: 'Cabin', media: 'cabin' },
    ],
  },
  {
    id: 'g-trips',
    name: 'Trips',
    cover: null,
    tales: [{ id: 't-mountain', title: 'Mountains', media: 'mountain' }],
  },
];
const HEBREW_GROUPS = [
  { id: 'g-summer', name: 'קיץ' },
  { id: 'g-new', name: 'חדש' },
  { id: 'g-winter', name: 'חורף' },
  { id: 'g-trips', name: 'טיולים' },
];
const HEBREW_TALES = { 'Beach': 'חוף', 'Sunset': 'שקיעה', 'Shoes': 'נעליים', 'Snow': 'שלג', 'Cabin': 'צריף', 'Mountains': 'הרים' };

// The local server's origin, set once it listens: the SDK takes only absolute media URLs.
let ORIGIN = '';

const KEYS = {
  bar: 'tak_SampleBarKey0000000000001',
  banner: 'tak_SampleBannerKey000000001',
  hebrew: 'tak_SampleHebrewKey00000001',
};

function zoneFor(kind) {
  const frameType = kind === 'banner' ? 'banner' : 'bar';
  return {
    id: 'z-home-top',
    name: 'Home – top',
    slug: 'home-top',
    frame: { id: 'f-home-top', type: frameType, settings: {} },
    taleGroups: GROUPS.map((g) => ({
      id: g.id,
      name: g.name,
      cover: null,
      tales: g.tales.map((t) => ({
        id: t.id,
        title: t.title,
        media: { kind: 'image', contentType: 'image/png', url: `${ORIGIN}/media/${t.media}.png` },
      })),
    })),
  };
}

// The host pages: the docs' snippet, with the locale variant for Hebrew.
const SNIPPET_SCRIPT = '<script type="module" src="/sdk/v1/taleart.js"></script>';
function page({ lang = 'en', dir = 'ltr', kind = 'bar', body = '', script = '' }) {
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Web SDK sample</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; background: #f5f5f7; color: #1d1d1f; }
  main { padding: 24px; }
  taleart-view { display: block; min-height: 94px; }
</style>
${script || SNIPPET_SCRIPT}
</head>
<body>
<main>
${body || `<taleart-view zone-key="${KEYS[kind]}"></taleart-view>`}
</main>
</body>
</html>`;
}

const HOSTS = {
  '/bar.html': () => page({ kind: 'bar' }),
  '/banner.html': () => page({ kind: 'banner' }),
  '/he.html': () =>
    page({
      lang: 'he-IL',
      dir: 'rtl',
      kind: 'hebrew',
      script: `<script type="module">
  import { init } from '/sdk/v1/taleart.js';
  init({
    locale: 'he',
    strings: { he: { 'viewer.close': 'סגור', 'viewer.nextGroup': 'הבאה', 'viewer.previousGroup': 'הקודמת' } },
  });
</script>`,
    }),
};

function localisedZone() {
  const zone = zoneFor('bar');
  zone.name = 'הבית – למעלה';
  zone.slug = 'home-top';
  zone.taleGroups = zone.taleGroups.map((g, i) => ({
    ...g,
    name: HEBREW_GROUPS[i].name,
    tales: g.tales.map((t) => ({ ...t, title: HEBREW_TALES[t.title] ?? t.title })),
  }));
  return zone;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

async function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const send = (type, body) => res.writeHead(200, { 'Content-Type': type }).end(body);
    if (url.pathname === '/sdk/v1/taleart.js') return send('text/javascript; charset=utf-8', await readFile(join(sdkDir, 'index.js')));
    if (url.pathname === '/delivery/v1/zone') {
      const key = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const kind = Object.keys(KEYS).find((k) => KEYS[k] === key);
      if (!kind) return void res.writeHead(401, JSON_HEADERS).end(JSON.stringify({ error: { code: 'invalid_zone_key' } }));
      return void res.writeHead(200, JSON_HEADERS).end(JSON.stringify(kind === 'hebrew' ? localisedZone() : zoneFor(kind)));
    }
    const media = /^\/media\/(\w+)\.png$/.exec(url.pathname);
    if (media && MEDIA[media[1]]) return send('image/png', MEDIA[media[1]]);
    for (const [path, render] of Object.entries(HOSTS)) {
      if (url.pathname === path) return send('text/html; charset=utf-8', render());
    }
    res.writeHead(404).end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  await mkdir(imagesDir, { recursive: true });
  const { server, origin } = await startServer();
  ORIGIN = origin;
  const browser = await chromium.launch();
  const written = [];
  try {
    const ready = (p, selector) =>
      p.waitForFunction(
        (sel) => {
          const el = document.querySelector('taleart-view');
          const root = el?.shadowRoot;
          return !!root?.querySelector(sel);
        },
        selector,
        { timeout: 15_000 },
      );

    // Bar: the zone as a host page places it, cropped to the page's display.
    const desktop = await browser.newContext({ viewport: { width: 560, height: 360 }, deviceScaleFactor: 2, locale: 'en-US' });
    let p = await desktop.newPage();
    await p.goto(`${origin}/bar.html`);
    await ready(p, 'button.item');
    await p.waitForLoadState('networkidle');
    await p.locator('main').screenshot({ path: join(imagesDir, 'web-view-bar.png') });
    written.push('web-view-bar.png');

    // Banner: the same groups as slides.
    p = await desktop.newPage();
    await p.goto(`${origin}/banner.html`);
    await ready(p, '[aria-roledescription="carousel"]');
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(400);
    await p.locator('main').screenshot({ path: join(imagesDir, 'web-view-banner.png') });
    written.push('web-view-banner.png');

    // Viewer: a group opened full screen on a phone-sized window.
    const phone = await browser.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2, locale: 'en-US' });
    p = await phone.newPage();
    await p.goto(`${origin}/bar.html`);
    await ready(p, 'button.item');
    await p.waitForLoadState('networkidle');
    await p.getByRole('button', { name: 'Summer' }).click();
    await p.waitForFunction(() => document.querySelector('taleart-view')?.shadowRoot?.querySelector('dialog[open]'));
    await p.waitForTimeout(700);
    await p.screenshot({ path: join(imagesDir, 'web-view-viewer.png') });
    written.push('web-view-viewer.png');

    // Hebrew: the same viewer with the he-IL page, right to left, and the Hebrew texts.
    p = await phone.newPage();
    await p.goto(`${origin}/he.html`);
    await ready(p, 'button.item');
    await p.waitForLoadState('networkidle');
    await p.getByRole('button', { name: 'קיץ' }).click();
    await p.waitForFunction(() => document.querySelector('taleart-view')?.shadowRoot?.querySelector('dialog[open]'));
    await p.waitForTimeout(700);
    await p.screenshot({ path: join(imagesDir, 'web-view-hebrew.png') });
    written.push('web-view-hebrew.png');
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`wrote ${written.join(', ')} to ${imagesDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
