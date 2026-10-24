import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { drawPngs } from './media';
import { emptyInstall, signIn } from './session';

/**
 * Tale Studio 2's five regions (epic Tale Studio 2, story 11.1), at 1440 × 900: the canvas, the
 * palette and the inspector of a selected element all show without scrolling the page; a tale
 * composed in the new shell (a text, an image, a shape and a poll) is updated and shows on the
 * sample page as before; F6 reaches each region in order. Signs in with a session written to the
 * database and empties the install at the end. E2E_SCREENSHOTS, when set, is a folder for screenshots.
 */

const API = '/api/v1';
const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

test.describe.serial('Tale Studio 2: the studio in five regions (story 11.1)', () => {
  let context: BrowserContext;
  let page: Page;
  let taleId = '';
  let testPageUrl = '';

  async function api<T>(method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, { method, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Five regions'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    const project = await api<{ id: string }>('post', '/projects', { name: 'Shoes' });
    const zone = await api<{ id: string; slug: string }>('post', '/zones', { name: 'Home top', projectId: project.id });
    await api('post', `/zones/${zone.id}/frame`, { type: 'bar', settings: {} });
    const group = await api<{ id: string }>('post', `/zones/${zone.id}/tale-groups`, { name: 'Autumn drop' });
    taleId = (await api<{ id: string }>('post', `/tale-groups/${group.id}/tales`, { title: 'Launch' })).id;
    await api('post', `/tale-groups/${group.id}/tales`, { title: 'Last call' });
    await api('put', `/tale-groups/${group.id}/status`, { status: 'live' });
    const [png] = await drawPngs(page);
    const res = await page.request.fetch(`${API}/projects/${project.id}/media`, {
      method: 'post',
      headers: { 'Content-Type': 'image/png' },
      data: png.buffer,
    });
    expect(res.ok(), `media upload: ${res.status()}`).toBe(true);
    const { key } = await api<{ key: string }>('post', `/projects/${project.id}/site-key`, {});
    const install = await api<{ testPageUrl: string }>('get', '/install');
    testPageUrl = `${install.testPageUrl}?zone=${encodeURIComponent(zone.slug)}#siteKey=${encodeURIComponent(key)}`;
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('composes a text, an image, a shape and a poll from the tiles, and updates the tale', async () => {
    await page.goto(`/tales/${taleId}/studio`);
    await expect(page.locator('#studio-add-text')).toBeVisible({ timeout: 30_000 });

    await page.locator('#studio-add-text').click();
    const editing = page.locator('textarea.el-edit');
    await expect(editing).toBeFocused();
    const textId = ((await editing.getAttribute('id')) ?? '').replace('studio-edit-', '');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Autumn drop');
    await page.keyboard.press('Escape');

    await page.locator('#studio-add-image').click();
    const picker = page.getByRole('dialog');
    await picker.getByRole('button', { name: /^Use / }).click();
    await expect(picker).toBeHidden();
    const alt = page.locator('textarea[id^="media-alt-"]');
    await expect(alt).toBeFocused();
    await alt.fill('A running shoe');
    await alt.press('Tab');

    await page.locator('#studio-add-rectangle').click();
    await page.locator('#studio-add-poll').click();
    const question = page.locator('input[id^="field-poll-question-"]');
    await expect(question).toBeFocused();
    const pollId = ((await question.getAttribute('id')) ?? '').replace('field-poll-question-', '');
    await question.fill('Which colour next?');
    await question.press('Tab');
    for (const [i, label] of ['Ember', 'Ink'].entries()) {
      const option = page.locator(`#field-poll-options-${pollId}-${i}`);
      await option.fill(label);
      await option.press('Tab');
    }

    // The text selected: the canvas, the palette and its inspector, all on screen, and the page does not scroll.
    // Selected from its row in the Layers tab (the poll lies over it on the canvas), then back to Elements.
    await page.getByRole('tab', { name: 'Layers' }).click();
    await page.locator(`#layer-${textId}`).click();
    await expect(page.locator('#inspector-title')).toContainText('Text');
    await page.getByRole('tab', { name: 'Elements' }).click();
    const scroll = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
      innerHeight,
      innerWidth,
    }));
    expect(scroll.height).toBeLessThanOrEqual(scroll.innerHeight);
    expect(scroll.width).toBeLessThanOrEqual(scroll.innerWidth);
    await expect(page.locator('#studio-canvas')).toBeInViewport({ ratio: 1 });
    // Adding the poll scrolled the palette (it is taller than the panel since story 11.3): back to its top.
    await page.locator('#studio-panel-elements').evaluate((panel) => panel.scrollTo(0, 0));
    await expect(page.locator('#studio-panel-elements .tiles').first()).toBeInViewport({ ratio: 1 });
    // The palette (story 11.3) is taller than the panel: its search shows, and the panel scrolls on its own to the rest.
    await expect(page.locator('#studio-palette-search')).toBeInViewport({ ratio: 1 });
    await page.locator('#studio-add-quiz').scrollIntoViewIfNeeded();
    await expect(page.locator('#studio-add-quiz')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
    await expect(page.locator('#studio-text')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.studio-strip [aria-current=page]')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.studio-strip a')).toHaveCount(2);
    if (shots) await page.screenshot({ path: join(shots, 'studio2-11-1-composed.png') });

    // F6 visits the regions in order from the top bar.
    await page.locator('#studio-back').focus();
    const regions: string[] = [];
    for (let n = 0; n < 5; n++) {
      await page.keyboard.press('F6');
      regions.push(
        await page.evaluate(() => document.activeElement?.closest('[data-region]')?.getAttribute('data-region') ?? ''),
      );
    }
    expect(regions).toEqual(['left', 'canvas', 'inspector', 'strip', 'top']);
    await expect(page.locator(`#studio-el-${textId}`)).toHaveCount(1);

    await expect(page.locator('#studio-update')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 15_000 });
    await page.locator('#studio-update').click();
    await expect
      .poll(async () =>
        (
          await api<{ published: { document: { elements: { type: string }[] } | null } }>(
            'get',
            `/tales/${taleId}/document`,
          )
        ).published.document?.elements.map((e) => e.type),
      )
      .toEqual(['text', 'image', 'shape', 'poll']);
  });

  test('the sample page shows the updated tale', async ({ browser }) => {
    const site = await browser.newPage();
    await site.goto(testPageUrl);
    const items = site.locator('taleart-view button.item');
    await expect(items).toHaveCount(1, { timeout: 20_000 });
    await items.first().click();
    const viewer = site.locator('taleart-view dialog');
    await expect(viewer).toContainText('Autumn drop');
    await expect(viewer.locator('button.ta-poll-opt')).toHaveText(['Ember', 'Ink']);
    if (shots) await site.screenshot({ path: join(shots, 'studio2-11-1-sample-page.png') });
    await site.close();
  });
});
