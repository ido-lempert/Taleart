// Automated WCAG 2.2 AA scan of the Web SDK on the sample page (NFR-007): the bar, then the
// open full-screen viewer, with axe-core in headless Chromium. The Delivery API and media are
// stubbed, so no API, database or key is needed. Also drives the viewer by keyboard and checks
// that focus returns to the bar item and the viewed group shows the seen ring after a reload.
// Then the banner frame of the same zone: rotating and stopped, its controls, swipe, opening the
// viewer from a slide, and, in a context that prefers reduced motion, no autoplay (3:1, no dots).
// Then a project theme (R9): a solid ring in one colour, corner radius 0 and a serif font reach
// the bar, the banner, the seen ring and the viewer.
// Last, stages: two <taleart-view stage> elements show their own frames, and an unknown stage
// key renders nothing and logs a warning.
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
// TaleArt's default theme, as the Delivery API sends it for a project with none (DEFAULT_THEME).
const DEFAULT_THEME = {
  ringStyle: 'gradient',
  ringColors: ['#ea580c', '#db2777', '#7c3aed'],
  seenRingColor: '#6b7280',
  ringWidth: 2,
  cornerRadius: 12,
  fontFamily: 'system-ui, sans-serif',
  titleColor: '#111827',
  backgroundColor: '#ffffff',
  accentColor: '#ffffff',
};
const ZONE = {
  id: 'z1',
  name: 'Home',
  theme: DEFAULT_THEME,
  frames: [
    { id: 'f1', type: 'bar', settings: {} },
    { id: 'f2', type: 'banner', settings: { intervalSeconds: 3 } },
  ],
  stages: [],
  taleGroups: [
    // A group with its own cover (R12), and two that fall back to their first tale's image.
    {
      id: 'ga',
      name: 'Summer sale',
      cover: { kind: 'image', contentType: 'image/svg+xml', animated: false, url: `${API}/media/covers/ga.svg` },
      tales: [image('a1', 'Beach day'), image('a2', 'Sunset')],
    },
    { id: 'gb', name: 'New arrivals', cover: null, tales: [image('b1', 'Jackets')] },
    { id: 'gc', name: 'Stories', cover: null, tales: [image('c1', 'Behind the scenes')] },
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
  // A tall page, so a wheel that reached it would scroll it.
  await page.addStyleTag({ content: 'body { min-height: 300vh; }' });
  const items = page.locator('taleart-view button.item');
  await items.first().waitFor();
  violations += await scan(page, 'bar', axe);

  await items.first().click();
  const dialog = page.locator('taleart-view dialog.viewer');
  await dialog.waitFor();
  // Paused first, so no check below races the automatic advance.
  await page.keyboard.press(' ');
  check((await dialog.getAttribute('data-paused')) !== null, 'Space pauses');
  check((await dialog.getAttribute('aria-label')) === 'Summer sale', 'the viewer opens on the activated group');
  const position = page.locator('taleart-view dialog .sr-only');
  const at = async (text, message) => {
    // The live region is filled a task after each change.
    await page.waitForFunction(
      (t) => document.querySelector('taleart-view')?.shadowRoot?.querySelector('dialog .sr-only')?.textContent === t,
      text,
      { timeout: 2000 },
    ).catch(() => undefined);
    check((await position.textContent()) === text, message);
  };
  await at('Summer sale, tale 1 of 2', 'the live region announces the group and tale');
  violations += await scan(page, 'viewer paused', axe);

  await page.keyboard.press('ArrowRight');
  await at('Summer sale, tale 2 of 2', 'ArrowRight steps to the next tale');
  await page.keyboard.press('ArrowLeft');
  await at('Summer sale, tale 1 of 2', 'ArrowLeft steps back');
  await page.keyboard.press('Alt+ArrowRight');
  await at('Summer sale, tale 1 of 2', 'Alt+ArrowRight is left to the browser');
  await page.locator('taleart-view dialog .zone.next').click();
  await at('Summer sale, tale 2 of 2', 'a tap on the right steps forward');
  await page.locator('taleart-view dialog .zone.prev').click();
  await at('Summer sale, tale 1 of 2', 'a tap on the left steps back');
  check((await dialog.getAttribute('data-paused')) !== null, 'stepping keeps the viewer paused');

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

  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  check((await page.evaluate(() => scrollY)) === 0, 'a wheel over the open viewer does not scroll the page');

  await page.keyboard.press(' ');
  check((await dialog.getAttribute('data-paused')) === null, 'Space resumes');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  const after = await focused(page);
  check(after?.group === 'ga', 'Escape closes and focus returns to the bar item');
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(() => scrollY > 0, null, { timeout: 2000 }).catch(() => undefined);
  check((await page.evaluate(() => scrollY)) > 0, 'with the viewer closed the same wheel scrolls the page');

  await page.reload();
  await items.first().waitFor();
  check((await items.first().getAttribute('data-seen')) !== null, 'after a reload the viewed group shows the seen ring');
  check((await items.nth(2).getAttribute('data-seen')) === null, 'an unviewed group does not');
  violations += await scan(page, 'bar with seen ring', axe);

  // The banner frame (R3) of the same zone, below the bar.
  const banner = page.locator('taleart-view section.banner');
  const slideShown = () =>
    page.evaluate(() =>
      [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('.b-dot')].findIndex(
        (dot) => dot.getAttribute('aria-current') === 'true',
      ),
    );
  check((await page.locator('taleart-view .b-open').count()) === 3, 'the banner shows one slide per group');
  // Away from the banner, so a hovering mouse does not pause it.
  await page.mouse.move(1, 1);
  check((await slideShown()) === 0, 'the banner starts on the first slide');
  await page.waitForTimeout(3400);
  check((await slideShown()) === 1, 'the banner autoplays after its 3 s interval');
  violations += await scan(page, 'bar and rotating banner', axe);

  await banner.getByRole('button', { name: 'Show New arrivals' }).click();
  check((await slideShown()) === 1, 'a dot shows its slide');
  await banner.locator('.b-next').click();
  check((await slideShown()) === 2, 'Next slide moves the banner');
  await page.waitForTimeout(3400);
  check((await slideShown()) === 2, 'interacting with the banner stops autoplay');
  const viewportBox = await banner.locator('.b-viewport').boundingBox();
  const by = viewportBox.y + viewportBox.height / 2;
  await page.mouse.move(viewportBox.x + viewportBox.width * 0.3, by);
  await page.mouse.down();
  await page.mouse.move(viewportBox.x + viewportBox.width * 0.8, by, { steps: 5 });
  await page.mouse.up();
  check((await slideShown()) === 1, 'a swipe right on the banner moves back');
  check((await dialog.isVisible()) === false, 'a swipe does not open the viewer');
  violations += await scan(page, 'banner stopped', axe);

  await banner.locator('.b-slide:not([inert]) .b-open').click();
  await dialog.waitFor();
  check((await dialog.getAttribute('aria-label')) === 'New arrivals', 'activating a slide opens the viewer at its group');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  const back = await focused(page);
  check(back?.group === 'gb' && back?.tag === 'BUTTON' && back?.label === 'New arrivals', 'closing returns focus to the banner slide');
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join('; ')}` : ''}`);

  // With reduced motion and the story's settings (3:1, 3 s, no dots): no autoplay.
  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const still = await reduced.newPage();
  const settings = { aspectRatio: '3:1', autoplay: true, intervalSeconds: 3, showDots: false, loop: true };
  await still.route(`${API}/delivery/v1/zone`, (route) =>
    route.fulfill({
      json: { ...ZONE, frames: [ZONE.frames[0], { id: 'f2', type: 'banner', settings }] },
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' },
    }),
  );
  await still.route(`${API}/media/**`, (route) =>
    route.fulfill({ body: SVG, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  await still.goto(`http://localhost:${port}/?key=tak_scan&api=${encodeURIComponent(API)}`);
  const stillBanner = still.locator('taleart-view section.banner');
  await stillBanner.waitFor();
  const ratioBox = await stillBanner.locator('.b-viewport').boundingBox();
  check(Math.abs(ratioBox.width / ratioBox.height - 3) < 0.05, 'the banner follows its 3:1 aspect ratio');
  check((await stillBanner.locator('.b-dots').count()) === 0, 'the banner follows showDots: false');
  check(await stillBanner.locator('.b-rotate').isHidden(), 'with reduced motion there is no rotation button');
  const transform = () => stillBanner.locator('.b-track').evaluate((track) => track.style.transform);
  await still.waitForTimeout(3400);
  check((await transform()) === 'translateX(0%)', 'with reduced motion the banner does not autoplay');
  violations += await scan(still, 'banner with reduced motion', axe);
  await reduced.close();

  // A 3:1 banner on a 390 px phone with autoplay: no control overlaps another, targets are 44 px.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const narrow = await phone.newPage();
  await narrow.route(`${API}/delivery/v1/zone`, (route) =>
    route.fulfill({
      json: { ...ZONE, frames: [{ id: 'f2', type: 'banner', settings: { aspectRatio: '3:1', intervalSeconds: 3 } }] },
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' },
    }),
  );
  await narrow.route(`${API}/media/**`, (route) =>
    route.fulfill({ body: SVG, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  await narrow.goto(`http://localhost:${port}/?key=tak_scan&api=${encodeURIComponent(API)}`);
  const narrowBanner = narrow.locator('taleart-view section.banner');
  await narrowBanner.waitFor();
  const boxes = {
    rotate: await narrowBanner.locator('.b-rotate').boundingBox(),
    prev: await narrowBanner.locator('.b-prev').boundingBox(),
    next: await narrowBanner.locator('.b-next').boundingBox(),
    dots: await narrowBanner.locator('.b-dots').boundingBox(),
  };
  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const names = Object.keys(boxes);
  const clashes = names.flatMap((a, i) => names.slice(i + 1).filter((b) => overlap(boxes[a], boxes[b])).map((b) => `${a}/${b}`));
  check(clashes.length === 0, `no banner controls overlap at 390 px on 3:1${clashes.length ? `: ${clashes.join(', ')}` : ''}`);
  check(
    ['rotate', 'prev', 'next'].every((k) => boxes[k].width >= 44 && boxes[k].height >= 44),
    'banner buttons are at least 44 px',
  );
  violations += await scan(narrow, 'phone 3:1 banner', axe);
  await phone.close();

  // Stages (R7): two bar frames of one zone, circle and rounded-square, each placed by its own
  // <taleart-view stage>; an unknown stage key renders nothing and logs a warning.
  const staging = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const staged = await staging.newPage();
  const stagedErrors = [];
  const warnings = [];
  staged.on('console', (msg) => {
    if (msg.type() === 'error') stagedErrors.push(msg.text());
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  staged.on('pageerror', (err) => stagedErrors.push(String(err)));
  await staged.route(`${API}/delivery/v1/zone`, (route) =>
    route.fulfill({
      json: {
        ...ZONE,
        frames: [
          { id: 'f1', type: 'bar', settings: { shape: 'circle' } },
          { id: 'f2', type: 'banner', settings: {} },
          { id: 'f3', type: 'bar', settings: { shape: 'rounded-square' } },
        ],
        stages: [
          { key: 'round', frameId: 'f1' },
          { key: 'square', frameId: 'f3' },
        ],
      },
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' },
    }),
  );
  await staged.route(`${API}/media/**`, (route) =>
    route.fulfill({ body: SVG, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  await staged.goto(`http://localhost:${port}/?key=tak_scan&api=${encodeURIComponent(API)}&stages=round,square,nope`);
  await staged.locator('taleart-view[stage="square"] .bar').waitFor();
  await staged.locator('taleart-view[stage="round"] .bar').waitFor();
  // The third element's response may land last; its warning ends the loads.
  for (let i = 0; i < 40 && warnings.length === 0; i++) await staged.waitForTimeout(50);
  const shapes = await staged.evaluate(() =>
    [...document.querySelectorAll('taleart-view')].map((view) => ({
      stage: view.getAttribute('stage'),
      bars: [...view.shadowRoot.querySelectorAll('.bar')].map((bar) => bar.dataset.shape),
      banners: view.shadowRoot.querySelectorAll('section.banner').length,
      nodes: view.shadowRoot.childNodes.length,
    })),
  );
  check(
    JSON.stringify(shapes.map((s) => [s.stage, s.bars])) === JSON.stringify([['round', ['circle']], ['square', ['rounded-square']], ['nope', []]]),
    'two elements naming two stages each show their own bar shape',
  );
  check(shapes.every((s) => s.banners === 0), 'a staged element does not render the zone’s other frames');
  check(shapes[2].nodes === 0, 'an unknown stage key renders nothing');
  check(warnings.length === 1 && warnings[0].includes('"nope"'), 'an unknown stage key logs one warning');
  check(stagedErrors.length === 0, `no console errors with stages${stagedErrors.length ? `: ${stagedErrors.join('; ')}` : ''}`);
  await staged.locator('taleart-view[stage="square"] button.item').first().click();
  const stagedDialog = staged.locator('taleart-view[stage="square"] dialog.viewer');
  await stagedDialog.waitFor();
  await staged.keyboard.press('Escape');
  await stagedDialog.waitFor({ state: 'hidden' });
  const stagedFocus = await staged.evaluate(
    () => document.querySelector('taleart-view[stage="square"]').shadowRoot.activeElement?.dataset.taleGroupId ?? null,
  );
  check(stagedFocus === 'ga', 'closing the viewer returns focus to the staged bar item');
  violations += await scan(staged, 'two stages and an unknown stage', axe);
  await staging.close();

  // The project's theme (R9), as the dashboard saves it: every frame and the viewer follow.
  const themedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const themed = await themedContext.newPage();
  const THEME = {
    ...DEFAULT_THEME,
    ringStyle: 'solid',
    ringColors: ['#0055ff'],
    seenRingColor: '#4b5563',
    cornerRadius: 0,
    fontFamily: 'Georgia, serif',
    accentColor: '#ffcc00',
  };
  await themed.route(`${API}/delivery/v1/zone`, (route) =>
    route.fulfill({
      json: {
        ...ZONE,
        theme: THEME,
        frames: [
          { id: 'f1', type: 'bar', settings: { shape: 'rounded-square' } },
          { id: 'f2', type: 'banner', settings: { autoplay: false } },
        ],
      },
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' },
    }),
  );
  await themed.route(`${API}/media/**`, (route) =>
    route.fulfill({ body: SVG, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  await themed.goto(`http://localhost:${port}/?key=tak_scan&api=${encodeURIComponent(API)}`);
  const themedItems = themed.locator('taleart-view button.item');
  await themedItems.first().waitFor();
  const css = (locator, prop) => locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  const unseenRing = themedItems.nth(1).locator('.ring');
  check((await css(unseenRing, 'background-color')) === 'rgb(0, 85, 255)', 'the solid ring takes the theme colour');
  check((await css(unseenRing, 'border-top-left-radius')) === '0px', 'a rounded-square item takes corner radius 0');
  check((await css(themedItems.nth(1).locator('.title'), 'font-family')).startsWith('Georgia'), 'the bar title takes the serif font');
  const themedBanner = themed.locator('taleart-view section.banner');
  check((await css(themedBanner.locator('.b-viewport'), 'border-top-left-radius')) === '0px', 'the banner takes corner radius 0');
  check((await css(themedBanner, 'font-family')).startsWith('Georgia'), 'the banner takes the serif font');
  await themedItems.first().click();
  const themedDialog = themed.locator('taleart-view dialog.viewer');
  await themedDialog.waitFor();
  await themed.keyboard.press(' ');
  check((await css(themedDialog, 'font-family')).startsWith('Georgia'), 'the viewer takes the serif font');
  check(
    (await css(themedDialog.locator('.fill').first(), 'background-color')) === 'rgb(255, 204, 0)',
    'the viewer progress takes the accent',
  );
  check((await css(themedDialog.locator('.control.close'), 'color')) === 'rgb(255, 204, 0)', 'the viewer buttons take the accent');
  violations += await scan(themed, 'themed viewer', axe);
  await themed.keyboard.press('Escape');
  await themed.reload();
  await themedItems.first().waitFor();
  check(
    (await css(themedItems.first().locator('.ring'), 'background-color')) === 'rgb(75, 85, 99)',
    'after a reload the seen ring takes the theme colour',
  );
  violations += await scan(themed, 'themed bar and banner', axe);
  await themedContext.close();
} finally {
  await browser.close();
  server.kill();
}

if (violations > 0) {
  console.error(`WCAG 2.2 AA scan: ${violations} violations`);
  process.exit(1);
}
console.log('WCAG 2.2 AA scan: no violations');
