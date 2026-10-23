import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';
import { e2eDatabase } from '../scripts/e2e-database.mjs';
import { emptyInstall, signIn } from './session';

/**
 * A poll, end to end (epic interactive components story 4.1): added in Tale Studio and updated to the
 * site; voted on the test page by keyboard, with the percentages shown, the choice marked and the
 * tale not stepped; shown again after a reload with no second vote; a vote in the studio preview
 * records nothing; the inspector counts the votes. Signs in with a session written to the database
 * and empties the install at the end. E2E_SCREENSHOTS, when set, is a folder for screenshots.
 */

const API = '/api/v1';
const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  await new Promise((resolve) => setTimeout(resolve, 700));
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

const barItems = (page: Page) => page.locator('taleart-view button.item');
const pollOptions = (page: Page) => page.locator('taleart-view dialog button.ta-poll-opt');

// The responses recorded so far, read from the e2e database.
async function responseRows(): Promise<{ value: string }[]> {
  const client = new pg.Client({ connectionString: e2eDatabase(process.env).url });
  await client.connect();
  try {
    return (await client.query<{ value: string }>('SELECT value FROM interactive_responses ORDER BY created_at')).rows;
  } finally {
    await client.end();
  }
}

test.describe.serial('a poll (epic interactive components story 4.1)', () => {
  let context: BrowserContext;
  let page: Page;
  let taleId = '';
  let testPageUrl = '';

  async function api<T>(method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, { method, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  // The test page afresh (it drops the key's fragment), with the poll's tale open in the viewer.
  async function openPoll(site: Page): Promise<void> {
    await site.goto('about:blank');
    await site.goto(testPageUrl);
    await expect(barItems(site)).toHaveCount(1, { timeout: 20_000 });
    await barItems(site).first().click();
    await expect(pollOptions(site)).toHaveCount(2);
  }

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    await context.addCookies([{ name: 'taleart_session', value: await signIn('A poll'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    const project = await api<{ id: string }>('post', '/projects', { name: 'Polls' });
    const zone = await api<{ id: string; slug: string }>('post', '/zones', { name: 'Home top', projectId: project.id });
    await api('post', `/zones/${zone.id}/frame`, { type: 'bar', settings: {} });
    const group = await api<{ id: string }>('post', `/zones/${zone.id}/tale-groups`, { name: 'Breakfast' });
    taleId = (await api<{ id: string }>('post', `/tale-groups/${group.id}/tales`, { title: 'Morning' })).id;
    await api('put', `/tale-groups/${group.id}/status`, { status: 'live' });
    const { key } = await api<{ key: string }>('post', `/projects/${project.id}/site-key`, {});
    const install = await api<{ testPageUrl: string }>('get', '/install');
    testPageUrl = `${install.testPageUrl}?zone=${encodeURIComponent(zone.slug)}#siteKey=${encodeURIComponent(key)}`;
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('adds a poll in Tale Studio and updates the tale', async () => {
    await page.goto(`/tales/${taleId}/studio`);
    await page.locator('#studio-add-poll').click();
    const question = page.locator('input[id^="field-poll-question-"]');
    await expect(question).toBeFocused();
    const id = (await question.getAttribute('id'))?.replace('field-poll-question-', '') ?? '';
    await question.fill('Tea or coffee?');
    await question.press('Tab');
    // Typed one after another: each option's edit lands on the poll as it is then.
    for (const [i, label] of ['Tea', 'Coffee'].entries()) {
      const option = page.locator(`#field-poll-options-${id}-${i}`);
      await option.fill(label);
      await option.press('Tab');
    }
    await expect(page.locator('#studio-responses li')).toHaveText(['Tea0', 'Coffee0']);
    await expect(page.locator('#studio-add-poll')).toHaveAttribute('aria-disabled', 'true');
    await page.locator('#studio-update').click();
    await expect
      .poll(async () => (await api<{ published: { document: { elements: { type: string }[] } | null } }>('get', `/tales/${taleId}/document`)).published.document?.elements.map((e) => e.type))
      .toEqual(['poll']);
    await shot(page, 'poll-01-studio');
  });

  test('a vote in the studio preview records nothing', async () => {
    await page.locator('#studio-preview').click();
    const tea = page.locator('#studio-preview-pane button.ta-poll-opt').first();
    await tea.click();
    await expect(tea).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#studio-preview-pane .ta-poll [aria-live=polite]')).toHaveText(
      'You chose Tea. Votes are not recorded in the preview.',
    );
    expect(await responseRows()).toEqual([]);
    await page.locator('#studio-preview').click();
  });

  test('votes Tea by keyboard on the test page: percentages, the choice marked, no step', async ({ browser }) => {
    // A visitor of its own: a new context, with its own storage and visitor id.
    const site = await browser.newPage();
    await openPoll(site);
    const tea = pollOptions(site).first();
    await tea.focus();
    await expect(site.locator('taleart-view dialog')).toHaveAttribute('data-paused', '');
    await site.keyboard.press('Enter');
    await expect(tea).toHaveAttribute('aria-pressed', 'true');
    await expect(pollOptions(site)).toHaveText(['Tea100%', 'Coffee0%']);
    await expect(site.locator('taleart-view dialog .ta-poll [aria-live=polite]')).toHaveText('You voted Tea. Tea 100%, Coffee 0%');
    await expect(site.locator('taleart-view dialog .segment.done')).toHaveCount(0);
    await shot(site, 'poll-02-test-page-voted');
    expect(await responseRows()).toHaveLength(1);

    // Reload: the choice and percentages show, and no second vote is possible.
    await openPoll(site);
    await expect(pollOptions(site).first()).toHaveAttribute('aria-pressed', 'true');
    await expect(pollOptions(site)).toHaveText(['Tea100%', 'Coffee0%']);
    // Marked aria-disabled, which Playwright waits on: a forced press, as a visitor's tap would be.
    await expect(pollOptions(site).nth(1)).toHaveAttribute('aria-disabled', 'true');
    await pollOptions(site).nth(1).click({ force: true });
    await expect(pollOptions(site).nth(1)).toHaveAttribute('aria-pressed', 'false');
    expect(await responseRows()).toHaveLength(1);
    await site.close();
  });

  test('the inspector shows Tea 1, Coffee 0', async () => {
    await page.locator('#studio-responses-refresh').click();
    await expect(page.locator('#studio-responses li')).toHaveText(['Tea1', 'Coffee0']);
    await expect(page.locator('#studio-responses-note')).toContainText('already has votes');
    await shot(page, 'poll-03-inspector-counts');
  });
});
