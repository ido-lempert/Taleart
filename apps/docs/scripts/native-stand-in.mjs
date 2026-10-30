// A stand-in for the Delivery API, for the NATIVE (Android and iOS) screenshots and clips of the docs (not shipped).
//
// It serves the same sample zones, tale art, element titles ('Quiz', 'Poll', 'Rate us', ...) and group names as the Web SDK's
// own shots (web-sdk-shots.mjs: the fixture code below is that script's, kept in step by hand), so the native images show
// the same content as their web twins. A zone is picked by its key: `tak_demo_<kind>` (kind = a key of KEYS: bar, banner,
// hebrew, features, frequency, reaction, components, pollViews, layoutRing, layoutChip, layoutPoster, layoutStack,
// layoutLoading, variantCarousel, variantCoverflow, variantPeek, variantDeck, variantSticky, variantStrip, hebrewChip,
// heVariantCoverflow, clipRing, clipCoverflow, ...); `tak_demo_refused` is refused (the fallback shots). Only the first 8
// characters of a key (`tak_demo`) are ever printed.
//
// Usage: node apps/docs/scripts/native-stand-in.mjs [port] [--hold]   (default 3400; listens on every interface, the Android
// emulator reaches it at http://10.0.2.2:<port>, the iOS simulator at http://localhost:<port>). The art is drawn in
// Chromium once at start (playwright). Votes, ratings and reactions count in memory: restart it for a fresh count.
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';

const PORT = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 3400);
// --hold: the tales that have a document run for two minutes, so a still keeps its progress bar near the start while it is shot.
const HOLD = process.argv.includes('--hold');

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
  { id: 'g-food', name: 'אוכל' },
  { id: 'g-music', name: 'מוזיקה' },
];
const HEBREW_TALES = { 'Beach': 'חוף', 'Sunset': 'שקיעה', 'Shoes': 'נעליים', 'Snow': 'שלג', 'Cabin': 'צריף', 'Mountains': 'הרים', 'Dinner': 'ארוחה', 'Concert': 'קונצרט', 'Stage': 'במה', 'Dance': 'ריקוד' };
// The six groups of the bar layouts: the four above, and two more, so the stack shows its "+2" bubble and a poster has
// three segments.
const LAYOUT_GROUPS = [
  ...GROUPS,
  { id: 'g-food', name: 'Food', cover: null, tales: [{ id: 't-dinner', title: 'Dinner', media: 'cabin' }] },
  {
    id: 'g-music',
    name: 'Music',
    cover: null,
    tales: [
      { id: 't-concert', title: 'Concert', media: 'sunset' },
      { id: 't-stage', title: 'Stage', media: 'beach' },
      { id: 't-dance', title: 'Dance', media: 'shoes' },
    ],
  },
];

// The local server's origin, set once it listens: the SDK takes only absolute media URLs.
let ORIGIN = '';

const KEYS = {
  bar: 'tak_SampleBarKey0000000000001',
  banner: 'tak_SampleBannerKey000000001',
  hebrew: 'tak_SampleHebrewKey00000001',
  hebrewBanner: 'tak_SampleHebrewBannerKey0001',
  features: 'tak_DemoFeaturesKey00000000001',
  // The promo clip: the same zone with the promo card higher, clear of Android's clipboard preview at the foot of the screen.
  featuresClip: 'tak_DemoFeaturesClipKey0000001',
  frequency: 'tak_DemoFrequencyKey000000001',
  reaction: 'tak_DemoReactionKey000000000001',
  components: 'tak_DemoComponentsKey0000001',
  banner31: 'tak_DemoBannerWideKey00000001',
  banner11: 'tak_DemoBannerSquareKey00001',
  bannerPlain: 'tak_DemoBannerPlainKey000001',
  barSquare: 'tak_DemoBarSquareKey0000001',
  barLarge: 'tak_DemoBarLargeKey00000001',
  audienceBar: 'tak_DemoAudienceBarKey0000000',
  audienceBanner: 'tak_DemoAudienceBannerKey0000',
  layoutRing: 'tak_DemoLayoutRingKey000000001',
  layoutTile: 'tak_DemoLayoutTileKey000000001',
  layoutChip: 'tak_DemoLayoutChipKey000000001',
  layoutPoster: 'tak_DemoLayoutPosterKey0000001',
  layoutStack: 'tak_DemoLayoutStackKey000000001',
  layoutLoading: 'tak_DemoLayoutLoadingKey0000001',
  hebrewChip: 'tak_DemoHebrewChipKey00000000001',
  hebrewPoster: 'tak_DemoHebrewPosterKey0000001',
  variantCarousel: 'tak_DemoVariantCarouselKey00001',
  variantCoverflow: 'tak_DemoVariantCoverflowKey0001',
  variantPeek: 'tak_DemoVariantPeekKey00000001',
  variantDeck: 'tak_DemoVariantDeckKey0000000001',
  variantSticky: 'tak_DemoVariantStickyKey000001',
  variantStrip: 'tak_DemoVariantStripKey0000001',
  heVariantCoverflow: 'tak_DemoHeVariantCoverflowKey01',
  heVariantPeek: 'tak_DemoHeVariantPeekKey0000001',
  heVariantDeck: 'tak_DemoHeVariantDeckKey0000001',
  heVariantStrip: 'tak_DemoHeVariantStripKey00001',
  clipRing: 'tak_DemoClipRingKey00000000000001',
  clipCoverflow: 'tak_DemoClipCoverflowKey000001',
  pollViews: 'tak_DemoPollViewsKey0000000001',
  pollViewsHe: 'tak_DemoPollViewsHeKey00000001',
  clipStrip: 'tak_DemoClipStripKey0000000001',
};
// Display settings per sample zone (a missing field takes its default); the banners stay still for the shots.
const SETTINGS = {
  banner: { autoplay: false },
  banner31: { aspectRatio: '3:1', autoplay: false },
  banner11: { aspectRatio: '1:1', autoplay: false },
  bannerPlain: { autoplay: false, showDots: false },
  barSquare: { shape: 'rounded-square', showTitles: false, alignment: 'center' },
  barLarge: { size: 'large', gap: 20 },
  // The bar layouts: the ring (the default look), the rounded-square ring, a chip, a poster, a collapsed stack.
  layoutRing: { layout: 'ring' },
  layoutTile: { layout: 'ring', shape: 'rounded-square' },
  layoutChip: { layout: 'chip' },
  layoutPoster: { layout: 'poster' },
  layoutStack: { layout: 'stack' },
  layoutLoading: { layout: 'ring' },
  hebrewChip: { layout: 'chip' },
  hebrewPoster: { layout: 'poster' },
  // The banner variants: still (no autoplay) for the shots; the clips autoplay, the strip at its own speed.
  variantCarousel: { variant: 'carousel', autoplay: false },
  variantCoverflow: { variant: 'coverflow', autoplay: false },
  variantPeek: { variant: 'peek', autoplay: false },
  variantDeck: { variant: 'deck', autoplay: false },
  variantSticky: { variant: 'sticky', autoplay: false },
  variantStrip: { variant: 'strip' },
  heVariantCoverflow: { variant: 'coverflow', autoplay: false },
  heVariantPeek: { variant: 'peek', autoplay: false },
  heVariantDeck: { variant: 'deck', autoplay: false },
  heVariantStrip: { variant: 'strip' },
  clipRing: { layout: 'ring' },
  clipCoverflow: { variant: 'coverflow', intervalSeconds: 3 },
  clipStrip: { variant: 'strip' },
};
// Not in KEYS: the stand-in refuses it, so a zone with this key cannot load (the failure shots).
const REFUSED_KEY = 'tak_RevokedDemoKey00000000001';

// The audience zone: two groups, each with an audience rule (the same zone for a bar and a banner).
const AUDIENCE_GROUPS = [
  {
    id: 'g-welcome',
    name: 'Welcome',
    tale: { id: 't-welcome', title: 'Welcome gift', media: 'gift' },
    audience: { match: 'all', conditions: [{ property: 'plan', operator: 'eq', value: 'free' }] },
  },
  {
    id: 'g-pro',
    name: 'Pro offers',
    tale: { id: 't-pro', title: 'Pro sale', media: 'sale' },
    audience: { match: 'all', conditions: [{ property: 'plan', operator: 'eq', value: 'pro' }] },
  },
];
function audienceZone(frameType) {
  return {
    id: 'z-home-top',
    name: 'Home – top',
    slug: 'home-top',
    frame: { id: 'f-home-top', type: frameType, settings: frameType === 'banner' ? { autoplay: false } : {} },
    taleGroups: AUDIENCE_GROUPS.map((g) => ({
      id: g.id,
      name: g.name,
      cover: null,
      audience: g.audience,
      tales: [
        {
          id: g.tale.id,
          title: g.tale.title,
          media: { kind: 'image', contentType: 'image/png', url: `${ORIGIN}/media/${g.tale.media}.png` },
        },
      ],
    })),
  };
}
// The two viewers of the audience shots: a free one, and a pro one (aged 34), set with init({ properties }).
const AUDIENCE_VIEWERS = { free: { plan: 'free' }, pro: { plan: 'pro', age: 34 } };
const AUDIENCE_KINDS = { audienceBar: 'bar', audienceBanner: 'banner' };

// The kinds drawn as a banner, and the kinds that use the six groups (the layouts and the variants).
const isBanner = (kind) => /^(banner|variant|heVariant|clipCoverflow|clipStrip)/.test(kind);
const isWide = (kind) => /^(layout|variant|heVariant|clip)/.test(kind);
function zoneFor(kind) {
  const frameType = isBanner(kind) ? 'banner' : 'bar';
  const groups = isWide(kind) ? LAYOUT_GROUPS : GROUPS;
  return {
    id: 'z-home-top',
    name: 'Home – top',
    slug: 'home-top',
    frame: { id: 'f-home-top', type: frameType, settings: SETTINGS[kind] ?? {} },
    taleGroups: groups.map((g) => ({
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
// The bar layouts in Hebrew: the zone of a layout kind (`layoutChip`, `layoutPoster`) with its groups and tales in Hebrew.
function localisedLayoutZone(kind) {
  const zone = zoneFor(kind === 'hebrewChip' ? 'layoutChip' : 'layoutPoster');
  zone.name = 'הבית – למעלה';
  zone.slug = 'home-top';
  zone.taleGroups = zone.taleGroups.map((g) => ({
    ...g,
    name: HEBREW_GROUPS.find((h) => h.id === g.id)?.name ?? g.name,
    tales: g.tales.map((t) => ({ ...t, title: HEBREW_TALES[t.title] ?? t.title })),
  }));
  return zone;
}

// A banner variant in Hebrew, for the right-to-left shots: the six groups and their tales, named in Hebrew.
function localisedVariantZone(kind) {
  const zone = zoneFor(kind);
  zone.name = 'הבית – למעלה';
  zone.slug = 'home-top';
  zone.taleGroups = zone.taleGroups.map((g) => ({
    ...g,
    name: HEBREW_GROUPS.find((h) => h.id === g.id)?.name ?? g.name,
    tales: g.tales.map((t) => ({ ...t, title: HEBREW_TALES[t.title] ?? t.title })),
  }));
  return zone;
}

// The sample zone in Hebrew, as a bar (`bar`) or a banner (`banner`).
function localisedZone(frame = 'bar') {
  const zone = zoneFor(frame);
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
  // A festival night: fireworks over a row of houses, the sparks drawn as radial lines.
  festival: () => {
    const rnd = seeded(43);
    const colours = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#ffffff'];
    const bursts = [
      [170, 360, 0],
      [540, 280, 1],
      [360, 520, 2],
      [110, 620, 3],
      [600, 600, 4],
    ]
      .map(([cx, cy, b]) =>
        Array.from({ length: 22 }, (_, i) => {
          const a = (i / 22) * Math.PI * 2;
          const r = 60 + rnd() * 46;
          const x = (cx + Math.cos(a) * r).toFixed(1);
          const y = (cy + Math.sin(a) * r).toFixed(1);
          const colour = colours[(b + i) % colours.length];
          return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${colour}" stroke-width="4" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="3" fill="${colour}"/>`;
        }).join(''),
      )
      .join('');
    const houses = [
      [0, 980, 92, 300],
      [84, 930, 112, 350],
      [188, 1010, 84, 270],
      [264, 950, 122, 330],
      [378, 1000, 92, 280],
      [462, 940, 112, 340],
      [566, 990, 104, 290],
    ]
      .map(([x, y, w, h], k) => {
        const windows = Array.from({ length: 6 }, (_, i) =>
          rnd() > 0.35
            ? `<rect x="${x + 12 + (i % 3) * 26}" y="${y + 24 + Math.floor(i / 3) * 44}" width="14" height="20" fill="#ffd166" opacity=".9"/>`
            : '',
        ).join('');
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${k % 2 ? '#24244a' : '#1b1b3a'}"/>${windows}`;
      })
      .join('');
    return svgArt(`
      <defs>
        <linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#070b1f"/><stop offset=".7" stop-color="#241a4f"/><stop offset="1" stop-color="#4a2160"/>
        </linearGradient>
      </defs>
      <rect width="720" height="1280" fill="url(#night)"/>
      ${bursts}
      ${houses}`);
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
      durationMs: HOLD ? 120000 : 15000,
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
function featuresZone(promoY = 0.66) {
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
            box: { x: 0.1, y: promoY, w: 0.8, h: 0.3, rotation: 0 },
            a11y: {},
            props: { title: 'Your welcome gift', code: 'SUMMER25', note: '20% off sandals, until Sunday', theme: 'light' },
          },
        ]),
      ],
    },
    { id: 'g-morning', name: 'Morning', tales: [demoTale('t-morning', 'Morning', 'morning')] },
  ]);
}
// The Reaction demo: one tale with a reaction. The counts start from REACTION_SEED; each tap adds one.
const REACTION_ID = '00000000-0000-4000-8000-0000000000e1';
const REACTION_SEED = new Map([
  ['❤️', 128],
  ['\u{1F602}', 41],
  ['\u{1F62E}', 17],
]);
const REACTION_COUNTS = new Map();
function reactionZone() {
  return demoZone('bar', [
    {
      id: 'g-tonight',
      name: 'Tonight',
      tales: [
        demoTale('t-fireworks', 'Fireworks', 'festival', [
          {
            id: REACTION_ID,
            type: 'reaction',
            box: { x: 0.1, y: 0.62, w: 0.8, h: 0.22, rotation: 0 },
            a11y: {},
            props: {
              title: 'Your reaction',
              question: 'How do you feel?',
              emojis: [...REACTION_SEED.keys()],
              theme: 'light',
            },
          },
        ]),
      ],
    },
  ]);
}

// The components demo: one tale per interactive component, and one with the display elements (text, buttons, emoji, shape).
const POLL_ID = '00000000-0000-4000-8000-0000000000f1';
const QUIZ_ID = '00000000-0000-4000-8000-0000000000f2';
const RATING_ID = '00000000-0000-4000-8000-0000000000f3';
const CARD_BOX = { x: 0.08, y: 0.5, w: 0.84, h: 0.34, rotation: 0 };
const POLL_OPTIONS = [
  { id: 'tea', label: 'Tea' },
  { id: 'coffee', label: 'Coffee' },
];
const QUIZ_ANSWERS = [
  { id: 'a', label: 'Paris' },
  { id: 'b', label: 'Lyon' },
  { id: 'c', label: 'Nice' },
];
function componentsZone() {
  const display = [
    { id: 'e-text', type: 'text', box: { x: 0.08, y: 0.1, w: 0.84, h: 0.14, rotation: 0 }, a11y: {}, props: { text: 'Summer is here', font: { source: 'system', stack: 'rounded' }, size: 0.05, weight: 'bold', color: '#FFFFFF', align: 'center', background: 'none' } },
    { id: 'e-emoji', type: 'emoji', box: { x: 0.38, y: 0.26, w: 0.24, h: 0.14, rotation: 0 }, a11y: {}, props: { emoji: '\u2600\uFE0F' } },
    { id: 'e-shape', type: 'shape', box: { x: 0.12, y: 0.44, w: 0.76, h: 0.005, rotation: 0 }, a11y: { decorative: true }, props: { shape: 'rectangle', fill: '#FFFFFF', opacity: 0.8 } },
    { id: 'e-button', type: 'button', box: { x: 0.14, y: 0.5, w: 0.72, h: 0.08, rotation: 0 }, a11y: {}, props: { label: 'Shop the sale', href: 'https://example.com/sale', newTab: true, variant: 'filled', color: '#1F1235', fill: '#FFD166', radius: 0.04 } },
    { id: 'e-outline', type: 'button', box: { x: 0.14, y: 0.62, w: 0.72, h: 0.08, rotation: 0 }, a11y: {}, props: { label: 'See all shoes', href: 'https://example.com/shoes', newTab: true, variant: 'outline', color: '#FFFFFF', fill: '#FFFFFF', radius: 0.04 } },
    { id: 'e-swipe', type: 'swipe-up', box: { x: 0.2, y: 0.88, w: 0.6, h: 0.1, rotation: 0 }, a11y: {}, props: { label: 'Read the story', href: 'https://example.com/story', newTab: true, color: '#1F1235', background: '#FFFFFF' } },
  ];
  return demoZone('bar', [
    { id: 'g-poll', name: 'Poll', tales: [demoTale('t-poll', 'Poll', 'morning', [{ id: POLL_ID, type: 'poll', box: CARD_BOX, a11y: {}, props: { title: 'Quick poll', question: 'Tea or coffee?', options: POLL_OPTIONS, theme: 'light' } }])] },
    { id: 'g-quiz', name: 'Quiz', tales: [demoTale('t-quiz', 'Quiz', 'afternoon', [{ id: QUIZ_ID, type: 'quiz', box: { ...CARD_BOX, y: 0.44, h: 0.42 }, a11y: {}, props: { title: 'Quiz', question: 'What is the capital of France?', answers: QUIZ_ANSWERS, correctAnswerId: 'a', theme: 'light' } }])] },
    { id: 'g-rating', name: 'Rating', tales: [demoTale('t-rating', 'Rating', 'evening', [{ id: RATING_ID, type: 'rating', box: { ...CARD_BOX, h: 0.3 }, a11y: {}, props: { title: 'Rate us', question: 'How was your visit?', emoji: '\u2B50', theme: 'dark' } }])] },
    { id: 'g-display', name: 'Elements', tales: [demoTale('t-display', 'Elements', 'sale', display)] },
  ]);
}
// The stand-in for a vote: a poll or a quiz answer counts against a fixed starting split; a rating against fixed totals.
function choiceResult(options, seed, picked) {
  const counts = options.map((o, i) => ({ id: o.id, count: seed[i] + (o.id === picked ? 1 : 0) }));
  const total = counts.reduce((n, c) => n + c.count, 0);
  return { total, choices: counts.map((c) => ({ ...c, percent: Math.round((c.count / total) * 100) })) };
}
function componentResult(body) {
  if (body.elementId === POLL_ID) return choiceResult(POLL_OPTIONS, [61, 39], body.value);
  if (body.elementId === QUIZ_ID) return choiceResult(QUIZ_ANSWERS, [74, 18, 8], body.value);
  if (body.elementId === RATING_ID) return { total: 213, average: 78 };
  const view = Object.keys(POLL_VIEW_IDS).find((v) => POLL_VIEW_IDS[v] === body.elementId);
  if (view) return choiceResult([{ id: 'midnight' }, { id: 'coral' }], POLL_VIEW_SEED[view], body.value);
  return null;
}
function frequencyZone() {
  return demoZone('bar', [
    { id: 'g-morning', name: 'Morning', tales: [demoTale('t-morning', 'Morning', 'morning')] },
    { id: 'g-afternoon', name: 'Afternoon', tales: [demoTale('t-afternoon', 'Afternoon', 'afternoon')] },
    { id: 'g-evening', name: 'Evening', tales: [demoTale('t-evening', 'Evening', 'evening')] },
  ]);
}

// The poll views (the end-user redesign, P6a): one tale per view, each poll with the same two options; both carry a
// colour (the this-or-that and grid views draw it, the others do not). The Hebrew set is the right-to-left shot.
const POLL_VIEW_TEXT = {
  en: {
    title: 'Poll',
    question: 'Which colourway next?',
    midnight: 'Midnight',
    coral: 'Coral',
    groups: { sticker: 'Sticker', embed: 'Embed', 'this-or-that': 'This or that', grid: 'Grid', inline: 'Inline' },
  },
  he: {
    title: 'סקר',
    question: 'איזה צבע הבא?',
    midnight: 'חצות',
    coral: 'אלמוג',
    groups: { sticker: 'מדבקה', embed: 'הטמעה', 'this-or-that': 'זה או זה', grid: 'רשת', inline: 'שורה' },
  },
};
const POLL_VIEW_IDS = {
  sticker: '00000000-0000-4000-8000-0000000000a1',
  embed: '00000000-0000-4000-8000-0000000000a2',
  'this-or-that': '00000000-0000-4000-8000-0000000000a3',
  grid: '00000000-0000-4000-8000-0000000000a4',
  inline: '00000000-0000-4000-8000-0000000000a5',
};
// The stand-in counts of each view's poll, against the same two options (midnight, coral).
const POLL_VIEW_SEED = {
  sticker: [61, 39],
  embed: [58, 42],
  'this-or-that': [60, 40],
  grid: [55, 45],
  inline: [52, 48],
};
const POLL_VIEW_BOX = {
  sticker: { x: 0.1, y: 0.48, w: 0.8, h: 0.3, rotation: 0 },
  embed: { x: 0.06, y: 0.44, w: 0.88, h: 0.42, rotation: 0 },
  'this-or-that': { x: 0.08, y: 0.46, w: 0.84, h: 0.3, rotation: 0 },
  grid: { x: 0.08, y: 0.46, w: 0.84, h: 0.34, rotation: 0 },
  inline: { x: 0.06, y: 0.7, w: 0.88, h: 0.14, rotation: 0 },
};
const POLL_VIEW_MEDIA = { sticker: 'morning', embed: 'afternoon', 'this-or-that': 'beach', grid: 'evening', inline: 'sale' };
function pollViewsZone(lang = 'en') {
  const t = POLL_VIEW_TEXT[lang];
  const options = [
    { id: 'midnight', label: t.midnight, color: '#3B2FC9' },
    { id: 'coral', label: t.coral, color: '#FF6F61' },
  ];
  const groups = Object.keys(POLL_VIEW_IDS).map((view) => ({
    id: `g-poll-${view}`,
    name: t.groups[view],
    tales: [
      demoTale(`t-poll-${view}`, t.groups[view], POLL_VIEW_MEDIA[view], [
        {
          id: POLL_VIEW_IDS[view],
          type: 'poll',
          box: POLL_VIEW_BOX[view],
          a11y: {},
          props: { title: t.title, question: t.question, options, theme: 'light', view },
        },
      ]),
    ],
  }));
  return demoZone('bar', groups);
}

// --- The server. ---
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const held = new Set();
const KEY_PREFIX = 'tak_demo_';
const REFUSED = KEY_PREFIX + 'refused';
let ART_MEDIA = {};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function zoneOf(kind) {
  if (kind in AUDIENCE_KINDS) return audienceZone(AUDIENCE_KINDS[kind]);
  if (kind === 'hebrew') return localisedZone();
  if (kind === 'hebrewBanner') return localisedZone('banner');
  if (kind === 'hebrewChip' || kind === 'hebrewPoster') return localisedLayoutZone(kind);
  if (kind === 'features') return featuresZone();
  if (kind === 'featuresClip') return featuresZone(0.5);
  if (kind === 'frequency') return frequencyZone();
  if (kind === 'reaction') return reactionZone();
  if (kind === 'components') return componentsZone();
  if (kind === 'pollViews') return pollViewsZone();
  if (kind === 'pollViewsHe') return pollViewsZone('he');
  if (kind.startsWith('heVariant')) return localisedVariantZone(kind);
  return zoneFor(kind);
}

const browser = await chromium.launch();
try {
  ART_MEDIA = await renderArt(browser);
} finally {
  await browser.close();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const origin = `http://${req.headers.host ?? `localhost:${PORT}`}`;
  const key = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const kind = key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : '';
  if (url.pathname === '/delivery/v1/zone') {
    if (!(kind in KEYS) || key === REFUSED) return void res.writeHead(401, JSON_HEADERS).end(JSON.stringify({ error: { code: 'invalid_zone_key', message: 'A valid zone key is required' } }));
    // The loading stand-in: this zone is never answered, so the app keeps its loading skeleton.
    if (kind === 'layoutLoading') return void held.add(res);
    ORIGIN = origin;
    return void res.writeHead(200, JSON_HEADERS).end(JSON.stringify(zoneOf(kind)));
  }
  if (url.pathname === '/delivery/v1/events') {
    await readBody(req);
    return void res.writeHead(204).end();
  }
  if (url.pathname === '/delivery/v1/responses' && req.method === 'POST') {
    if (!(kind in KEYS)) return void res.writeHead(401, JSON_HEADERS).end(JSON.stringify({ error: { code: 'invalid_zone_key' } }));
    const body = JSON.parse(await readBody(req));
    const fixed = componentResult(body);
    if (fixed) return void res.writeHead(201, JSON_HEADERS).end(JSON.stringify({ elementId: body.elementId, value: body.value, recorded: true, result: fixed }));
    const id = `${body.taleId}:${body.elementId}`;
    const counts = REACTION_COUNTS.get(id) ?? new Map(REACTION_SEED);
    counts.set(body.value, (counts.get(body.value) ?? 0) + 1);
    REACTION_COUNTS.set(id, counts);
    const reactions = [...REACTION_SEED.keys()].map((emoji) => ({ emoji, count: counts.get(emoji) ?? 0 }));
    const result = { total: reactions.reduce((sum, r) => sum + r.count, 0), reactions };
    return void res.writeHead(201, JSON_HEADERS).end(JSON.stringify({ elementId: body.elementId, value: body.value, recorded: true, result }));
  }
  const media = /^\/media\/(\w+)\.png$/.exec(url.pathname);
  const bytes = media && (MEDIA[media[1]] ?? ART_MEDIA[media[1]]);
  if (bytes) return void res.writeHead(200, { 'Content-Type': 'image/png' }).end(bytes);
  res.writeHead(404).end();
});
server.listen(PORT, '0.0.0.0', () => console.log(`native stand-in on port ${PORT}, pid ${process.pid}`));
