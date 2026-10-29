import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { drawPngs } from './media';
import { emptyInstall, signIn } from './session';

/**
 * Delete a tale (story 8.20): from the group view on the zone page, after a confirmation that
 * names it; the group's count, the API and the test page follow, and a copy that shares the
 * deleted tale's media keeps it. It signs in with a session written to the database and empties
 * the install at the end. E2E_SCREENSHOTS, when set, is a folder the screenshots go to.
 */

const API = '/api/v1';
const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  // Past the drawers' and the viewer's opening transitions.
  await new Promise((resolve) => setTimeout(resolve, 700));
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

// The tale group's items on a page that places the zone (bar items, in the SDK's Shadow DOM).
const barItems = (page: Page) => page.locator('taleart-view button.item');

interface Group {
  id: string;
  tales: { id: string; title: string; position: number; storedStatus: string }[];
}

test.describe.serial('delete a tale (story 8.20)', () => {
  let context: BrowserContext;
  let page: Page;
  let zoneId = '';
  let groupId = '';
  let testPageUrl = '';
  let copyId = '';

  async function api<T>(method: 'get' | 'post' | 'put', path: string, data?: unknown, contentType?: string): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, {
      method,
      data,
      headers: contentType ? { 'Content-Type': contentType } : undefined,
    });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  // The test page, opened afresh (the page drops the key's fragment, so going to the same address
  // again would only move to the fragment): the group's viewer, and how many tales it plays.
  async function talesOnTestPage(testPage: Page): Promise<number> {
    await testPage.goto('about:blank');
    await testPage.goto(testPageUrl);
    await expect(barItems(testPage)).toHaveCount(1, { timeout: 20_000 });
    await barItems(testPage).first().click();
    const viewer = testPage.getByRole('dialog', { name: 'Summer sale' });
    await expect(viewer).toBeVisible();
    return viewer.locator('.segment').count();
  }

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Delete a tale'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    // A zone with its display, its zone key, and a group that is On with two shown tales
    // with media, and a Hidden copy of the first, sharing its media (AD-14).
    const project = await api<{ id: string }>('post', '/projects', { name: 'Delete a tale' });
    const zone = await api<{ id: string; slug: string }>('post', '/zones', { name: 'Home top', projectId: project.id });
    zoneId = zone.id;
    await api('post', `/zones/${zoneId}/frame`, { type: 'bar', settings: {} });
    groupId = (await api<{ id: string }>('post', `/zones/${zoneId}/tale-groups`, { name: 'Summer sale' })).id;
    const files = await drawPngs(page);
    const ids: string[] = [];
    for (const [i, title] of ['Beach', 'Pool'].entries()) {
      const tale = await api<{ id: string }>('post', `/tale-groups/${groupId}/tales`, { title });
      await api('put', `/tales/${tale.id}/media`, files[i].buffer, 'image/png');
      ids.push(tale.id);
    }
    copyId = (await api<{ id: string }>('post', `/tales/${ids[0]}/duplicate`, {})).id;
    await api('put', `/tale-groups/${groupId}/status`, { status: 'live' });
    const { key } = await api<{ key: string }>('post', `/zones/${zone.id}/key`, {});
    const install = await api<{ testPageUrl: string }>('get', '/install');
    // As the Install tab links it: the zone key in the fragment.
    testPageUrl = `${install.testPageUrl}#zoneKey=${encodeURIComponent(key)}`;
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('deletes a tale from the group view; the count, the API and the test page follow', async () => {
    const testPage = await context.newPage();
    expect(await talesOnTestPage(testPage)).toBe(2);
    await shot(testPage, '01-test-page-two-tales');

    await page.goto(`/zones/${zoneId}?group=${groupId}`);
    const view = page.getByRole('dialog', { name: 'Summer sale' });
    await expect(view).toBeVisible();
    await expect(view.locator('.tale-card__name')).toHaveText(['Beach', 'Beach (copy)', 'Pool']);
    await expect(view.locator('.group-view__count')).toContainText('2 of 3 shown');

    await view.getByRole('button', { name: 'More for Beach', exact: true }).click();
    await shot(page, '02-tale-menu-with-delete');
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete tale' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Delete Beach from Summer sale?');
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await shot(page, '03-delete-confirmation');

    // From the keyboard: Tab to Delete tale, then Enter.
    await page.keyboard.press('Tab');
    await expect(confirm.getByRole('button', { name: 'Delete tale' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(confirm).toBeHidden();
    await expect(view.locator('.tale-card__name')).toHaveText(['Beach (copy)', 'Pool']);
    await expect(view.locator('.group-view__count')).toContainText('1 of 2 shown');
    await expect(view.locator('[aria-live=polite]').first()).toHaveText('Beach deleted from Summer sale. 1 of 2 shown.');
    // Focus moved to the card that took its place.
    await expect(view.getByRole('button', { name: 'More for Beach (copy)' })).toBeFocused();
    await shot(page, '04-group-view-after-delete');

    const saved = await api<Group>('get', `/tale-groups/${groupId}`);
    expect(saved.tales.map((t) => [t.title, t.position])).toEqual([
      ['Beach (copy)', 0],
      ['Pool', 1],
    ]);
    // The copy keeps the media it shared with the deleted tale.
    expect((await page.request.get(`${API}/tales/${copyId}/media`)).status()).toBe(200);

    // The sample page now plays the one shown tale.
    expect(await talesOnTestPage(testPage)).toBe(1);
    await shot(testPage, '05-test-page-one-tale');
    await testPage.close();

    // The Tale groups page counts one tale fewer.
    await page.goto('/tale-groups');
    await expect(page.getByText('1 of 2 shown').first()).toBeVisible();
    await shot(page, '06-tale-groups-page-after-delete');
  });
});
