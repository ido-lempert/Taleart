import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { axeViolations } from './axe';
import { emptyInstall, signIn } from './session';

/**
 * Tale Studio's automated WCAG 2.2 AA scan (epic Tale Studio R13, story 7.10): a composed tale
 * (text, an image with alt text, a button and an emoji over a canvas colour) open in the studio,
 * then with each kind selected and with the preview open, reports no axe violations. The same tale
 * checks the contrast warnings in a real browser: a white text over a bright photo is judged from
 * the photo's pixels, and light grey text on white warns on the element and its layer row until
 * the colour darkens (R12).
 *
 * A second tale checks the sampling itself: a picture whose top half is white and bottom half
 * black (a white text on each half; a rotated white label whose upright bounds reach into a white
 * corner its turned box does not touch), and a white video's first frame under a white text.
 *
 * It signs in with a session written to the database (the first-run test owns the
 * passkey setup), and at the end empties the users and projects again, so the first-run test finds
 * an empty install whichever runs first.
 */

const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
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
  let pixelsId = '';
  const ids = { title: '', photoText: '', image: '', button: '', emoji: '' };
  const px = { top: '', bottom: '', turned: '', onVideo: '' };

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
    // A picture with a white top half and a black bottom half, with a white top-left quadrant only
    // in the variant for the rotated label; and a white video, recorded from a canvas.
    const drawn = await page.evaluate(async () => {
      const toBase64 = async (blob: Blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(text);
      };
      const halves = new OffscreenCanvas(360, 640);
      const h = halves.getContext('2d');
      if (!h) throw new Error('no 2d context');
      h.fillStyle = '#000000';
      h.fillRect(0, 0, 360, 640);
      h.fillStyle = '#ffffff';
      h.fillRect(0, 0, 360, 320);
      // The bottom-right quarter of the top half is black: the rotated label's corner.
      h.fillStyle = '#000000';
      h.fillRect(180, 160, 180, 160);
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const c = canvas.getContext('2d');
      if (!c) throw new Error('no 2d context');
      const recorder = new MediaRecorder(canvas.captureStream(10), { mimeType: 'video/webm' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      const stopped = new Promise((done) => (recorder.onstop = done));
      recorder.start();
      const started = performance.now();
      while (performance.now() - started < 1200) {
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, 160, 90);
        await new Promise((done) => setTimeout(done, 100));
      }
      recorder.stop();
      await stopped;
      return {
        halves: await toBase64(await halves.convertToBlob({ type: 'image/png' })),
        video: await toBase64(new Blob(chunks, { type: 'video/webm' })),
      };
    });
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

    // The sampling tale. On the 180 x 320 sample canvas the picture's white is the top half, less
    // its bottom-right quarter (x 90 and up, y 80 to 160).
    const pixels = await api<{ id: string }>('POST', `/tale-groups/${group.id}/tales`, { title: 'Pixels' });
    pixelsId = pixels.id;
    const halves = await api<{ key: string }>('POST', `/projects/${project.id}/media`, Buffer.from(drawn.halves, 'base64'), 'image/png');
    const clip = await api<{ key: string }>('POST', `/projects/${project.id}/media`, Buffer.from(drawn.video, 'base64'), 'video/webm');
    const white = { color: '#FFFFFF', size: 0.02 };
    const top = element('text', [0.1, 0.1, 0.8, 0.06], { text: 'On white', ...white });
    const bottom = element('text', [0.1, 0.62, 0.8, 0.06], { text: 'On black', ...white });
    // A thin label turned -45 degrees about (95, 185) px: its ends at about (57, 223) and (133, 147),
    // all on black; its upright bounds (x 57 to 133, y 147 to 223) reach into the white at the
    // top left (x < 90, y < 160), which reading the bounds would count.
    const turned = { ...element('text', [0.229, 0.568, 0.597, 0.02], { text: 'Turned', ...white }), box: { x: 0.229, y: 0.568, w: 0.597, h: 0.02, rotation: -45 } };
    const video = element('video', [0.05, 0.8, 0.5, 0.15], { mediaKey: clip.key, fit: 'cover' }, { label: 'White' });
    const onVideo = element('text', [0.07, 0.84, 0.46, 0.06], { text: 'On video', ...white });
    Object.assign(px, { top: top.id, bottom: bottom.id, turned: turned.id, onVideo: onVideo.id });
    await api('PUT', `/tales/${pixels.id}/document`, {
      document: {
        version: 1,
        canvas: { background: { type: 'color', color: '#000000' } },
        elements: [
          element('image', [0, 0, 1, 1], { mediaKey: halves.key, fit: 'cover' }, { label: 'Halves' }),
          top,
          bottom,
          turned,
          video,
          onVideo,
        ],
      },
      revision: 0,
    });
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
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

  test('reads the pixels behind each label: halves, a rotated label and a video frame', async () => {
    await page.goto(`/tales/${pixelsId}/studio`);
    await expect(canvasEl(px.top)).toBeVisible();
    // White on the white half: low; on the black half: enough.
    await expect(row(px.top)).toContainText('Low contrast');
    await expect(row(px.bottom)).not.toContainText('Low contrast');
    // The rotated label is read inside its turned box, which lies on black only.
    await page.locator(`#layer-${px.turned}`).click();
    await expect(page.locator('#ts-contrast')).toContainText(/Contrast about \d+\.\d:1 against the media behind it/);
    await expect(row(px.turned)).not.toContainText('Low contrast');
    // The video's first frame (white) lies behind the white text.
    await expect(row(px.onVideo)).toContainText('Low contrast');
    await shot(page, 'contrast-pixels');
  });
});
