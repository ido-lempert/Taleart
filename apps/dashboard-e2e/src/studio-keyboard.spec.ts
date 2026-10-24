import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { drawPngs } from './media';
import { emptyInstall, signIn } from './session';
import { onTop, scan, settle, type ScanOptions } from './wcag';

/**
 * Tale Studio's accessibility review (epic Tale Studio R12 and R13, story 7.15), run with
 * `nx run dashboard-e2e:a11y` after the dashboard scan (`a11y.spec.ts`).
 *
 * 1. Keyboard operability: a tale is composed with the keyboard only. Every control is reached with
 *    Tab or Shift+Tab, or with the arrow keys inside a grid or a menu; nothing is clicked or focused
 *    by script, and every control reached is checked to be on screen and on top (2.4.11): text, an
 *    image from the project's media, a rectangle, an emoji from the picker and a button, each named
 *    and announced (the live region's exact words); selecting from the layers grid; moving with
 *    the arrow keys (Shift for larger steps); resizing and rotating through the numeric fields;
 *    editing a text in place while it lies under a picture; reordering, hiding and locking with the
 *    layer shortcuts; the layer menu by Shift+F10 and the context-menu key; undo and redo; Update
 *    tale; the preview pane, its replay and the tale's link.
 * 2. The WCAG 2.2 AA scan of `wcag.ts` (axe plus 2.4.7, 2.4.11, 2.5.8, and 1.4.10 and 1.4.12 once
 *    per screen) of each studio state on the way: empty, the media and emoji pickers, the composed
 *    tale with each kind selected, the shortcuts panel, the layer menu, the duplicate drawer, the
 *    preview, a phone width.
 * 3. The web-zones dashboard screens 3.12 left to this story that 8.17 did not scan: the project
 *    list, theme, fonts and import pages, and a group's Rename, Cover, Audience and Schedule drawers.
 *
 * It signs in with a session written to the database and empties the install at the end.
 * E2E_SCREENSHOTS and E2E_A11Y_REPORT work as in `a11y.spec.ts` (the report goes to
 * `<name>-studio.json`).
 */

const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });
const API = '/api/v1';
/** The scanned states, all named in the review (`a11y-review-7-15.md`), and the palette search (story 11.3). */
const STATES = 23;

test.describe.serial('Tale Studio by keyboard, and its WCAG 2.2 AA scan (story 7.15) @a11y', () => {
  let context: BrowserContext;
  let page: Page;
  const results: Record<string, string[]> = {};
  const walked: Record<string, string[]> = {};
  /** Every keyboard check, in order, for the report: what was done and how many Tab presses it took. */
  const keyboard: string[] = [];
  let projectId = '';
  let zoneId = '';
  let taleId = '';
  const ids = { text: '', image: '', shape: '', emoji: '', button: '' };

  async function check(state: string, options: ScanOptions = {}): Promise<void> {
    await settle(page);
    const prefix = `studio-${String(Object.keys(results).length + 1).padStart(2, '0')}-${state}`;
    if (shots) await page.screenshot({ path: join(shots, `${prefix}.png`) });
    let found = 0;
    const evidence = async (label: string) => {
      if (shots)
        await page.screenshot({ path: join(shots, `${prefix}--${++found}-${label}.png`), animations: 'disabled' });
    };
    const stops: string[] = [];
    // From the top of the page, as a person arrives: a control scrolled under the sticky top bar is
    // not judged as covered by it (the walk checks what Tab brings into view).
    await page.evaluate(() => window.scrollTo(0, 0));
    results[state] = await scan(page, { maxStops: 90, ...options, stops, evidence });
    walked[state] = stops;
  }

  async function api<T>(method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, { method, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  /** True when `target` has focus, looking through shadow roots. */
  const focused = (target: Locator) =>
    target.evaluate((el) => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return active === el;
    });

  /** The focused control is on screen and at least partly the topmost thing there (2.4.11). */
  async function seen(target: Locator, what: string): Promise<void> {
    await expect(target, `${what} has focus`).toBeFocused();
    await settle(page);
    await expect(target, `${what} is on screen`).toBeInViewport();
    expect(await onTop(target), `${what}: on top when focused`).toBe(true);
  }

  /**
   * Presses Tab (or Shift+Tab) until `target` has focus, as a person would: it must be reachable,
   * and be seen once it has focus. Returns the number of presses; fails past `max`.
   */
  async function tabTo(target: Locator, what: string, { back = false, max = 120 } = {}): Promise<number> {
    await expect(target, `${what} is there`).toHaveCount(1);
    for (let n = 0; n <= max; n++) {
      if (await focused(target)) {
        await seen(target, what);
        keyboard.push(`${what}: reached with ${n} ${back ? 'Shift+Tab' : 'Tab'}`);
        return n;
      }
      await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    }
    throw new Error(`${what}: not reached with ${max} ${back ? 'Shift+Tab' : 'Tab'} presses`);
  }

  /** In an open menu, moves with ArrowDown to the item named `name`. */
  async function menuTo(name: string): Promise<void> {
    const item = page.getByRole('menuitem', { name, exact: true });
    for (let n = 0; n < 12 && !(await focused(item)); n++) await page.keyboard.press('ArrowDown');
    await expect(item).toBeFocused();
  }

  /**
   * Shows a tab of the left panel (Tale Studio 2): Tab to the tab rail (one tab stop), then the
   * arrows to the tab, which shows its panel.
   */
  async function openTab(name: string): Promise<void> {
    await tabTo(page.locator('[role=tab][tabindex="0"]'), 'the left panel tabs');
    const tab = page.getByRole('tab', { name, exact: true });
    for (let n = 0; n < 4 && !(await focused(tab)); n++) await page.keyboard.press('ArrowDown');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    keyboard.push(`left panel: the ${name} tab by the arrow keys`);
  }

  /** Selects the layer `id` alone from the layers grid: Tab to the grid, Ctrl+Home, Down to its row, Enter. */
  async function selectInGrid(id: string, what: string): Promise<void> {
    await tabTo(page.locator('.layers [role=gridcell][tabindex="0"]'), 'layers grid');
    await page.keyboard.press('ControlOrMeta+Home');
    const row = page.locator(`#layer-${id}`);
    for (let n = 0; n < 10 && !(await focused(row)); n++) await page.keyboard.press('ArrowDown');
    await seen(row, `${what} row`);
    await page.keyboard.press('Enter');
    await expect(canvasEl(id)).toHaveAttribute('aria-pressed', 'true');
  }

  /** The id of the element with focus. */
  const activeId = () => page.evaluate(() => document.activeElement?.id ?? '');
  /** The studio's live region. */
  const live = () => page.locator('#studio-live');
  /** The live region says exactly `text`; recorded for the report. */
  async function said(text: string | RegExp, what: string): Promise<void> {
    await expect(live(), what).toHaveText(text, { timeout: 15_000 });
    keyboard.push(`${what}: announced "${text}"`);
  }
  const canvasEl = (id: string) => page.locator(`#studio-el-${id}`);
  const layerOrder = () =>
    page.locator('.layers [role=row] [id^="layer-"][role=gridcell]').evaluateAll((cells) => cells.map((c) => c.id.slice(6)));
  /** A canvas layer's inline style value, read again until it settles. */
  const styleOf = (id: string, prop: 'left' | 'top' | 'width' | 'height' | 'transform' | 'zIndex') =>
    canvasEl(id).evaluate((el, p) => (el as HTMLElement).style[p], prop);
  /** Selects all of a field's text and types `value` over it, then leaves it with Tab. */
  async function typeOver(value: string): Promise<void> {
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(value);
    await page.keyboard.press('Tab');
  }

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Keyboard walk'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    const project = await api<{ id: string }>('post', '/projects', { name: 'Keyboard walk' });
    projectId = project.id;
    const zone = await api<{ id: string }>('post', '/zones', { name: 'Home', projectId });
    zoneId = zone.id;
    const group = await api<{ id: string }>('post', `/zones/${zoneId}/tale-groups`, { name: 'Autumn' });
    const tale = await api<{ id: string }>('post', `/tale-groups/${group.id}/tales`, { title: 'Autumn edit' });
    taleId = tale.id;
    // One picture in the project's media, for the image.
    const [png] = await drawPngs(page);
    const res = await page.request.fetch(`${API}/projects/${projectId}/media`, {
      method: 'post',
      headers: { 'Content-Type': 'image/png' },
      data: png.buffer,
    });
    expect(res.ok(), `media upload: ${res.status()}`).toBe(true);
  });

  test.afterAll(async () => {
    const report = process.env['E2E_A11Y_REPORT'];
    if (report)
      writeFileSync(
        report.replace(/(\.json)?$/, '-studio.json'),
        JSON.stringify({ findings: results, tabStops: walked, keyboard }, null, 2),
      );
    const total = Object.values(results).reduce((n, f) => n + f.length, 0);
    console.log(`Studio scan: ${Object.keys(results).length} states, ${total} findings`);
    for (const [state, findings] of Object.entries(results)) {
      const stops = walked[state]?.length ?? 0;
      console.log(
        `${findings.length === 0 ? 'pass' : 'FAIL'} ${state} (${stops} Tab stops)${findings.map((f) => `\n    ${f}`).join('')}`,
      );
    }
    console.log(`Keyboard: ${keyboard.length} steps\n  ${keyboard.join('\n  ')}`);
    await context.close();
    await emptyInstall();
  });

  test('the empty studio', async () => {
    await page.goto(`/tales/${taleId}/studio`);
    await expect(page.locator('#studio-add-text')).toBeVisible({ timeout: 30_000 });
    await check('studio-empty', { layout: true });
  });

  test('adds a text by keyboard and types it in place', async () => {
    await tabTo(page.locator('#studio-add-text'), 'Add body text');
    await page.keyboard.press('Enter');
    // At the next free spot, selected, and typed in place on the canvas (story 11.4).
    await said(/^Text added (near the centre of the safe area|at left [\d.]+%, top [\d.]+% of the tale)\. Editing its text: type, then press Escape\.$/, 'text');
    // Typing in place: a text field on the canvas.
    const editing = page.locator('textarea.el-edit');
    await seen(editing, 'the text field on the canvas');
    ids.text = (await activeId()).replace('studio-edit-', '');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Autumn sale');
    await page.keyboard.press('Escape');
    await expect(canvasEl(ids.text)).toHaveAttribute('aria-label', 'Text: Autumn sale');
    await seen(canvasEl(ids.text), 'the text after Escape');
  });

  test('adds an image from the media picker by keyboard and gives it alt text', async () => {
    await tabTo(page.locator('#studio-add-image'), 'Add image');
    await page.keyboard.press('Enter');
    const picker = page.getByRole('dialog');
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('button', { name: /^Use / })).toHaveCount(1);
    await check('media-picker', { layout: true });
    await tabTo(picker.getByRole('button', { name: /^Use / }), 'media picker: the picture', { max: 20 });
    await page.keyboard.press('Enter');
    await expect(picker).toBeHidden();
    await said(
      /^Image added (near the centre of the safe area|at left [\d.]+%, top [\d.]+% of the tale)\. Selected\. Give it alt text, or mark it decorative, before updating the tale\. Press F6 for its properties\.$/,
      'image',
    );
    // Focus goes to the new image on the canvas (story 11.4); F6 then Tab reach the alt text it needs.
    await expect(page.locator('[id^="studio-el-"]:focus')).toHaveCount(1);
    ids.image = (await activeId()).replace('studio-el-', '');
    await page.keyboard.press('F6');
    const alt = page.locator(`#media-alt-${ids.image}`);
    await tabTo(alt, 'Alt text', { max: 30 });
    await page.keyboard.type('An orange sky');
    await page.keyboard.press('Tab');
    await expect(canvasEl(ids.image)).toHaveAttribute('aria-label', 'Image: An orange sky');
  });

  test('adds a rectangle by keyboard', async () => {
    await tabTo(page.locator('#studio-add-rectangle'), 'Add rectangle');
    await page.keyboard.press('Enter');
    await said(
      /^Rectangle added (near the centre of the safe area|at left [\d.]+%, top [\d.]+% of the tale)\. Selected\. It is decorative: screen readers skip it\. Press F6 for its properties\.$/,
      'rectangle',
    );
    await expect(page.locator('[id^="studio-el-"]:focus')).toHaveCount(1);
    ids.shape = (await activeId()).replace('studio-el-', '');
    await seen(canvasEl(ids.shape), 'the rectangle');
  });

  test('adds an emoji from the picker by keyboard: search, arrows and Enter', async () => {
    await tabTo(page.locator('#studio-add-emoji'), 'Add emoji');
    await page.keyboard.press('Enter');
    const picker = page.getByRole('dialog', { name: 'Add an emoji' });
    await expect(picker).toBeVisible();
    await check('emoji-picker', { layout: true, maxStops: 30 });
    await tabTo(picker.locator('#emoji-search'), 'emoji search', { max: 20 });
    await page.keyboard.type('face');
    // The grid is one Tab stop (roving tabindex); the arrows move in it.
    await tabTo(picker.locator('.emoji-choice[tabindex="0"]'), 'emoji grid', { max: 10 });
    const first = await activeId();
    await page.keyboard.press('ArrowRight');
    expect(await activeId(), 'ArrowRight moves in the grid').not.toBe(first);
    await page.keyboard.press('ArrowLeft');
    expect(await activeId()).toBe(first);
    // Tab from the grid, the last stop, wraps to Close; Shift+Tab comes back (2.1.2, 2.4.3).
    await page.keyboard.press('Tab');
    await seen(picker.getByRole('button', { name: 'Close' }), 'emoji picker: Close after the grid');
    await page.keyboard.press('Shift+Tab');
    await seen(page.locator(`#${first}`), 'emoji grid again');
    const name = (await page.locator(`#${first}`).getAttribute('aria-label')) ?? '';
    await page.keyboard.press('Enter');
    await expect(picker).toBeHidden();
    await said(
      new RegExp(
        `^Emoji added (near the centre of the safe area|at left [\\d.]+%, top [\\d.]+% of the tale)\\. Selected\\. Screen readers announce it as ${name}, a name you can edit\\. Press F6 for its properties\\.$`,
      ),
      'emoji',
    );
    await expect(page.locator('[id^="studio-el-"]:focus')).toHaveCount(1);
    ids.emoji = (await activeId()).replace('studio-el-', '');
    await expect(canvasEl(ids.emoji)).toHaveAttribute('aria-label', `Emoji: ${name}`);
  });

  test('adds a button by keyboard and gives it a web address and a label', async () => {
    await tabTo(page.locator('#studio-add-button'), 'Add button');
    await page.keyboard.press('Enter');
    await said(
      /^Button added (near the centre of the safe area|at left [\d.]+%, top [\d.]+% of the tale)\. Selected\. Give it a web address before updating the tale\. Press F6 for its properties\.$/,
      'button',
    );
    await expect(page.locator('[id^="studio-el-"]:focus')).toHaveCount(1);
    ids.button = (await activeId()).replace('studio-el-', '');
    await page.keyboard.press('F6');
    await tabTo(page.locator(`#link-href-${ids.button}`), 'button web address', { max: 30 });
    await page.keyboard.type('https://example.com/shop');
    await page.keyboard.press('Tab');
    await tabTo(page.locator(`#link-label-${ids.button}`), 'button label field', { max: 20 });
    await typeOver('Shop now');
    await expect(canvasEl(ids.button)).toHaveAttribute('aria-label', 'Button: Shop now');
  });

  test('the composed tale, with each kind selected', async () => {
    // The layers list is the left panel's Layers tab (Tale Studio 2).
    await openTab('Layers');
    for (const [name, id] of Object.entries(ids)) {
      await selectInGrid(id, name);
      await check(`composed-${name}-selected`, { layout: name === 'text' });
    }
  });

  test('moves between the five regions with F6 and Shift+F6 (Tale Studio 2)', async () => {
    const region = () =>
      page.evaluate(() => document.activeElement?.closest('[data-region]')?.getAttribute('data-region') ?? '');
    // From the layers grid (the left panel): the canvas, the inspector, the strip, the top bar, back to the left panel.
    await tabTo(page.locator('.layers [role=gridcell][tabindex="0"]'), 'layers grid');
    const forward: string[] = [];
    for (let n = 0; n < 5; n++) {
      await page.keyboard.press('F6');
      forward.push(await region());
      await seen(page.locator(':focus'), `F6 to the ${forward.at(-1)} region`);
    }
    expect(forward).toEqual(['canvas', 'inspector', 'strip', 'top', 'left']);
    // On the canvas F6 lands on the selected element; in the strip on the current tale.
    const back: string[] = [];
    for (let n = 0; n < 5; n++) {
      await page.keyboard.press('Shift+F6');
      back.push(await region());
    }
    expect(back).toEqual(['top', 'strip', 'inspector', 'canvas', 'left']);
    await expect(page.locator('[role=tab][aria-selected=true]')).toBeFocused();
    keyboard.push(`F6: ${forward.join(', ')}; Shift+F6: ${back.join(', ')}`);
  });

  test('searches the palette with / and moves to a tile with Arrow Down (Tale Studio 2, story 11.3)', async () => {
    // From the selected tab of the left panel (where F6 left focus): `/` opens Elements with its search focused.
    const before = ((await page.locator('[role=tab][aria-selected=true]').textContent()) ?? '').trim();
    await page.keyboard.press('/');
    await expect(page.locator('#studio-palette-search')).toBeFocused();
    await page.keyboard.type('circle');
    await said('1 element', 'palette search');
    await check('palette-search', { walk: false });
    await page.keyboard.press('ArrowDown');
    await seen(page.locator('#studio-add-ellipse'), 'the ellipse tile, found');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#studio-palette-search')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#studio-palette-search')).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-region=canvas] :focus')).toHaveCount(1);
    keyboard.push('palette: / to search, "circle" found 1 element, Arrow Down to it, Escape twice back to the canvas');
    // Back to the tab the walk was on.
    if (before && before !== 'Elements') await openTab(before);
  });

  test('selects from the layers grid with the arrow keys', async () => {
    // The grid is one Tab stop; the arrows go from layer to layer.
    await tabTo(page.locator('.layers [role=gridcell][tabindex="0"]'), 'layers grid');
    await page.keyboard.press('ControlOrMeta+Home');
    // Top layer first: the button, the emoji, the rectangle, the image, the text.
    const order = [ids.button, ids.emoji, ids.shape, ids.image, ids.text];
    expect(await layerOrder()).toEqual(order);
    await expect(page.locator(`#layer-${ids.button}`)).toBeFocused();
    for (const id of order.slice(1)) {
      await page.keyboard.press('ArrowDown');
      await expect(page.locator(`#layer-${id}`)).toBeFocused();
    }
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(`#layer-hide-${ids.text}`)).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator(`#layer-more-${ids.text}`)).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(page.locator(`#layer-${ids.text}`).locator('xpath=..')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#inspector-title')).toContainText('Text');
    keyboard.push('layers grid: Ctrl/Cmd+Home, Down through all layers, Right, End, Home, Enter selects');
  });

  test('moves with the arrow keys, Shift for larger steps, and resizes and rotates in the fields', async () => {
    const x0 = Number(await page.locator('#studio-x').inputValue());
    const y0 = Number(await page.locator('#studio-y').inputValue());
    await tabTo(canvasEl(ids.text), 'the text on the canvas', { back: true });
    const left0 = parseFloat(await styleOf(ids.text, 'left'));
    const top0 = parseFloat(await styleOf(ids.text, 'top'));
    await page.keyboard.press('ArrowRight');
    await said(`Text moved to left ${x0 + 1}%, top ${y0}%`, 'move: ArrowRight');
    await expect.poll(async () => parseFloat(await styleOf(ids.text, 'left')) - left0).toBeCloseTo(1, 5);
    await page.keyboard.press('Shift+ArrowDown');
    await said(`Text moved to left ${x0 + 1}%, top ${y0 + 10}%`, 'move: Shift+ArrowDown');
    await expect.poll(async () => parseFloat(await styleOf(ids.text, 'top')) - top0).toBeCloseTo(10, 5);
    await expect(page.locator('#studio-x')).toHaveValue(String(x0 + 1));
    await expect(page.locator('#studio-y')).toHaveValue(String(y0 + 10));
    await seen(canvasEl(ids.text), 'the text after moving');

    // Width, height, rotation; then left and top put it wholly under the picture (10 to 90 % across,
    // 30 to 70 % down), for the next test.
    await tabTo(page.locator('#studio-w'), 'Width field');
    await typeOver('70');
    await said('Text width set to 70%', 'width field');
    await expect.poll(() => styleOf(ids.text, 'width')).toBe('70%');
    await seen(page.locator('#studio-h'), 'Height field');
    await typeOver('9');
    await said('Text height set to 9%', 'height field');
    await expect.poll(() => styleOf(ids.text, 'height')).toBe('9%');
    await seen(page.locator('#studio-rotation'), 'Rotation field');
    await typeOver('-5');
    await said('Text rotated to -5°', 'rotation field');
    await expect.poll(() => styleOf(ids.text, 'transform')).toBe('rotate(-5deg)');
    await tabTo(page.locator('#studio-x'), 'Left field', { back: true, max: 10 });
    await typeOver('15');
    await said('Text moved to left 15%', 'left field');
    await expect.poll(() => styleOf(ids.text, 'left')).toBe('15%');
    await seen(page.locator('#studio-y'), 'Top field');
    await typeOver('40');
    await said('Text moved to top 40%', 'top field');
    await expect.poll(() => styleOf(ids.text, 'top')).toBe('40%');
  });

  test('a text under the picture: focused, it is raised; edited in place, the field is on top', async () => {
    // The text lies wholly under the picture: focused by keyboard it comes above (2.4.11) …
    await tabTo(canvasEl(ids.text), 'the text under the picture', { back: true });
    await expect.poll(() => styleOf(ids.text, 'zIndex')).toBe('99');
    for (const key of ['Enter', 'F2']) {
      await page.keyboard.press(key);
      const editing = page.locator(`#studio-edit-${ids.text}`);
      await seen(editing, `the text field opened by ${key}, under the picture`);
      await page.keyboard.press('Escape');
      await seen(canvasEl(ids.text), `the text after Escape (${key})`);
    }
    // … while a layer only partly under another keeps its place, with its ring drawn above.
    await tabTo(canvasEl(ids.shape), 'the rectangle, partly under the emoji', { back: true });
    await expect(page.locator('.focus-frame')).toBeVisible();
    expect(await styleOf(ids.shape, 'zIndex')).not.toBe('99');
    keyboard.push('a text wholly under the picture is raised while focused; Enter and F2 edit it on top');
  });

  test('reorders, hides and locks with the layer shortcuts, on the canvas and in the grid', async () => {
    await expect(canvasEl(ids.shape)).toBeFocused();
    await page.keyboard.press('Alt+ArrowUp');
    await said('Layer brought forward', 'reorder: Alt+ArrowUp on the canvas');
    await expect.poll(async () => (await layerOrder()).indexOf(ids.shape), 'brought forward').toBe(1);
    // The layer keeps its new place on the canvas (no raise): its stacking follows the list.
    await expect.poll(() => styleOf(ids.shape, 'zIndex')).toBe('4');
    await expect(canvasEl(ids.shape)).toBeFocused();
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await said('Layer moved to the back', 'reorder: Alt+Shift+ArrowDown');
    await expect.poll(async () => (await layerOrder()).at(-1), 'sent to the back').toBe(ids.shape);
    // In the grid: to the front.
    await tabTo(page.locator('.layers [role=gridcell][tabindex="0"]'), 'layers grid');
    await page.keyboard.press('ControlOrMeta+End');
    await expect(page.locator(`#layer-${ids.shape}`)).toBeFocused();
    await page.keyboard.press('Alt+Shift+ArrowUp');
    await expect.poll(async () => (await layerOrder())[0], 'to the front from the grid').toBe(ids.shape);
    await expect(live()).toHaveText(/^Layer moved to the front\b/);
    keyboard.push(`reorder in the grid: Alt+Shift+ArrowUp, announced "${await live().textContent()}"`);
    await seen(page.locator(`#layer-${ids.shape}`), 'the rectangle row after reordering');

    await page.keyboard.press('h');
    await said('Layer hidden', 'hide: H');
    await expect(page.locator(`#layer-hide-${ids.shape}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(canvasEl(ids.shape)).toHaveCount(0);
    await page.keyboard.press('h');
    await said('Layer shown', 'show: H');
    await expect(canvasEl(ids.shape)).toHaveCount(1);
    await page.keyboard.press('l');
    await said('Layer locked', 'lock: L');
    await expect(page.locator(`#layer-lock-${ids.shape}`)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('l');
    await said('Layer unlocked', 'unlock: L');
    await expect(page.locator(`#layer-lock-${ids.shape}`)).toHaveAttribute('aria-pressed', 'false');
    // Back to where it was: below the button.
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(async () => (await layerOrder())[1]).toBe(ids.shape);
    await expect(live()).toHaveText(/^Layer sent backward\b/);
  });

  test('opens the layer menu with Shift+F10 and the context-menu key, and closes it with Escape', async () => {
    const row = page.locator(`#layer-${ids.shape}`);
    await expect(row).toBeFocused();
    const menu = page.getByRole('menu');
    await page.keyboard.press('Shift+F10');
    await expect(menu).toHaveCount(1);
    await seen(menu.getByRole('menuitem').first(), 'the layer menu’s first item');
    await check('layer-menu', { walk: false });
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await seen(row, 'the row after the menu');
    // The context-menu key on the canvas: one menu, the studio's.
    await tabTo(canvasEl(ids.shape), 'the rectangle on the canvas', { back: true });
    await page.keyboard.press('ContextMenu');
    await expect(menu).toHaveCount(1);
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await seen(canvasEl(ids.shape), 'the rectangle after the menu');
    keyboard.push('layer menu: Shift+F10 on a row and the context-menu key on the canvas open it on its first item; Escape returns focus');
  });

  test('undoes and redoes by keyboard and announces it', async () => {
    const undo = ((await page.locator('#studio-undo').getAttribute('aria-keyshortcuts')) ?? '').split(' ')[0];
    const redo = ((await page.locator('#studio-redo').getAttribute('aria-keyshortcuts')) ?? '').split(' ')[0];
    expect(undo).toMatch(/^(Meta|Control)\+Z$/);
    // The last change put the rectangle back below the button; undo brings it to the front again.
    await page.keyboard.press(undo);
    await said('Undone: Layer sent backward', `undo: ${undo}`);
    await expect.poll(async () => (await layerOrder())[0]).toBe(ids.shape);
    await page.keyboard.press(redo);
    await said('Redone: Layer sent backward', `redo: ${redo}`);
    await expect.poll(async () => (await layerOrder())[1]).toBe(ids.shape);
    // The Undo and Redo buttons too, by Enter; focus stays on each.
    await tabTo(page.locator('#studio-undo'), 'Undo button', { back: true });
    await page.keyboard.press('Enter');
    await said('Undone: Layer sent backward', 'Undo button');
    await seen(page.locator('#studio-undo'), 'Undo button after Enter');
    await tabTo(page.locator('#studio-redo'), 'Redo button', { max: 2 });
    await page.keyboard.press('Enter');
    await said('Redone: Layer sent backward', 'Redo button');
  });

  test('the shortcuts panel and the duplicate drawer, from the tale menu', async () => {
    // Keyboard shortcuts and Duplicate are in the top bar's tale menu (Tale Studio 2).
    const taleMenu = page.locator('#studio-menu');
    await tabTo(taleMenu, 'Tale actions', { max: 8 });
    await page.keyboard.press('Enter');
    await menuTo('Keyboard shortcuts');
    await page.keyboard.press('Enter');
    await seen(page.locator('#studio-help-panel'), 'the shortcuts panel');
    await expect(page.locator('#studio-keys')).toBeVisible();
    await check('shortcuts-open', { walk: false });
    await page.keyboard.press('Escape');
    await expect(page.locator('#studio-keys')).toBeHidden();
    await seen(taleMenu, 'Tale actions after Escape');

    await page.keyboard.press('Enter');
    await menuTo('Duplicate');
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Duplicate tale' });
    await expect(drawer).toBeVisible();
    await check('duplicate-drawer', { layout: true, maxStops: 30 });
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await seen(taleMenu, 'Tale actions after the Duplicate drawer');
    keyboard.push('tale menu: Enter opens it, the arrows reach Keyboard shortcuts and Duplicate; Escape returns focus to it');
  });

  test('updates the tale by keyboard', async () => {
    await tabTo(page.locator('#studio-update'), 'Update tale', { back: true, max: 10 });
    await expect(page.locator('#studio-update')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 });
    await page.keyboard.press('Enter');
    await said('Tale updated. Not visible: group is off.', 'Update tale');
    await check('updated');
  });

  test('opens the preview pane by keyboard, replays it and reaches its link', async () => {
    await tabTo(page.locator('#studio-preview'), 'Preview', { back: true });
    await page.keyboard.press('Enter');
    await expect(page.locator('#studio-preview')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#preview-host')).toBeVisible();
    await check('preview', { maxStops: 100 });
    await tabTo(page.locator('#preview-replay'), 'Play from the start');
    await page.keyboard.press('Enter');
    // The replay keeps focus and starts the tale again: no "Play again" end screen.
    await seen(page.locator('#preview-replay'), 'Play from the start after Enter');
    await expect(page.locator('#preview-play-again')).toHaveCount(0);
    // The tale's button is a link in the preview, reached by Tab.
    await tabTo(page.locator('#preview-host').getByRole('link', { name: /Shop now/ }), 'the tale’s link in the preview');
    await tabTo(page.locator('#studio-preview'), 'Preview toggle', { back: true });
    await page.keyboard.press('Enter');
    await expect(page.locator('#studio-preview-pane')).toHaveCount(0);
    await seen(page.locator('#studio-preview'), 'Preview after closing');
  });

  test('the studio on a phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    // The layers grid, each canvas layer's equivalent target (2.5.8), is on the same page there.
    await expect(page.locator('.layers [role=gridcell][id^="layer-"]')).toHaveCount(5);
    await expect(page.locator('.layers')).toBeVisible();
    await check('composed-phone');
    expect(walked['composed-phone'].length).toBeGreaterThan(0);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test('web-zones screens 3.12 left open: projects, theme, fonts, import and the group drawers', async () => {
    test.setTimeout(300_000);
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: /Projects/ }).first()).toBeVisible();
    await check('projects', { layout: true });
    for (const [name, path] of [
      ['theme', 'theme'],
      ['fonts', 'fonts'],
      ['import', 'import'],
    ]) {
      await page.goto(`/projects/${projectId}/${path}`);
      await expect(page.locator('main h2, main h1').first()).toBeVisible();
      await check(name, { layout: true });
    }
    await page.goto(`/zones/${zoneId}`);
    const more = page.getByRole('button', { name: 'More for Autumn' }).first();
    await expect(more).toBeVisible();
    for (const item of ['Rename', 'Cover', 'Audience', 'Schedule']) {
      await tabTo(more, 'More for Autumn');
      await page.keyboard.press('Enter');
      await menuTo(item);
      await page.keyboard.press('Enter');
      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();
      await check(`group-${item.toLowerCase()}-drawer`, { layout: true, maxStops: 40 });
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await seen(more, `More for Autumn after ${item}`);
    }
    // Each date and time field takes several Tabs (its day, month, year, … parts); both are reached.
    await page.keyboard.press('Enter');
    await menuTo('Schedule');
    await page.keyboard.press('Enter');
    await tabTo(page.locator('#schedule-end'), 'Schedule: End time', { max: 30 });
    await page.keyboard.press('Escape');
    await seen(more, 'More for Autumn after Schedule');
  });

  test('every state has no WCAG 2.2 AA finding', () => {
    expect(Object.keys(results).length).toBe(STATES);
    for (const [state, findings] of Object.entries(results)) expect.soft(findings, state).toEqual([]);
  });
});
