import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { drawPngs } from './media';
import { emptyInstall, signIn } from './session';
import { scan, settle, type ScanOptions } from './wcag';

/**
 * Tale Studio's accessibility review (epic Tale Studio R12 and R13, story 7.15), run with
 * `nx run dashboard-e2e:a11y` after the dashboard scan (`a11y.spec.ts`).
 *
 * 1. Keyboard operability: a tale is composed with the keyboard only, every control reached with
 *    Tab (never clicked, never focused by script): text, an image from the project's media, a
 *    rectangle, an emoji from the picker and a button, each named and announced; selecting from the
 *    layers grid; moving with the arrow keys (Shift for larger steps); resizing and rotating through
 *    the numeric fields; reordering, hiding and locking with the layer shortcuts; the context menu
 *    by Shift+F10; undo and redo; Update tale; the preview pane.
 * 2. The WCAG 2.2 AA scan of `wcag.ts` (axe plus 2.4.7, 2.4.11, 2.5.8, and 1.4.10 and 1.4.12 once
 *    per screen) of each studio state on the way: empty, the media and emoji pickers, the composed
 *    tale with each kind selected, the shortcuts panel, the layer menu, the duplicate drawer, the
 *    preview, a phone width.
 * 3. The web-zones dashboard screens 3.12 left to this story that 8.17 did not scan: the project
 *    list, theme, fonts and import pages, and a group's Rename, Cover, Tags and Schedule drawers.
 *
 * It signs in with a session written to the database and empties the install at the end.
 * E2E_SCREENSHOTS and E2E_A11Y_REPORT work as in `a11y.spec.ts` (the report goes to
 * `<name>-studio.json`).
 */

const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });
const API = '/api/v1';

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

  /**
   * Presses Tab (or Shift+Tab) until `target` has focus, as a person would: it must be reachable.
   * Returns the number of presses; fails past `max`.
   */
  async function tabTo(target: Locator, what: string, { back = false, max = 120 } = {}): Promise<number> {
    await expect(target, `${what} is there`).toHaveCount(1);
    for (let n = 0; n <= max; n++) {
      if (await focused(target)) {
        keyboard.push(`${what}: reached with ${n} ${back ? 'Shift+Tab' : 'Tab'}`);
        return n;
      }
      await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    }
    throw new Error(`${what}: not reached with ${max} ${back ? 'Shift+Tab' : 'Tab'} presses`);
  }

  /** The id of the element with focus. */
  const activeId = () => page.evaluate(() => document.activeElement?.id ?? '');
  /** The studio's live region. */
  const live = () => page.locator('section.card > p.visually-hidden[aria-live="polite"]');
  const canvasEl = (id: string) => page.locator(`#studio-el-${id}`);
  const layerOrder = () =>
    page.locator('.layers [role=row] [id^="layer-"][role=gridcell]').evaluateAll((cells) => cells.map((c) => c.id.slice(6)));
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
    await expect(page.locator('#studio-add')).toBeVisible({ timeout: 30_000 });
    await check('studio-empty', { layout: true });
  });

  test('adds a text by keyboard and types it in place', async () => {
    await page.locator('body').focus();
    await tabTo(page.locator('#studio-add'), 'Add text');
    await page.keyboard.press('Enter');
    await expect(live()).toHaveText('Text added');
    // Typing in place: a text field on the canvas, with the new text selected or empty.
    const editing = page.locator('textarea.el-edit');
    await expect(editing).toBeFocused();
    ids.text = (await activeId()).replace('studio-edit-', '');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Autumn sale');
    await page.keyboard.press('Escape');
    await expect(canvasEl(ids.text)).toHaveAttribute('aria-label', 'Text: Autumn sale');
    await expect(canvasEl(ids.text)).toBeFocused();
    keyboard.push('text: added, typed in place, Escape returns focus to it on the canvas');
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
    await expect(live()).toContainText('Image added');
    // Focus goes to the alt text field, which the image needs before the tale can be updated.
    await expect(page.locator('textarea[id^="media-alt-"]')).toBeFocused();
    ids.image = (await activeId()).replace('media-alt-', '');
    await page.keyboard.type('An orange sky');
    await page.keyboard.press('Tab');
    await expect(canvasEl(ids.image)).toHaveAttribute('aria-label', /An orange sky/);
    keyboard.push('image: picked from the media picker by Enter, alt text typed');
  });

  test('adds a rectangle by keyboard', async () => {
    await tabTo(page.locator('#studio-add-rectangle'), 'Add rectangle');
    await page.keyboard.press('Enter');
    await expect(live()).toContainText('Rectangle added. It is decorative');
    await expect(page.locator('[id^="studio-el-"]:focus')).toHaveCount(1);
    ids.shape = (await activeId()).replace('studio-el-', '');
    keyboard.push('rectangle: added, focus on it on the canvas');
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
    const name = await page.locator(`#${first}`).getAttribute('aria-label');
    await page.keyboard.press('Enter');
    await expect(picker).toBeHidden();
    await expect(live()).toContainText(`Emoji added: ${name}`);
    await expect(page.locator('[id^="studio-el-"]:focus')).toHaveCount(1);
    ids.emoji = (await activeId()).replace('studio-el-', '');
    await expect(canvasEl(ids.emoji)).toHaveAttribute('aria-label', `Emoji: ${name}`);
    keyboard.push(`emoji: searched "face", arrows in the grid, Enter added "${name}"`);
  });

  test('adds a button by keyboard and gives it a web address and a label', async () => {
    await tabTo(page.locator('#studio-add-button'), 'Add button');
    await page.keyboard.press('Enter');
    await expect(live()).toContainText('Button added');
    await expect(page.locator('[id^="link-href-"]:focus')).toHaveCount(1);
    ids.button = (await activeId()).replace('link-href-', '');
    await page.keyboard.type('https://example.com/shop');
    await page.keyboard.press('Tab');
    await tabTo(page.locator(`#link-label-${ids.button}`), 'button label field', { max: 20 });
    await typeOver('Shop now');
    await expect(canvasEl(ids.button)).toHaveAttribute('aria-label', /Shop now/);
    keyboard.push('button: web address and label typed in the inspector');
  });

  test('the composed tale, with each kind selected', async () => {
    for (const [name, id] of Object.entries(ids)) {
      await canvasEl(id).focus();
      await page.keyboard.press('Shift+Space');
      // Shift+Space toggles the selection: make it this one only, from the layers grid.
      await page.locator(`#layer-${id}`).focus();
      await page.keyboard.press('Enter');
      await expect(canvasEl(id)).toHaveAttribute('aria-pressed', 'true');
      await check(`composed-${name}-selected`, { layout: name === 'text' });
    }
  });

  test('selects from the layers grid with the arrow keys', async () => {
    await page.locator('body').focus();
    // The grid is one Tab stop; the arrows go from layer to layer.
    await tabTo(page.locator('.layers [role=gridcell][tabindex="0"]'), 'layers grid');
    await page.keyboard.press('ControlOrMeta+Home');
    const order = await layerOrder();
    expect(order).toHaveLength(5);
    // Top layer first: the button, the emoji, the rectangle, the image, the text.
    expect(order).toEqual([ids.button, ids.emoji, ids.shape, ids.image, ids.text]);
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
    await expect(page.locator('fieldset.selected legend').first()).toHaveText('Selected text');
    keyboard.push('layers grid: Ctrl/Cmd+Home, Down through all layers, Right, End, Home, Enter selects');
  });

  test('moves with the arrow keys, Shift for larger steps, and resizes and rotates in the fields', async () => {
    const x = page.locator('#studio-x');
    const y = page.locator('#studio-y');
    const x0 = Number(await x.inputValue());
    const y0 = Number(await y.inputValue());
    await tabTo(canvasEl(ids.text), 'the text on the canvas', { back: true });
    await page.keyboard.press('ArrowRight');
    await expect(x).toHaveValue(String(x0 + 1));
    await expect(live()).toContainText(/moved/i);
    await page.keyboard.press('Shift+ArrowDown');
    await expect(y).toHaveValue(String(y0 + 10));
    await expect(canvasEl(ids.text)).toBeFocused();
    keyboard.push(`move: ArrowRight 1 %, Shift+ArrowDown 10 %; announced "${await live().textContent()}"`);

    await tabTo(page.locator('#studio-w'), 'Width field');
    await typeOver('70');
    await expect(live()).toContainText('width set to 70%');
    await expect.poll(() => canvasEl(ids.text).evaluate((el) => (el as HTMLElement).style.width)).toBe('70%');
    await tabTo(page.locator('#studio-h'), 'Height field', { max: 3 });
    await typeOver('9');
    await expect(live()).toContainText('height set to 9%');
    await expect.poll(() => canvasEl(ids.text).evaluate((el) => (el as HTMLElement).style.height)).toBe('9%');
    await tabTo(page.locator('#studio-rotation'), 'Rotation field', { max: 3 });
    await typeOver('-5');
    await expect.poll(() => canvasEl(ids.text).evaluate((el) => (el as HTMLElement).style.transform)).toBe('rotate(-5deg)');
    await tabTo(page.locator('#studio-x'), 'Left field', { back: true, max: 10 });
    await typeOver('8');
    await expect.poll(() => canvasEl(ids.text).evaluate((el) => (el as HTMLElement).style.left)).toBe('8%');
    keyboard.push(`resize and rotate: width 70 %, height 9 %, rotation -5°, left 8 % in the fields; announced "${await live().textContent()}"`);
  });

  test('reorders, hides and locks with the layer shortcuts, on the canvas and in the grid', async () => {
    await tabTo(canvasEl(ids.shape), 'the rectangle on the canvas', { back: true });
    await page.keyboard.press('Alt+ArrowUp');
    await expect(live()).not.toBeEmpty();
    await expect.poll(async () => (await layerOrder()).indexOf(ids.shape), 'brought forward').toBe(1);
    keyboard.push(`reorder: Alt+ArrowUp on the canvas, announced "${await live().textContent()}"`);
    await expect(canvasEl(ids.shape)).toBeFocused();
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await expect.poll(async () => (await layerOrder()).at(-1), 'sent to the back').toBe(ids.shape);
    keyboard.push(`reorder: Alt+Shift+ArrowDown, announced "${await live().textContent()}"`);
    // In the grid: to the front and back again.
    await page.locator('body').focus();
    await tabTo(page.locator('.layers [role=gridcell][tabindex="0"]'), 'layers grid');
    await page.keyboard.press('ControlOrMeta+End');
    await expect(page.locator(`#layer-${ids.shape}`)).toBeFocused();
    await page.keyboard.press('Alt+Shift+ArrowUp');
    await expect.poll(async () => (await layerOrder())[0], 'to the front from the grid').toBe(ids.shape);
    await expect(page.locator(`#layer-${ids.shape}`)).toBeFocused();
    keyboard.push(`reorder in the grid: Alt+Shift+ArrowUp, focus stays on the row, announced "${await live().textContent()}"`);

    await page.keyboard.press('h');
    await expect(page.locator(`#layer-hide-${ids.shape}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(canvasEl(ids.shape)).toHaveCount(0);
    keyboard.push(`hide: H, announced "${await live().textContent()}"`);
    await page.keyboard.press('h');
    await expect(canvasEl(ids.shape)).toHaveCount(1);
    await page.keyboard.press('l');
    await expect(page.locator(`#layer-lock-${ids.shape}`)).toHaveAttribute('aria-pressed', 'true');
    keyboard.push(`lock: L, announced "${await live().textContent()}"`);
    await page.keyboard.press('l');
    await expect(page.locator(`#layer-lock-${ids.shape}`)).toHaveAttribute('aria-pressed', 'false');
    // Back to where it was: below the button.
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(async () => (await layerOrder())[1]).toBe(ids.shape);
  });

  test('opens the layer menu with Shift+F10 and closes it with Escape', async () => {
    await expect(page.locator(`#layer-${ids.shape}`)).toBeFocused();
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await check('layer-menu', { walk: false });
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.locator(`#layer-${ids.shape}`)).toBeFocused();
    keyboard.push('layer menu: Shift+F10 opens on its first item, ArrowDown, Escape returns focus');
  });

  test('undoes and redoes by keyboard and announces it', async () => {
    const undo = ((await page.locator('#studio-undo').getAttribute('aria-keyshortcuts')) ?? '').split(' ')[0];
    const redo = ((await page.locator('#studio-redo').getAttribute('aria-keyshortcuts')) ?? '').split(' ')[0];
    expect(undo).toMatch(/^(Meta|Control)\+Z$/);
    // The last change put the rectangle back below the button; undo brings it to the front again.
    await page.keyboard.press(undo);
    await expect(live()).toContainText(/^Undo/i);
    await expect.poll(async () => (await layerOrder())[0]).toBe(ids.shape);
    keyboard.push(`undo: ${undo}, announced "${await live().textContent()}"`);
    await page.keyboard.press(redo);
    await expect(live()).toContainText(/^Redo/i);
    await expect.poll(async () => (await layerOrder())[1]).toBe(ids.shape);
    keyboard.push(`redo: ${redo}, announced "${await live().textContent()}"`);
    // The Undo button too, by Enter.
    await tabTo(page.locator('#studio-undo'), 'Undo button', { back: true });
    await page.keyboard.press('Enter');
    await expect(live()).toContainText(/^Undo/i);
    await expect(page.locator('#studio-undo')).toBeFocused();
    await tabTo(page.locator('#studio-redo'), 'Redo button', { max: 2 });
    await page.keyboard.press('Enter');
    await expect(live()).toContainText(/^Redo/i);
  });

  test('the shortcuts panel and the duplicate drawer', async () => {
    await tabTo(page.locator('#studio-help-button'), 'Keyboard shortcuts', { max: 3 });
    await page.keyboard.press('Enter');
    await expect(page.locator('#studio-keys')).toBeVisible();
    await check('shortcuts-open', { walk: false });
    await page.keyboard.press('Escape');
    await expect(page.locator('#studio-keys')).toBeHidden();
    await expect(page.locator('#studio-help-button')).toBeFocused();

    await tabTo(page.locator('#studio-duplicate'), 'Duplicate', { max: 10 });
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Duplicate tale' });
    await expect(drawer).toBeVisible();
    await check('duplicate-drawer', { layout: true, maxStops: 30 });
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page.locator('#studio-duplicate')).toBeFocused();
    keyboard.push('shortcuts panel: Enter opens, Escape closes; Duplicate drawer: Enter opens, Escape returns focus');
  });

  test('updates the tale by keyboard', async () => {
    await tabTo(page.locator('#studio-update'), 'Update tale', { back: true, max: 10 });
    await expect(page.locator('#studio-update')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 });
    await page.keyboard.press('Enter');
    await expect(live()).toContainText('Tale updated', { timeout: 15_000 });
    keyboard.push(`Update tale: Enter, announced "${await live().textContent()}"`);
    await check('updated');
  });

  test('opens the preview pane by keyboard and walks into it', async () => {
    await tabTo(page.locator('#studio-preview'), 'Preview', { back: true });
    await page.keyboard.press('Enter');
    await expect(page.locator('#studio-preview')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#preview-host')).toBeVisible();
    await check('preview', { maxStops: 100 });
    await tabTo(page.locator('#preview-replay'), 'Play from the start');
    await page.keyboard.press('Enter');
    // The tale's button is a link in the preview, reachable by Tab.
    keyboard.push('preview: Enter opens it; its controls are reached by Tab');
    await tabTo(page.locator('#studio-preview'), 'Preview toggle', { back: true });
    await page.keyboard.press('Enter');
    await expect(page.locator('#studio-preview-pane')).toHaveCount(0);
    await expect(page.locator('#studio-preview')).toBeFocused();
  });

  test('the studio on a phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
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
    for (const item of ['Rename', 'Cover', 'Tags', 'Schedule']) {
      await more.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: item }).focus();
      await page.keyboard.press('Enter');
      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();
      await check(`group-${item.toLowerCase()}-drawer`, { layout: true, maxStops: 40 });
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(more).toBeFocused();
    }
    // Each date and time field takes several Tabs (its day, month, year, … parts); both are reached.
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Schedule' }).focus();
    await page.keyboard.press('Enter');
    await tabTo(page.locator('#schedule-end'), 'Schedule: End time', { max: 30 });
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();
  });

  test('every state has no WCAG 2.2 AA finding', () => {
    expect(Object.keys(results).length).toBeGreaterThanOrEqual(20);
    for (const [state, findings] of Object.entries(results)) expect.soft(findings, state).toEqual([]);
  });
});
