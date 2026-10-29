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
  features: 'tak_DemoFeaturesKey00000000001',
  frequency: 'tak_DemoFrequencyKey000000001',
};
// Not in KEYS: the stand-in refuses it, so a zone with this key cannot load (the failure shots).
const REFUSED_KEY = 'tak_RevokedDemoKey00000000001';

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
  '/features.html': () => page({ kind: 'features' }),
  '/frequency.html': () =>
    page({ kind: 'frequency', body: `<taleart-view zone-key="${KEYS.frequency}" frequency="once"></taleart-view>` }),
  '/failed-slot.html': () =>
    page({
      body: `<style>
  .home h1 { font: 600 20px system-ui, sans-serif; margin: 0 0 14px; }
  .ta-fallback { padding: 28px 22px; border-radius: 18px; background: linear-gradient(135deg, #fde68a, #fb7185 55%, #818cf8); color: #1f1235; text-align: center; font: 15px system-ui, sans-serif; }
  .ta-fallback strong { display: block; margin-bottom: 6px; font-size: 20px; }
</style>
<div class="home"><h1>Home</h1>
<taleart-view zone-key="${REFUSED_KEY}"><div slot="fallback" class="ta-fallback"><strong>Today's stories are on their way</strong>Check back in a moment.</div></taleart-view></div>`,
    }),
  '/failed-message.html': () =>
    page({
      body: `<div style="font: 600 20px system-ui, sans-serif; margin: 0 0 14px">Home</div>
<taleart-view zone-key="${REFUSED_KEY}" fallback="message"></taleart-view>`,
    }),
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

// --- Generated artwork for the demo tales: SVG drawn in Chromium, rendered to PNG once per run. ---
const ART_SIZE = { width: 720, height: 1280 };
// Deterministic pseudo-random numbers, so the artwork is the same on every run.
function seeded(seed) {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
}
function svgArt(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART_SIZE.width} ${ART_SIZE.height}" width="${ART_SIZE.width}" height="${ART_SIZE.height}">${body}</svg>`;
}
const ART = {
  // A sunset sale: a warm sky, a glowing sun, two layers of hills and confetti.
  sale: () => {
    const rnd = seeded(7);
    const confetti = Array.from({ length: 46 }, (_, i) => {
      const colours = ['#fff1c1', '#ffd166', '#06d6a0', '#ef476f', '#118ab2'];
      return `<circle cx="${(rnd() * 720).toFixed(0)}" cy="${(rnd() * 760).toFixed(0)}" r="${(4 + rnd() * 7).toFixed(1)}" fill="${colours[i % colours.length]}" opacity=".85"/>`;
    }).join('');
    return svgArt(`
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ff5e7e"/><stop offset=".55" stop-color="#ff9f43"/><stop offset="1" stop-color="#ffd166"/>
        </linearGradient>
        <radialGradient id="glow"><stop offset="0" stop-color="#fff3b0" stop-opacity=".95"/><stop offset="1" stop-color="#fff3b0" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="720" height="1280" fill="url(#sky)"/>
      ${confetti}
      <circle cx="360" cy="520" r="360" fill="url(#glow)"/>
      <circle cx="360" cy="520" r="170" fill="#fff1c1"/>
      <path d="M0 880 Q180 800 360 860 T720 840 V1280 H0Z" fill="#7b2cbf" opacity=".9"/>
      <path d="M0 1000 Q200 930 400 990 T720 970 V1280 H0Z" fill="#3c096c"/>`);
  },
  // A welcome gift: teal water, a gift box with a ribbon, sparkles and bubbles.
  gift: () => {
    const rnd = seeded(11);
    const bubbles = Array.from({ length: 22 }, () =>
      `<circle cx="${(rnd() * 720).toFixed(0)}" cy="${(rnd() * 1280).toFixed(0)}" r="${(6 + rnd() * 26).toFixed(1)}" fill="#ffffff" opacity="${(0.08 + rnd() * 0.16).toFixed(2)}"/>`,
    ).join('');
    return svgArt(`
      <defs>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#06d6a0"/><stop offset=".5" stop-color="#118ab2"/><stop offset="1" stop-color="#073b4c"/>
        </linearGradient>
      </defs>
      <rect width="720" height="1280" fill="url(#sea)"/>
      ${bubbles}
      <ellipse cx="360" cy="1010" rx="300" ry="36" fill="#000000" opacity=".18"/>
      <rect x="200" y="600" width="320" height="250" rx="14" fill="#ffd166"/>
      <rect x="180" y="530" width="360" height="82" rx="16" fill="#ffe08a"/>
      <rect x="340" y="530" width="40" height="320" fill="#ef476f"/>
      <ellipse cx="300" cy="500" rx="52" ry="34" fill="#ef476f"/>
      <ellipse cx="420" cy="500" rx="52" ry="34" fill="#ef476f"/>
      <path d="M560 300 l10 28 l28 10 l-28 10 l-10 28 l-10 -28 l-28 -10 l28 -10z" fill="#fff8e1"/>
      <path d="M150 360 l7 20 l20 7 l-20 7 l-7 20 l-7 -20 l-20 -7 l20 -7z" fill="#fff8e1"/>`);
  },
  // A sunrise: a pale sky, a half-risen sun and two hills.
  morning: () =>
    svgArt(`
      <defs>
        <linearGradient id="dawn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffd6a5"/><stop offset=".6" stop-color="#ff9a76"/><stop offset="1" stop-color="#ffb4a2"/>
        </linearGradient>
        <radialGradient id="sunglow"><stop offset="0" stop-color="#fff0a0"/><stop offset="1" stop-color="#fff0a0" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="720" height="1280" fill="url(#dawn)"/>
      <circle cx="360" cy="800" r="420" fill="url(#sunglow)"/>
      <circle cx="360" cy="800" r="170" fill="#ffe066"/>
      <rect x="0" y="800" width="720" height="480" fill="#ff9a76" opacity=".35"/>
      <path d="M0 860 Q220 780 460 850 T720 830 V1280 H0Z" fill="#6a994e"/>
      <path d="M0 980 Q260 900 520 970 T720 950 V1280 H0Z" fill="#386641"/>
      <path d="M120 300 q25 -22 50 0 q25 -22 50 0" stroke="#7a3e3e" stroke-width="4" fill="none" opacity=".7"/>
      <path d="M520 240 q22 -18 44 0 q22 -18 44 0" stroke="#7a3e3e" stroke-width="4" fill="none" opacity=".7"/>`),
  // An afternoon: a blue sky with clouds, a sun and a meadow of flowers.
  afternoon: () => {
    const rnd = seeded(23);
    const flowers = Array.from({ length: 34 }, (_, i) => {
      const colours = ['#ff006e', '#ffbe0b', '#ffffff', '#8338ec'];
      return `<circle cx="${(rnd() * 720).toFixed(0)}" cy="${(930 + rnd() * 300).toFixed(0)}" r="${(5 + rnd() * 5).toFixed(1)}" fill="${colours[i % colours.length]}"/>`;
    }).join('');
    return svgArt(`
      <defs>
        <linearGradient id="blue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#4cc9f0"/><stop offset="1" stop-color="#bde0fe"/>
        </linearGradient>
      </defs>
      <rect width="720" height="1280" fill="url(#blue)"/>
      <circle cx="580" cy="200" r="110" fill="#ffd60a" opacity=".35"/>
      <circle cx="580" cy="200" r="70" fill="#ffd60a"/>
      <g fill="#ffffff" opacity=".95">
        <circle cx="160" cy="300" r="46"/><circle cx="210" cy="280" r="60"/><circle cx="270" cy="306" r="44"/>
        <rect x="120" y="306" width="200" height="44" rx="22"/>
        <circle cx="500" cy="500" r="40"/><circle cx="550" cy="484" r="54"/><circle cx="604" cy="506" r="36"/>
        <rect x="464" y="506" width="170" height="36" rx="18"/>
      </g>
      <path d="M0 880 Q200 810 420 870 T720 850 V1280 H0Z" fill="#70e000"/>
      <path d="M0 1010 Q240 940 480 1000 T720 980 V1280 H0Z" fill="#38b000"/>
      ${flowers}`);
  },
  // An evening: a night sky with stars, a crescent moon and hills in silhouette.
  evening: () => {
    const rnd = seeded(31);
    const stars = Array.from({ length: 120 }, () =>
      `<circle cx="${(rnd() * 720).toFixed(0)}" cy="${(rnd() * 900).toFixed(0)}" r="${(0.8 + rnd() * 2.2).toFixed(1)}" fill="#fff6d5" opacity="${(0.4 + rnd() * 0.6).toFixed(2)}"/>`,
    ).join('');
    return svgArt(`
      <defs>
        <linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0b1026"/><stop offset=".6" stop-color="#2b1d58"/><stop offset="1" stop-color="#5a2a6b"/>
        </linearGradient>
      </defs>
      <rect width="720" height="1280" fill="url(#night)"/>
      ${stars}
      <circle cx="530" cy="300" r="92" fill="#fff6d5"/>
      <circle cx="496" cy="272" r="84" fill="#1d1846"/>
      <path d="M0 960 Q200 880 400 940 T720 920 V1280 H0Z" fill="#1f1640"/>
      <path d="M0 1080 Q260 1000 520 1060 T720 1040 V1280 H0Z" fill="#120c2a"/>`);
  },
};

// Renders the artwork in Chromium: name -> PNG bytes, for the MEDIA of the stand-in server.
async function renderArt(browser) {
  const context = await browser.newContext({ viewport: ART_SIZE, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const out = {};
  try {
    for (const [name, draw] of Object.entries(ART)) {
      await page.setContent(`<!doctype html><html><body style="margin:0">${draw()}</body></html>`);
      out[name] = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...ART_SIZE } });
    }
  } finally {
    await context.close();
  }
  return out;
}

// The demo zones: the countdown and the promo code in tales of their own, and a frequency-capped zone.
const COUNTDOWN_ID = '00000000-0000-4000-8000-0000000000c1';
const PROMO_ID = '00000000-0000-4000-8000-0000000000d1';
// A tale's picture; with elements, also its document: the picture is its bottom element (`taleMedia`, as the
// server composes it), and the canvas colour is transparent (a bar paints it over the picture).
function demoTale(id, title, media, elements = []) {
  const url = `${ORIGIN}/media/${media}.png`;
  const tale = { id, title, media: { kind: 'image', contentType: 'image/png', url } };
  if (elements.length === 0) return { ...tale, document: null };
  const picture = {
    id: `${id}-picture`,
    type: 'image',
    box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
    a11y: { decorative: true },
    props: { url, fit: 'contain', taleMedia: true },
  };
  return {
    ...tale,
    document: {
      version: 1,
      canvas: { background: { type: 'color', color: '#00000000' } },
      durationMs: 15000,
      elements: [picture, ...elements],
    },
  };
}
function demoZone(frameType, groups) {
  return {
    ...zoneFor('bar'),
    id: 'z-demo',
    name: 'Demo',
    slug: 'demo',
    frame: { id: 'f-demo', type: frameType, settings: {} },
    taleGroups: groups.map((g) => ({ id: g.id, name: g.name, cover: null, tales: g.tales })),
  };
}
function featuresZone() {
  const endsAt = new Date(Date.now() + (2 * 86400 + 5 * 3600 + 40 * 60) * 1000).toISOString();
  return demoZone('bar', [
    {
      id: 'g-sale',
      name: 'Sale',
      tales: [
        demoTale('t-sale', 'Sale', 'sale', [
          {
            id: COUNTDOWN_ID,
            type: 'countdown',
            box: { x: 0.1, y: 0.38, w: 0.8, h: 0.24, rotation: 0 },
            a11y: {},
            props: { title: 'Sale ends in', endsAt, endedText: 'The sale is over', theme: 'light' },
          },
        ]),
      ],
    },
    {
      id: 'g-gift',
      name: 'Welcome gift',
      tales: [
        demoTale('t-gift', 'Gift', 'gift', [
          {
            id: PROMO_ID,
            type: 'promo-code',
            box: { x: 0.1, y: 0.66, w: 0.8, h: 0.3, rotation: 0 },
            a11y: {},
            props: { title: 'Your welcome gift', code: 'SUMMER25', note: '20% off sandals, until Sunday', theme: 'light' },
          },
        ]),
      ],
    },
    { id: 'g-morning', name: 'Morning', tales: [demoTale('t-morning', 'Morning', 'morning')] },
  ]);
}
function frequencyZone() {
  return demoZone('bar', [
    { id: 'g-morning', name: 'Morning', tales: [demoTale('t-morning', 'Morning', 'morning')] },
    { id: 'g-afternoon', name: 'Afternoon', tales: [demoTale('t-afternoon', 'Afternoon', 'afternoon')] },
    { id: 'g-evening', name: 'Evening', tales: [demoTale('t-evening', 'Evening', 'evening')] },
  ]);
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
      const zone = kind === 'hebrew' ? localisedZone() : kind === 'features' ? featuresZone() : kind === 'frequency' ? frequencyZone() : zoneFor(kind);
      return void res.writeHead(200, JSON_HEADERS).end(JSON.stringify(zone));
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
  Object.assign(MEDIA, await renderArt(browser));
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

    // Failure, slotted: the zone's key is refused, so the page's own placeholder shows in the element's slot.
    const failed = await browser.newContext({ viewport: { width: 560, height: 360 }, deviceScaleFactor: 2, locale: 'en-US' });
    p = await failed.newPage();
    await p.goto(`${origin}/failed-slot.html`);
    await p.waitForSelector('taleart-view[data-state="failed"]', { timeout: 15_000 });
    await p.waitForTimeout(300);
    await p.locator('main').screenshot({ path: join(imagesDir, 'web-shot-failure-slot.png') });
    written.push('web-shot-failure-slot.png');

    // Failure, the SDK's text: fallback="message" shows its text and a "Try again" button.
    p = await failed.newPage();
    await p.goto(`${origin}/failed-message.html`);
    await ready(p, '.failed button');
    await p.waitForTimeout(300);
    await p.locator('main').screenshot({ path: join(imagesDir, 'web-shot-failure-message.png') });
    written.push('web-shot-failure-message.png');

    // Frequency: before, then the same page after a viewer opened the Morning group (frequency="once").
    const frequency = await browser.newContext({ viewport: { width: 560, height: 360 }, deviceScaleFactor: 2, locale: 'en-US' });
    p = await frequency.newPage();
    await p.goto(`${origin}/frequency.html`);
    await ready(p, 'button.item');
    await p.waitForLoadState('networkidle');
    await p.locator('main').screenshot({ path: join(imagesDir, 'web-shot-frequency-before.png') });
    written.push('web-shot-frequency-before.png');
    await p.getByRole('button', { name: 'Morning' }).click();
    await p.waitForFunction(() => document.querySelector('taleart-view')?.shadowRoot?.querySelector('dialog[open]'));
    await p.waitForTimeout(500);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('taleart-view')?.shadowRoot?.querySelector('dialog[open]'));
    await p.reload();
    await ready(p, 'button.item');
    await p.waitForLoadState('networkidle');
    await p.locator('main').screenshot({ path: join(imagesDir, 'web-shot-frequency-after.png') });
    written.push('web-shot-frequency-after.png');

    // Countdown and promo code, in the viewer at phone size. Copying needs the clipboard permission.
    const features = await browser.newContext({
      viewport: { width: 390, height: 700 },
      deviceScaleFactor: 2,
      locale: 'en-US',
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    p = await features.newPage();
    await p.goto(`${origin}/features.html`);
    await ready(p, 'button.item');
    await p.waitForLoadState('networkidle');
    await p.getByRole('button', { name: 'Sale' }).click();
    await p.waitForFunction(() => document.querySelector('taleart-view')?.shadowRoot?.querySelector('.ta-countdown'));
    await p.waitForTimeout(900);
    await p.screenshot({ path: join(imagesDir, 'web-shot-countdown.png') });
    written.push('web-shot-countdown.png');

    p = await features.newPage();
    await p.goto(`${origin}/features.html`);
    await ready(p, 'button.item');
    await p.waitForLoadState('networkidle');
    await p.getByRole('button', { name: 'Welcome gift' }).click();
    await p.waitForFunction(() => document.querySelector('taleart-view')?.shadowRoot?.querySelector('.ta-promo'));
    await p.waitForTimeout(900);
    await p.screenshot({ path: join(imagesDir, 'web-shot-promo.png') });
    written.push('web-shot-promo.png');
    await p.locator('taleart-view .ta-promo-copy').click();
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(imagesDir, 'web-shot-promo-copied.png') });
    written.push('web-shot-promo-copied.png');
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
