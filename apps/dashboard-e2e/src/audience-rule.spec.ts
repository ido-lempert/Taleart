import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { emptyInstall, signIn } from './session';

/**
 * The audience rule of a tale group (epic viewer properties): the Audience drawer's "Audience rule"
 * section. A rule of two conditions is added and saved, and it reads back after a reload, with the
 * group's row saying who it is for ("for viewers where plan is pro and age ≥ 30"). "Try it" says
 * whether the group would show for sample properties typed as JSON, and what an empty box does
 * (shown). A refused draft says why on its own row and takes focus there. Clear removes the rule.
 * The group is made visible through the API (a display, a zone key, a live group with a tale).
 */

const API = '/api/v1';
const SUMMARY = 'Visible on site in at least one zone · for viewers where plan is pro and age ≥ 30';

const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

test.describe.serial('the audience rule of a tale group (epic viewer properties)', () => {
  let context: BrowserContext;
  let page: Page;
  let zoneId = '';
  let groupId = '';

  async function api<T>(method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, { method, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  // A live group in the zone with one published tale, so the site shows it (and the row shows its rule).
  async function visibleGroup(name: string): Promise<string> {
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
    return group.id;
  }

  // The Audience drawer of the group, opened from its ⋯ menu on the Tale groups page.
  async function openAudience(): Promise<Locator> {
    await page.goto('/tale-groups');
    await page.getByRole('button', { name: 'More for Pro members' }).click();
    await page.getByRole('menuitem', { name: 'Audience' }).click();
    const drawer = page.getByRole('dialog', { name: 'Audience', exact: true });
    await expect(drawer.getByRole('group', { name: 'Audience rule' })).toBeVisible();
    return drawer;
  }

  const propertyFields = (drawer: Locator) => drawer.getByLabel('Property', { exact: true });
  const valueFields = (drawer: Locator) => drawer.getByLabel('Value', { exact: true });
  const operatorFields = (drawer: Locator) => drawer.getByLabel('Operator');

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Rules'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    const project = await api<{ id: string }>('post', '/projects', { name: 'Rules' });
    zoneId = (await api<{ id: string }>('post', '/zones', { name: 'Home top', projectId: project.id })).id;
    await api('post', `/zones/${zoneId}/frame`, { type: 'bar', settings: {} });
    await api('post', `/zones/${zoneId}/key`, {});
    groupId = await visibleGroup('Pro members');
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('a rule of two conditions is saved, and reads back after a reload with the group saying who it is for', async () => {
    const drawer = await openAudience();
    await drawer.getByRole('button', { name: 'Add condition' }).click();
    await propertyFields(drawer).nth(0).fill('plan');
    await valueFields(drawer).nth(0).fill('pro');
    await drawer.getByRole('button', { name: 'Add condition' }).click();
    await propertyFields(drawer).nth(1).fill('age');
    await operatorFields(drawer).nth(1).selectOption({ label: 'is at least' });
    await valueFields(drawer).nth(1).fill('30');
    await shot(page, 'audience-rule-editor');
    await drawer.getByRole('button', { name: 'Save audience rule' }).click();
    await expect(page.locator('#audience-rule-status')).toHaveText('Audience rule saved.');

    const saved = await api<{ audience: { match: string; conditions: unknown[] } | null }>('get', `/tale-groups/${groupId}`);
    expect(saved.audience).toEqual({
      match: 'all',
      conditions: [
        { property: 'plan', operator: 'eq', value: 'pro' },
        { property: 'age', operator: 'gte', value: 30 },
      ],
    });

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Pro members', exact: true })).toBeVisible();
    const indicator = page
      .locator('app-group-row')
      .filter({ has: page.getByRole('heading', { name: 'Pro members', exact: true }) })
      .locator('app-visibility')
      .getByRole('button');
    await expect(indicator).toHaveAccessibleName(SUMMARY);

    // Reload: the rule opens as the rows that were saved.
    await page.reload();
    const again = await openAudience();
    await expect(propertyFields(again).nth(0)).toHaveValue('plan');
    await expect(valueFields(again).nth(0)).toHaveValue('pro');
    await expect(propertyFields(again).nth(1)).toHaveValue('age');
    await expect(operatorFields(again).nth(1)).toHaveValue('gte');
    await expect(valueFields(again).nth(1)).toHaveValue('30');
    await page.keyboard.press('Escape');
    await expect(again).toBeHidden();
  });

  test('Try it says whether the group would show, and that a viewer with no properties sees it', async () => {
    const drawer = await openAudience();
    const result = page.locator('#audience-try-result');
    const sample = drawer.locator('#audience-sample');

    await sample.fill('{"plan": "pro", "age": 34}');
    await expect(result).toHaveText('This group would show: the audience rule passes for these properties.');

    await sample.fill('{"plan": "pro", "age": 12}');
    await expect(result).toHaveText('This group would be hidden: the audience rule fails for these properties.');

    await sample.fill('{"plan": ');
    await expect(result).toContainText('The sample is not valid JSON');

    await sample.fill('');
    await expect(result).toHaveText('This group would show: no properties were passed, so every rule passes.');
    await shot(page, 'audience-rule-try-it');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('a refused rule says why on its row, and focus goes to that row', async () => {
    const drawer = await openAudience();
    await drawer.getByRole('button', { name: 'Add condition' }).click();
    // The third row is left without a property: Save refuses it, with the reason on the row.
    await drawer.getByRole('button', { name: 'Save audience rule' }).click();
    const row = propertyFields(drawer).nth(2);
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute('aria-invalid', 'true');
    // The reason shows on the row (its field error) and in the refusal banner, which says it again.
    await expect(drawer.locator('p.field__error')).toContainText('property must be 1 to 64 characters');
    await expect(drawer.locator('#audience-rule-error')).toContainText('property must be 1 to 64 characters');
    await expect(page.locator('#audience-rule-status')).toHaveText('');

    // Typing an invalid name shows its reason at once, on that row.
    await row.fill('1plan');
    await expect(drawer.locator('p.field__error')).toContainText('property must be 1 to 64 characters');
    await shot(page, 'audience-rule-refused');

    // Removing it leaves the saved rule as it was, and Save is accepted again.
    await drawer.getByRole('button', { name: 'Remove condition 3' }).click();
    await expect(propertyFields(drawer)).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('Clear removes the rule: the group reads Visible on site again, and no rule is kept', async () => {
    const drawer = await openAudience();
    await drawer.getByRole('button', { name: 'Clear audience rule' }).click();
    await expect(page.locator('#audience-rule-status')).toHaveText('Audience rule cleared.');
    await expect(propertyFields(drawer)).toHaveCount(0);

    const cleared = await api<{ audience: unknown }>('get', `/tale-groups/${groupId}`);
    expect(cleared.audience).toBeNull();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    const indicator = page
      .locator('app-group-row')
      .filter({ has: page.getByRole('heading', { name: 'Pro members', exact: true }) })
      .locator('app-visibility');
    await expect(indicator).toHaveText('Visible on site in at least one zone', { useInnerText: true });
    await expect(indicator.getByRole('button')).toHaveCount(0);
  });
});
