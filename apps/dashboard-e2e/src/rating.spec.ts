import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import pg from 'pg';
import { e2eDatabase } from '../scripts/e2e-database.mjs';
import { emptyInstall, signIn } from './session';

/**
 * A Rating, end to end (epic interactive components story 4.2): added in Tale Studio with a heart
 * emoji and updated to the site; on the test page one visitor drags the emoji to 80 and sees the
 * average while the viewer stays on the same tale and group, and another sets 40 with the arrow
 * keys and Enter, which makes the average 60; the inspector shows 2 ratings averaging 60; a Rating
 * whose emoji is 'ab' is refused on save; a rating in the studio preview records nothing. Signs in
 * with a session written to the database and empties the install at the end. E2E_SCREENSHOTS, when
 * set, is a folder for screenshots.
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
const slider = (page: Page) => page.locator('taleart-view dialog .ta-rating [role="slider"]');
const viewer = (page: Page) => page.locator('taleart-view dialog');

/**
 * The element's box once the viewer's opening motion is over: the same in five reads in a row, 50 ms
 * apart (about 200 ms without a change). Throws when it never settles within 5 s.
 */
async function settledBox(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  let last = '';
  let same = 0;
  for (const deadline = Date.now() + 5_000; Date.now() < deadline; ) {
    const box = await locator.boundingBox();
    const now = JSON.stringify(box);
    same = box && now === last ? same + 1 : 0;
    last = now;
    if (box && same >= 4) return box;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The slider did not stop moving');
}

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

test.describe.serial('a Rating (epic interactive components story 4.2)', () => {
  let context: BrowserContext;
  let page: Page;
  let taleId = '';
  let testPageUrl = '';

  async function api<T>(method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, { method, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  // The test page afresh, with the Rating's group open in the viewer.
  async function openRating(site: Page): Promise<void> {
    await site.goto('about:blank');
    await site.goto(testPageUrl);
    await expect(barItems(site)).toHaveCount(2, { timeout: 20_000 });
    await barItems(site).first().click();
    await expect(slider(site)).toHaveCount(1);
  }

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    await context.addCookies([{ name: 'taleart_session', value: await signIn('A rating'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    const project = await api<{ id: string }>('post', '/projects', { name: 'Ratings' });
    const zone = await api<{ id: string; slug: string }>('post', '/zones', { name: 'Home top', projectId: project.id });
    await api('post', `/zones/${zone.id}/frame`, { type: 'bar', settings: {} });
    const group = await api<{ id: string }>('post', `/zones/${zone.id}/tale-groups`, { name: 'Beach' });
    taleId = (await api<{ id: string }>('post', `/tale-groups/${group.id}/tales`, { title: 'Sunset' })).id;
    await api('put', `/tale-groups/${group.id}/status`, { status: 'live' });
    // A second group after it: a sideways swipe on the first would show this one.
    const next = await api<{ id: string }>('post', `/zones/${zone.id}/tale-groups`, { name: 'Mountains' });
    const nextTale = (await api<{ id: string }>('post', `/tale-groups/${next.id}/tales`, { title: 'Peak' })).id;
    await api('put', `/tales/${nextTale}/document`, {
      document: { version: 1, canvas: { background: { type: 'color', color: '#0F766E' } }, elements: [] },
      revision: 0,
    });
    await api('post', `/tales/${nextTale}/document/publish`, { revision: 1, publishedRevision: 0 });
    await api('put', `/tale-groups/${next.id}/status`, { status: 'live' });
    const { key } = await api<{ key: string }>('post', `/projects/${project.id}/site-key`, {});
    const install = await api<{ testPageUrl: string }>('get', '/install');
    testPageUrl = `${install.testPageUrl}?zone=${encodeURIComponent(zone.slug)}#siteKey=${encodeURIComponent(key)}`;
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('adds a Rating with a heart emoji in Tale Studio and updates the tale', async () => {
    await page.goto(`/tales/${taleId}/studio`);
    await page.locator('#studio-add-rating').click();
    const question = page.locator('input[id^="field-rating-question-"]');
    // Focus is on the new element on the canvas (story 11.4); its inspector shows its fields.
    await expect(page.locator('[id^="studio-el-"]:focus')).toHaveCount(1);
    const id = (await question.getAttribute('id'))?.replace('field-rating-question-', '') ?? '';
    await question.fill('How was the sunset?');
    await question.press('Tab');
    // The emoji field opens the emoji picker; the heart is chosen by keyboard there.
    const choose = page.locator(`#field-rating-emoji-${id}`);
    await choose.click();
    await page.locator('#emoji-search').fill('red heart');
    await page.locator('app-tale-emoji-picker button[aria-label="red heart"]').press('Enter');
    await expect(page.locator('app-tale-emoji-picker')).toHaveCount(0);
    await expect(choose).toHaveAttribute('aria-label', 'Choose emoji… Current: red heart');
    await expect(page.locator('#studio-responses-total')).toHaveText('0 ratings');
    await expect(page.locator('#studio-add-rating')).toHaveAttribute('aria-disabled', 'true');
    await page.locator('#studio-update').click();
    await expect
      .poll(async () => (await api<{ published: { document: { elements: { type: string; props: { emoji?: string } }[] } | null } }>('get', `/tales/${taleId}/document`)).published.document?.elements.map((e) => [e.type, e.props.emoji]))
      .toEqual([['rating', '❤️']]);
    await shot(page, 'rating-01-studio');
  });

  test("refuses to save a Rating whose emoji is 'ab'", async () => {
    const { document, revision } = await api<{ document: { elements: { props: Record<string, unknown> }[] }; revision: number }>(
      'get',
      `/tales/${taleId}/document`,
    );
    const bad = { ...document, elements: document.elements.map((e) => ({ ...e, props: { ...e.props, emoji: 'ab' } })) };
    const res = await page.request.fetch(`${API}/tales/${taleId}/document`, { method: 'put', data: { document: bad, revision } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatchObject({ code: 'invalid_tale_document', pointer: '/elements/0/props/emoji' });
  });

  test('a rating in the studio preview records nothing', async () => {
    await page.locator('#studio-preview').click();
    const preview = page.locator('#studio-preview-pane .ta-rating [role="slider"]');
    await preview.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page.locator('#studio-preview-pane .ta-rating [aria-live=polite]')).toHaveText(
      'You rated 100. Ratings are not recorded in the preview.',
    );
    expect(await responseRows()).toEqual([]);
    await page.locator('#studio-preview').click();
  });

  test('drags the emoji to 80 on the test page: the average shows, and the viewer stays put', async ({ browser }) => {
    const site = await browser.newPage();
    await openRating(site);
    const where = async () => [await viewer(site).getAttribute('aria-label'), await viewer(site).locator('.segment.done').count()];
    const before = await where();
    const box = await settledBox(slider(site));
    const y = box.y + box.height / 2;
    // A long sideways drag, from the end back to 80: on the stage it would swipe between groups.
    await site.mouse.move(box.x + box.width * 0.98, y);
    await site.mouse.down();
    await site.mouse.move(box.x + box.width * 0.2, y, { steps: 8 });
    await site.mouse.move(box.x + box.width * 0.8, y, { steps: 8 });
    await site.mouse.up();
    await expect(slider(site)).toHaveAttribute('aria-valuenow', '80');
    await expect(site.locator('taleart-view dialog .ta-rate-out')).toHaveText('Average 80 from 1 rating');
    await expect(slider(site)).toHaveAttribute('aria-disabled', 'true');
    expect(await where()).toEqual(before);
    await shot(site, 'rating-02-dragged');
    expect((await responseRows()).map((r) => r.value)).toEqual(['80']);
    await site.close();
  });

  test('another visitor sets 40 with the arrow keys and Enter: the average reads 60', async ({ browser }) => {
    const other = await browser.newContext();
    const site = await other.newPage();
    await openRating(site);
    const before = await viewer(site).getAttribute('aria-label');
    await slider(site).focus();
    await expect(viewer(site)).toHaveAttribute('data-paused', '');
    await site.keyboard.press('ArrowLeft');
    await expect(slider(site)).toHaveAttribute('aria-valuenow', '40');
    await site.keyboard.press('Enter');
    await expect(site.locator('taleart-view dialog .ta-rate-out')).toHaveText('Average 60 from 2 ratings');
    await expect(site.locator('taleart-view dialog .ta-rating [aria-live=polite]')).toHaveText(
      'You rated 40. Average 60 from 2 ratings.',
    );
    await expect(viewer(site)).toHaveAttribute('aria-label', before ?? '');
    await expect(viewer(site).locator('.segment.done')).toHaveCount(0);
    await shot(site, 'rating-03-keyboard');

    // A return visit shows the kept rating and takes no second one.
    await openRating(site);
    await expect(slider(site)).toHaveAttribute('aria-valuenow', '40');
    await expect(slider(site)).toHaveAttribute('aria-disabled', 'true');
    await slider(site).focus();
    await site.keyboard.press('End');
    await site.keyboard.press('Enter');
    await expect(slider(site)).toHaveAttribute('aria-valuenow', '40');
    expect((await responseRows()).map((r) => r.value)).toEqual(['80', '40']);
    await other.close();
  });

  test('the inspector shows 2 ratings averaging 60', async () => {
    await page.locator('#studio-responses-refresh').click();
    await expect(page.locator('#studio-responses-total')).toHaveText('2 ratings, average 60');
    await expect(page.locator('#studio-responses-note')).toContainText('already has ratings');
    await shot(page, 'rating-04-inspector');
  });
});
