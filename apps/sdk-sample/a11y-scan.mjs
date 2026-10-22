// Automated WCAG 2.2 AA scan of the Web SDK on the sample page (NFR-007): the bar, then the
// open full-screen viewer, with axe-core in headless Chromium. The Delivery API and media are
// stubbed, so no API, database or key is needed. Also drives the viewer by keyboard and checks
// that focus returns to the bar item and the viewed group shows the seen ring after a reload.
// A zone has one display (AD-17): the page places a second zone, whose display is a banner, below
// the bar zone (`?zones=…#siteKey=…`), each named by its slug. The banner: rotating and stopped, its controls, swipe,
// opening the viewer from a slide, and, in a context that prefers reduced motion, no autoplay (3:1, no dots).
// Then two zones with two bars, each with its own shape and its own named items, and an unknown slug
// that renders nothing and logs one error.
// Then templates (epic UX rework R5): a zone created from each template with a display renders its preset.
// Then one site key with zones named by slug (epic UX rework R3): two zones, an unknown slug, and a
// theme override for one slug only.
// Then a project theme (R9): a solid ring in one colour, corner radius 0 and a serif font reach
// the bar, the banner, the seen ring and the viewer; then the zones' SDK theme override wins over it.
// Then a composed tale (Tale Studio story 7.10): read in visual order by a screen reader and by Tab,
// every node named or hidden, rows in the tale's direction (a Hebrew tale from the right, an English
// one from the left even on a right-to-left page), a GIF still
// under reduced motion. A11Y_SHOTS, when set, is a folder for a screenshot of it.
// Run through `nx run sdk-sample:a11y`, which builds the SDK first.
// The deeper accessibility review (keyboard walk, zoom, forced colours, RTL…) is a11y-review.mjs.
import { chromium } from 'playwright';
import { axeViolations, freePort, loadAxe, mediaTale, startSample } from './a11y-shared.mjs';

const API = 'http://taleart-api.test';

// A grey 9:16 SVG, served for every media URL.
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#6b7280"/></svg>';
// Each tale as the Delivery API sends it since Tale Studio R16: its media is its document's media element.
const media = (id) => ({ kind: 'image', contentType: 'image/svg+xml', url: `${API}/media/tales/${id}.svg` });
const image = (id, title, document) => mediaTale(id, title, media(id), document);
// TaleArt's default theme, as the Delivery API sends it for a project with none (DEFAULT_THEME):
// the host page's title colour and font, the frame's radius, a transparent background.
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
const ZONE = {
  id: 'z1',
  name: 'Home',
  slug: 'home-top',
  theme: DEFAULT_THEME,
  frame: { id: 'f1', type: 'bar', settings: {} },
  taleGroups: [
    // A group with its own cover (R12), and two that fall back to their first tale's image.
    {
      id: 'ga',
      name: 'Summer sale',
      cover: { kind: 'image', contentType: 'image/svg+xml', animated: false, url: `${API}/media/covers/ga.svg` },
      tales: [
        image('a1', 'Beach day'),
        // A tale document (AD-15): a text element in the upper third, and right-to-left text with emoji below.
        image('a2', 'Sunset', {
          version: 1,
          // A canvas colour (Tale Studio story 2): it fills the stage behind the tale's media.
          canvas: { background: { type: 'color', color: '#1f3a5f' } },
          elements: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              type: 'text',
              box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
              a11y: {},
              props: { text: '<b>Hello</b>' },
            },
            {
              id: '00000000-0000-4000-8000-000000000002',
              type: 'text',
              box: { x: 0.1, y: 0.62, w: 0.8, h: 0.1, rotation: 0 },
              a11y: {},
              props: { text: 'שלום \u2067עולם\u2069 👩‍👩‍👧‍👦' },
            },
            // A decorative shape and an emoji named by its Unicode name (Tale Studio story 7.6).
            {
              id: '00000000-0000-4000-8000-000000000003',
              type: 'shape',
              box: { x: 0.1, y: 0.78, w: 0.8, h: 0.04, rotation: 0 },
              a11y: { decorative: true },
              props: { shape: 'rectangle', fill: '#ffcc00', radius: 0.02 },
            },
            {
              id: '00000000-0000-4000-8000-000000000004',
              type: 'emoji',
              box: { x: 0.375, y: 0.43, w: 0.25, h: 0.140625, rotation: 0 },
              a11y: { label: 'sun' },
              props: { emoji: '☀️' },
            },
          ],
        }),
      ],
    },
    { id: 'gb', name: 'New arrivals', cover: null, tales: [image('b1', 'Jackets')] },
    { id: 'gc', name: 'Stories', cover: null, tales: [image('c1', 'Behind the scenes')] },
  ],
};

// The same zone's groups shown by a second zone whose display is a banner (AD-17).
const bannerZone = (settings) => ({ ...ZONE, id: 'z2', name: 'Home promo', slug: 'home-promo', frame: { id: 'f2', type: 'banner', settings } });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' };

// The project's site key the scan's pages place their zones with (epic UX rework R3).
const SITE_KEY = 'tas_scan';

// Serves the Delivery API by site key and slug: each slug in `zones` reads its zone with SITE_KEY;
// any other slug or key is refused, as the API refuses it.
async function serve(page, zones) {
  await page.route(
    (url) => url.href.startsWith(`${API}/delivery/v1/zone?`),
    (route) => {
      const slug = new URL(route.request().url()).searchParams.get('zone') ?? '';
      const key = (route.request().headers()['authorization'] ?? '').replace(/^Bearer\s+/i, '');
      return key === SITE_KEY && Object.hasOwn(zones, slug)
        ? route.fulfill({ json: zones[slug], headers: CORS })
        : route.fulfill({
            status: 401,
            json: { error: { code: 'invalid_site_key', message: 'A valid site key and zone are required' } },
            headers: CORS,
          });
    },
  );
  await page.route(`${API}/media/**`, (route) =>
    route.fulfill({ body: SVG, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
}

// The sample page placing one element per slug, the site key in the fragment; `extra` joins the query.
const pageUrl = (port, slugs, extra = '') =>
  `http://localhost:${port}/?zones=${slugs.join(',')}&api=${encodeURIComponent(API)}${extra}#siteKey=${SITE_KEY}`;

async function scan(page, label, axe) {
  return (await axeViolations(page, label, axe)).length;
}

function check(ok, message) {
  if (!ok) throw new Error(`Check failed: ${message}`);
  console.log(`ok - ${message}`);
}

// The focused element in the shadow DOM of the page's `index`th <taleart-view>, described for checks.
const focused = (page, index = 0) =>
  page.evaluate((i) => {
    const active = document.querySelectorAll('taleart-view')[i]?.shadowRoot?.activeElement;
    return active ? { tag: active.tagName, group: active.dataset.taleGroupId ?? null, label: active.getAttribute('aria-label') } : null;
  }, index);

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
  await serve(page, { bar: ZONE, banner: bannerZone({ intervalSeconds: 3 }) });

  await page.goto(pageUrl(port, ['bar', 'banner']));
  // The bar zone's element, then the banner zone's.
  const barView = page.locator('taleart-view').nth(0);
  const bannerView = page.locator('taleart-view').nth(1);
  // A tall page, so a wheel that reached it would scroll it.
  await page.addStyleTag({ content: 'body { min-height: 300vh; }' });
  const items = barView.locator('button.item');
  await items.first().waitFor();
  violations += await scan(page, 'bar', axe);
  // With the default theme the frames keep the look before themes: the host page's text colour and font, no background.
  const looks = await page.evaluate(() => {
    const root = document.querySelector('taleart-view').shadowRoot;
    const title = getComputedStyle(root.querySelector('.title'));
    const body = getComputedStyle(document.body);
    return {
      color: title.color === body.color,
      font: title.fontFamily === body.fontFamily,
      background: getComputedStyle(root.querySelector('.bar')).backgroundColor,
      bannerRadius: getComputedStyle(document.querySelectorAll('taleart-view')[1].shadowRoot.querySelector('.b-viewport'))
        .borderTopLeftRadius,
    };
  });
  check(looks.color && looks.font, "by default bar titles take the host page's text colour and font");
  check(looks.background === 'rgba(0, 0, 0, 0)', 'by default the bar background is transparent');
  check(looks.bannerRadius === '12px', 'by default the banner keeps its 12 px radius');

  await items.first().click();
  const dialog = barView.locator('dialog.viewer');
  await dialog.waitFor();
  // Paused first, so no check below races the automatic advance.
  await page.keyboard.press(' ');
  check((await dialog.getAttribute('data-paused')) !== null, 'Space pauses');
  check((await dialog.getAttribute('aria-label')) === 'Summer sale', 'the viewer opens on the activated group');
  const position = barView.locator('dialog .sr-only');
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
  // Tale 2 has a tale document (AD-15, AD-16): its text over the media, as live, selectable text.
  const textEl = barView.locator('dialog p.ta-text').first();
  const glyphs = textEl.locator('.ta-glyphs');
  check((await textEl.textContent()) === '<b>Hello</b>', 'the text element shows its text literally, as a text node');
  check(
    (await barView.locator('dialog p.ta-text').nth(1).textContent()) === 'שלום \u2067עולם\u2069 👩‍👩‍👧‍👦',
    'right-to-left text with isolates and an emoji ZWJ sequence renders as written',
  );
  const placed = await page.evaluate(() => {
    const root = document.querySelector('taleart-view').shadowRoot;
    const p = root.querySelector('dialog p.ta-text');
    const canvas = root.querySelector('dialog .ta-canvas').getBoundingClientRect();
    const box = p.getBoundingClientRect();
    return {
      // Only the renderer's own line and glyph spans (story 7.4), never markup from the text.
      markup: p.querySelector(':not(.ta-line, .ta-glyphs)') !== null,
      upperThird: box.top >= canvas.top && box.bottom <= canvas.top + canvas.height / 3,
      ratio: canvas.width / canvas.height,
      // The tale's media (its document's media element, R16) is framed as always: full-bleed in the stage.
      over: root.querySelector('dialog .stage > img.media') !== null && !root.querySelector('dialog .ta-canvas img'),
      background: getComputedStyle(root.querySelector('dialog .stage')).backgroundColor,
    };
  });
  check(placed.background === 'rgb(31, 58, 95)', "the document's background colour fills the stage behind the media");
  check(!placed.markup && placed.upperThird, 'the text sits in the upper third of the 9:16 canvas, with no markup');
  check(
    Math.abs(placed.ratio - 9 / 16) < 0.01 && placed.over,
    "the canvas is 9:16 with the tale's media under the text",
  );
  const extras = await page.evaluate(() => {
    const root = document.querySelector('taleart-view').shadowRoot;
    const emoji = root.querySelector('dialog .ta-emoji');
    return {
      emoji: emoji && [emoji.getAttribute('role'), emoji.getAttribute('aria-label'), emoji.textContent],
      shape: root.querySelector('dialog .ta-shape')?.getAttribute('aria-hidden') ?? null,
    };
  });
  check(
    extras.emoji?.join() === 'img,sun,☀️' && extras.shape === 'true',
    'an emoji is text named by its label, and a decorative shape is hidden from assistive technology',
  );
  violations += await scan(page, 'viewer with a text element', axe);
  await glyphs.click({ clickCount: 3 });
  check(
    (await page.evaluate(() => String(getSelection()))).includes('<b>Hello</b>'),
    'the text can be selected with the mouse',
  );
  await at('Summer sale, tale 2 of 2', 'clicking the text does not step');
  // The empty part of the text's box lets the tap through: on the left third, it steps back.
  const textBox = await textEl.boundingBox();
  await page.mouse.click(textBox.x + 4, textBox.y + textBox.height / 2);
  await at('Summer sale, tale 1 of 2', "a tap on the empty part of a text's box steps the tale");
  await page.keyboard.press('ArrowRight');
  await at('Summer sale, tale 2 of 2', 'ArrowRight returns to the tale with text');
  await page.keyboard.press('ArrowLeft');
  await at('Summer sale, tale 1 of 2', 'ArrowLeft steps back');
  await page.keyboard.press('Alt+ArrowRight');
  await at('Summer sale, tale 1 of 2', 'Alt+ArrowRight is left to the browser');
  await barView.locator('dialog .zone.next').click();
  await at('Summer sale, tale 2 of 2', 'a tap on the right steps forward');
  await barView.locator('dialog .zone.prev').click();
  await at('Summer sale, tale 1 of 2', 'a tap on the left steps back');
  check((await dialog.getAttribute('data-paused')) !== null, 'stepping keeps the viewer paused');

  const box = await barView.locator('dialog .stage').boundingBox();
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

  // The banner (R3): the display of the second zone, below the bar zone.
  const banner = bannerView.locator('section.banner');
  const slideShown = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('taleart-view')[1].shadowRoot.querySelectorAll('.b-dot')].findIndex(
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
  const bannerDialog = bannerView.locator('dialog.viewer');
  await bannerDialog.waitFor();
  check((await bannerDialog.getAttribute('aria-label')) === 'New arrivals', 'activating a slide opens the viewer at its group');
  await page.keyboard.press('Escape');
  await bannerDialog.waitFor({ state: 'hidden' });
  const back = await focused(page, 1);
  check(back?.group === 'gb' && back?.tag === 'BUTTON' && back?.label === 'New arrivals', 'closing returns focus to the banner slide');
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join('; ')}` : ''}`);

  // With reduced motion and the story's settings (3:1, 3 s, no dots): no autoplay.
  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const still = await reduced.newPage();
  const settings = { aspectRatio: '3:1', autoplay: true, intervalSeconds: 3, showDots: false, loop: true };
  await serve(still, { bar: ZONE, banner: bannerZone(settings) });
  await still.goto(pageUrl(port, ['bar', 'banner']));
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
  await serve(narrow, { banner: bannerZone({ aspectRatio: '3:1', intervalSeconds: 3 }) });
  await narrow.goto(pageUrl(port, ['banner']));
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

  // Two zones on one page (AD-17), each a bar with its own shape and its own tale groups, so every
  // control has its own name; a third element with an unknown slug renders nothing and logs one error.
  const twoZones = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const placed2 = await twoZones.newPage();
  const placedErrors = [];
  const placedWarnings = [];
  placed2.on('console', (msg) => {
    if (msg.type() === 'error') placedErrors.push(msg.text());
    if (msg.type() === 'warning') placedWarnings.push(msg.text());
  });
  placed2.on('pageerror', (err) => placedErrors.push(String(err)));
  const roundZone = { ...ZONE, frame: { id: 'f1', type: 'bar', settings: { shape: 'circle' } } };
  const squareZone = {
    ...ZONE,
    id: 'z3',
    name: 'Shop',
    slug: 'shop',
    frame: { id: 'f3', type: 'bar', settings: { shape: 'rounded-square' } },
    taleGroups: [
      { id: 'gd', name: 'Gifts', cover: null, tales: [image('d1', 'Wrapped')] },
      { id: 'ge', name: 'Sale', cover: null, tales: [image('e1', 'Half price')] },
    ],
  };
  await serve(placed2, { round: roundZone, square: squareZone });
  await placed2.goto(pageUrl(port, ['round', 'square', 'nope']));
  const views = placed2.locator('taleart-view');
  await views.nth(0).locator('.bar').waitFor();
  await views.nth(1).locator('.bar').waitFor();
  // The third element's response may land last; its error ends the loads.
  for (let i = 0; i < 40 && !placedErrors.some((e) => e.includes('TaleArt')); i++) await placed2.waitForTimeout(50);
  const shapes = await placed2.evaluate(() =>
    [...document.querySelectorAll('taleart-view')].map((view) => ({
      bars: [...view.shadowRoot.querySelectorAll('.bar')].map((bar) => bar.dataset.shape),
      labels: [...view.shadowRoot.querySelectorAll('button.item')].map((b) => b.getAttribute('aria-label')),
      nodes: view.shadowRoot.childNodes.length,
    })),
  );
  check(
    JSON.stringify(shapes.map((s) => s.bars)) === JSON.stringify([['circle'], ['rounded-square'], []]),
    'two zones on one page each show their own display',
  );
  const allLabels = shapes.flatMap((s) => s.labels);
  check(new Set(allLabels).size === allLabels.length && allLabels.length === 5, 'every bar item on the page has its own name');
  check(shapes[2].nodes === 0, 'an unknown slug renders nothing');
  // The browser itself also reports the refused request (401) on the console.
  const sdkErrors = placedErrors.filter((e) => !e.startsWith('Failed to load resource'));
  check(sdkErrors.length === 1 && sdkErrors[0].includes('TaleArt'), `an unknown slug logs one error${sdkErrors.length === 1 ? '' : `: ${placedErrors.join('; ')}`}`);
  check(placedWarnings.length === 0, 'no warnings with two zones');
  await views.nth(1).locator('button.item').first().click();
  const placedDialog = views.nth(1).locator('dialog.viewer');
  await placedDialog.waitFor();
  check((await placedDialog.getAttribute('aria-label')) === 'Gifts', "the second zone's item opens its own group");
  await placed2.keyboard.press('Escape');
  await placedDialog.waitFor({ state: 'hidden' });
  check((await focused(placed2, 1))?.group === 'gd', "closing the viewer returns focus to the second zone's bar item");
  violations += await scan(placed2, 'two zones and an unknown slug', axe);
  await twoZones.close();

  // Templates (epic UX rework R5): a zone shaped as the API creates it from each template with a
  // display: its display is the template's preset (libs/contract/src/lib/templates.ts).
  const TEMPLATE_ZONES = {
    'stories-bar': {
      frame: {
        id: 'p1',
        type: 'bar',
        settings: { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 },
      },
    },
    'promo-banner': {
      frame: {
        id: 'p2',
        type: 'banner',
        settings: { aspectRatio: '3:1', autoplay: true, intervalSeconds: 5, showDots: true, loop: true },
      },
    },
  };
  for (const [templateKey, { frame }] of Object.entries(TEMPLATE_ZONES)) {
    const templateContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const played = await templateContext.newPage();
    const playedErrors = [];
    played.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') playedErrors.push(msg.text());
    });
    played.on('pageerror', (err) => playedErrors.push(String(err)));
    await serve(played, { scan: { ...ZONE, slug: templateKey, frame } });
    await played.goto(pageUrl(port, ['scan']));
    const view = 'taleart-view';
    await played.locator(`${view} ${frame.type === 'bar' ? '.bar' : 'section.banner'}`).waitFor();
    const look = await played.evaluate((selector) => {
      const root = document.querySelector(selector).shadowRoot;
      const bar = root.querySelector('.bar');
      const banner = root.querySelector('section.banner');
      return {
        bars: root.querySelectorAll('.bar').length,
        banners: root.querySelectorAll('section.banner').length,
        shape: bar?.dataset.shape ?? null,
        align: bar?.dataset.align ?? null,
        titles: bar ? (bar.dataset.titles ?? 'shown') : null,
        gap: bar ? getComputedStyle(bar).columnGap : null,
        titlesShown: bar ? [...root.querySelectorAll('.title')].filter((t) => getComputedStyle(t).display !== 'none').length : 0,
        ratio: banner?.dataset.ratio ?? null,
        dots: root.querySelectorAll('.b-dot').length,
      };
    }, view);
    if (frame.type === 'bar') {
      check(
        look.bars === 1 && look.banners === 0 && look.shape === 'circle' && look.align === 'start' && look.gap === '12px',
        'a zone from "Stories bar" shows its preset bar: circle, start, gap 12',
      );
      check(look.titles !== 'hidden' && look.titlesShown === 3, 'the preset bar shows each group’s title');
    } else {
      check(
        look.banners === 1 && look.bars === 0 && look.ratio === '3:1' && look.dots === 3,
        'a zone from "Promo banner" shows its preset banner: 3:1 with dots',
      );
    }
    check(playedErrors.length === 0, `no console errors or warnings for the ${templateKey} zone${playedErrors.length ? `: ${playedErrors.join('; ')}` : ''}`);
    violations += await scan(played, `${templateKey} template zone`, axe);
    await templateContext.close();
  }

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
  await serve(themed, {
    bar: { ...ZONE, theme: THEME, frame: { id: 'f1', type: 'bar', settings: { shape: 'rounded-square' } } },
    banner: { ...bannerZone({ autoplay: false }), theme: THEME },
  });
  await themed.goto(pageUrl(port, ['bar', 'banner']));
  const themedItems = themed.locator('taleart-view').nth(0).locator('button.item');
  await themedItems.first().waitFor();
  const css = (locator, prop) => locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  const unseenRing = themedItems.nth(1).locator('.ring');
  check((await css(unseenRing, 'background-color')) === 'rgb(0, 85, 255)', 'the solid ring takes the theme colour');
  check((await css(unseenRing, 'border-top-left-radius')) === '0px', 'a rounded-square item takes corner radius 0');
  check((await css(themedItems.nth(1).locator('.title'), 'font-family')).replace(/^"/, '').startsWith('Georgia'), 'the bar title takes the serif font');
  const themedBanner = themed.locator('taleart-view section.banner');
  check((await css(themedBanner.locator('.b-viewport'), 'border-top-left-radius')) === '0px', 'the banner takes corner radius 0');
  check((await css(themedBanner, 'font-family')).replace(/^"/, '').startsWith('Georgia'), 'the banner takes the serif font');
  await themedItems.first().click();
  const themedDialog = themed.locator('taleart-view').nth(0).locator('dialog.viewer');
  await themedDialog.waitFor();
  await themed.keyboard.press(' ');
  check((await css(themedDialog, 'font-family')).replace(/^"/, '').startsWith('Georgia'), 'the viewer takes the serif font');
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

  // One site key for the project, zones named by slug (epic UX rework R3): the sample page's
  // `?zones=a,b,c#siteKey=…` places one element per slug, the key in the fragment. Each shows its
  // own display, an unknown slug renders nothing and logs one error, and a theme override for one
  // slug changes only that zone.
  const siteContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sitePage = await siteContext.newPage();
  const siteErrors = [];
  sitePage.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) siteErrors.push(msg.text());
  });
  sitePage.on('pageerror', (err) => siteErrors.push(String(err)));
  const siteTheme = { ...DEFAULT_THEME, ringStyle: 'solid', ringColors: ['#ff0000'], ringWidth: 3 };
  const bySlug = {
    'home-top': { ...ZONE, slug: 'home-top', theme: siteTheme },
    'home-promo': { ...bannerZone({ autoplay: false }), theme: siteTheme },
  };
  const siteRequests = [];
  await sitePage.route(
    (url) => url.href.startsWith(`${API}/delivery/v1/zone?`),
    (route) => {
      const url = new URL(route.request().url());
      const slug = url.searchParams.get('zone') ?? '';
      const key = (route.request().headers()['authorization'] ?? '').replace(/^Bearer\s+/i, '');
      siteRequests.push(slug);
      return key === 'tas_site' && bySlug[slug]
        ? route.fulfill({ json: bySlug[slug], headers: CORS })
        : route.fulfill({
            status: 401,
            json: { error: { code: 'invalid_site_key', message: 'A valid site key and zone are required' } },
            headers: CORS,
          });
    },
  );
  await sitePage.route(`${API}/media/**`, (route) =>
    route.fulfill({ body: SVG, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  const siteTop = encodeURIComponent(JSON.stringify({ ringColors: ['#0000ff'] }));
  await sitePage.goto(
    `http://localhost:${port}/?zones=home-top,home-promo,nope&api=${encodeURIComponent(API)}&theme=${siteTop}&themeZone=home-top#siteKey=tas_site`,
  );
  const siteViews = sitePage.locator('taleart-view');
  await siteViews.nth(0).locator('.bar').waitFor();
  await siteViews.nth(1).locator('section.banner').waitFor();
  for (let i = 0; i < 40 && siteErrors.length === 0; i++) await sitePage.waitForTimeout(50);
  const siteLooks = await sitePage.evaluate(() =>
    [...document.querySelectorAll('taleart-view')].map((view) => ({
      bar: !!view.shadowRoot.querySelector('.bar'),
      banner: !!view.shadowRoot.querySelector('section.banner'),
      nodes: view.shadowRoot.childNodes.length,
      ring: view.shadowRoot.querySelector('.taleart')?.style.getPropertyValue('--ta-ring') ?? null,
    })),
  );
  check(siteLooks[0].bar && !siteLooks[0].banner, 'a site key and the slug home-top show that zone\'s bar');
  check(siteLooks[1].banner && !siteLooks[1].bar, 'the same site key and the slug home-promo show that zone\'s banner');
  check(siteLooks[2].nodes === 0, 'an unknown slug renders nothing');
  check(siteErrors.length === 1 && siteErrors[0].includes('TaleArt'), `an unknown slug logs one error${siteErrors.length === 1 ? '' : `: ${siteErrors.join('; ')}`}`);
  check(siteLooks[0].ring === '#0000ff' && siteLooks[1].ring === '#ff0000', 'a theme override for one slug changes only that zone');
  check(new Set(siteRequests).size === siteRequests.length, 'one request per zone');
  violations += await scan(sitePage, 'site key with two zones and an unknown slug', axe);
  // The zone key form of earlier builds places nothing and says so in one line (story 8.7).
  await sitePage.goto(`http://localhost:${port}/?api=${encodeURIComponent(API)}#key=tak_old`);
  const oldNotice = (await sitePage.locator('#old-key-notice').textContent()) ?? '';
  check(oldNotice.includes('Zone keys are no longer supported'), 'a page with only the old key says zone keys are gone');
  check(
    (await sitePage.evaluate(() => document.querySelector('taleart-view')?.shadowRoot?.childNodes.length ?? 0)) === 0,
    'a page with only the old key places nothing',
  );
  await siteContext.close();

  // The zones' SDK theme override (R9): a red project ring, overridden in blue for each zone in the
  // sample page's configuration, on a bar zone and a banner zone; an invalid ringWidth is ignored
  // with one warning per zone; without the override the project's values return.
  const overrideContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const overridden = await overrideContext.newPage();
  const overrideWarnings = [];
  const overrideErrors = [];
  overridden.on('console', (msg) => {
    if (msg.type() === 'warning') overrideWarnings.push(msg.text());
    if (msg.type() === 'error') overrideErrors.push(msg.text());
  });
  overridden.on('pageerror', (err) => overrideErrors.push(String(err)));
  const projectTheme = { ...DEFAULT_THEME, ringStyle: 'solid', ringColors: ['#ff0000'], ringWidth: 3, cornerRadius: 16 };
  await serve(overridden, {
    top: { ...ZONE, theme: projectTheme },
    hero: { ...bannerZone({ autoplay: false }), theme: projectTheme },
  });
  const sdkTheme = encodeURIComponent(JSON.stringify({ ringColors: ['#0000ff'], cornerRadius: 0, ringWidth: 9 }));
  const twoZoneUrl = (extra = '') => pageUrl(port, ['top', 'hero'], extra);
  const overrideLooks = async () => {
    const bar = overridden.locator('taleart-view').nth(0).locator('.bar');
    const banner = overridden.locator('taleart-view').nth(1).locator('section.banner');
    await bar.waitFor();
    await banner.waitFor();
    return {
      ring: await css(bar.locator('button.item .ring').first(), 'background-color'),
      width: (await css(bar, '--ta-ring-width')).trim(),
      bannerRing: (await css(banner, '--ta-ring')).trim(),
      bannerRadius: await css(banner.locator('.b-viewport'), 'border-top-left-radius'),
    };
  };
  await overridden.goto(twoZoneUrl(`&theme=${sdkTheme}`));
  const withOverride = await overrideLooks();
  check(withOverride.ring === 'rgb(0, 0, 255)', "the zone's SDK ring colour wins over the project's in the bar zone");
  check(withOverride.bannerRing === '#0000ff', "the banner zone takes its zone's override too");
  check(withOverride.bannerRadius === '0px', "the banner zone takes its zone's SDK corner radius");
  check(withOverride.width === '3px', "an invalid SDK ringWidth is ignored and the project's width applies");
  check(
    overrideWarnings.length === 2 && overrideWarnings.every((w) => w.includes('"ringWidth"')),
    'the invalid SDK ringWidth logs one warning per configured zone, naming the field',
  );
  violations += await scan(overridden, 'SDK theme override', axe);
  await overridden.goto(twoZoneUrl());
  const withoutOverride = await overrideLooks();
  check(withoutOverride.ring === 'rgb(255, 0, 0)', "without the SDK value the project's ring colour returns");
  check(withoutOverride.bannerRadius === '16px', "without the SDK value the project's corner radius returns");
  check(overrideErrors.length === 0, `no console errors with an override${overrideErrors.length ? `: ${overrideErrors.join('; ')}` : ''}`);
  await overrideContext.close();

  // A composed tale (Tale Studio story 7.10, R12): a title and an emoji in one row, an image with
  // alt text beside a text placed a little higher (still one row), a decorative backdrop, a button,
  // and a swipe-up link stored at the top. A screen reader reads it, and Tab reaches its links, in
  // visual order (AD-15); every node is named or hidden; axe finds nothing. On a right-to-left page
  // each row reads from the right; under reduced motion its GIF is drawn still.
  const el = (n, type, box, props, a11y = {}) => ({
    id: `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`,
    type,
    box: { x: box[0], y: box[1], w: box[2], h: box[3], rotation: 0 },
    a11y,
    props,
  });
  const composedTale = {
    id: 'k1',
    title: 'Autumn edit',
    media: null,
    document: {
      version: 1,
      durationMs: 7000,
      canvas: { background: { type: 'color', color: '#1f3a5f' } },
      elements: [
        el(1, 'shape', [0, 0.3, 1, 0.4], { shape: 'rectangle', fill: '#0b1d33' }, { decorative: true }),
        el(2, 'button', [0.25, 0.76, 0.5, 0.07], {
          label: 'Shop now',
          variant: 'filled',
          color: '#111827',
          fill: '#ffffff',
          href: 'https://example.com/shop',
        }),
        el(3, 'image', [0.06, 0.41, 0.4, 0.25], { url: `${API}/media/look.gif`, fit: 'cover' }, { label: 'A red coat' }),
        el(4, 'text', [0.52, 0.4, 0.42, 0.1], { text: 'New season', size: 0.04 }),
        el(5, 'text', [0.08, 0.14, 0.6, 0.08], { text: 'Autumn', size: 0.05 }),
        el(6, 'emoji', [0.78, 0.14, 0.12, 0.07], { emoji: '🍂' }, { label: 'Falling leaf' }),
        el(7, 'swipe-up', [0.2, 0.0, 0.6, 0.09], {
          label: 'See more',
          color: '#ffffff',
          background: '#000000b3',
          href: 'https://example.com/more',
        }),
      ],
    },
  };
  const composedZone = {
    ...ZONE,
    id: 'z7',
    slug: 'composed',
    taleGroups: [{ id: 'gk', name: 'Autumn', cover: null, tales: [composedTale] }],
  };
  const VISUAL_ORDER = ['Autumn', 'Falling leaf', 'A red coat', 'New season', 'Shop now', 'See more'];
  // The same tale in Hebrew: its rows read from the right (the tale's direction, from its texts).
  const RTL_ORDER = ['Falling leaf', 'סתיו', 'עונה חדשה', 'A red coat', 'Shop now', 'See more'];
  const hebrewZone = {
    ...composedZone,
    taleGroups: [
      {
        id: 'gk',
        name: 'Autumn',
        cover: null,
        tales: [
          {
            ...composedTale,
            document: {
              ...composedTale.document,
              elements: composedTale.document.elements.map((e) =>
                e.type !== 'text' ? e : { ...e, props: { ...e.props, text: e.props.text === 'Autumn' ? 'סתיו' : 'עונה חדשה' } },
              ),
            },
          },
        ],
      },
    ],
  };
  // What a screen reader meets in the open tale's canvas, in order: the accessible names of the
  // accessibility tree (Playwright's ARIA snapshot), hidden nodes left out.
  const readOut = async (host) => {
    const snapshot = await host.locator('dialog .ta-canvas').ariaSnapshot();
    return snapshot
      .split('\n')
      .map((line) => line.match(/^\s*- (?:img|link|paragraph|text)(?: "([^"]*)")?:?\s*(.*)$/))
      .filter(Boolean)
      .map((m) => (m[1] || m[2] || '').replace(/^"|"$/g, '').trim())
      .filter((name) => name !== '' && !name.startsWith('/'));
  };
  const openComposed = async (contextOptions, rightToLeft = false, zone = composedZone) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...contextOptions });
    const view = await context.newPage();
    const errors = [];
    view.on('pageerror', (err) => errors.push(String(err)));
    view.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    await serve(view, { composed: zone });
    await view.goto(pageUrl(port, ['composed']));
    const host = view.locator('taleart-view');
    await host.locator('button.item').first().waitFor();
    if (rightToLeft) await view.evaluate(() => (document.documentElement.dir = 'rtl'));
    await host.locator('button.item').first().click();
    await host.locator('dialog .ta-canvas a').first().waitFor();
    // Paused, so nothing below races the end of the tale.
    await view.keyboard.press(' ');
    return { context, view, host, errors };
  };

  const composed = await openComposed({});
  const order = await readOut(composed.host);
  check(
    JSON.stringify(order) === JSON.stringify(VISUAL_ORDER),
    `a screen reader reads the composed tale's text, alt text and button in visual order (${order.join(' / ')})`,
  );
  const composedNames = await composed.view.evaluate(() =>
    [...document.querySelector('taleart-view').shadowRoot.querySelectorAll('dialog .ta-canvas > .ta-el')].map((node) => ({
      hidden: node.getAttribute('aria-hidden') === 'true',
      name: node instanceof HTMLImageElement ? node.alt : (node.getAttribute('aria-label') ?? node.textContent.trim()),
    })),
  );
  check(composedNames.length === 7 && composedNames.every((n) => n.hidden || n.name !== ''), 'every node of the composed tale is named or hidden');
  // From the tale's first link, Tab reaches the next in visual order.
  await composed.host.locator('dialog .ta-canvas a').first().focus();
  const tabbed = [];
  for (let i = 0; i < 2; i++) {
    tabbed.push(
      await composed.view.evaluate(() => document.querySelector('taleart-view').shadowRoot.activeElement?.textContent ?? ''),
    );
    await composed.view.keyboard.press('Tab');
  }
  check(tabbed.join() === 'Shop now,See more', `Tab reaches the tale's links in visual order (${tabbed.join(', ')})`);
  if (process.env.A11Y_SHOTS) await composed.view.screenshot({ path: `${process.env.A11Y_SHOTS}/sample-composed-tale.png` });
  violations += await scan(composed.view, 'composed tale', axe);
  check(composed.errors.length === 0, `no console errors with the composed tale${composed.errors.length ? `: ${composed.errors.join('; ')}` : ''}`);
  await composed.context.close();

  // The reading direction is the tale's, never the page's (AD-15 amended).
  const rtlPage = await openComposed({}, true);
  const onRtlPage = await readOut(rtlPage.host);
  check(
    JSON.stringify(onRtlPage) === JSON.stringify(VISUAL_ORDER),
    `on a right-to-left page an English tale still reads left to right (${onRtlPage.join(' / ')})`,
  );
  violations += await scan(rtlPage.view, 'composed tale, right-to-left page', axe);
  await rtlPage.context.close();
  const rtl = await openComposed({}, false, hebrewZone);
  const rtlRead = await readOut(rtl.host);
  check(
    JSON.stringify(rtlRead) === JSON.stringify(RTL_ORDER),
    `a Hebrew tale reads each row from the right (${rtlRead.join(' / ')})`,
  );
  violations += await scan(rtl.view, 'Hebrew composed tale', axe);
  await rtl.context.close();

  const stillTale = await openComposed({ reducedMotion: 'reduce' });
  const gif = await stillTale.view.evaluate(() => {
    const node = document
      .querySelector('taleart-view')
      .shadowRoot.querySelector('dialog .ta-canvas [aria-label="A red coat"]');
    return node ? [node.tagName, node.getAttribute('role')] : null;
  });
  check(gif?.join() === 'CANVAS,img', 'under reduced motion the GIF is drawn still and keeps its alt text');
  violations += await scan(stillTale.view, 'composed tale, reduced motion', axe);
  await stillTale.context.close();
} finally {
  await browser.close();
  server.kill();
}

if (violations > 0) {
  console.error(`WCAG 2.2 AA scan: ${violations} violations`);
  process.exit(1);
}
console.log('WCAG 2.2 AA scan: no violations');
