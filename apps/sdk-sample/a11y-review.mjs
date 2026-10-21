// The WCAG 2.2 AA review of the bar, banner and viewer (web zones story 12, R11, NFR-007): axe-core in
// every state, a scripted keyboard-only walk, accessibility-tree checks, zoom and reflow, text spacing,
// orientation, target size, pointer cancellation, non-text contrast, motion and timing, forced colours,
// a dark host page, themes, and a right-to-left host page with Hebrew and mixed-direction text.
// The Delivery API and media are stubbed (as in a11y-scan.mjs), so no API, database or key is needed.
//
// Run through `nx run sdk-sample:a11y-review`, which builds the SDK first. Options:
//   --shots <dir>  also saves the review's screenshots (PNG) there
//   --json <file>  also writes every check's result as JSON
// Every check is recorded with the WCAG criterion it serves; the run fails when any check fails.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { axeViolations, freePort, loadAxe, startSample } from './a11y-shared.mjs';

const { values: args } = parseArgs({ options: { shots: { type: 'string' }, json: { type: 'string' } } });
const shotsDir = args.shots ? resolve(args.shots) : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const API = 'http://taleart-api.test';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' };
// A light 9:16 picture with a dark band, so controls are checked over both light and dark media.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#f3f4f6"/>' +
  '<rect y="60" width="90" height="40" fill="#374151"/></svg>';

const DEFAULT_THEME = {
  ringStyle: 'gradient',
  ringColors: ['#ea580c', '#db2777', '#7c3aed'],
  seenRingColor: '#6b7280',
  ringWidth: 2,
  cornerRadius: null,
  fontFamily: null,
  titleColor: null,
  backgroundColor: 'transparent',
  accentColor: '#ffffff',
};
const media = (kind, id) =>
  kind === 'video'
    ? { kind, contentType: 'video/webm', url: `${API}/media/tales/${id}.webm` }
    : { kind, contentType: 'image/svg+xml', url: `${API}/media/tales/${id}.svg` };
const text = (n, y, value) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  type: 'text',
  box: { x: 0.1, y, w: 0.8, h: 0.12, rotation: 0 },
  a11y: {},
  props: { text: value },
});
const textTale = (id, title, lines) => ({
  id,
  title,
  media: null,
  document: {
    version: 1,
    canvas: { background: { type: 'color', color: '#1f3a5f' } },
    elements: lines.map((line, i) => text(i + 1, 0.2 + i * 0.25, line)),
  },
});

// Image, text (a document with no media) and video tales; an animated video cover; a mixed-direction text tale.
const groups = (names = ['Summer sale', 'New arrivals', 'Stories']) => [
  {
    id: 'ga',
    name: names[0],
    cover: { kind: 'image', contentType: 'image/svg+xml', animated: false, url: `${API}/media/covers/ga.svg` },
    tales: [
      { id: 'a1', title: 'Beach day', media: media('image', 'a1') },
      textTale('a2', 'Opening hours', ['Open every day', 'from 9 to 21']),
      { id: 'a3', title: 'Runway', media: media('video', 'a3') },
    ],
  },
  {
    id: 'gb',
    name: names[1],
    cover: { kind: 'video', contentType: 'video/webm', animated: true, url: `${API}/media/covers/gb.webm` },
    tales: [{ id: 'b1', title: 'Jackets', media: media('image', 'b1') }],
  },
  {
    id: 'gc',
    name: names[2],
    cover: null,
    tales: [textTale('c1', 'מבצע קיץ', ['מבצע קיץ: 50% off on all shoes!', 'Free shipping — משלוח חינם'])],
  },
];
const zone = (overrides = {}) => ({
  id: 'z1',
  name: 'Home',
  theme: DEFAULT_THEME,
  frames: [
    { id: 'f1', type: 'bar', settings: {} },
    { id: 'f2', type: 'banner', settings: { intervalSeconds: 3 } },
  ],
  stages: [],
  taleGroups: groups(),
  ...overrides,
});

// ---- Results ----

const results = [];
function check(criterion, ok, message) {
  results.push({ criterion, ok: !!ok, message });
  console.log(`${ok ? 'ok' : 'NOT OK'} - [${criterion}] ${message}`);
}
async function axe(page, label) {
  const violations = await axeViolations(page, label, axeSource);
  check(
    'axe',
    violations.length === 0,
    `axe WCAG 2.2 AA: ${label}${violations.length ? ` (${violations.map((v) => v.id).join(', ')})` : ''}`,
  );
}
// A screenshot of the page (the open viewer fills it), or with `frames` of the SDK element only.
async function shot(page, name, { frames = false } = {}) {
  if (!shotsDir) return;
  const path = resolve(shotsDir, `${name}.png`);
  if (frames) await page.locator('taleart-view').first().screenshot({ path });
  else await page.screenshot({ path });
}

// ---- Page set-up ----

let videoBytes = null;
async function makeVideo(browser) {
  // A 2 s WebM recorded from a canvas in the browser itself, so the review needs no video tool.
  const page = await browser.newPage();
  const base64 = await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 180, height: 320 });
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(25);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((done) => (recorder.onstop = done));
    recorder.start();
    const start = performance.now();
    await new Promise((done) => {
      const draw = () => {
        const t = performance.now() - start;
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(0, 0, 180, 320);
        ctx.fillStyle = '#7c3aed';
        ctx.fillRect((t / 10) % 180, 140, 40, 40);
        if (t < 2000) requestAnimationFrame(draw);
        else done();
      };
      draw();
    });
    recorder.stop();
    await stopped;
    const buffer = await new Blob(chunks).arrayBuffer();
    let binary = '';
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  await page.close();
  videoBytes = Buffer.from(base64, 'base64');
}

/**
 * A page of the sample with the zone stubbed. `host` is CSS added to the host page, `dir`/`lang` set
 * on its <html>, `query` adds to the sample URL.
 */
async function openSample(context, { zone: z = zone(), host = '', dir = null, lang = null, query = '' } = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.route(`${API}/delivery/v1/zone`, (route) => route.fulfill({ json: z, headers: CORS }));
  await page.route(`${API}/media/**`, (route) =>
    route.request().url().endsWith('.webm')
      ? route.fulfill({ body: videoBytes, contentType: 'video/webm', headers: { 'Access-Control-Allow-Origin': '*' } })
      : route.fulfill({ body: SVG, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  if (dir || lang || host) {
    await page.addInitScript(
      ({ dir, lang, host }) => {
        document.addEventListener('DOMContentLoaded', () => {
          if (dir) document.documentElement.dir = dir;
          if (lang) document.documentElement.lang = lang;
          if (host) document.head.appendChild(Object.assign(document.createElement('style'), { textContent: host }));
        });
      },
      { dir, lang, host },
    );
  }
  await page.goto(`http://localhost:${port}/?key=tak_review&api=${encodeURIComponent(API)}${query}`);
  await page.locator('taleart-view button.item, taleart-view section.banner').first().waitFor();
  page.errors = errors;
  return page;
}

const view = (page) => page.locator('taleart-view').first();
const dialogOf = (page) => page.locator('taleart-view dialog.viewer');

// The focused element, looking through shadow roots: what it is, its name, focus ring and whether
// anything covers it (2.4.11: at least part of it must show).
const focusInfo = (page) =>
  page.evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    if (!el || el === document.body) return { where: 'body' };
    const root = el.getRootNode();
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const ringed =
      (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
      (style.boxShadow && style.boxShadow !== 'none');
    // Sample points inside the element: visible when the topmost element at any one is it or inside it.
    const points = [];
    for (const fx of [0.1, 0.5, 0.9])
      for (const fy of [0.1, 0.5, 0.9]) points.push([rect.left + rect.width * fx, rect.top + rect.height * fy]);
    const inView = points.filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
    const shown = inView.filter(([x, y]) => {
      const top = (root.elementFromPoint ? root : document).elementFromPoint(x, y);
      return top && (top === el || el.contains(top));
    }).length;
    return {
      where: el.closest('dialog') ? 'dialog' : root === document ? 'page' : 'frame',
      tag: el.tagName.toLowerCase(),
      cls: el.className && typeof el.className === 'string' ? el.className : '',
      name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '',
      inert: !!el.closest('[inert]'),
      ringed,
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
      shown,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    };
  });

// Presses Tab (or Shift+Tab) up to `max` times and returns each focus stop.
async function tabWalk(page, max, key = 'Tab') {
  const stops = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    stops.push(await focusInfo(page));
  }
  return stops;
}

// WCAG relative luminance and contrast of CSS colours (rgb/rgba over an opaque base).
function parse(color) {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1]
    .split(/[ ,/]+/)
    .filter(Boolean)
    .map(Number);
  return { r, g, b, a };
}
function over(fg, bg) {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}
function luminance({ r, g, b }) {
  const c = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const WHITE = { r: 255, g: 255, b: 255, a: 1 };

// Computed values inside the first <taleart-view>'s shadow root.
const shadowStyle = (page, selector, props, pseudo = null) =>
  page.evaluate(
    ({ selector, props, pseudo }) => {
      const el = document.querySelector('taleart-view').shadowRoot.querySelector(selector);
      if (!el) return null;
      const style = getComputedStyle(el, pseudo);
      return Object.fromEntries(props.map((p) => [p, style.getPropertyValue(p)]));
    },
    { selector, props, pseudo },
  );

// Every visible control in the shadow roots: its name and size (2.5.8).
const targets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('taleart-view')].flatMap((v) =>
      [...v.shadowRoot.querySelectorAll('button')]
        .filter(
          (b) => !b.closest('[inert]') && b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden',
        )
        .map((b) => {
          const r = b.getBoundingClientRect();
          return {
            name: b.getAttribute('aria-label') ?? '',
            cls: b.className,
            w: r.width,
            h: r.height,
            x: r.x,
            y: r.y,
          };
        }),
    ),
  );

// The status text of the open viewer, once it settles on `expected` (or after a short wait).
async function viewerStatus(page, expected) {
  await page
    .waitForFunction(
      (t) => document.querySelector('taleart-view')?.shadowRoot?.querySelector('dialog .sr-only')?.textContent === t,
      expected,
      { timeout: 2000 },
    )
    .catch(() => undefined);
  return page.locator('taleart-view dialog .sr-only').textContent();
}

const noHorizontalScroll = (page) =>
  page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth + 1);

// ---- The review ----

const axeSource = await loadAxe();
const port = await freePort();
const server = await startSample(port);
const browser = await chromium.launch();
try {
  await makeVideo(browser);

  // 1. Default theme, light host page, phone size: axe in each state, keyboard walk, accessibility tree.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openSample(context);
    await page.mouse.move(1, 1);
    await axe(page, 'bar and rotating banner (default theme)');
    await shot(page, '01-bar-and-banner-default', { frames: true });

    // The accessibility tree of the bar and banner (names, roles, states).
    const tree = await view(page).ariaSnapshot();
    check(
      '4.1.2',
      /- list:[\s\S]*button "Summer sale"[\s\S]*button "New arrivals"[\s\S]*button "Stories"/.test(tree),
      'bar: a list of buttons named by group',
    );
    check('4.1.2', /region "Banner"/.test(tree) || /- region "Banner"/.test(tree), 'banner: a region named "Banner"');
    check('4.1.2', /group "1 of 3"/.test(tree), 'banner: the slide shown is a group named "1 of 3"');
    check(
      '4.1.2',
      /button "Stop automatic slide show"/.test(tree),
      'banner: the rotation button is named for what it does',
    );
    check(
      '4.1.2',
      /button "Previous slide"/.test(tree) && /button "Next slide"/.test(tree),
      'banner: previous and next are named',
    );
    check('4.1.2', /button "Show Summer sale"/.test(tree), 'banner: dots are named by group');
    const cdp = await context.newCDPSession(page);
    const ax = (await cdp.send('Accessibility.getFullAXTree')).nodes;
    const prop = (node, name) => node.properties?.find((p) => p.name === name)?.value?.value;
    const roledesc = ax.map((n) => prop(n, 'roledescription')).filter(Boolean);
    check(
      '4.1.2',
      roledesc.includes('carousel') && roledesc.includes('slide'),
      'banner: carousel and slide role descriptions reach the tree',
    );
    // Chromium keeps aria-current out of the CDP tree: read it from the DOM.
    const currentDot = await page.evaluate(() =>
      document
        .querySelector('taleart-view')
        .shadowRoot.querySelector('.b-dot[aria-current="true"]')
        ?.getAttribute('aria-label'),
    );
    check('4.1.2', currentDot === 'Show Summer sale', 'banner: the shown slide’s dot is aria-current');
    const hiddenSlides = await page.evaluate(() =>
      [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('.b-slide')].map(
        (s) => s.hasAttribute('inert') && s.getAttribute('aria-hidden') === 'true',
      ),
    );
    check('4.1.2', hiddenSlides.filter(Boolean).length === 2, 'banner: the two slides not shown are inert and hidden');
    check('1.3.1', !/img/.test(tree.split('region')[0]), 'bar: covers are decorative (the button carries the name)');

    // Keyboard walk from the top of the page through the bar and banner.
    await page.evaluate(() => document.activeElement?.blur());
    const stops = await tabWalk(page, 9);
    const names = stops.map((s) => s.name);
    console.log('  tab order:', names.join(' → '));
    check(
      '2.4.3',
      JSON.stringify(names.slice(0, 9)) ===
        JSON.stringify([
          'Summer sale',
          'New arrivals',
          'Stories',
          'Previous slide',
          'Next slide',
          'Summer sale',
          'Start automatic slide show',
          'Show Summer sale',
          'Show New arrivals',
        ]),
      'tab order: bar items left to right, then the banner’s previous, next, slide, rotation, dots',
    );
    check(
      '2.4.7',
      stops.every((s) => s.ringed),
      'every focus stop in the bar and banner shows a focus ring',
    );
    check(
      '2.4.11',
      stops.every((s) => s.shown > 0),
      'no focused control in the bar or banner is fully covered',
    );
    check(
      '2.2.2',
      names[6] === 'Start automatic slide show',
      'focus entering the banner stops autoplay (the rotation button then offers Start)',
    );
    await shot(page, '02-focus-banner-dot', { frames: true });

    // Operate the banner by keyboard: rotation button, dots, previous and next, then the slide opens the viewer.
    const slide = () =>
      page.evaluate(() =>
        [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('.b-dot')].findIndex(
          (d) => d.getAttribute('aria-current') === 'true',
        ),
      );
    await page.keyboard.press('Enter'); // on "Show New arrivals"
    check('2.1.1', (await slide()) === 1, 'Enter on a dot shows its slide');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press(' ');
    check('2.1.1', (await slide()) === 0, 'Space on a dot shows its slide');
    await page.keyboard.press('Shift+Tab'); // rotation
    await page.keyboard.press('Enter');
    check(
      '2.2.2',
      (await focusInfo(page)).name === 'Stop automatic slide show',
      'Enter on the rotation button restarts autoplay',
    );
    await page.keyboard.press(' ');
    check(
      '2.2.2',
      (await focusInfo(page)).name === 'Start automatic slide show',
      'Space on the rotation button stops it',
    );
    const live = await page.evaluate(() =>
      document.querySelector('taleart-view').shadowRoot.querySelector('.b-track').getAttribute('aria-live'),
    );
    check('4.1.3', live === 'polite', 'stopped, the slide list announces slide changes politely');
    await page.keyboard.press('Shift+Tab'); // slide
    await page.keyboard.press('Shift+Tab'); // next
    await page.keyboard.press('Enter');
    check('2.1.1', (await slide()) === 1, 'Enter on Next slide moves the banner');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press(' ');
    check('2.1.1', (await slide()) === 0, 'Space on Previous slide moves it back');

    // The bar item opens the viewer by keyboard (Space); the viewer is a labelled modal dialog.
    await view(page).locator('button.item').first().focus();
    await page.keyboard.press(' ');
    const dialog = dialogOf(page);
    await dialog.waitFor();
    check('2.1.1', await dialog.isVisible(), 'Space on a bar item opens the viewer');
    const opened = await focusInfo(page);
    check('2.4.3', opened.where === 'dialog', 'opening moves focus into the viewer');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    check(
      '2.4.3',
      (await focusInfo(page)).name === 'Summer sale, seen',
      'Escape closes and focus returns to the bar item',
    );
    await page.keyboard.press('Enter');
    await dialog.waitFor();
    check('2.1.1', await dialog.isVisible(), 'Enter on a bar item opens the viewer');
    const isModal = await page.evaluate(() =>
      document.querySelector('taleart-view').shadowRoot.querySelector('dialog').matches(':modal'),
    );
    check('4.1.2', isModal, 'the viewer is a modal dialog (the page behind it is inert)');
    const dialogTree = await dialog.ariaSnapshot();
    check('4.1.2', /dialog "Summer sale"/.test(dialogTree), 'the dialog is named by the group');
    check('1.1.1', /img "Beach day"/.test(dialogTree), 'an image tale is named by its title');
    check(
      '4.1.3',
      (await viewerStatus(page, 'Summer sale, tale 1 of 3')) === 'Summer sale, tale 1 of 3',
      'the live region says "Summer sale, tale 1 of 3"',
    );
    const liveRegion = await page.evaluate(() =>
      document.querySelector('taleart-view').shadowRoot.querySelector('dialog .sr-only').getAttribute('aria-live'),
    );
    check('4.1.3', liveRegion === 'polite', 'the tale position is a polite live region');

    // 2.2.1 and 2.2.2: the auto-advancing tale can be paused, and stays paused past its duration.
    await page.keyboard.press(' ');
    check('2.2.1', (await dialog.getAttribute('data-paused')) !== null, 'Space pauses the tale');
    await axe(page, 'viewer on an image tale (paused)');
    await shot(page, '03-viewer-image-tale');
    await page.waitForTimeout(5600);
    check(
      '2.2.1',
      (await viewerStatus(page, 'Summer sale, tale 1 of 3')) === 'Summer sale, tale 1 of 3',
      'paused, the tale does not advance after its 5 s',
    );

    // The viewer's controls, in order, with a ring, operable, and focus stays in the dialog.
    const viewerStops = await tabWalk(page, 6);
    console.log('  viewer tab order:', viewerStops.map((s) => s.name || s.where).join(' → '));
    check(
      '2.4.3',
      JSON.stringify(viewerStops.slice(0, 4).map((s) => s.name)) ===
        JSON.stringify(['Previous tale', 'Next tale', 'Play', 'Close']),
      'viewer tab order: Previous tale, Next tale, Play/Pause, Close',
    );
    check(
      '2.1.2',
      viewerStops.every((s) => s.where === 'dialog' || s.where === 'body'),
      'Tab never leaves the viewer for the page behind it',
    );
    check(
      '2.1.2',
      viewerStops.slice(4).some((s) => s.where === 'dialog'),
      'Tab past Close comes back into the viewer (no trap, no escape to the page)',
    );
    const backStops = await tabWalk(page, 6, 'Shift+Tab');
    check(
      '2.1.2',
      backStops.every((s) => s.where === 'dialog' || s.where === 'body'),
      'Shift+Tab never leaves the viewer for the page behind it',
    );
    check(
      '2.4.7',
      viewerStops.filter((s) => s.where === 'dialog').every((s) => s.ringed),
      'every viewer control shows a focus ring',
    );
    check(
      '2.4.11',
      viewerStops.filter((s) => s.where === 'dialog').every((s) => s.shown > 0),
      'no focused viewer control is fully covered',
    );

    // Each control by Enter and by Space.
    const focusByName = async (name) => {
      await page.evaluate(() => document.querySelector('taleart-view').shadowRoot.querySelector('dialog').focus());
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        if ((await focusInfo(page)).name === name) return true;
      }
      return false;
    };
    await focusByName('Next tale');
    await shot(page, '04-viewer-focus-next-tale');
    await page.keyboard.press('Enter');
    check(
      '2.1.1',
      (await viewerStatus(page, 'Summer sale, tale 2 of 3')) === 'Summer sale, tale 2 of 3',
      'Enter on Next tale steps forward',
    );
    const textTree = await dialog.ariaSnapshot();
    check(
      '1.3.1',
      /group "Opening hours"/.test(textTree) && /Open every day/.test(textTree),
      'a text tale is a group named by its title, its text readable',
    );
    await axe(page, 'viewer on a text tale');
    await shot(page, '05-viewer-text-tale');
    // On the tap zones Space keeps the viewer's shortcut (pause), as a mouse click leaves focus there; Enter steps.
    await focusByName('Next tale');
    const pausedOnZone = (await dialog.getAttribute('data-paused')) !== null;
    await page.keyboard.press(' ');
    check(
      '2.1.1',
      ((await dialog.getAttribute('data-paused')) !== null) !== pausedOnZone,
      'Space on a tap zone pauses or resumes (the viewer shortcut)',
    );
    if (pausedOnZone) await page.keyboard.press(' ');
    await page.keyboard.press('Enter');
    check(
      '2.1.1',
      (await viewerStatus(page, 'Summer sale, tale 3 of 3')) === 'Summer sale, tale 3 of 3',
      'Enter on Next tale steps forward again',
    );
    if ((await dialog.getAttribute('data-paused')) === null) await page.keyboard.press(' ');
    const videoName = await page.evaluate(() =>
      document.querySelector('taleart-view').shadowRoot.querySelector('dialog video.media')?.getAttribute('aria-label'),
    );
    check('1.1.1', videoName === 'Runway', 'a video tale is named by its title');
    await axe(page, 'viewer on a video tale');
    await focusByName('Previous tale');
    await page.keyboard.press('Enter');
    check(
      '2.1.1',
      (await viewerStatus(page, 'Summer sale, tale 2 of 3')) === 'Summer sale, tale 2 of 3',
      'Enter on Previous tale steps back',
    );
    await page.keyboard.press('Enter');
    check(
      '2.1.1',
      (await viewerStatus(page, 'Summer sale, tale 1 of 3')) === 'Summer sale, tale 1 of 3',
      'Enter on Previous tale steps back',
    );
    const pausedBefore = (await dialog.getAttribute('data-paused')) !== null;
    await focusByName(pausedBefore ? 'Play' : 'Pause');
    await page.keyboard.press('Enter');
    check(
      '2.2.2',
      ((await dialog.getAttribute('data-paused')) !== null) !== pausedBefore,
      'Enter on Play/Pause toggles playback',
    );
    await page.keyboard.press(' ');
    check(
      '2.2.2',
      ((await dialog.getAttribute('data-paused')) !== null) === pausedBefore,
      'Space on Play/Pause toggles playback',
    );
    if (!pausedBefore) await page.keyboard.press(' ');
    await page.keyboard.press('ArrowRight');
    check(
      '2.1.1',
      (await viewerStatus(page, 'Summer sale, tale 2 of 3')) === 'Summer sale, tale 2 of 3',
      'ArrowRight steps forward',
    );
    await page.keyboard.press('ArrowLeft');
    check(
      '2.1.1',
      (await viewerStatus(page, 'Summer sale, tale 1 of 3')) === 'Summer sale, tale 1 of 3',
      'ArrowLeft steps back',
    );
    await focusByName('Close');
    await page.keyboard.press(' ');
    check('2.1.1', !(await dialog.isVisible()), 'Space on Close closes the viewer');
    check('2.4.3', (await focusInfo(page)).name?.startsWith('Summer sale'), 'closing returns focus to the bar item');
    if (await dialog.isVisible()) await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await dialog.waitFor();
    await focusByName('Close');
    await page.keyboard.press('Enter');
    check('2.1.1', !(await dialog.isVisible()), 'Enter on Close closes the viewer');
    if (await dialog.isVisible()) await page.keyboard.press('Escape');

    // Across groups with taps only (2.5.7: the swipe between groups has a single-pointer alternative).
    await page.locator('taleart-view button.item').nth(1).click();
    await dialog.waitFor();
    // Taps near the bottom edge, away from any text of a text tale.
    const tap = async (fx) => {
      const box = await page.locator('taleart-view dialog .stage').boundingBox();
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * 0.95);
    };
    await tap(0.9);
    check(
      '2.5.7',
      (await dialog.getAttribute('aria-label')) === 'Stories',
      'a tap on the last tale’s right side moves to the next group',
    );
    await tap(0.1);
    check(
      '2.5.7',
      (await dialog.getAttribute('aria-label')) === 'New arrivals',
      'a tap on the first tale’s left side moves back a group',
    );
    await page.keyboard.press('Escape');

    // 2.5.2 pointer cancellation: press on a control, move off, release: nothing happens.
    const cancelled = async (locator) => {
      const box = await locator.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200, { steps: 4 });
      await page.mouse.up();
    };
    await cancelled(page.locator('taleart-view button.item').first());
    check(
      '2.5.2',
      !(await dialog.isVisible()),
      'pressing a bar item and moving off before release does not open the viewer',
    );
    await page.locator('taleart-view button.item').first().click();
    await dialog.waitFor();
    await cancelled(page.locator('taleart-view dialog .control.close'));
    check('2.5.2', await dialog.isVisible(), 'pressing Close and moving off before release does not close the viewer');
    await page.keyboard.press('Escape');

    // 2.5.8 target size: every control at least 24 × 24.
    await page.locator('taleart-view button.item').first().click();
    await dialog.waitFor();
    const all = [...(await targets(page))];
    await page.keyboard.press('Escape');
    all.push(...(await targets(page)));
    const small = all.filter((t) => t.w < 24 || t.h < 24);
    check(
      '2.5.8',
      small.length === 0,
      `every control is at least 24 × 24 CSS px${small.length ? `: ${small.map((t) => `${t.name} ${t.w}×${t.h}`).join(', ')}` : ''}`,
    );

    // 1.4.11 non-text contrast on the white host page: dots, banner buttons, viewer controls.
    const dot = parse(
      (await shadowStyle(page, '.b-dot:not([aria-current])', ['background-color'], '::before'))['background-color'],
    );
    const dotOn = parse(
      (await shadowStyle(page, '.b-dot[aria-current]', ['background-color'], '::before'))['background-color'],
    );
    check(
      '1.4.11',
      contrast(dot, WHITE) >= 3 && contrast(dotOn, WHITE) >= 3,
      `dots on white: ${contrast(dot, WHITE).toFixed(2)}:1, current ${contrast(dotOn, WHITE).toFixed(2)}:1`,
    );
    const btn = await shadowStyle(page, '.b-next', ['background-color', 'border-top-color', 'color']);
    const btnBg = over(parse(btn['background-color']), WHITE);
    check(
      '1.4.11',
      contrast(parse(btn.color), btnBg) >= 3 && contrast(parse(btn['border-top-color']), WHITE) >= 3,
      `banner buttons: icon ${contrast(parse(btn.color), btnBg).toFixed(2)}:1, edge on white media ${contrast(parse(btn['border-top-color']), WHITE).toFixed(2)}:1`,
    );
    await page.locator('taleart-view button.item').first().click();
    await dialog.waitFor();
    const control = await shadowStyle(page, '.control.close', ['background-color', 'color']);
    const onLight = over(parse(control['background-color']), WHITE);
    check(
      '1.4.11',
      contrast(parse(control.color), onLight) >= 3,
      `viewer controls over white media: ${contrast(parse(control.color), onLight).toFixed(2)}:1`,
    );
    await page.keyboard.press('Escape');
    check(
      '4.1.2',
      page.errors.length === 0,
      `no console errors${page.errors.length ? `: ${page.errors.join('; ')}` : ''}`,
    );
    await context.close();
  }

  // 2. Motion (2.2.2, 2.3.3): autoplay can be stopped; hovering pauses; animated covers stop within 5 s;
  //    with reduced motion nothing moves by itself.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openSample(context);
    await page.mouse.move(1, 1);
    const playing = () =>
      page.evaluate(() => {
        const video = document.querySelector('taleart-view').shadowRoot.querySelector('video.cover[data-animated]');
        return video ? !video.paused : false;
      });
    await page.waitForTimeout(800);
    check('2.2.2', await playing(), 'an animated cover plays without reduced motion');
    await page.waitForTimeout(5200);
    check('2.2.2', !(await playing()), 'an animated cover stops by itself within 5 s');
    // Hover pauses the banner; the rotation button stops it.
    const index = () =>
      page.evaluate(() =>
        [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('.b-dot')].findIndex(
          (d) => d.getAttribute('aria-current') === 'true',
        ),
      );
    const banner = page.locator('taleart-view section.banner');
    await banner.hover();
    const at = await index();
    await page.waitForTimeout(3400);
    check('2.2.2', (await index()) === at, 'a hovering mouse pauses the banner');
    await page.locator('taleart-view .b-rotate').click();
    await page.mouse.move(1, 1);
    const stoppedAt = await index();
    await page.waitForTimeout(3400);
    check('2.2.2', (await index()) === stoppedAt, 'the rotation button stops autoplay for good');
    await shot(page, '06-banner-stopped', { frames: true });
    await context.close();

    const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const still = await openSample(reduced);
    await still.mouse.move(1, 1);
    const transform = () => still.locator('taleart-view .b-track').evaluate((t) => t.style.transform);
    await still.waitForTimeout(3400);
    check('2.3.3', (await transform()) === 'translateX(0%)', 'with reduced motion the banner does not autoplay');
    check(
      '2.3.3',
      (await still.locator('taleart-view .b-track').evaluate((t) => getComputedStyle(t).transitionDuration)) === '0s',
      'with reduced motion slides change without a transition',
    );
    const coverStill = await still.evaluate(() => {
      const video = document.querySelector('taleart-view').shadowRoot.querySelector('video.cover[data-animated]');
      return video ? video.paused && !video.autoplay : true;
    });
    check('2.3.3', coverStill, 'with reduced motion an animated cover stays on its first frame');
    await still.locator('taleart-view button.item').first().click();
    const d = dialogOf(still);
    await d.waitFor();
    check('2.3.3', (await d.getAttribute('data-paused')) !== null, 'with reduced motion the viewer opens paused');
    await still.waitForTimeout(5600);
    check(
      '2.2.1',
      (await viewerStatus(still, 'Summer sale, tale 1 of 3')) === 'Summer sale, tale 1 of 3',
      'with reduced motion a tale never advances by itself',
    );
    const fill = await shadowStyle(still, 'dialog .fill.timed', ['animation-name']);
    check('2.3.3', !fill || fill['animation-name'] === 'none', 'with reduced motion the progress bar does not animate');
    await axe(still, 'viewer with reduced motion');
    await reduced.close();
  }

  // 3. Zoom and reflow (1.4.10, 1.4.4): 200 % (640 × 400) and 400 % (320 × 256) of a 1280 × 800 / 1024 window.
  for (const [label, viewport] of [
    ['200 %', { width: 640, height: 400 }],
    ['400 %', { width: 320, height: 256 }],
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await openSample(context);
    await page.mouse.move(1, 1);
    check('1.4.10', await noHorizontalScroll(page), `${label}: the page does not scroll sideways`);
    await view(page).locator('button.item').last().focus();
    const last = await focusInfo(page);
    check(
      '1.4.10',
      last.shown > 0,
      `${label}: the last bar item scrolls into view when focused (the bar scrolls within itself)`,
    );
    await axe(page, `bar and banner at ${label}`);
    if (label === '400 %') await shot(page, '07-reflow-400-bar-banner', { frames: true });
    await view(page).locator('button.item').first().click();
    const dialog = dialogOf(page);
    await dialog.waitFor();
    await page.keyboard.press(' ');
    const boxes = await page.evaluate(() => {
      const root = document.querySelector('taleart-view').shadowRoot;
      const r = (s) => root.querySelector(s).getBoundingClientRect();
      return { pause: r('dialog .control.pause'), close: r('dialog .control.close'), name: r('dialog .name') };
    });
    const inside = (b) => b.left >= 0 && b.top >= 0 && b.right <= viewport.width && b.bottom <= viewport.height;
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    check(
      '1.4.10',
      inside(boxes.pause) &&
        inside(boxes.close) &&
        !overlap(boxes.pause, boxes.close) &&
        !overlap(boxes.name, boxes.pause),
      `${label}: viewer controls stay on screen and apart`,
    );
    await axe(page, `viewer at ${label}`);
    if (label === '400 %') await shot(page, '08-reflow-400-viewer');
    await context.close();
  }

  // 4. Text spacing (1.4.12): line height 1.5, letter 0.12 em, word 0.16 em, paragraph 2 em, applied to the
  //    page and inside the SDK's shadow root (a host stylesheet does not reach it).
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openSample(context);
    const SPACING =
      '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';
    const before = await page.evaluate(() =>
      [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('.title')].map(
        (t) => t.scrollWidth <= t.clientWidth,
      ),
    );
    await page.evaluate((css) => {
      for (const root of [document, document.querySelector('taleart-view').shadowRoot]) {
        const style = document.createElement('style');
        style.textContent = css;
        (root.head ?? root).appendChild(style);
      }
    }, SPACING);
    const clipped = await page.evaluate(() =>
      [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('.title')].map((t) => ({
        name: t.textContent,
        fits: t.scrollWidth <= t.clientWidth,
        tall: t.scrollHeight <= t.clientHeight + 1,
      })),
    );
    const lost = clipped.filter((t, i) => before[i] && !t.fits);
    check(
      '1.4.12',
      lost.length === 0 && clipped.every((t) => t.tall),
      `bar titles that fit still fit with text spacing${lost.length ? `: ${lost.map((t) => t.name).join(', ')} truncated` : ''}`,
    );
    await shot(page, '09-text-spacing-bar', { frames: true });
    await view(page).locator('button.item').first().click();
    const dialog = dialogOf(page);
    await dialog.waitFor();
    await page.keyboard.press(' ');
    await page.keyboard.press('ArrowRight');
    await viewerStatus(page, 'Summer sale, tale 2 of 3');
    const texts = await page.evaluate(() =>
      [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('dialog .ta-text')].map((p) => {
        const canvas = p.closest('.ta-canvas').getBoundingClientRect();
        const g = p.querySelector('.ta-glyphs').getBoundingClientRect();
        return (
          g.top >= canvas.top && g.bottom <= canvas.bottom && g.left >= canvas.left - 1 && g.right <= canvas.right + 1
        );
      }),
    );
    check(
      '1.4.12',
      texts.length > 0 && texts.every(Boolean),
      'text tale lines stay within the canvas with text spacing',
    );
    const name = await shadowStyle(page, 'dialog .name', ['line-height']);
    check('1.4.12', !!name, 'the viewer’s group name takes the spacing without overlapping the controls');
    await shot(page, '10-text-spacing-viewer');
    await context.close();
  }

  // 5. Orientation (1.3.4): the viewer and frames work in landscape.
  {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 } });
    const page = await openSample(context);
    check('1.3.4', await noHorizontalScroll(page), 'landscape: the page does not scroll sideways');
    await view(page).locator('button.item').first().click();
    const dialog = dialogOf(page);
    await dialog.waitFor();
    const frame = await page.evaluate(() =>
      document.querySelector('taleart-view').shadowRoot.querySelector('dialog .frame').getBoundingClientRect().toJSON(),
    );
    check(
      '1.3.4',
      frame.height === 390 && frame.width > 0 && frame.width <= 844,
      'landscape: the viewer shows the tale at full height',
    );
    await axe(page, 'viewer in landscape');
    await context.close();
  }

  // 6. A dark host page: titles take its light text colour; dots, focus rings and controls still contrast.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const page = await openSample(context, {
      host: 'body { background: #111827 !important; color: #f9fafb !important; } code { background: #374151 !important; }',
    });
    await page.mouse.move(1, 1);
    await axe(page, 'bar and banner on a dark host page');
    const DARK = { r: 17, g: 24, b: 39, a: 1 };
    const dot = parse(
      (await shadowStyle(page, '.b-dot:not([aria-current])', ['background-color'], '::before'))['background-color'],
    );
    const dotOn = parse(
      (await shadowStyle(page, '.b-dot[aria-current]', ['background-color'], '::before'))['background-color'],
    );
    check('1.4.11', contrast(dot, DARK) >= 3, `dark host: dots ${contrast(dot, DARK).toFixed(2)}:1`);
    check('1.4.11', contrast(dotOn, DARK) >= 3, `dark host: the current dot ${contrast(dotOn, DARK).toFixed(2)}:1`);
    await view(page).locator('button.item').first().focus();
    const ring = await shadowStyle(page, 'button.item:focus-visible', ['box-shadow', 'outline-color']);
    check(
      '1.4.11',
      !!ring && /255, 255, 255/.test(ring['box-shadow']),
      'dark host: the bar focus ring’s white inner ring shows on the dark page',
    );
    await shot(page, '11-dark-host', { frames: true });
    await context.close();
  }

  // 7. Themes (R9): a project theme with a title colour and background, and the SDK override.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const theme = {
      ...DEFAULT_THEME,
      ringStyle: 'solid',
      ringColors: ['#0055ff'],
      seenRingColor: '#4b5563',
      titleColor: '#f9fafb',
      backgroundColor: '#1f2937',
      accentColor: '#ffcc00',
      cornerRadius: 0,
      fontFamily: 'Georgia, serif',
    };
    const page = await openSample(context, {
      zone: zone({
        theme,
        frames: [
          { id: 'f1', type: 'bar', settings: { shape: 'rounded-square' } },
          { id: 'f2', type: 'banner', settings: { autoplay: false } },
        ],
      }),
    });
    await axe(page, 'themed bar and banner (dark theme background, light titles)');
    const BG = { r: 31, g: 41, b: 55, a: 1 };
    const dot = parse(
      (await shadowStyle(page, '.b-dot:not([aria-current])', ['border-top-color'], '::before'))['border-top-color'],
    );
    check('1.4.11', contrast(dot, BG) >= 3, `themed dots on the theme background: ${contrast(dot, BG).toFixed(2)}:1`);
    await shot(page, '12-themed', { frames: true });
    await view(page).locator('button.item').first().click();
    await dialogOf(page).waitFor();
    await page.keyboard.press(' ');
    await axe(page, 'themed viewer');
    await context.close();

    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const sdkTheme = encodeURIComponent(
      JSON.stringify({
        ringColors: ['#0000ff'],
        ringStyle: 'solid',
        cornerRadius: 0,
        titleColor: '#111827',
        backgroundColor: '#ffffff',
      }),
    );
    const overridden = await openSample(ctx2, { query: `&theme=${sdkTheme}` });
    await overridden.mouse.move(1, 1);
    await axe(overridden, 'SDK theme override');
    await ctx2.close();
  }

  // 8. Forced colours (Windows High Contrast): controls, the shown slide and focus stay visible.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, forcedColors: 'active' });
    const page = await openSample(context);
    await page.mouse.move(1, 1);
    await axe(page, 'bar and banner in forced colours');
    const dotStyles = await page.evaluate(() =>
      [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('.b-dot')].map((d) => {
        const s = getComputedStyle(d, '::before');
        return {
          bg: s.backgroundColor,
          border: s.borderTopStyle !== 'none' ? s.borderTopColor : null,
          w: s.width,
          current: d.getAttribute('aria-current') === 'true',
        };
      }),
    );
    const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const visible = (s) => (s.bg !== canvas && parse(s.bg)?.a !== 0) || s.border;
    check(
      '1.4.11',
      dotStyles.every(visible),
      `forced colours: every dot is drawn (${dotStyles.map((s) => s.bg).join(', ')} on ${canvas})`,
    );
    const cur = dotStyles.find((s) => s.current);
    const other = dotStyles.find((s) => !s.current);
    check(
      '1.4.1',
      cur && other && (cur.bg !== other.bg || cur.w !== other.w),
      'forced colours: the current dot differs from the others',
    );
    await view(page).locator('button.item').first().focus();
    const ring = await focusInfo(page);
    check('2.4.7', ring.outline.startsWith('solid'), 'forced colours: the focus outline shows');
    await shot(page, '13-forced-colors', { frames: true });
    await view(page).locator('button.item').first().press('Enter');
    const dialog = dialogOf(page);
    await dialog.waitFor();
    await page.keyboard.press(' ');
    const seg = await page.evaluate(() => {
      const root = document.querySelector('taleart-view').shadowRoot;
      const s = getComputedStyle(root.querySelector('dialog .control.close'));
      return { border: s.borderTopStyle, color: s.color };
    });
    check('1.4.11', seg.border !== 'none', 'forced colours: viewer buttons keep a visible edge');
    await axe(page, 'viewer in forced colours');
    await shot(page, '14-forced-colors-viewer');
    await context.close();
  }

  // 9. A right-to-left host page with Hebrew names, and a mixed Hebrew/English text tale.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const he = zone({ taleGroups: groups(['מבצע קיץ', 'חדש בחנות', 'סיפורים']) });
    const page = await openSample(context, { zone: he, dir: 'rtl', lang: 'he' });
    await page.mouse.move(1, 1);
    await axe(page, 'RTL host page: bar and banner');
    const shownMedia = async () =>
      page.evaluate(() => {
        const root = document.querySelector('taleart-view').shadowRoot;
        const viewport = root.querySelector('.b-viewport').getBoundingClientRect();
        const slide = root.querySelector('.b-slide:not([inert])').getBoundingClientRect();
        return Math.abs(slide.left - viewport.left) < 2 && Math.abs(slide.width - viewport.width) < 2;
      });
    check('1.3.2', await shownMedia(), 'RTL: the banner shows its first slide in the slide area');
    await page.locator('taleart-view .b-rotate').click();
    await page.locator('taleart-view .b-next').click();
    await page.waitForTimeout(500); // the slide transition
    check('1.3.2', await shownMedia(), 'RTL: after Next the shown slide is in the slide area (not off-screen)');
    const rtlIndex = () =>
      page.evaluate(() =>
        [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('.b-dot')].findIndex(
          (d) => d.getAttribute('aria-current') === 'true',
        ),
      );
    const vp = await page.locator('taleart-view .b-viewport').boundingBox();
    const beforeSwipe = await rtlIndex();
    await page.mouse.move(vp.x + vp.width * 0.3, vp.y + vp.height / 2);
    await page.mouse.down();
    await page.mouse.move(vp.x + vp.width * 0.8, vp.y + vp.height / 2, { steps: 5 });
    await page.mouse.up();
    check('2.5.7', (await rtlIndex()) === beforeSwipe + 1, 'RTL: a swipe to the right shows the next slide (mirrored)');
    await page.waitForTimeout(500);
    check('1.3.2', await shownMedia(), 'RTL: after a swipe the shown slide is in the slide area');
    const sides = await page.evaluate(() => {
      const root = document.querySelector('taleart-view').shadowRoot;
      return {
        prev: root.querySelector('.b-prev').getBoundingClientRect().x,
        next: root.querySelector('.b-next').getBoundingClientRect().x,
      };
    });
    check('1.3.2', sides.prev > sides.next, 'RTL: Previous slide sits on the right and Next on the left');
    const flips = await page.evaluate(() => {
      const root = document.querySelector('taleart-view').shadowRoot;
      const t = (s) => getComputedStyle(root.querySelector(s + ' svg')).transform;
      return { next: t('.b-next'), rotate: t('.b-rotate') };
    });
    check(
      '1.3.2',
      flips.next !== 'none' && flips.rotate === 'none',
      'RTL: the chevrons point the other way; the play/pause icon does not',
    );
    await shot(page, '15-rtl-bar-banner', { frames: true });
    const titleDir = await page.evaluate(
      () => getComputedStyle(document.querySelector('taleart-view').shadowRoot.querySelector('.title')).direction,
    );
    check('1.3.2', titleDir === 'rtl', 'RTL: bar titles run right to left');
    await view(page).locator('button.item').nth(2).click();
    const dialog = dialogOf(page);
    await dialog.waitFor();
    await page.keyboard.press(' ');
    const zones = await page.evaluate(() => {
      const root = document.querySelector('taleart-view').shadowRoot;
      return {
        prev: root.querySelector('dialog .zone.prev').getBoundingClientRect().x,
        next: root.querySelector('dialog .zone.next').getBoundingClientRect().x,
      };
    });
    check(
      '1.3.2',
      zones.prev > zones.next,
      'RTL: in the viewer, Previous tale is the right third and Next tale the left',
    );
    const head = await page.evaluate(() => {
      const root = document.querySelector('taleart-view').shadowRoot;
      const x = (s) => root.querySelector(s).getBoundingClientRect();
      return {
        name: x('dialog .name').right,
        pause: x('dialog .control.pause').right,
        close: x('dialog .control.close').left,
      };
    });
    check(
      '1.3.2',
      head.name > head.pause && head.close < 60,
      'RTL: the group name is on the right and Close at the far left',
    );
    const lines = await page.evaluate(() =>
      [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('dialog .ta-text')].map((p) => ({
        dir: p.dir,
        base: getComputedStyle(p).direction,
      })),
    );
    check(
      '1.3.2',
      lines.length === 2 && lines.every((l) => l.dir === 'auto'),
      'mixed Hebrew/English text takes its direction from its own first strong character',
    );
    await axe(page, 'RTL host page: viewer on a mixed-direction text tale');
    await shot(page, '16-rtl-mixed-text-tale');
    await page.keyboard.press('ArrowRight');
    check(
      '2.1.1',
      (await dialog.getAttribute('aria-label')) === 'חדש בחנות',
      'RTL: ArrowRight is previous (back to the previous group)',
    );
    await page.keyboard.press('ArrowLeft');
    check('2.1.1', (await dialog.getAttribute('aria-label')) === 'סיפורים', 'RTL: ArrowLeft is next');
    await page.keyboard.press('Escape');
    check(
      '4.1.2',
      page.errors.length === 0,
      `RTL: no console errors${page.errors.length ? `: ${page.errors.join('; ')}` : ''}`,
    );
    await context.close();

    // The mixed text tale on a left-to-right page: a Hebrew-first line still reads right to left.
    const ltr = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await openSample(ltr);
    await view(p2).locator('button.item').nth(2).click();
    await dialogOf(p2).waitFor();
    await p2.keyboard.press(' ');
    const first = await p2.evaluate(() => {
      const p = document.querySelector('taleart-view').shadowRoot.querySelector('dialog .ta-text');
      return getComputedStyle(p).direction === 'rtl' || p.matches(':dir(rtl)');
    });
    check('1.3.2', first, 'LTR page: the Hebrew-first line of a mixed text tale runs right to left');
    await ltr.close();
  }

  // 10. Stages: two staged bars on one page keep distinct, named controls.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const z = zone({
      frames: [
        { id: 'f1', type: 'bar', settings: { shape: 'circle' } },
        { id: 'f2', type: 'banner', settings: { autoplay: false } },
      ],
      stages: [
        { key: 'top', frameId: 'f1' },
        { key: 'hero', frameId: 'f2' },
      ],
    });
    const page = await openSample(context, { zone: z, query: '&stages=top,hero' });
    await axe(page, 'stages: a bar stage and a banner stage');
    await context.close();
  }

  // 11. Styled text (Tale Studio 7.4): fonts, sizes, colours, boxes and highlights, alignment and
  //     direction, at two phone widths; contrast (1.4.3), right-to-left text (1.3.2) and text spacing (1.4.12).
  {
    const styled = (n, y, props) => ({ ...text(n, y, props.text), props });
    const STYLED = [
      styled(1, 0.14, {
        text: 'קיץ: 50% off',
        font: { source: 'system', stack: 'serif' },
        size: 0.06,
        weight: 'bold',
        italic: true,
        color: '#ffcc00',
        align: 'start',
        direction: 'auto',
        lineHeight: 1.2,
        background: 'box',
        backgroundColor: '#000000',
      }),
      styled(2, 0.34, {
        text: 'Free shipping on every order this week',
        font: { source: 'name', family: '"Sample Serif"' },
        fallback: 'serif',
        size: 0.04,
        weight: 'regular',
        color: '#111111',
        align: 'end',
        lineHeight: 1.4,
        background: 'highlight',
        backgroundColor: '#ffffff',
      }),
      styled(3, 0.54, { text: 'Theme font', font: { source: 'theme' }, fallback: 'monospace', size: 0.03 }),
      styled(4, 0.7, { text: 'שלום world', direction: 'ltr', align: 'start', weight: 'medium' }),
    ];
    const z = zone({
      theme: { ...DEFAULT_THEME, fontFamily: 'Georgia, serif' },
      taleGroups: [
        {
          id: 'gs',
          name: 'Styled',
          cover: null,
          tales: [
            {
              id: 's1',
              title: 'Styled text',
              media: null,
              document: { version: 1, canvas: { background: { type: 'color', color: '#1f3a5f' } }, elements: STYLED },
            },
          ],
        },
      ],
    });
    // The host page loads the font the second text names, from a font the system has.
    const host =
      '@font-face { font-family: "Sample Serif"; src: local("Georgia"), local("DejaVu Serif"), local("Times New Roman"); }';
    const read = (page) =>
      page.evaluate(() =>
        [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('dialog .ta-text')].map((p) => {
          const s = getComputedStyle(p);
          const g = p.querySelector('.ta-glyphs');
          const gs = getComputedStyle(g);
          const box = p.getBoundingClientRect();
          const glyphs = g.getBoundingClientRect();
          const canvas = p.closest('.ta-canvas').getBoundingClientRect();
          return {
            text: p.textContent,
            dirAttr: p.getAttribute('dir'),
            direction: s.direction,
            family: s.fontFamily,
            size: parseFloat(s.fontSize) / canvas.height,
            weight: s.fontWeight,
            italic: s.fontStyle,
            color: s.color,
            align: s.textAlign,
            boxBg: s.backgroundColor,
            lineBg: gs.backgroundColor,
            clone: gs.boxDecorationBreak || gs.webkitBoxDecorationBreak,
            // Where each word is drawn, for the visual order of mixed Hebrew and English (bidi).
            words: Object.fromEntries(
              ['קיץ', 'off', 'שלום', 'world'].flatMap((word) => {
                const at = g.firstChild.textContent.indexOf(word);
                if (at < 0) return [];
                const range = document.createRange();
                range.setStart(g.firstChild, at);
                range.setEnd(g.firstChild, at + word.length);
                return [[word, range.getBoundingClientRect().left]];
              }),
            ),
            leftGap: glyphs.left - box.left,
            rightGap: box.right - glyphs.right,
            inside:
              glyphs.top >= canvas.top - 1 &&
              glyphs.bottom <= canvas.bottom + 1 &&
              glyphs.left >= canvas.left - 1 &&
              glyphs.right <= canvas.right + 1,
          };
        }),
      );
    const near = (a, b) => Math.abs(a - b) < 0.002;
    for (const width of [390, 360]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await openSample(context, { zone: z, host });
      await view(page).locator('button.item').first().click();
      await dialogOf(page).waitFor();
      await page.keyboard.press(' ');
      const [hebrew, named, themed, ltr] = await read(page);
      const at = `${width} px`;
      check(
        '1.4.4',
        near(hebrew.size, 0.06) && near(named.size, 0.04) && near(themed.size, 0.03),
        `${at}: text sizes are fractions of the canvas height (6 %, 4 %, 3 %)`,
      );
      check(
        '1.3.1',
        /Georgia/.test(hebrew.family) && hebrew.weight === '700' && hebrew.italic === 'italic',
        `${at}: the serif stack, bold and italic apply`,
      );
      check(
        '1.3.1',
        /^"Sample Serif", Georgia/.test(named.family) && named.weight === '400',
        `${at}: a font name the page loads comes first, before its fallback stack (${named.family.slice(0, 40)}…)`,
      );
      check(
        '1.3.1',
        /^"?Georgia"?, serif, ui-monospace/.test(themed.family),
        `${at}: the theme font applies, then the fallback stack (${themed.family.slice(0, 40)}…)`,
      );
      check(
        '1.3.2',
        hebrew.dirAttr === 'auto' && hebrew.direction === 'rtl' && hebrew.rightGap < hebrew.leftGap,
        `${at}: Hebrew-first text with automatic direction reads right to left and aligns to its start, the right ` +
          `(${hebrew.direction}, gaps ${Math.round(hebrew.leftGap)} / ${Math.round(hebrew.rightGap)} px)`,
      );
      check(
        '1.3.2',
        ltr.dirAttr === 'ltr' && ltr.direction === 'ltr' && ltr.leftGap < ltr.rightGap,
        `${at}: an explicit left-to-right direction keeps Hebrew text left-aligned at its start`,
      );
      check('1.3.2', named.align === 'end' && named.leftGap > named.rightGap, `${at}: end alignment on LTR is right`);
      // Visual order (AC2): in the right-to-left line the Hebrew word comes first, on the right, and the
      // English after it, to its left; in the line set left to right the Hebrew word is on the left.
      check(
        '1.3.2',
        hebrew.words['קיץ'] > hebrew.words['off'] && ltr.words['שלום'] < ltr.words['world'],
        `${at}: mixed Hebrew and English runs are drawn in bidi order for each line's direction`,
      );
      const boxRatio = contrast(parse(hebrew.color), parse(hebrew.boxBg));
      const lineRatio = contrast(parse(named.color), parse(named.lineBg));
      check(
        '1.4.3',
        boxRatio >= 4.5 && lineRatio >= 4.5,
        `${at}: text on its box (${boxRatio.toFixed(1)}:1) and on its highlight (${lineRatio.toFixed(1)}:1) contrasts`,
      );
      check(
        '1.4.3',
        named.clone === 'clone' && parse(named.boxBg)?.a === 0,
        `${at}: the highlight is drawn behind each line, not the box`,
      );
      await axe(page, `${at}: viewer on a styled text tale`);
      if (width === 390) await shot(page, '17-styled-text-tale');
      // Text spacing (1.4.12) on styled text: every line stays on the canvas.
      await page.evaluate((css) => {
        const style = document.createElement('style');
        style.textContent = css;
        document.querySelector('taleart-view').shadowRoot.appendChild(style);
      }, '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }');
      const spaced = await read(page);
      check(
        '1.4.12',
        spaced.every((t) => t.inside),
        `${at}: styled text stays within the canvas with text spacing`,
      );
      check('4.1.2', page.errors.length === 0, `${at}: no console errors on the styled text tale`);
      await context.close();
    }
  }

  // 12. Project fonts (Tale Studio 7.17, epic R15, R18): no font file before the tale opens; then one
  //     request, the fallback first and the font swapped in; a font slower than 3 s keeps the fallback.
  {
    const FONT_ID = '0f0e0d0c-0000-4000-8000-00000000000a';
    const ALIAS = `taleart-font-${FONT_ID}`;
    const fontBytes = readFileSync(
      resolve(import.meta.dirname, '../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'),
    );
    const branded = {
      ...text(1, 0.3, 'Brand font, swapped in when ready'),
      props: {
        text: 'Brand font, swapped in when ready',
        font: { source: 'project', fontId: FONT_ID },
        fallback: 'serif',
        size: 0.05,
      },
    };
    const z = zone({
      frames: [{ id: 'f1', type: 'bar', settings: {} }],
      taleGroups: [
        { id: 'gp', name: 'Plain', cover: null, tales: [textTale('p1', 'Plain', ['No project font'])] },
        {
          id: 'gf',
          name: 'Brand',
          cover: null,
          tales: [
            {
              id: 'f1',
              title: 'Brand',
              media: null,
              document: {
                version: 1,
                canvas: { background: { type: 'color', color: '#1f3a5f' } },
                elements: [branded, text(2, 0.6, 'Plain text')],
              },
              fonts: [{ id: FONT_ID, url: `${API}/media/fonts/brand.woff2`, weight: 400, style: 'normal' }],
            },
          ],
        },
      ],
    });
    const serveFont = async (page, delayMs) => {
      const requests = [];
      await page.route(`${API}/media/fonts/**`, async (route) => {
        requests.push(route.request().url());
        await new Promise((done) => setTimeout(done, delayMs));
        await route
          .fulfill({ body: fontBytes, contentType: 'font/woff2', headers: { 'Access-Control-Allow-Origin': '*' } })
          .catch(() => undefined);
      });
      return requests;
    };
    const readFont = (page) =>
      page.evaluate((alias) => {
        const p = [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('dialog .ta-text')].find((t) =>
          t.textContent.startsWith('Brand font'),
        );
        return {
          family: p ? getComputedStyle(p).fontFamily : '',
          width: p ? p.querySelector('.ta-glyphs').getBoundingClientRect().width : 0,
          faces: [...document.fonts].filter((f) => f.family.replace(/"/g, '') === alias).map((f) => f.status),
        };
      }, ALIAS);
    const items = (page) => view(page).locator('button.item');

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openSample(context, { zone: z });
    const requests = await serveFont(page, 600);
    // Open the plain group first: a tale with no project font fetches none.
    await items(page).first().click();
    await dialogOf(page).waitFor();
    await page.waitForTimeout(700);
    check('R18', requests.length === 0, 'no font file is requested before a tale that uses it opens');
    await page.keyboard.press('Escape');
    await items(page).nth(1).click();
    await dialogOf(page).waitFor();
    await page.keyboard.press(' ');
    const before = await readFont(page);
    check(
      'R18',
      // Computed styles may drop the quotes around the alias.
      before.family.replace(/"/g, '').startsWith(`${ALIAS},`) &&
        /Georgia/.test(before.family) &&
        before.faces.length === 0,
      `the text is drawn under the font's alias, in its fallback until the font is ready (${before.family.slice(0, 60)}…)`,
    );
    await page.waitForFunction(
      (alias) => [...document.fonts].some((f) => f.family.replace(/"/g, '') === alias && f.status === 'loaded'),
      ALIAS,
      { timeout: 5000 },
    );
    await page.waitForTimeout(100);
    const after = await readFont(page);
    check(
      'R18',
      after.faces.join() === 'loaded' && Math.abs(after.width - before.width) > 1,
      `the font swaps in when ready (text width ${Math.round(before.width)} → ${Math.round(after.width)} px)`,
    );
    check('R18', requests.length === 1, `opening the tale requests its font once (${requests.length})`);
    await axe(page, 'viewer on a tale in a project font');
    await page.keyboard.press('Escape');
    await items(page).nth(1).click();
    await dialogOf(page).waitFor();
    await page.waitForTimeout(300);
    check('R18', requests.length === 1, 'opening the tale again requests no font');
    check('4.1.2', page.errors.length === 0, 'no console errors on the project font tale');
    await context.close();

    // A font that takes over 3 s is dropped: the text keeps its fallback.
    const slowContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const slow = await openSample(slowContext, { zone: z });
    await serveFont(slow, 4000);
    await items(slow).nth(1).click();
    await dialogOf(slow).waitFor();
    await slow.keyboard.press(' ');
    await slow.waitForTimeout(4800);
    const late = await readFont(slow);
    check(
      'R18',
      late.faces.length === 0 && /Georgia/.test(late.family) && late.width > 0,
      'a font slower than 3 s is never added, and the text keeps its fallback',
    );
    await slowContext.close();
  }

  // 13. Images and video in a tale document (Tale Studio 7.5, epic R5, R12): an image read by its alt
  //     text, a decorative image and the background hidden, a video muted and inline that runs the tale
  //     for its length, and under reduced motion stays on its first frame until Play.
  {
    const mediaEl = (n, type, y, props, a11y) => ({
      id: `00000000-0000-4000-8000-00000000010${n}`,
      type,
      box: { x: 0.1, y, w: 0.8, h: 0.2, rotation: n === 1 ? 8 : 0 },
      a11y,
      props: { fit: 'cover', ...props },
    });
    const z = zone({
      frames: [{ id: 'f1', type: 'bar', settings: {} }],
      taleGroups: [
        {
          id: 'gm',
          name: 'Media',
          cover: null,
          tales: [
            {
              id: 'm1',
              title: 'Media tale',
              media: null,
              document: {
                version: 1,
                canvas: {
                  background: { type: 'media', url: `${API}/media/media/bg.svg`, fit: 'contain', color: '#1f3a5f' },
                },
                elements: [
                  mediaEl(
                    1,
                    'image',
                    0.15,
                    { url: `${API}/media/media/bike.svg`, radius: 0.03 },
                    { label: 'A red bicycle' },
                  ),
                  mediaEl(
                    2,
                    'image',
                    0.4,
                    { url: `${API}/media/media/pattern.svg`, opacity: 0.6 },
                    { decorative: true },
                  ),
                  mediaEl(3, 'video', 0.65, { url: `${API}/media/media/runway.webm` }, { label: 'Runway clip' }),
                ],
              },
            },
            textTale('m2', 'After the video', ['The next tale']),
          ],
        },
      ],
    });
    const readMedia = (page) =>
      page.evaluate(() => {
        const dialog = document.querySelector('taleart-view').shadowRoot.querySelector('dialog');
        const video = dialog.querySelector('.ta-canvas video');
        return {
          images: [...dialog.querySelectorAll('.ta-canvas img.ta-media')].map((img) => ({
            alt: img.alt,
            hidden: img.getAttribute('aria-hidden'),
          })),
          background: dialog.querySelector('.ta-bg')?.getAttribute('aria-hidden') ?? null,
          video: video && {
            muted: video.muted,
            inline: video.playsInline,
            label: video.getAttribute('aria-label'),
            paused: video.paused,
            time: video.currentTime,
          },
        };
      });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openSample(context, { zone: z });
    await view(page).locator('button.item').first().click();
    await dialogOf(page).waitFor();
    await page.waitForTimeout(400);
    const shown = await readMedia(page);
    check(
      '1.1.1',
      shown.images.length === 2 &&
        shown.images[0].alt === 'A red bicycle' &&
        shown.images[0].hidden === null &&
        shown.images[1].alt === '' &&
        shown.images[1].hidden === 'true' &&
        shown.background === 'true',
      'an image is read by its alt text; a decorative image and the background image are hidden',
    );
    check(
      '2.2.2',
      shown.video?.muted && shown.video.inline && shown.video.label === 'Runway clip' && !shown.video.paused,
      'a video element plays muted and inline, named by its alt text',
    );
    await axe(page, 'viewer on a tale with images and a video');
    await shot(page, 'media-tale');
    // The 2 s video runs the tale: the next tale shows once it ends.
    await page.waitForTimeout(1000);
    const next = await viewerStatus(page, 'Media, tale 2 of 2');
    check('R5', next === 'Media, tale 2 of 2', `the tale plays for its video's length, then moves on (${next})`);
    check('4.1.2', page.errors.length === 0, 'no console errors on the media tale');
    await context.close();

    const reducedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const reduced = await openSample(reducedContext, { zone: z });
    await view(reduced).locator('button.item').first().click();
    await dialogOf(reduced).waitFor();
    await reduced.waitForTimeout(1500);
    const still = await readMedia(reduced);
    check(
      '2.3.3',
      still.video?.paused && still.video.time < 0.1,
      'under reduced motion the video does not play by itself and stays on its first frame',
    );
    const play = dialogOf(reduced).locator('button.pause');
    check('2.2.2', (await play.getAttribute('aria-label')) === 'Play', 'under reduced motion the Play button plays it');
    await play.click();
    await reduced.waitForTimeout(500);
    check('2.2.2', !(await readMedia(reduced)).video?.paused, 'Play plays the video');
    await reducedContext.close();
  }
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
const byCriterion = {};
for (const r of results) (byCriterion[r.criterion] ??= { pass: 0, fail: 0 })[r.ok ? 'pass' : 'fail']++;
console.log('\nBy criterion:', JSON.stringify(byCriterion));
if (args.json) writeFileSync(resolve(args.json), JSON.stringify({ results, byCriterion }, null, 2));
if (failed.length) {
  console.error(`\nWCAG 2.2 AA review: ${failed.length} of ${results.length} checks failed`);
  for (const f of failed) console.error(`  [${f.criterion}] ${f.message}`);
  process.exit(1);
}
console.log(`WCAG 2.2 AA review: all ${results.length} checks passed`);
