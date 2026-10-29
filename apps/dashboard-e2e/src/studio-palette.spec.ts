import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { axeViolations } from './axe';
import { emptyInstall, signIn } from './session';

/**
 * Tale Studio 2's palette (epic Tale Studio 2 R2, story 11.3): typing "vote" finds Poll and the
 * count is announced; Arrow Down and Enter add it; with a poll in the tale the Poll tile stays
 * focusable, is disabled and says why; Escape clears the search and a second Escape returns to the
 * canvas; `/` focuses the search from the canvas; the test badge, registered without a palette
 * entry, shows under More in a development build that opts in to test types. Each palette state
 * has no axe violation. Signs in with a session written to the database and empties the install
 * at the end. E2E_SCREENSHOTS, when set, is a folder for screenshots.
 */

const API = '/api/v1';
const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

test.describe.serial('Tale Studio 2: a grouped, searchable palette (story 11.3)', () => {
  let context: BrowserContext;
  let page: Page;
  let taleId = '';

  async function api<T>(method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, { method, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  const search = () => page.locator('#studio-palette-search');
  const live = () => page.locator('#studio-live');
  const tileIds = () => page.locator('#studio-panel-elements .tile').evaluateAll((tiles) => tiles.map((t) => t.id));

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Palette'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    const project = await api<{ id: string }>('post', '/projects', { name: 'Palette' });
    const zone = await api<{ id: string }>('post', '/zones', { name: 'Home top', projectId: project.id });
    const group = await api<{ id: string }>('post', `/zones/${zone.id}/tale-groups`, { name: 'Autumn drop' });
    taleId = (await api<{ id: string }>('post', `/tale-groups/${group.id}/tales`, { title: 'Launch' })).id;
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('shows every element in its category, with no axe violation', async () => {
    await page.goto(`/tales/${taleId}/studio`);
    await expect(page.locator('#studio-add-heading')).toBeVisible({ timeout: 30_000 });
    const groups = page.locator('#studio-panel-elements [role=group] h3');
    await expect(groups).toHaveText(['Text', 'Media', 'Shapes', 'Stickers & emoji', 'Buttons & links', 'Interactive']);
    await expect(page.getByRole('group', { name: 'Interactive' }).getByRole('button')).toHaveText([
      'Add poll',
      'Add rating',
      'Add quiz',
      'Add countdown',
      'Add promo code',
      'Add reaction',
    ]);
    await expect(page.locator('#studio-add-test-badge')).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
    if (shots) await page.screenshot({ path: join(shots, 'studio2-11-3-palette.png') });
  });

  test('finds Poll by "vote", announces the count, and adds it with Arrow Down and Enter', async () => {
    // `/` from the canvas focuses the search.
    await page.locator('#studio-canvas').focus();
    await page.keyboard.press('/');
    await expect(search()).toBeFocused();
    await page.keyboard.type('vote');
    expect(await tileIds()).toEqual(['studio-add-poll']);
    await expect(page.locator('#studio-palette-count')).toHaveText('1 element');
    await expect(live()).toHaveText('1 element', { timeout: 5_000 });
    expect(await axeViolations(page), 'with a search').toEqual([]);

    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#studio-add-poll')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(live()).toHaveText('Poll added near the centre of the safe area. Selected. Press F6 for its properties.');
    await expect(page.locator('[id^="studio-el-"]:focus')).toHaveCount(1);
    await expect(page.locator('[id^="studio-el-"]')).toHaveCount(1);
  });

  test('keeps the Poll tile focusable with a poll in the tale, and says why', async () => {
    const poll = page.locator('#studio-add-poll');
    await expect(poll).toHaveAttribute('aria-disabled', 'true');
    await expect(poll).toHaveAccessibleDescription('A tale holds one poll. Delete it to add another.');
    await expect(page.getByRole('group', { name: 'Interactive' }).locator('#studio-poll-hint')).toBeVisible();
    await search().focus();
    await page.keyboard.press('ArrowDown');
    await expect(poll).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(live()).toHaveText('A tale holds one poll. Delete it to add another.');
    await expect(page.locator('[id^="studio-el-"]')).toHaveCount(1);
    expect(await axeViolations(page), 'with a blocked tile').toEqual([]);
    if (shots) await page.screenshot({ path: join(shots, 'studio2-11-3-disabled.png') });
  });

  test('clears with Escape, returns to the canvas with a second Escape, and moves between tiles with arrows', async () => {
    await search().focus();
    await page.keyboard.press('Escape');
    await expect(search()).toHaveValue('');
    await expect(search()).toBeFocused();
    expect((await tileIds()).length).toBe(21);
    await page.keyboard.press('Escape');
    await expect(page.locator('[id^="studio-el-"]').first()).toBeFocused();

    // Arrows by position: the text presets lie in two columns (Heading, Subheading / Body text,
    // Caption / Label); Down follows the column, then into Media; Up from the top row is the search.
    await page.locator('#studio-add-heading').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#studio-add-subheading')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#studio-add-caption')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#studio-add-label')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#studio-add-image')).toBeFocused();
    await page.keyboard.press('End');
    // End is the last tile in reading order: Reaction now follows Promo code.
    await expect(page.locator('#studio-add-reaction')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('#studio-add-heading')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(search()).toBeFocused();
  });

  test('shows a type without a palette entry under More when test types are on', async () => {
    await page.evaluate(() => localStorage.setItem('taleart.testElementTypes', 'on'));
    await page.reload();
    const more = page.getByRole('group', { name: 'More' });
    await expect(more.getByRole('button')).toHaveText(['Add test badge'], { timeout: 30_000 });
    await search().fill('test badge');
    expect(await tileIds()).toEqual(['studio-add-test-badge']);
    if (shots) await page.screenshot({ path: join(shots, 'studio2-11-3-more.png') });
    await page.evaluate(() => localStorage.removeItem('taleart.testElementTypes'));
  });

  test('says once, above the groups, why the media tiles cannot add to a tale with no project', async () => {
    // A tale the dashboard knows without a project: its project id taken out of each tale the API lists.
    const unproject = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(unproject);
      if (!value || typeof value !== 'object') return value;
      const entries = Object.entries(value).map(([k, v]) => [k, unproject(v)]);
      const object = Object.fromEntries(entries) as Record<string, unknown>;
      if ('taleGroupId' in object && 'projectId' in object) object['projectId'] = null;
      return object;
    };
    await page.route('**/api/v1/**', async (route) => {
      const response = await route.fetch();
      const type = response.headers()['content-type'] ?? '';
      if (route.request().method() !== 'GET' || !type.includes('json')) return route.fulfill({ response });
      return route.fulfill({ response, json: unproject(await response.json()) });
    });
    await page.reload();
    await expect(page.locator('#studio-add-heading')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#studio-project-hint')).toHaveCount(1);
    await expect(page.locator('#studio-project-hint')).toHaveText(
      "This tale has no project, so it can't use the project's media.",
    );
    for (const id of ['image', 'video', 'sticker', 'image-button']) {
      const tile = page.locator(`#studio-add-${id}`);
      await expect(tile, id).toHaveAttribute('aria-disabled', 'true');
      await expect(tile, id).toHaveAccessibleDescription("This tale has no project, so it can't use the project's media.");
    }
    await expect(page.locator('#studio-add-emoji')).not.toHaveAttribute('aria-disabled', 'true');
    // Focusable, and pressing it says why and adds nothing.
    await page.locator('#studio-add-image').focus();
    await page.keyboard.press('Enter');
    await expect(live()).toHaveText("This tale has no project, so it can't use the project's media.");
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await axeViolations(page), 'with no project').toEqual([]);
    await page.unroute('**/api/v1/**');
  });
});
