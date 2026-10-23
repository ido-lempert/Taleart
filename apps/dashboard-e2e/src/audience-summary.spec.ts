import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { emptyInstall, signIn } from './session';

/**
 * A targeted group says who it is for (epic targeting story 5.2, R7): on the zone page, the group
 * view and the Tale groups page, a visible group with targeting tags reads "Visible on site · for
 * viewers tagged summer or vip" (Any) or "… summer and vip" (All), and an untagged one only
 * "Visible on site"; the Tale groups page's Targeted filter lists exactly the tagged groups. The
 * summary is checked in the accessibility tree: it is the indicator's accessible name. The groups
 * are made visible through the API (a display, a site key, a live group with a published tale).
 */

const API = '/api/v1';
const ANY_LINE = 'Visible on site · for viewers tagged summer or vip';
const ALL_LINE = 'Visible on site · for viewers tagged summer and vip';

const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

test.describe.serial('a targeted group says who it is for (epic targeting story 5.2)', () => {
  let context: BrowserContext;
  let page: Page;
  let zoneId = '';

  async function api<T>(method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, { method, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  // A live group in the zone with one published tale, so the site shows it, and its tags.
  async function visibleGroup(name: string, tagIds: string[], tagMatch: 'any' | 'all'): Promise<void> {
    const group = await api<{ id: string }>('post', `/zones/${zoneId}/tale-groups`, { name });
    const tale = await api<{ id: string }>('post', `/tale-groups/${group.id}/tales`, { title: `${name} tale` });
    const state = await api<{ revision: number; published: { revision: number } }>('get', `/tales/${tale.id}/document`);
    const document = { version: 1, canvas: { background: { type: 'color', color: '#1d4ed8' } }, elements: [] };
    const saved = await api<{ revision: number }>('put', `/tales/${tale.id}/document`, { document, revision: state.revision });
    await api('post', `/tales/${tale.id}/document/publish`, {
      revision: saved.revision,
      publishedRevision: state.published.revision,
    });
    await api('put', `/tale-groups/${group.id}/status`, { status: 'live' });
    if (tagIds.length > 0) await api('put', `/tale-groups/${group.id}/tags`, { tagIds, tagMatch });
  }

  // The indicator of the row whose name is `name`.
  const indicator = (scope: Page | Locator, name: string): Locator =>
    scope.locator('app-group-row').filter({ has: page.getByRole('heading', { name, exact: true }) }).locator('app-visibility');

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Audience'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    const project = await api<{ id: string }>('post', '/projects', { name: 'Audience' });
    zoneId = (await api<{ id: string }>('post', '/zones', { name: 'Home top', projectId: project.id })).id;
    await api('post', `/zones/${zoneId}/frame`, { type: 'bar', settings: {} });
    await api('post', `/projects/${project.id}/site-key`, {});
    const summer = await api<{ id: string }>('post', `/projects/${project.id}/tags`, { name: 'summer' });
    const vip = await api<{ id: string }>('post', `/projects/${project.id}/tags`, { name: 'vip' });
    await visibleGroup('Beach days', [summer.id, vip.id], 'any');
    await visibleGroup('Members club', [summer.id, vip.id], 'all');
    await visibleGroup('Everyone', [], 'any');
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('the zone page rows say who each targeted group is for, in the indicator accessible name', async () => {
    await page.goto(`/zones/${zoneId}`);
    const beach = indicator(page, 'Beach days');
    await expect(beach.getByRole('button')).toHaveAccessibleName(ANY_LINE);
    await expect(indicator(page, 'Members club').getByRole('button')).toHaveAccessibleName(ALL_LINE);
    // The whole subtree, as the accessibility tree has it: one button, named by the line, described
    // by the full audience.
    await expect(beach).toMatchAriaSnapshot(`- button "${ANY_LINE}"`);
    await expect(beach.getByRole('button')).toHaveAccessibleDescription(
      'Shown to viewers tagged with any of summer or vip. A page that passes no tags shows it to every viewer.',
    );
    // An untagged group: "Visible on site" and nothing more, not a button.
    const everyone = indicator(page, 'Everyone');
    await expect(everyone).toHaveText('Visible on site');
    await expect(everyone.getByRole('button')).toHaveCount(0);
    await expect(everyone).toMatchAriaSnapshot('- text: Visible on site');
    // The tooltip opens on focus, as the reasons of a hidden group do.
    await beach.getByRole('button').focus();
    await expect(page.getByRole('tooltip')).toContainText('Shown to viewers tagged with any of summer or vip.');
    await shot(page, 'targeting-5-2-zone-rows');
    await page.keyboard.press('Escape');
  });

  test('the group view says it too', async () => {
    await page.getByRole('button', { name: 'Members club', exact: true }).click();
    const view = page.getByRole('dialog', { name: 'Members club' });
    await expect(view).toBeVisible();
    await expect(view.locator('.group-view__visibility').getByRole('button')).toHaveAccessibleName(ALL_LINE);
    await shot(page, 'targeting-5-2-group-view');
    await page.keyboard.press('Escape');
    await expect(view).toBeHidden();
  });

  test('the Tale groups page says it for any zone, and its Targeted filter lists exactly the tagged groups', async () => {
    await page.goto('/tale-groups');
    await expect(indicator(page, 'Beach days').getByRole('button')).toHaveAccessibleName(
      'Visible on site in at least one zone · for viewers tagged summer or vip',
    );
    await expect(indicator(page, 'Everyone')).toHaveText('Visible on site in at least one zone');
    const targeted = page.getByRole('radio', { name: /^Targeted/ });
    await expect(targeted).toHaveAccessibleName('Targeted , 2');
    await targeted.check();
    await expect(page).toHaveURL(/\/tale-groups\?filter=targeted$/);
    const list = page.getByRole('list', { name: 'Tale groups in Audience: Targeted' });
    await expect(list.getByRole('heading')).toHaveText(['Beach days', 'Members club']);
    await shot(page, 'targeting-5-2-tale-groups-targeted');
  });
});
