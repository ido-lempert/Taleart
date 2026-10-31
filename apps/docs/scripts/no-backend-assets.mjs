// Draws the four pictures the "Use without a backend" page's live examples show: flat landscapes as SVG, rendered to
// JPEG (540 x 960, a tale's 9:16) with the Chromium that Playwright installs. Original artwork made for this repository;
// nothing is downloaded. Run `node apps/docs/scripts/no-backend-assets.mjs` from the repository root to redraw
// apps/docs/public/images/no-backend/art-*.jpg.
import { mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const out = join(resolve(import.meta.dirname, '../../..'), 'apps/docs/public/images/no-backend');
mkdirSync(out, { recursive: true });
const W = 540;
const H = 960;

const sky = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const hill = (y, amp, fill, shift = 0) =>
  `<path d="M0 ${y} C ${140 + shift} ${y - amp}, ${300 - shift} ${y + amp}, ${W} ${y - amp / 2} L ${W} ${H} L 0 ${H} Z" fill="${fill}"/>`;

const SCENES = {
  hills: `<defs>${sky('s', '#f6c58d', '#fbe9c8')}</defs><rect width="${W}" height="${H}" fill="url(#s)"/>
    <circle cx="380" cy="300" r="90" fill="#f08a5d" opacity=".9"/>
    ${hill(560, 70, '#c9855a')}${hill(660, 60, '#9a6a4d', 60)}${hill(770, 50, '#6b4a3a', -40)}${hill(870, 40, '#3f2e29', 30)}`,
  city: `<defs>${sky('s', '#1d2a4a', '#4b5d8f')}</defs><rect width="${W}" height="${H}" fill="url(#s)"/>
    <circle cx="140" cy="210" r="46" fill="#f4efd6"/>
    ${[40, 120, 200, 290, 370, 450].map((x, i) => `<rect x="${x}" y="${520 + (i % 3) * 70}" width="${70 + (i % 2) * 20}" height="${H}" fill="${['#101a30', '#16233f', '#0d1526'][i % 3]}"/>`).join('')}
    ${Array.from({ length: 36 }, (_, i) => `<rect x="${52 + (i % 6) * 70}" y="${560 + Math.floor(i / 6) * 60}" width="12" height="18" fill="#f7d774" opacity="${i % 3 ? 0.85 : 0.2}"/>`).join('')}`,
  sea: `<defs>${sky('s', '#8fd3e8', '#e6f6f2')}</defs><rect width="${W}" height="${H}" fill="url(#s)"/>
    <circle cx="150" cy="260" r="70" fill="#fff6c9"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M0 ${520 + i * 70} Q 135 ${480 + i * 70} 270 ${520 + i * 70} T ${W} ${520 + i * 70} L ${W} ${H} L 0 ${H} Z" fill="${['#4fb3c8', '#3a9ab5', '#2b829f', '#216a88', '#175470', '#0f405a'][i]}"/>`).join('')}`,
  meadow: `<defs>${sky('s', '#bfe3a8', '#f4f7d9')}</defs><rect width="${W}" height="${H}" fill="url(#s)"/>
    ${hill(520, 50, '#8cc47b')}${hill(640, 50, '#5fa65a', 50)}${hill(780, 40, '#3e8346', -30)}
    ${Array.from({ length: 14 }, (_, i) => {
      const x = 40 + ((i * 97) % 470);
      const y = 640 + ((i * 53) % 260);
      return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 60}" stroke="#2f6b3b" stroke-width="5"/><circle cx="${x}" cy="${y}" r="22" fill="${['#f6d44a', '#f08a8a', '#fff'][i % 3]}"/><circle cx="${x}" cy="${y}" r="8" fill="#a0642a"/>`;
    }).join('')}`,
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
for (const [name, body] of Object.entries(SCENES)) {
  await page.setContent(`<style>html,body{margin:0}</style><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`);
  const file = join(out, `art-${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 78 });
  console.log(file, `${Math.round(statSync(file).size / 1024)} KB`);
}
await browser.close();
