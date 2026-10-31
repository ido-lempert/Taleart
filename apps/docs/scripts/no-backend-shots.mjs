// Takes the screenshots of the docs page "Use without a backend" (apps/docs/public/images/no-backend-*.png): the live bar,
// the viewer it opens, the live banner and the editor with broken JSON, from the built docs site, so they show the real Web
// SDK running on the page's inline zone data. Not shipped: a script for the docs' images.
//
// Usage (after `nx build docs`): node apps/docs/scripts/no-backend-shots.mjs
// The docs site is served from this script on NO_BACKEND_PORT (default 4701) and nothing else is started.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../../..');
const site = join(root, 'dist/apps/docs/browser');
const out = join(root, 'apps/docs/public/images');
const port = Number(process.env.NO_BACKEND_PORT || 4701);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(site, path);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(site, path, 'index.html');
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((ok) => server.listen(port, '127.0.0.1', ok));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  await page.goto(`http://127.0.0.1:${port}/guides/no-backend`);
  await page.waitForSelector('#live-bar-status:has-text("Rendered by the Web SDK")');
  await page.waitForFunction(() => document.querySelectorAll('.live taleart-view').length === 3);
  // The pictures are small local files; wait until each live element drew its display.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.live taleart-view')].every((el) => el.shadowRoot?.querySelector('.bar, .banner')),
  );
  await page.waitForTimeout(600);

  // The sticky header would cover the top of an element shot.
  await page.addStyleTag({ content: 'header, .topbar, [class*="header"] { position: static !important; }' });
  const shot = async (selector, name) => {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.locator(selector).first().screenshot({ path: join(out, name) });
    console.log('wrote', name);
  };
  await shot('div.live[aria-label="A live bar"]', 'no-backend-bar.png');
  await shot('div.live[aria-label="A live banner"]', 'no-backend-banner.png');

  // The errors: break the example with the page's own button.
  await page.getByRole('button', { name: 'Break it' }).click();
  await page.waitForSelector('#zone-errors li');
  await shot('div.live[aria-label="A live editor"]', 'no-backend-errors.png');

  // The viewer, on a phone: open the first group of the live bar.
  const phone = await browser.newPage({ viewport: { width: 430, height: 800 }, deviceScaleFactor: 1 });
  await phone.goto(`http://127.0.0.1:${port}/guides/no-backend`);
  await phone.waitForFunction(() => document.querySelector('#live-bar-status')?.textContent?.includes('Rendered'));
  await phone.waitForTimeout(500);
  await phone.evaluate(() => document.querySelector('#live-bar-status')?.scrollIntoView());
  await phone.evaluate(() => document.querySelector('.live taleart-view')?.shadowRoot?.querySelector('button.item')?.click());
  await phone.waitForFunction(() => document.querySelector('.live taleart-view')?.shadowRoot?.querySelector('dialog.viewer[open]'));
  await phone.waitForTimeout(1200);
  await phone.screenshot({ path: join(out, 'no-backend-viewer.png') });
  console.log('wrote no-backend-viewer.png');
  if (problems.length) console.log('console problems:', problems);
} finally {
  await browser.close();
  server.close();
}
