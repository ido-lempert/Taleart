import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { emptyInstall, signIn } from './session';

/**
 * Tale Studio 2: drag an element onto the canvas, or add it with a click or a key (epic Tale
 * Studio 2 R3, story 11.4). A real mouse drag of the Poll tile to the lower third lands it under the
 * pointer, snapped to the centre guide, selected, focused and announced; a drop on the workspace
 * outside the stage, or Escape, adds nothing and says "Not added"; with the keyboard only, Tab to
 * Rating and Enter adds it at the next free spot, selected and focused on the canvas; one undo
 * removes each add. Signs in with a session written to the database and empties the install at the
 * end. E2E_SCREENSHOTS, when set, is a folder for screenshots.
 */

const API = '/api/v1';
const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

test.describe.serial('Tale Studio 2: drag onto the canvas, or add by key (story 11.4)', () => {
  let context: BrowserContext;
  let page: Page;
  let taleId = '';

  async function api<T>(method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, { method, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  const live = () => page.locator('#studio-live');
  const stage = () => page.locator('#studio-canvas');
  const elements = () => page.locator('#studio-canvas [id^="studio-el-"]');
  /** Empties the live region, so what it says next is from the step under test. */
  const clearLive = async () => {
    // The text node the page writes to is kept, emptied, so the page's next message still shows.
    await live().evaluate((el) => el.childNodes.forEach((node) => (node.nodeValue = '')));
    await expect(live()).toHaveText('');
  };

  async function centreOf(target: Locator): Promise<{ x: number; y: number }> {
    const box = await target.boundingBox();
    if (!box) throw new Error('not on screen');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Presses the tile with the mouse and moves, in steps, to (x, y); releases unless told not to. */
  async function drag(tile: Locator, x: number, y: number, release = true): Promise<void> {
    await tile.scrollIntoViewIfNeeded();
    const from = await centreOf(tile);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y, { steps: 2 });
    await page.mouse.move(x, y, { steps: 12 });
    if (release) await page.mouse.up();
  }

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Drag'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    const project = await api<{ id: string }>('post', '/projects', { name: 'Drag' });
    const zone = await api<{ id: string }>('post', '/zones', { name: 'Home top', projectId: project.id });
    const group = await api<{ id: string }>('post', `/zones/${zone.id}/tale-groups`, { name: 'Autumn drop' });
    taleId = (await api<{ id: string }>('post', `/tale-groups/${group.id}/tales`, { title: 'Launch' })).id;
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('drags a Poll to the lower third: under the pointer, snapped to the centre, selected and announced', async () => {
    await page.goto(`/tales/${taleId}/studio`);
    await expect(page.locator('#studio-add-poll')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.canvas__hint')).toHaveText('Drag an element here, or pick one on the left.');
    const box = await stage().boundingBox();
    if (!box) throw new Error('no stage');
    // 3 px right of the centre line, two thirds of the way down.
    const x = box.x + box.width / 2 + 3;
    const y = box.y + box.height * 0.66;
    await drag(page.locator('#studio-add-poll'), x, y, false);
    const ghost = page.locator('.drag-ghost');
    await expect(ghost).toBeVisible();
    await expect(ghost).toHaveClass(/is-over/);
    await expect(page.locator('.snap-line--x')).toBeVisible();
    await expect(page.locator('.guides')).toHaveClass(/guides--dragging/);
    // The ghost is the poll at its size on the canvas: 80% by 28% of the stage.
    const g = await ghost.boundingBox();
    expect(Math.abs((g?.width ?? 0) - box.width * 0.8)).toBeLessThan(2);
    expect(Math.abs((g?.height ?? 0) - box.height * 0.28)).toBeLessThan(2);
    if (shots) await page.screenshot({ path: join(shots, 'drag-01-in-progress.png') });
    expect(await elements().count()).toBe(0);
    await page.mouse.up();

    await expect(elements()).toHaveCount(1);
    const poll = elements().first();
    await expect(poll).toHaveAttribute('aria-pressed', 'true');
    await expect(poll).toBeFocused();
    await expect(page.locator('.drag-ghost')).toHaveCount(0);
    // Centred on the stage's centre line (snapped), its middle under the pointer.
    const at = await centreOf(poll);
    expect(Math.abs(at.x - (box.x + box.width / 2))).toBeLessThan(1.5);
    expect(Math.abs(at.y - y)).toBeLessThan(2);
    await expect(live()).toHaveText(/^Poll added at left 10%, top 5[12](\.\d)?% of the tale\. Selected\. Press F6 for its properties\.$/);
    if (shots) await page.screenshot({ path: join(shots, 'drag-02-after-drop.png') });
  });

  test('a drop on the workspace outside the stage adds nothing and says so', async () => {
    await clearLive();
    const box = await stage().boundingBox();
    if (!box) throw new Error('no stage');
    await drag(page.locator('#studio-add-rectangle'), box.x - 20, box.y + box.height / 2, false);
    await expect(page.locator('.drag-ghost')).toBeVisible();
    await expect(page.locator('.drag-ghost')).not.toHaveClass(/is-over/);
    await page.mouse.up();
    await expect(live()).toHaveText('Not added');
    await expect(elements()).toHaveCount(1);
  });

  test('Escape cancels a drag: nothing is added, then or on release', async () => {
    const box = await stage().boundingBox();
    if (!box) throw new Error('no stage');
    await clearLive();
    await drag(page.locator('#studio-add-rectangle'), box.x + box.width / 2, box.y + box.height * 0.3, false);
    await expect(page.locator('.drag-ghost')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.drag-ghost')).toHaveCount(0);
    await expect(live()).toHaveText('Not added');
    // The release afterwards adds nothing and says nothing more.
    await clearLive();
    await page.mouse.up();
    await page.waitForTimeout(500);
    await expect(live()).toHaveText('');
    await expect(elements()).toHaveCount(1);
  });

  test('keyboard only: Tab to Rating and Enter adds it at the next free spot, selected and focused', async () => {
    await page.locator('#studio-palette-search').focus();
    const rating = page.locator('#studio-add-rating');
    for (let n = 0; n < 40 && !(await rating.evaluate((el) => el === document.activeElement)); n++) {
      await page.keyboard.press('Tab');
    }
    await expect(rating).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(elements()).toHaveCount(2);
    const added = elements().nth(1);
    await expect(added).toBeFocused();
    await expect(added).toHaveAttribute('aria-pressed', 'true');
    await expect(added).toHaveAttribute('aria-label', /^Rating/);
    // The centre of the safe area: the poll's centre is lower down, so the spot is free.
    await expect(live()).toHaveText('Rating added near the centre of the safe area. Selected. Press F6 for its properties.');
    if (shots) {
      await page.screenshot({ path: join(shots, 'drag-03-keyboard-add.png') });
      // The live region is visually hidden: shown for the screenshot only.
      await live().evaluate((el) => {
        el.classList.remove('visually-hidden');
        el.setAttribute(
          'style',
          'position:fixed;left:16px;bottom:16px;width:auto;height:auto;clip:auto;margin:0;padding:8px 12px;background:#111827;color:#fff;font:600 14px system-ui;border-radius:8px;z-index:2000',
        );
      });
      await page.screenshot({ path: join(shots, 'drag-04-announcement.png') });
      await live().evaluate((el) => {
        el.removeAttribute('style');
        el.classList.add('visually-hidden');
      });
    }
  });

  test('one undo removes each add', async () => {
    await page.locator('#studio-undo').click();
    await expect(elements()).toHaveCount(1);
    await page.locator('#studio-undo').click();
    await expect(elements()).toHaveCount(0);
    // And the drop is saved like any change: redo it and the draft holds the poll.
    await page.locator('#studio-redo').click();
    await expect(elements()).toHaveCount(1);
    await expect
      .poll(async () => (await api<{ document: { elements: { type: string }[] } | null }>('get', `/tales/${taleId}/document`)).document?.elements.map((e) => e.type), {
        timeout: 15_000,
      })
      .toEqual(['poll']);
  });
});
