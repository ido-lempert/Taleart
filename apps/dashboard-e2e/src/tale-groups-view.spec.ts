import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { drawPngs } from './media';
import { emptyInstall, signIn } from './session';

/**
 * A tale group in no zone gets tales (story 8.19): on the Tale groups page, its group view adds a
 * tale with its media and reorders the tales, end to end through the API. It signs in with a session
 * written to the database and empties the install at the end.
 */

const API = '/api/v1';

interface Group {
  id: string;
  zoneIds: string[];
  tales: { id: string; title: string; position: number; media: unknown }[];
}

test.describe.serial('the Tale groups page group view (story 8.19)', () => {
  let context: BrowserContext;
  let page: Page;
  let groupId = '';

  async function api<T>(method: 'get' | 'post', path: string, data?: unknown): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, { method, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Group view'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    const project = await api<{ id: string }>('post', '/projects', { name: 'Group view' });
    groupId = (await api<{ id: string }>('post', `/projects/${project.id}/tale-groups`, { name: 'Loose ideas' })).id;
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('adds tales with media to a group in no zone and reorders them', async () => {
    await page.goto('/tale-groups');
    await page.getByRole('button', { name: 'Loose ideas', exact: true }).click();
    const view = page.getByRole('dialog', { name: 'Loose ideas' });
    await expect(view).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/tale-groups\\?group=${groupId}$`));
    await expect(view.getByText('No tales yet.')).toBeVisible();

    const files = await drawPngs(page);
    for (const [i, title] of ['Beach', 'Pool'].entries()) {
      await view.getByRole('button', { name: 'Add tale to Loose ideas' }).click();
      const drawer = page.getByRole('dialog').last();
      await drawer.getByLabel('Tale title').fill(title);
      await drawer.locator('#create-file').setInputFiles(files[i]);
      await drawer.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(view.locator('.tale-card__name')).toHaveCount(i + 1);
    }
    await expect(view.locator('.tale-card__name')).toHaveText(['Beach', 'Pool']);
    let saved = await api<Group>('get', `/tale-groups/${groupId}`);
    expect(saved.zoneIds).toEqual([]);
    expect(saved.tales.map((t) => [t.title, t.position, !!t.media])).toEqual([
      ['Beach', 0, true],
      ['Pool', 1, true],
    ]);

    // Pool earlier, with its move button from the keyboard: saved in the group's order.
    await view.getByRole('button', { name: 'Move Pool earlier' }).focus();
    await page.keyboard.press('Enter');
    await expect(view.locator('.tale-card__name')).toHaveText(['Pool', 'Beach']);
    await expect.poll(async () => (await api<Group>('get', `/tale-groups/${groupId}`)).tales.map((t) => t.title)).toEqual([
      'Pool',
      'Beach',
    ]);

    // A reload opens the view again, in the saved order.
    await page.reload();
    await expect(view).toBeVisible();
    await expect(view.locator('.tale-card__name')).toHaveText(['Pool', 'Beach']);
    saved = await api<Group>('get', `/tale-groups/${groupId}`);
    expect(saved.tales.map((t) => t.position)).toEqual([0, 1]);
  });
});
