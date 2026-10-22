import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';
import { axeViolations } from './axe';

/**
 * Tale Studio's automated WCAG 2.2 AA scan (epic Tale Studio R13, story 7.10): a composed tale
 * (text, an image with alt text, a button and an emoji over a canvas colour) open in the studio,
 * then with each kind selected and with the preview open, reports no axe violations. The same tale
 * checks the contrast warnings in a real browser: a white text over a bright photo is judged from
 * the photo's pixels, and light grey text on white warns on the element and its layer row until
 * the colour darkens (R12).
 *
 * It signs in with a session written to the database (the first-run test owns the passkey setup),
 * so it runs whatever runs before it.
 */

const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
}

// An admin with a session, written as the API's integration tests write them; the session cookie.
async function signIn(): Promise<string> {
  const client = new pg.Client({ connectionString: process.env['E2E_DATABASE_URL'] });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO users (name, email, role, webauthn_user_id) VALUES ($1, $2, $3, $4) RETURNING id',
      ['Studio scan', `studio-${randomBytes(6).toString('hex')}@example.com`, 'admin', randomBytes(32).toString('base64url')],
    );
    const token = randomBytes(32).toString('base64url');
    await client.query(
      "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '2 hours')",
      [rows[0].id, createHash('sha256').update(token, 'utf8').digest('hex')],
    );
    return token;
  } finally {
    await client.end();
  }
}

const id = () => randomUUID();
const element = (type: string, box: number[], props: Record<string, unknown>, a11y: Record<string, unknown> = {}) => ({
  id: id(),
  type,
  box: { x: box[0], y: box[1], w: box[2], h: box[3], rotation: 0 },
  hidden: false,
  locked: false,
  a11y,
  props,
});

test.describe.serial('Tale Studio accessibility (story 7.10)', () => {
  let context: BrowserContext;
  let page: Page;
  let taleId = '';
  const ids = { title: '', photoText: '', image: '', button: '', emoji: '' };

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    await context.addCookies([{ name: 'taleart_session', value: await signIn(), url: baseURL ?? '' }]);
    page = await context.newPage();
    const api = async <T>(method: string, path: string, data?: unknown, type = 'application/json'): Promise<T> => {
      const res = await page.request.fetch(`/api/v1${path}`, {
        method,
        headers: { 'Content-Type': type },
        data: data === undefined ? undefined : type === 'application/json' ? JSON.stringify(data) : (data as Buffer),
      });
      expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
      return (await res.json()) as T;
    };
    // A bright photo, drawn in the browser.
    await page.goto('/sign-in');
    const png = Buffer.from(
      await page.evaluate(async () => {
        const canvas = new OffscreenCanvas(360, 640);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        const fill = ctx.createLinearGradient(0, 0, 0, 640);
        fill.addColorStop(0, '#fff7d6');
        fill.addColorStop(1, '#ffe08a');
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, 360, 640);
        const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
        return btoa(String.fromCharCode(...bytes));
      }),
      'base64',
    );
    const project = await api<{ id: string }>('POST', '/projects', { name: 'Studio scan' });
    const zone = await api<{ id: string }>('POST', '/zones', { name: 'Home', projectId: project.id });
    const group = await api<{ id: string }>('POST', `/zones/${zone.id}/tale-groups`, { name: 'Autumn' });
    const tale = await api<{ id: string }>('POST', `/tale-groups/${group.id}/tales`, { title: 'Autumn edit' });
    taleId = tale.id;
    const media = await api<{ key: string }>('POST', `/projects/${project.id}/media`, png, 'image/png');
    const title = element('text', [0.08, 0.14, 0.6, 0.08], { text: 'Autumn edit', color: '#FFFFFF' });
    const emoji = element('emoji', [0.78, 0.14, 0.12, 0.07], { emoji: '🍂' }, { label: 'Falling leaf' });
    const image = element('image', [0.08, 0.3, 0.84, 0.4], { mediaKey: media.key, fit: 'cover' }, { label: 'A sunlit beach' });
    const photoText = element('text', [0.12, 0.45, 0.76, 0.08], { text: 'On the photo', color: '#FFFFFF', size: 0.03 });
    const button = element('button', [0.25, 0.76, 0.5, 0.07], {
      label: 'Shop now',
      variant: 'filled',
      color: '#111827',
      fill: '#FFFFFF',
      href: 'https://example.com/shop',
    });
    Object.assign(ids, { title: title.id, photoText: photoText.id, image: image.id, button: button.id, emoji: emoji.id });
    await api('PUT', `/tales/${tale.id}/document`, {
      document: {
        version: 1,
        canvas: { background: { type: 'color', color: '#1F3A5F' } },
        elements: [image, photoText, title, emoji, button],
      },
      revision: 0,
    });
  });

  test.afterAll(async () => {
    await context.close();
  });

  const canvasEl = (elementId: string) => page.locator(`#studio-el-${elementId}`);
  const row = (elementId: string) => page.locator(`#layer-state-${elementId}`);

  test('the studio with a composed tale reports no WCAG 2.2 AA violations', async () => {
    await page.goto('/zones');
    await page.goto(`/tales/${taleId}/studio`);
    await expect(canvasEl(ids.button)).toBeVisible();
    await shot(page, 'studio-composed');
    expect(await axeViolations(page)).toEqual([]);
    for (const [name, elementId] of [
      ['text', ids.title],
      ['image', ids.image],
      ['button', ids.button],
      ['emoji', ids.emoji],
    ]) {
      // Near its corner: the text on the photo covers the image's middle.
      await canvasEl(elementId).click({ position: { x: 4, y: 4 } });
      await expect(canvasEl(elementId)).toHaveAttribute('aria-pressed', 'true');
      expect(await axeViolations(page), `with the ${name} selected`).toEqual([]);
    }
    await page.locator('#studio-preview').click();
    await expect(page.locator('#preview-host')).toBeVisible();
    await shot(page, 'studio-preview');
    expect(await axeViolations(page), 'with the preview open').toEqual([]);
    await page.locator('#studio-preview').click();
  });

  test('judges a text over a photo from its pixels', async () => {
    // White on the bright photo: read from the photo's pixels, and low.
    await expect(row(ids.photoText)).toContainText('Low contrast');
    await expect(canvasEl(ids.photoText).locator('.el__warn')).toBeVisible();
    await canvasEl(ids.photoText).click();
    await expect(page.locator('#ts-contrast')).toContainText('against the media behind it');
    await shot(page, 'contrast-over-photo');
    // A dark colour reads well on it.
    await page.locator('#ts-color-hex').fill('#1a1a1a');
    await page.locator('#ts-color-hex').press('Tab');
    await expect(row(ids.photoText)).not.toContainText('Low contrast');
    await expect(page.locator('#ts-contrast')).toContainText(/^\s*Contrast .* against the media behind it/);
    // The title on the dark canvas has enough contrast throughout.
    await expect(row(ids.title)).not.toContainText('Low contrast');
  });

  test('warns about light grey text on white on the element and its row, and clears when it darkens', async () => {
    // A white canvas.
    await page.locator('#studio-bg-hex').fill('#ffffff');
    await page.locator('#studio-bg-hex').press('Tab');
    await canvasEl(ids.title).click();
    await page.locator('#ts-color-hex').fill('#cccccc');
    await page.locator('#ts-color-hex').press('Tab');
    await expect(row(ids.title)).toContainText('Low contrast');
    await expect(canvasEl(ids.title).locator('.el__warn')).toBeVisible();
    await expect(page.locator('#ts-contrast')).toContainText('against the canvas colour');
    await shot(page, 'contrast-grey-on-white');
    await page.locator('#ts-color-hex').fill('#333333');
    await page.locator('#ts-color-hex').press('Tab');
    await expect(row(ids.title)).not.toContainText('Low contrast');
    await expect(canvasEl(ids.title).locator('.el__warn')).toHaveCount(0);
    await shot(page, 'contrast-darkened');
  });
});
