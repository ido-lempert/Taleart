// Automated WCAG 2.2 AA scan of the Web SDK on the sample page (NFR-007): the bar, then the
// open full-screen viewer, with axe-core in headless Chromium. The Delivery API and media are
// stubbed, so no API, database or key is needed. Also drives the viewer by keyboard and checks
// that focus returns to the bar item and the viewed group shows the seen ring after a reload.
// Run through `nx run sdk-sample:a11y`, which builds the SDK first.
//
// axe-core is not a workspace dependency yet: a pinned build is fetched from cdnjs and checked
// against its SHA-384 before it is injected.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const AXE_SHA384 = '3NYxCdpLKVHfNs2FHPtg3qqaYuhq85m4mMnlHBlN0JzSpKYKct2PMGYfsKGaKIj4';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const API = 'http://taleart-api.test';

// A grey 9:16 SVG, served for every media URL.
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#6b7280"/></svg>';
const image = (id, title) => ({ id, title, media: { kind: 'image', contentType: 'image/svg+xml', url: `${API}/media/tales/${id}.svg` } });
const ZONE = {
  id: 'z1',
  name: 'Home',
  frames: [{ id: 'f1', type: 'bar', settings: {} }],
  taleGroups: [
    { id: 'ga', name: 'Summer sale', tales: [image('a1', 'Beach day'), image('a2', 'Sunset')] },
    { id: 'gb', name: 'New arrivals', tales: [image('b1', 'Jackets')] },
    { id: 'gc', name: 'Stories', tales: [image('c1', 'Behind the scenes')] },
  ],
};

async function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

async function loadAxe() {
  const res = await fetch(AXE_URL);
  if (!res.ok) throw new Error(`Could not fetch axe-core: ${res.status}`);
  const source = Buffer.from(await res.arrayBuffer());
  const hash = createHash('sha384').update(source).digest('base64');
  if (hash !== AXE_SHA384) throw new Error(`axe-core at ${AXE_URL} does not match its pinned SHA-384`);
  return source.toString('utf8');
}

async function startSample(port) {
  const child = spawn(process.execPath, [resolve(import.meta.dirname, 'serve.mjs')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((done, fail) => {
    child.once('exit', (code) => fail(new Error(`sample server exited with ${code}`)));
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('SDK sample at')) done();
    });
  });
  return child;
}

async function scan(page, label, axe) {
  await page.addScriptTag({ content: axe });
  const result = await page.evaluate(
    (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
    TAGS,
  );
  for (const v of result.violations) {
    console.error(`[${label}] ${v.id} (${v.impact}): ${v.help}`);
    for (const node of v.nodes) console.error(`    ${node.target.join(' ')} — ${node.failureSummary}`);
  }
  console.log(`[${label}] ${result.violations.length} violations, ${result.passes.length} rules passed`);
  return result.violations.length;
}

function check(ok, message) {
  if (!ok) throw new Error(`Check failed: ${message}`);
  console.log(`ok - ${message}`);
}

// The shadow DOM's focused element of <taleart-view>, described for checks.
const focused = (page) =>
  page.evaluate(() => {
    const active = document.querySelector('taleart-view')?.shadowRoot?.activeElement;
    return active ? { tag: active.tagName, group: active.dataset.taleGroupId ?? null, label: active.getAttribute('aria-label') } : null;
  });

const axe = await loadAxe();
const port = await freePort();
const server = await startSample(port);
const browser = await chromium.launch();
let violations = 0;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.route(`${API}/delivery/v1/zone`, (route) =>
    route.fulfill({ json: ZONE, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' } }),
  );
  await page.route(`${API}/media/**`, (route) =>
    route.fulfill({ body: SVG, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );

  await page.goto(`http://localhost:${port}/?key=tak_scan&api=${encodeURIComponent(API)}`);
  const items = page.locator('taleart-view button.item');
  await items.first().waitFor();
  violations += await scan(page, 'bar', axe);

  await items.first().click();
  const dialog = page.locator('taleart-view dialog.viewer');
  await dialog.waitFor();
  check((await dialog.getAttribute('aria-label')) === 'Summer sale', 'the viewer opens on the activated group');
  violations += await scan(page, 'viewer', axe);

  const position = page.locator('taleart-view dialog .sr-only');
  await page.keyboard.press('ArrowRight');
  check((await position.textContent()) === 'Summer sale, tale 2 of 2', 'ArrowRight steps to the next tale');
  await page.keyboard.press('ArrowLeft');
  check((await position.textContent()) === 'Summer sale, tale 1 of 2', 'ArrowLeft steps back');
  await page.keyboard.press(' ');
  check((await dialog.getAttribute('data-paused')) !== null, 'Space pauses');
  violations += await scan(page, 'viewer paused', axe);
  await page.keyboard.press(' ');
  check((await dialog.getAttribute('data-paused')) === null, 'Space resumes');
  await page.locator('taleart-view dialog .zone.next').click();
  check((await position.textContent()) === 'Summer sale, tale 2 of 2', 'a tap on the right steps forward');
  await page.locator('taleart-view dialog .zone.prev').click();
  check((await position.textContent()) === 'Summer sale, tale 1 of 2', 'a tap on the left steps back');

  const box = await page.locator('taleart-view dialog .stage').boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.8, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, y, { steps: 5 });
  await page.mouse.up();
  check((await dialog.getAttribute('aria-label')) === 'New arrivals', 'a swipe left moves to the next group');
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, y, { steps: 5 });
  await page.mouse.up();
  check((await dialog.getAttribute('aria-label')) === 'Summer sale', 'a swipe right moves back');

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  const after = await focused(page);
  check(after?.group === 'ga', 'Escape closes and focus returns to the bar item');

  await page.reload();
  await items.first().waitFor();
  check((await items.first().getAttribute('data-seen')) !== null, 'after a reload the viewed group shows the seen ring');
  check((await items.nth(2).getAttribute('data-seen')) === null, 'an unviewed group does not');
  violations += await scan(page, 'bar with seen ring', axe);
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
} finally {
  await browser.close();
  server.kill();
}

if (violations > 0) {
  console.error(`WCAG 2.2 AA scan: ${violations} violations`);
  process.exit(1);
}
console.log('WCAG 2.2 AA scan: no violations');
