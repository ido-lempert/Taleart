import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';
import { e2eDatabase } from '../scripts/e2e-database.mjs';
import { emptyInstall, signIn } from './session';

/**
 * User lists from a CSV, stored only as keyed hashes (epic targeting story 5.3, R3, R5), on the
 * Audience page: create a list with the verify CSV (10 rows with a duplicate and a 300-character
 * value, and an empty row) and read the report; create one from a CSV of emails, warned before and
 * after sending but not refused; rename; delete with the confirmation. The database is read after
 * each step: no uploaded ID is in it in clear, and a deleted list leaves no row.
 */

const API = '/api/v1';
const IDS = ['cust-1001', 'cust-1002', 'Cust-1002', 'cust-1003', 'cust-1004', 'cust-1005'];
const LONG = 'L'.repeat(300);
const VERIFY_CSV = [...IDS, 'cust-1001', 'cust-1006', '', LONG, '"cust-1007"'].join('\n') + '\n';
const EMAILS = ['ana@example.com', 'bo@example.org', 'cy@example.net', 'dee@example.com'];
const UPLOADED = [...IDS, 'cust-1006', 'cust-1007', LONG, ...EMAILS];

const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
}

// Every row of every table as text, and each hash as raw bytes, from the e2e database.
async function dump(): Promise<string> {
  const client = new pg.Client({ connectionString: e2eDatabase(process.env).url });
  await client.connect();
  try {
    const { rows: tables } = await client.query<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const parts: string[] = [];
    for (const { name } of tables) {
      const { rows } = await client.query<{ row: string }>(`SELECT t::text AS row FROM "${name}" t`);
      parts.push(...rows.map((r) => r.row));
    }
    return parts.join('\n');
  } finally {
    await client.end();
  }
}

async function rowsOf(listId: string): Promise<number> {
  const client = new pg.Client({ connectionString: e2eDatabase(process.env).url });
  await client.connect();
  try {
    const lists = await client.query('SELECT 1 FROM user_lists WHERE id = $1', [listId]);
    const ids = await client.query('SELECT 1 FROM user_list_ids WHERE user_list_id = $1', [listId]);
    return (lists.rowCount ?? 0) + (ids.rowCount ?? 0);
  } finally {
    await client.end();
  }
}

test.describe.serial('user lists on the Audience page (epic targeting story 5.3)', () => {
  let context: BrowserContext;
  let page: Page;
  let projectId = '';

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Lists'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    const res = await page.request.post(`${API}/projects`, { data: { name: 'Shop' } });
    expect(res.ok()).toBe(true);
    projectId = ((await res.json()) as { id: string }).id;
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('creates a list from the verify CSV: 8 IDs, and the report names the refused line', async () => {
    await page.goto('/audience');
    await page.getByRole('link', { name: 'Audience' }).first().waitFor();
    await expect(page.getByRole('tab', { name: 'User lists', selected: true })).toBeVisible();
    await expect(page.getByText('No user lists yet')).toBeVisible();
    await page.getByRole('button', { name: 'New user list' }).click();
    const drawer = page.getByRole('dialog', { name: 'New user list' });
    await drawer.getByLabel('Name').fill('Loyal customers');
    await drawer.getByLabel(/CSV file/).setInputFiles({ name: 'loyal.csv', mimeType: 'text/csv', buffer: Buffer.from(VERIFY_CSV) });
    await expect(drawer.getByText(/look like/)).toHaveCount(0);
    await drawer.getByRole('button', { name: 'Create list' }).click();
    const report = drawer.getByRole('list', { name: 'Created Loyal customers' });
    await expect(report.getByRole('listitem')).toHaveText([
      'Added 8 IDs.',
      '1 row already in the list (or earlier in the file).',
      '1 row refused: line 10 (longer than 256 characters).',
      '1 empty row skipped.',
      'The list now holds 8 IDs.',
    ]);
    await shot(page, 'user-lists-report');
    await drawer.getByRole('button', { name: 'Done' }).click();
    const row = page.locator('.user-list').filter({ hasText: 'Loyal customers' });
    await expect(row).toContainText('8 IDs');
    await expect(page.getByRole('button', { name: 'New user list' })).toBeFocused();
    const dumped = await dump();
    for (const id of UPLOADED) expect(dumped.includes(id), 'an uploaded ID in clear in the database').toBe(false);
  });

  test('a CSV of emails is warned about before and after sending, and the list is still created', async () => {
    await page.getByRole('button', { name: 'New user list' }).click();
    const drawer = page.getByRole('dialog', { name: 'New user list' });
    await drawer.getByLabel('Name').fill('Newsletter');
    await drawer
      .getByLabel(/CSV file/)
      .setInputFiles({ name: 'emails.csv', mimeType: 'text/csv', buffer: Buffer.from(`email\n${EMAILS.join('\n')}\n`) });
    await drawer.getByLabel('The first row is a header (skip it)').check();
    await expect(drawer.getByRole('status')).toContainText('Most of these values look like email addresses');
    await shot(page, 'user-lists-email-warning');
    await drawer.getByRole('button', { name: 'Create list' }).click();
    await expect(drawer.getByRole('list', { name: 'Created Newsletter' })).toContainText('Added 4 IDs.');
    await expect(drawer.getByRole('note')).toContainText('You can still upload this file.');
    await drawer.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.user-list').filter({ hasText: 'Newsletter' })).toContainText('4 IDs');
    const dumped = await dump();
    for (const id of EMAILS) expect(dumped.includes(id), 'an email in clear in the database').toBe(false);
  });

  test('renames a list and deletes one after asking; no row of it remains', async () => {
    await page.getByRole('button', { name: 'Rename Newsletter' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename user list' });
    await rename.getByLabel('Name').fill('Newsletter readers');
    await rename.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByRole('heading', { name: 'Newsletter readers' })).toBeVisible();

    const lists = (await (await page.request.get(`${API}/projects/${projectId}/user-lists`)).json()) as { id: string; name: string }[];
    const loyal = lists.find((l) => l.name === 'Loyal customers')?.id ?? '';
    await page.getByRole('button', { name: 'Delete Loyal customers' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete user list' });
    await expect(dialog).toHaveAccessibleDescription(
      'Delete Loyal customers and the 8 IDs it holds? They are deleted for good, not kept anywhere. This cannot be undone.',
    );
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await shot(page, 'user-lists-delete');
    await dialog.getByRole('button', { name: 'Delete user list' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Loyal customers' })).toHaveCount(0);
    await expect(page.getByRole('status').last()).toContainText('Loyal customers deleted');
    expect(await rowsOf(loyal)).toBe(0);
  });
});
