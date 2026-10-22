// Automated WCAG 2.2 AA scan of the Web SDK on the sample page (NFR-007): the bar, then the
// open full-screen viewer, with axe-core in headless Chromium. The Delivery API and media are
// stubbed, so no API, database or key is needed. Also drives the viewer by keyboard and checks
// that focus returns to the bar item and the viewed group shows the seen ring after a reload.
// Then the banner frame of the same zone: rotating and stopped, its controls, swipe, opening the
// viewer from a slide, and, in a context that prefers reduced motion, no autoplay (3:1, no dots).
// Then a project theme (R9): a solid ring in one colour, corner radius 0 and a serif font reach
// the bar, the banner, the seen ring and the viewer; then the zone's SDK theme override wins over it.
// Last, stages: two <taleart-view stage> elements show their own frames, and an unknown stage
// key renders nothing and logs a warning.
// Then playbooks (R8): a zone shaped like each applied MVP playbook renders its preset frame by stage key.
// Run through `nx run sdk-sample:a11y`, which builds the SDK first.
// The deeper accessibility review (keyboard walk, zoom, forced colours, RTL…) is a11y-review.mjs.
import { chromium } from 'playwright';
import { axeViolations, freePort, loadAxe, startSample } from './a11y-shared.mjs';

const API = 'http://taleart-api.test';

// A grey 9:16 SVG, served for every media URL.
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#6b7280"/></svg>';
const image = (id, title) => ({ id, title, media: { kind: 'image', contentType: 'image/svg+xml', url: `${API}/media/tales/${id}.svg` } });
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
      tales: [
        image('a1', 'Beach day'),
        {
          ...image('a2', 'Sunset'),
          // A tale document (AD-15): a text element in the upper third, and right-to-left text with emoji below.
          document: {
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
          },
        },
      ],
    },
    { id: 'gb', name: 'New arrivals', cover: null, tales: [image('b1', 'Jackets')] },
    { id: 'gc', name: 'Stories', cover: null, tales: [image('c1', 'Behind the scenes')] },
  ],
};

async function scan(page, label, axe) {
  return (await axeViolations(page, label, axe)).length;
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
  // With the default theme the frames keep the look before themes: the host page's text colour and font, no background.
  const looks = await page.evaluate(() => {
    const root = document.querySelector('taleart-view').shadowRoot;
    const title = getComputedStyle(root.querySelector('.title'));
    const body = getComputedStyle(document.body);
    return {
      color: title.color === body.color,
      font: title.fontFamily === body.fontFamily,
      background: getComputedStyle(root.querySelector('.bar')).backgroundColor,
      bannerRadius: getComputedStyle(root.querySelector('.b-viewport')).borderTopLeftRadius,
    };
  });
  check(looks.color && looks.font, "by default bar titles take the host page's text colour and font");
  check(looks.background === 'rgba(0, 0, 0, 0)', 'by default the bar background is transparent');
  check(looks.bannerRadius === '12px', 'by default the banner keeps its 12 px radius');

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
  // Tale 2 has a tale document (AD-15, AD-16): its text over the media, as live, selectable text.
  const textEl = page.locator('taleart-view dialog p.ta-text').first();
  const glyphs = textEl.locator('.ta-glyphs');
  check((await textEl.textContent()) === '<b>Hello</b>', 'the text element shows its text literally, as a text node');
  check(
    (await page.locator('taleart-view dialog p.ta-text').nth(1).textContent()) === 'שלום \u2067עולם\u2069 👩‍👩‍👧‍👦',
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
      // The media is framed as for a tale without a document: full-bleed in the stage.
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

  // Playbooks (R8): a zone shaped as the API leaves it after each MVP playbook is applied, its
  // preset frame and a stage per frame (libs/contract/src/lib/playbooks.ts), next to a frame the
  // zone already had. The page names the playbook's stage key and gets exactly the preset frame.
  const PLAYBOOK_ZONES = {
    'home-stories-bar': {
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
  for (const [stageKey, { frame }] of Object.entries(PLAYBOOK_ZONES)) {
    const playbookContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const played = await playbookContext.newPage();
    const playedErrors = [];
    played.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') playedErrors.push(msg.text());
    });
    played.on('pageerror', (err) => playedErrors.push(String(err)));
    await played.route(`${API}/delivery/v1/zone`, (route) =>
      route.fulfill({
        json: {
          ...ZONE,
          frames: [{ id: 'own', type: 'bar', settings: { shape: 'rounded-square', gap: 20 } }, frame],
          stages: [{ key: stageKey, frameId: frame.id }],
        },
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' },
      }),
    );
    await played.route(`${API}/media/**`, (route) =>
      route.fulfill({ body: SVG, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } }),
    );
    await played.goto(`http://localhost:${port}/?key=tak_scan&api=${encodeURIComponent(API)}&stages=${stageKey}`);
    const view = `taleart-view[stage="${stageKey}"]`;
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
        'the "Home page stories bar" stage shows only its preset bar: circle, start, gap 12',
      );
      check(look.titles !== 'hidden' && look.titlesShown === 3, 'the preset bar shows each group’s title');
    } else {
      check(
        look.banners === 1 && look.bars === 0 && look.ratio === '3:1' && look.dots === 3,
        'the "Promo banner" stage shows only its preset banner: 3:1 with dots',
      );
    }
    check(playedErrors.length === 0, `no console errors or warnings for the ${stageKey} stage${playedErrors.length ? `: ${playedErrors.join('; ')}` : ''}`);
    violations += await scan(played, `${stageKey} playbook stage`, axe);
    await playbookContext.close();
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
  check((await css(themedItems.nth(1).locator('.title'), 'font-family')).replace(/^"/, '').startsWith('Georgia'), 'the bar title takes the serif font');
  const themedBanner = themed.locator('taleart-view section.banner');
  check((await css(themedBanner.locator('.b-viewport'), 'border-top-left-radius')) === '0px', 'the banner takes corner radius 0');
  check((await css(themedBanner, 'font-family')).replace(/^"/, '').startsWith('Georgia'), 'the banner takes the serif font');
  await themedItems.first().click();
  const themedDialog = themed.locator('taleart-view dialog.viewer');
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

  // The zone's SDK theme override (R9): a red project ring, overridden in blue for the zone in the
  // sample page's configuration, on a bar stage and a banner stage; an invalid ringWidth is ignored
  // with a warning; without the override the project's values return.
  const overrideContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const overridden = await overrideContext.newPage();
  const overrideWarnings = [];
  const overrideErrors = [];
  overridden.on('console', (msg) => {
    if (msg.type() === 'warning') overrideWarnings.push(msg.text());
    if (msg.type() === 'error') overrideErrors.push(msg.text());
  });
  overridden.on('pageerror', (err) => overrideErrors.push(String(err)));
  await overridden.route(`${API}/delivery/v1/zone`, (route) =>
    route.fulfill({
      json: {
        ...ZONE,
        theme: { ...DEFAULT_THEME, ringStyle: 'solid', ringColors: ['#ff0000'], ringWidth: 3, cornerRadius: 16 },
        frames: [
          { id: 'f1', type: 'bar', settings: {} },
          { id: 'f2', type: 'banner', settings: { autoplay: false } },
        ],
        stages: [
          { key: 'top', frameId: 'f1' },
          { key: 'hero', frameId: 'f2' },
        ],
      },
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' },
    }),
  );
  await overridden.route(`${API}/media/**`, (route) =>
    route.fulfill({ body: SVG, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  const sdkTheme = encodeURIComponent(JSON.stringify({ ringColors: ['#0000ff'], cornerRadius: 0, ringWidth: 9 }));
  const stagedUrl = `http://localhost:${port}/?key=tak_scan&api=${encodeURIComponent(API)}&stages=top,hero`;
  const overrideLooks = async () => {
    const bar = overridden.locator('taleart-view[stage="top"] .bar');
    const banner = overridden.locator('taleart-view[stage="hero"] section.banner');
    await bar.waitFor();
    await banner.waitFor();
    return {
      ring: await css(bar.locator('button.item .ring').first(), 'background-color'),
      width: (await css(bar, '--ta-ring-width')).trim(),
      bannerRing: (await css(banner, '--ta-ring')).trim(),
      bannerRadius: await css(banner.locator('.b-viewport'), 'border-top-left-radius'),
    };
  };
  await overridden.goto(`${stagedUrl}&theme=${sdkTheme}`);
  const withOverride = await overrideLooks();
  check(withOverride.ring === 'rgb(0, 0, 255)', "the zone's SDK ring colour wins over the project's in the bar stage");
  check(withOverride.bannerRing === '#0000ff', 'the banner stage takes the zone override too');
  check(withOverride.bannerRadius === '0px', "the banner stage takes the zone's SDK corner radius");
  check(withOverride.width === '3px', "an invalid SDK ringWidth is ignored and the project's width applies");
  check(
    overrideWarnings.length === 1 && overrideWarnings[0].includes('"ringWidth"'),
    'the invalid SDK ringWidth logs one warning naming the field',
  );
  violations += await scan(overridden, 'SDK theme override', axe);
  await overridden.goto(stagedUrl);
  const withoutOverride = await overrideLooks();
  check(withoutOverride.ring === 'rgb(255, 0, 0)', "without the SDK value the project's ring colour returns");
  check(withoutOverride.bannerRadius === '16px', "without the SDK value the project's corner radius returns");
  check(overrideErrors.length === 0, `no console errors with an override${overrideErrors.length ? `: ${overrideErrors.join('; ')}` : ''}`);
  await overrideContext.close();
} finally {
  await browser.close();
  server.kill();
}

if (violations > 0) {
  console.error(`WCAG 2.2 AA scan: ${violations} violations`);
  process.exit(1);
}
console.log('WCAG 2.2 AA scan: no violations');
