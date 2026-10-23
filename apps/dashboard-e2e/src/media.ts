import type { Page } from '@playwright/test';

/** Two small PNGs, drawn in the browser: the media a user picks for a group's tales. */
export async function drawPngs(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer }[]> {
  const drawn = await page.evaluate(async () => {
    const out: string[] = [];
    for (const [top, bottom] of [
      ['#f97316', '#7c2d12'],
      ['#14b8a6', '#134e4a'],
    ]) {
      const canvas = new OffscreenCanvas(360, 640);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      const fill = ctx.createLinearGradient(0, 0, 0, 640);
      fill.addColorStop(0, top);
      fill.addColorStop(1, bottom);
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, 360, 640);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
      out.push(btoa(String.fromCharCode(...bytes)));
    }
    return out;
  });
  return [
    { name: 'beach_day.png', mimeType: 'image/png', buffer: Buffer.from(drawn[0], 'base64') },
    { name: 'pool.png', mimeType: 'image/png', buffer: Buffer.from(drawn[1], 'base64') },
  ];
}
