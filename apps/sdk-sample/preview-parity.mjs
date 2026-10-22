// Tale Studio story 7.9 (epic Tale Studio R10, AD-16): the studio preview is pixel for pixel the
// viewer a visitor sees. A tale with text, an image, a shape, an emoji and a button is drawn twice
// at 390 x 844: by the built SDK in the sample page's viewer, and by the SDK's preview entry point
// (`@taleart/web-sdk/preview`, the code Tale Studio mounts), fed the studio's draft of the same
// document. The two screenshots are compared pixel by pixel.
//
// Tolerance: a pixel differs when any channel differs by more than 2 (the R16 baseline rule in
// a11y-review.mjs); at most 0.1 % of the 390 x 844 pixels (329) may differ, for antialiasing that
// can vary between two pages. Both progress bars are frozen at the same point, so the chrome is
// compared too. The Delivery API and media are stubbed, as in a11y-review.mjs.
//
// Also checked: the preview's links have no destination, and a change shows in the preview at once.
// Run through `nx run sdk-sample:preview-parity`, which builds the SDK first. `--shots <dir>` saves
// the screenshots.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { freePort, startSample } from './a11y-shared.mjs';

const { values: args } = parseArgs({ options: { shots: { type: 'string' } } });
const shotsDir = args.shots ? resolve(args.shots) : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const root = resolve(import.meta.dirname, '../..');
const API = 'http://taleart-api.test';
const PREVIEW_PAGE = 'http://studio-preview.test/';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' };
const SITE_KEY = 'tas_parity';
const VIEWPORT = { width: 390, height: 844 };
const MAX_DIFFERING = Math.floor(VIEWPORT.width * VIEWPORT.height * 0.001);
const FROZEN_AT_MS = 1500;

const THEME = {
  ringStyle: 'gradient',
  ringColors: ['#f58529', '#dd2a7b', '#8134af'],
  seenRingColor: '#c7c7c7',
  ringWidth: 2,
  cornerRadius: null,
  fontFamily: null,
  titleColor: null,
  backgroundColor: 'transparent',
  accentColor: '#ffffff',
};
const PICTURE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">' +
  '<rect width="160" height="90" fill="#16a34a"/><circle cx="80" cy="45" r="30" fill="#fde047"/></svg>';
const IMAGE_KEY = 'media/0b7c9d4e-1111-4222-8333-944455556666.png';
const mediaUrl = (key) => `${API}/media/${key}`;

// The studio's draft: what Tale Studio holds, with media keys, a hidden layer and editor fields.
const box = (x, y, w, h) => ({ x, y, w, h, rotation: 0 });
const draft = (headline) => ({
  version: 1,
  canvas: { background: { type: 'color', color: '#1e3a8a' } },
  durationMs: 7000,
  elements: [
    { id: 'img', type: 'image', box: box(0.08, 0.14, 0.84, 0.3), a11y: { label: 'A sunny field' }, hidden: false, locked: false, props: { mediaKey: IMAGE_KEY, fit: 'cover', radius: 0.02 } },
    { id: 'shp', type: 'shape', box: box(0.1, 0.47, 0.8, 0.12), a11y: { decorative: true }, hidden: false, locked: true, props: { shape: 'rectangle', fill: '#f97316', radius: 0.02 } },
    { id: 'txt', type: 'text', box: box(0.12, 0.48, 0.76, 0.1), a11y: {}, hidden: false, locked: false, props: { text: headline, size: 0.04, weight: 'bold', color: '#ffffff', align: 'center' } },
    { id: 'emo', type: 'emoji', box: box(0.4, 0.62, 0.2, 0.1), a11y: {}, hidden: false, locked: false, props: { emoji: '🎉' } },
    { id: 'btn', type: 'button', box: box(0.2, 0.76, 0.6, 0.07), a11y: {}, hidden: false, locked: false, props: { label: 'Shop now', variant: 'filled', color: '#111827', fill: '#ffffff', radius: 0.02, href: 'https://example.com/shop' } },
    { id: 'off', type: 'text', box: box(0.1, 0.9, 0.8, 0.05), a11y: {}, hidden: true, locked: false, props: { text: 'A hidden layer' } },
  ],
});

// The same document as the Delivery API sends it once published: URLs for keys, no hidden layer or editor fields.
function delivered(doc) {
  return {
    ...doc,
    elements: doc.elements
      .filter((e) => !e.hidden)
      .map((element) => {
        const e = { ...element };
        delete e.hidden;
        delete e.locked;
        if (!e.props.mediaKey) return e;
        const { mediaKey, ...props } = e.props;
        return { ...e, props: { ...props, url: mediaUrl(mediaKey) } };
      }),
  };
}

const TALE = { id: '00000000-0000-4000-8000-000000000079', title: 'Summer sale' };
const GROUP = { id: '00000000-0000-4000-8000-000000000790', name: 'Summer' };
const zone = {
  id: '00000000-0000-4000-8000-000000000791',
  name: 'Home',
  slug: 'home-top',
  theme: THEME,
  frame: { id: 'f1', type: 'bar', settings: {} },
  taleGroups: [{ ...GROUP, cover: null, tales: [{ ...TALE, media: null, document: delivered(draft('Summer sale')) }] }],
};

const results = [];
function check(ok, message) {
  results.push({ ok: !!ok, message });
  console.log(`${ok ? 'ok' : 'NOT OK'} - ${message}`);
}

// The preview entry point, bundled from source as the dashboard bundles it.
const outDir = mkdtempSync(join(tmpdir(), 'taleart-preview-'));
await build({
  entryPoints: [resolve(root, 'libs/web-sdk/src/preview.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: join(outDir, 'preview.js'),
  tsconfig: resolve(root, 'libs/web-sdk/tsconfig.lib.json'),
  logLevel: 'error',
});
const previewJs = readFileSync(join(outDir, 'preview.js'));
rmSync(outDir, { recursive: true, force: true });

async function routeMedia(page) {
  await page.route(`${API}/media/**`, (route) =>
    route.fulfill({ body: PICTURE, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
}

// In a page: freezes the progress bar of the viewer in `root` at the same point, and pauses it there.
const FREEZE = ([selector, at]) => {
  const host = document.querySelector(selector);
  const fill = host.shadowRoot.querySelector('dialog .fill');
  for (const animation of fill.getAnimations()) {
    animation.pause();
    animation.currentTime = at;
  }
};

// Counts the pixels that differ (by more than 2 in any channel) between two PNG screenshots
// (the R16 baseline helper of a11y-review.mjs).
const differing = (page, a, b) =>
  page.evaluate(
    async ([a, b]) => {
      const load = async (base64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.length !== y.length) return Infinity;
      let count = 0;
      for (let i = 0; i < x.length; i += 4) {
        if (Math.max(...[0, 1, 2].map((c) => Math.abs(x[i + c] - y[i + c]))) > 2) count++;
      }
      return count;
    },
    [a.toString('base64'), b.toString('base64')],
  );

const port = await freePort();
const server = await startSample(port);
const browser = await chromium.launch();
let failed = false;
try {
  // 1. The sample page's viewer, as a visitor sees the published tale.
  const sample = await browser.newPage({ viewport: VIEWPORT });
  const sampleErrors = [];
  sample.on('pageerror', (err) => sampleErrors.push(String(err)));
  await sample.route(
    (url) => url.href.startsWith(`${API}/delivery/v1/zone?`),
    (route) => route.fulfill({ json: zone, headers: CORS }),
  );
  await routeMedia(sample);
  await sample.goto(`http://localhost:${port}/?zones=${zone.slug}&api=${encodeURIComponent(API)}#siteKey=${SITE_KEY}`);
  await sample.locator('taleart-view button.item').first().click();
  await sample.locator('taleart-view dialog.viewer[open] .ta-canvas img').waitFor();
  await sample.mouse.move(0, 0);
  await sample.evaluate(FREEZE, ['taleart-view', FROZEN_AT_MS]);
  await sample.evaluate(() => document.fonts.ready);
  await sample.waitForTimeout(300);
  const viewerPng = await sample.screenshot();
  check(sampleErrors.length === 0, `the sample page has no errors (${sampleErrors.join('; ') || 'none'})`);

  // 2. The Tale Studio preview of the draft, mounted by the preview entry point on a page of its own.
  const studio = await browser.newPage({ viewport: VIEWPORT });
  const studioErrors = [];
  studio.on('pageerror', (err) => studioErrors.push(String(err)));
  await routeMedia(studio);
  await studio.route(`${PREVIEW_PAGE}preview.js`, (route) =>
    route.fulfill({ body: previewJs, contentType: 'text/javascript' }),
  );
  // A dashboard-like page: its own font and smoothing, which must not reach the preview.
  await studio.route(PREVIEW_PAGE, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
        body { margin: 0; font: 15px/1.5 Georgia, serif; color: #333; letter-spacing: 0.05em; -webkit-font-smoothing: antialiased; }
        #host { width: ${VIEWPORT.width}px; height: ${VIEWPORT.height}px; }
      </style></head><body><div id="host"></div></body></html>`,
    }),
  );
  await studio.goto(PREVIEW_PAGE);
  await studio.evaluate(
    async ({ draft, tale, group, theme, api }) => {
      const { TalePreview, previewDocument } = await import('./preview.js');
      window.__draft = draft;
      window.__show = (doc) =>
        window.__preview.show({
          id: tale.id,
          title: tale.title,
          groupName: group.name,
          document: previewDocument(doc, (key) => `${api}/media/${key}`),
        });
      window.__preview = new TalePreview(document.getElementById('host'));
      window.__preview.setTheme(theme);
      window.__show(draft);
    },
    { draft: draft('Summer sale'), tale: TALE, group: GROUP, theme: THEME, api: API },
  );
  await studio.locator('#host dialog.viewer[open] .ta-canvas img').waitFor();
  await studio.evaluate(FREEZE, ['#host', FROZEN_AT_MS]);
  await studio.evaluate(() => document.fonts.ready);
  await studio.waitForTimeout(300);
  const previewPng = await studio.locator('#host').screenshot();
  check(studioErrors.length === 0, `the preview page has no errors (${studioErrors.join('; ') || 'none'})`);

  const scratch = await browser.newPage();
  const diff = await differing(scratch, viewerPng, previewPng);
  await scratch.close();
  check(
    diff <= MAX_DIFFERING,
    `the preview matches the sample page's viewer at ${VIEWPORT.width}x${VIEWPORT.height}: ${diff} pixels differ (at most ${MAX_DIFFERING})`,
  );

  const links = await studio.evaluate(() =>
    [...document.querySelector('#host').shadowRoot.querySelectorAll('a')].map((a) => ({
      href: a.getAttribute('href'),
      disabled: a.getAttribute('aria-disabled'),
    })),
  );
  check(
    links.length === 1 && links.every((l) => l.href === null && l.disabled === 'true'),
    `the preview's link has no destination (${JSON.stringify(links)})`,
  );
  const sampleLinks = await sample.evaluate(() =>
    [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('dialog a')].map((a) => a.getAttribute('href')),
  );
  check(sampleLinks[0] === 'https://example.com/shop', `the visitor's link is live (${sampleLinks.join(', ')})`);
  const before = await studio.url();
  await studio.locator('#host').getByRole('link', { name: 'Shop now' }).click({ force: true });
  await studio.waitForTimeout(200);
  check(studio.url() === before && studio.context().pages().length === 1, 'clicking the preview link goes nowhere');

  // 3. An unsaved change shows at once.
  await studio.evaluate(() => window.__show({ ...window.__draft, elements: window.__draft.elements.map((e) => (e.id === 'txt' ? { ...e, props: { ...e.props, text: 'Last day!' } } : e)) }));
  const shown = await studio.evaluate(() =>
    [...document.querySelector('#host').shadowRoot.querySelectorAll('.ta-glyphs')].map((n) => n.textContent),
  );
  check(shown.includes('Last day!') && !shown.includes('Summer sale'), `a change shows at once (${shown.join(', ')})`);

  if (shotsDir) {
    writeFileSync(resolve(shotsDir, 'parity-sample-viewer-390x844.png'), viewerPng);
    writeFileSync(resolve(shotsDir, 'parity-studio-preview-390x844.png'), previewPng);
  }
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  await browser.close();
  server.kill();
}

const notOk = results.filter((r) => !r.ok);
console.log(`\n${results.length - notOk.length} of ${results.length} checks passed.`);
if (failed || notOk.length) process.exit(1);
