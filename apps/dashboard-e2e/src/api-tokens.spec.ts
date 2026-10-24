import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';
import { e2eDatabase } from '../scripts/e2e-database.mjs';
import { axeViolations } from './axe';
import { emptyInstall, signIn } from './session';
import { scan } from './wcag';

/**
 * Settings > API tokens (epic developer experience 10.1): create a read-only token for one project,
 * see it once with Copy, use it from a script (no cookie), see it listed by prefix only, and revoke it
 * after a confirmation. `@a11y` scans each state of the page for WCAG 2.2 AA.
 *
 * E2E_SCREENSHOTS, when set, is a folder the tests save screenshots in.
 */

const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });
const apiOrigin = `http://localhost:${process.env['E2E_API_PORT'] || 3413}`;

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

// A script's request: the token as a bearer, never the browser's cookie.
function script(method: string, path: string, token: string, body?: unknown): Promise<Response> {
  return fetch(`${apiOrigin}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function storedTokens(): Promise<{ token_hash: string; prefix: string }[]> {
  const client = new pg.Client({ connectionString: e2eDatabase(process.env).url });
  await client.connect();
  try {
    return (await client.query<{ token_hash: string; prefix: string }>('SELECT * FROM api_tokens')).rows;
  } finally {
    await client.end();
  }
}

async function setUp(browser: import('@playwright/test').Browser, baseURL: string | undefined, who: string) {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'taleart_session', value: await signIn(who), url: baseURL ?? '' }]);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL ?? '' });
  const page = await context.newPage();
  const api = async <T>(path: string, data: unknown): Promise<T> => {
    const res = await page.request.post(`/api/v1${path}`, { data });
    expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  };
  const acme = await api<{ id: string }>('/projects', { name: 'Acme' });
  const beta = await api<{ id: string }>('/projects', { name: 'Beta' });
  await api('/zones', { name: 'Home top', projectId: acme.id });
  const betaZone = await api<{ id: string }>('/zones', { name: 'Beta home', projectId: beta.id });
  return { context, page, acme: acme.id, beta: beta.id, betaZone: betaZone.id };
}

async function fillForm(page: Page, name: string): Promise<void> {
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Only the projects I pick').check();
  await page.getByRole('group', { name: 'Projects the token can reach' }).getByLabel('Acme').check();
  await expect(page.getByLabel('Read-only')).toBeChecked();
}

test.describe.serial('API tokens for scripts (story 10.1)', () => {
  let context: BrowserContext;
  let page: Page;
  let acme = '';
  let betaZone = '';
  let token = '';

  test.beforeAll(async ({ browser, baseURL }) => {
    ({ context, page, acme, betaZone } = await setUp(browser, baseURL, 'API tokens'));
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('Settings > API tokens starts empty', async () => {
    await page.goto('/zones');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings\/api-tokens$/);
    await expect(page.getByRole('heading', { name: 'API tokens' })).toBeVisible();
    await expect(page.getByText('No API tokens yet.')).toBeVisible();
    await shot(page, '01-api-tokens-empty');
    expect(await axeViolations(page)).toEqual([]);
  });

  test('creates a read-only token for one project and shows it once with Copy', async () => {
    await fillForm(page, 'Nightly import');
    await shot(page, '02-api-tokens-create-form');
    await page.getByRole('button', { name: 'Create token' }).click();

    const drawer = page.getByRole('dialog', { name: 'Token created' });
    await expect(drawer).toBeVisible();
    token = await drawer.getByLabel('API token').inputValue();
    expect(token).toMatch(/^tat_[A-Za-z0-9_-]{43}$/);
    await drawer.getByRole('button', { name: 'Copy token' }).click();
    await expect(drawer.getByRole('status')).toHaveText('Token copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);
    await shot(page, '03-api-tokens-shown-once');
    expect(await axeViolations(page)).toEqual([]);

    await drawer.getByRole('button', { name: 'Done' }).click();
    await expect(drawer).toBeHidden();
    // Focus goes back to the button that created it.
    await expect(page.getByRole('button', { name: 'Create token' })).toBeFocused();
    const item = page.getByRole('listitem').filter({ hasText: 'Nightly import' });
    await expect(item).toContainText(`${token.slice(0, 10)}…`);
    await expect(item).toContainText('Read-only · Acme');
    await expect(item).toContainText('Never');
    await shot(page, '04-api-tokens-list');

    // Never shown again: not in the page, and not after a reload.
    expect(await page.content()).not.toContain(token);
    await page.reload();
    await expect(page.getByRole('listitem').filter({ hasText: 'Nightly import' })).toBeVisible();
    expect(await page.content()).not.toContain(token);

    // The database holds only its hash.
    const rows = await storedTokens();
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test('a script reads its project with the token, cannot write, and cannot reach another project', async () => {
    const zones = await script('GET', '/zones', token);
    expect(zones.status).toBe(200);
    expect((await zones.json()).map((z: { projectId: string }) => z.projectId)).toEqual([acme]);
    expect((await script('POST', '/zones', token, { name: 'From a script', projectId: acme })).status).toBe(403);
    expect((await script('GET', `/zones/${betaZone}/tale-groups`, token)).status).toBe(403);
    // The list now says when it was last used.
    await page.reload();
    await expect(page.getByRole('listitem').filter({ hasText: 'Nightly import' })).not.toContainText('Last usedNever');
  });

  test('revokes the token after a confirmation; the script is refused', async () => {
    await page.getByRole('button', { name: 'Revoke Nightly import' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Revoke API token' });
    await expect(confirm).toContainText('Scripts that use it stop working at once');
    await shot(page, '05-api-tokens-revoke-confirmation');
    expect(await axeViolations(page)).toEqual([]);
    await confirm.getByRole('button', { name: 'Revoke token' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByText('No API tokens yet.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your tokens' })).toBeFocused();
    await shot(page, '06-api-tokens-revoked');

    const after = await script('GET', '/zones', token);
    expect(after.status).toBe(401);
    expect((await after.json()).error.code).toBe('unauthenticated');
  });
});

test.describe.serial('WCAG 2.2 AA scan of Settings > API tokens (story 10.1) @a11y', () => {
  let context: BrowserContext;
  let page: Page;
  const results: Record<string, string[]> = {};

  async function check(state: string, layout = false): Promise<void> {
    if (shots) await page.screenshot({ path: join(shots, `a11y-api-tokens-${state}.png`) });
    results[state] = await scan(page, { layout });
  }

  test.beforeAll(async ({ browser, baseURL }) => {
    ({ context, page } = await setUp(browser, baseURL, 'API tokens scan'));
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('scans each state of the page', async () => {
    await page.goto('/settings/api-tokens');
    await expect(page.getByText('No API tokens yet.')).toBeVisible();
    await check('empty', true);

    // A form error, tied to its field.
    await page.getByRole('button', { name: 'Create token' }).click();
    await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Name')).toBeFocused();
    await check('name-error');

    await fillForm(page, 'Scan token');
    await check('picking-projects');
    await page.getByRole('button', { name: 'Create token' }).click();
    const drawer = page.getByRole('dialog', { name: 'Token created' });
    await expect(drawer).toBeVisible();
    // Focus starts on the token, selected, so it can be copied at once.
    await expect(drawer.getByLabel('API token')).toBeFocused();
    await check('shown-once');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    await check('list', true);
    await page.getByRole('button', { name: 'Revoke Scan token' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog', { name: 'Revoke API token' })).toBeVisible();
    await check('revoke-confirmation');
    await page.keyboard.press('Escape');
    // Escape cancels; focus returns to the Revoke button.
    await expect(page.getByRole('button', { name: 'Revoke Scan token' })).toBeFocused();

    const findings = Object.entries(results).flatMap(([state, list]) => list.map((f) => `${state}: ${f}`));
    expect(findings).toEqual([]);
  });
});
