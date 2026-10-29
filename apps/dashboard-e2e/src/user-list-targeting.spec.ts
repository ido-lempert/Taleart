import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { emptyInstall, signIn } from './session';

/**
 * A group targeted to user lists; the viewer's external user ID picks them (epic targeting story
 * 5.4, R4, R5, R7). The Audience drawer names the project's user lists with their ID counts and
 * saves them; the row then reads "Visible on site · for user list Loyal (2)". A group targeted only
 * to an empty list reads "Not visible: its user lists are empty". The Delivery API shows the group
 * to a viewer whose ID (in its header, never the URL) is in the list, and leaves it out for anyone
 * else, with `private, no-store`. The Audience page says which groups each list targets.
 */

const API = '/api/v1';
const apiOrigin = `http://localhost:${Number(process.env['E2E_API_PORT'] || 3413)}`;
const HEADER = 'X-TaleArt-External-User-Id';
const MEMBERS = ['cust-1001', 'm\u00FCller-7'];

const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

const b64 = (id: string) => Buffer.from(id, 'utf8').toString('base64url');

test.describe.serial('user-list targeting (epic targeting story 5.4)', () => {
  let context: BrowserContext;
  let page: Page;
  let projectId = '';
  let zoneId = '';
  let zoneKey = '';
  const groupIds: Record<string, string> = {};
  const listIds: Record<string, string> = {};

  async function api<T>(method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, { method, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  // A live group in the zone with one published tale, so the site shows it.
  async function visibleGroup(name: string): Promise<void> {
    const group = await api<{ id: string }>('post', `/zones/${zoneId}/tale-groups`, { name });
    groupIds[name] = group.id;
    const tale = await api<{ id: string }>('post', `/tale-groups/${group.id}/tales`, { title: `${name} tale` });
    const state = await api<{ revision: number; published: { revision: number } }>('get', `/tales/${tale.id}/document`);
    const document = { version: 1, canvas: { background: { type: 'color', color: '#1d4ed8' } }, elements: [] };
    const saved = await api<{ revision: number }>('put', `/tales/${tale.id}/document`, { document, revision: state.revision });
    await api('post', `/tales/${tale.id}/document/publish`, { revision: saved.revision, publishedRevision: state.published.revision });
    await api('put', `/tale-groups/${group.id}/status`, { status: 'live' });
  }

  // The Delivery API's groups for a viewer, as the Web SDK asks: the ID in its header only.
  async function delivered(id: string | null): Promise<{ names: string[]; cacheControl: string | null; url: string }> {
    const url = `${apiOrigin}/delivery/v1/zone`;
    const headers: Record<string, string> = { Authorization: `Bearer ${zoneKey}` };
    if (id !== null) headers[HEADER] = b64(id);
    const res = await page.request.get(url, { headers });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { taleGroups: { name: string }[] };
    return { names: body.taleGroups.map((g) => g.name), cacheControl: res.headers()['cache-control'] ?? null, url };
  }

  const indicator = (scope: Page | Locator, name: string): Locator =>
    scope.locator('app-group-row').filter({ has: page.getByRole('heading', { name, exact: true }) }).locator('app-visibility');

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Lists'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    projectId = (await api<{ id: string }>('post', '/projects', { name: 'Lists' })).id;
    zoneId = (await api<{ id: string }>('post', '/zones', { name: 'Home top', projectId })).id;
    await api('post', `/zones/${zoneId}/frame`, { type: 'bar', settings: {} });
    zoneKey = (await api<{ key: string }>('post', `/zones/${zoneId}/key`, {})).key;
    for (const name of ['Loyal only', 'Nobody yet', 'Everyone']) await visibleGroup(name);
    for (const [name, csv] of [
      ['Loyal', `${MEMBERS.join('\n')}\n`],
      ['Empty', ''],
    ] as const) {
      listIds[name] = (await api<{ id: string }>('post', `/projects/${projectId}/user-lists`, { name })).id;
      if (csv) {
        const res = await page.request.post(`${API}/projects/${projectId}/user-lists/${listIds[name]}/ids`, {
          headers: { 'Content-Type': 'text/csv' },
          data: Buffer.from(csv),
        });
        expect(res.ok()).toBe(true);
      }
    }
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('the Audience drawer names the user lists with their counts and saves them', async () => {
    await page.goto(`/zones/${zoneId}`);
    await page.getByRole('button', { name: 'More for Loyal only' }).click();
    await page.getByRole('menuitem', { name: 'Audience' }).click();
    const drawer = page.getByRole('dialog').last();
    const lists = drawer.getByRole('group', { name: 'User lists' });
    await expect(lists.getByRole('checkbox')).toHaveCount(2);
    await expect(lists.getByRole('checkbox', { name: 'Loyal (2 IDs)' })).not.toBeChecked();
    await expect(lists.getByRole('checkbox', { name: 'Empty (0 IDs)' })).not.toBeChecked();
    await expect(lists).toHaveAccessibleDescription('With no user list, the group does not depend on who the viewer is.');
    await lists.getByRole('checkbox', { name: 'Loyal (2 IDs)' }).check();
    await expect(lists).toHaveAccessibleDescription(
      'Shows only to viewers whose external user ID, set by the page with setExternalUserId, is in this list.',
    );
    await expect(drawer.getByText('Targeting is not access control')).toBeVisible();
    await lists.scrollIntoViewIfNeeded();
    await shot(page, 'audience-drawer-with-lists');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(indicator(page, 'Loyal only').getByRole('button')).toHaveAccessibleName(
      'Visible on site \u00B7 for user list Loyal (2)',
    );
    await expect(indicator(page, 'Loyal only').getByRole('button')).toHaveAccessibleDescription(
      'Shown to viewers whose external user ID is in the user list Loyal (2 IDs). A page that sets no external user ID does not show it.',
    );
    await expect(indicator(page, 'Everyone')).toHaveText('Visible on site', { useInnerText: true });
    await shot(page, 'group-summary-user-list');
  });

  test('a group targeted only to an empty list is not visible, and nobody gets it', async () => {
    await api('put', `/tale-groups/${groupIds['Nobody yet']}/user-lists`, { userListIds: [listIds['Empty']] });
    await page.reload();
    await expect(indicator(page, 'Nobody yet')).toContainText('Not visible: its user lists are empty');
    await shot(page, 'audience-empty-indicator');
    for (const viewer of [MEMBERS[0], 'cust-9999', null]) expect((await delivered(viewer)).names).not.toContain('Nobody yet');
  });

  test('the Delivery API shows the list group only to a viewer in the list, never with the ID in the URL', async () => {
    for (const member of MEMBERS) {
      const read = await delivered(member);
      expect(read.names).toEqual(['Loyal only', 'Everyone']);
      expect(read.cacheControl).toBe('private, no-store');
      expect(read.url).not.toContain(member);
      expect(read.url).not.toContain(b64(member));
    }
    expect((await delivered('cust-9999')).names).toEqual(['Everyone']);
    const anonymous = await delivered(null);
    expect(anonymous.names).toEqual(['Everyone']);
    expect(anonymous.cacheControl).toBe('private, no-cache');
  });

  test('the sample page sends each ID only in its header and shows that viewer\'s groups; never an ID in a URL', async () => {
    // The sample page (apps/sdk-sample) on its own origin, with the SDK the API serves as its module.
    const dir = [resolve(process.cwd(), '../sdk-sample'), resolve(process.cwd(), 'apps/sdk-sample')].find((d) =>
      existsSync(join(d, 'index.html')),
    );
    expect(dir, 'apps/sdk-sample/index.html').toBeTruthy();
    const html = readFileSync(join(dir as string, 'index.html'), 'utf8');
    const sdk = await (await fetch(`${apiOrigin}/sdk/v1/taleart.js`)).text();
    const server: Server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path === '/') res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      else if (path === '/sdk/index.js') res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(sdk);
      else res.writeHead(404).end();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const sample = await context.newPage();
    const seen: { url: string; header: string | null }[] = [];
    sample.on('request', (req) => seen.push({ url: req.url(), header: req.headers()[HEADER.toLowerCase()] ?? null }));
    const bar = sample.locator('taleart-view button.item');
    const names = () => bar.evaluateAll((items) => items.map((b) => b.getAttribute('aria-label')));
    try {
      // The first viewer from the fragment, as the page reads it.
      const hash = new URLSearchParams({ zoneKeys: zoneKey, externalUserId: MEMBERS[0] }).toString();
      await sample.goto(`${origin}/?api=${encodeURIComponent(apiOrigin)}#${hash}`);
      await expect.poll(names, { timeout: 20_000 }).toEqual(['Loyal only', 'Everyone']);
      // The second viewer typed in the form; then a viewer not in the list; then no ID.
      await sample.getByLabel('External user ID').fill(MEMBERS[1]);
      await sample.getByRole('button', { name: 'Set ID' }).click();
      await expect.poll(names, { timeout: 20_000 }).toEqual(['Loyal only', 'Everyone']);
      await sample.getByLabel('External user ID').fill('cust-9999');
      await sample.keyboard.press('Enter');
      await expect.poll(names, { timeout: 20_000 }).toEqual(['Everyone']);
      await sample.getByRole('button', { name: 'No ID' }).click();
      await expect.poll(() => seen.filter((r) => r.url.includes('/delivery/v1/zone')).at(-1)?.header ?? 'none').toBe('none');
      await expect.poll(names).toEqual(['Everyone']);
      // Enter in the field never submitted the form: the page is where it was, with no ID in its URL.
      expect(sample.url()).not.toContain('cust-9999');

      const zoneReads = seen.filter((r) => r.url.includes('/delivery/v1/zone'));
      expect(zoneReads.map((r) => r.header)).toEqual([b64(MEMBERS[0]), b64(MEMBERS[1]), b64('cust-9999'), null]);
      for (const request of seen) {
        for (const id of [...MEMBERS, 'cust-9999']) {
          expect(request.url, 'a request URL').not.toContain(id);
          expect(request.url, 'a request URL').not.toContain(encodeURIComponent(id));
          expect(request.url, 'a request URL').not.toContain(b64(id));
        }
      }
    } finally {
      await sample.close();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  test('the Audience page says which groups each list targets, and what deleting one does to them', async () => {
    await page.goto('/audience');
    const row = page.locator('.user-list').filter({ has: page.getByRole('heading', { name: 'Loyal', exact: true }) });
    await expect(row).toContainText('Targets Loyal only');
    await expect(page.locator('.user-list').filter({ has: page.getByRole('heading', { name: 'Empty', exact: true }) })).toContainText(
      'Targets Nobody yet',
    );
    await row.getByRole('button', { name: 'Delete Loyal' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(
      'It is removed from the tale group Loyal only. Groups targeted only to this list will stop showing until you change their Audience.',
    );
    await dialog.getByRole('button', { name: 'Delete user list' }).click();
    await expect(dialog).toBeHidden();
    // The group is held hidden, never public: the zone page says why, and no viewer gets it.
    await page.goto(`/zones/${zoneId}`);
    await expect(indicator(page, 'Loyal only')).toContainText('Not visible: its user lists were removed');
    await shot(page, 'audience-removed-indicator');
    for (const viewer of [MEMBERS[0], null]) expect((await delivered(viewer)).names).not.toContain('Loyal only');
  });
});
