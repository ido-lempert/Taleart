// Draws the demo seed's pictures: flat furniture scenes as SVG, rendered to JPEG with the Chromium
// that Playwright installs. Run `node libs/seed-demo/scripts/render-assets.mjs` from the repository
// root to regenerate src/assets/*.jpg. The pictures are original artwork made for this repository
// (see src/assets/LICENSES.md); nothing is downloaded.
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const out = join(dirname(fileURLToPath(import.meta.url)), '../src/assets');
mkdirSync(out, { recursive: true });

const W = 1080;
const H = 1920;
const FLOOR = 880;

const PALETTES = {
  sand: { wall: '#efe6d8', wall2: '#e3d5c0', floor: '#d9c3a3', main: '#a9714b', shade: '#8a5a3a', light: '#c99673', accent: '#3f5d4a' },
  sage: { wall: '#dfe6da', wall2: '#cdd8c6', floor: '#b9c6ae', main: '#3f5d4a', shade: '#2f4838', light: '#6f8d77', accent: '#c2674a' },
  blush: { wall: '#f3ddd3', wall2: '#e8c7b9', floor: '#d9ad98', main: '#27364a', shade: '#1c283a', light: '#4b5d78', accent: '#e0a458' },
  night: { wall: '#2c3b52', wall2: '#22304a', floor: '#1a2438', main: '#c2674a', shade: '#9c4f37', light: '#dd8c6f', accent: '#e0a458' },
  sun: { wall: '#f6e3b8', wall2: '#efd08e', floor: '#d6a85f', main: '#3f5d4a', shade: '#2f4838', light: '#6f8d77', accent: '#c2674a' },
  mist: { wall: '#dbe7ee', wall2: '#c6d7e1', floor: '#b4c3cc', main: '#c2674a', shade: '#9c4f37', light: '#dd8c6f', accent: '#27364a' },
};

const rect = (x, y, w, h, fill, r = 0, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
const group = (x, y, s, body) => `<g transform="translate(${x} ${y}) scale(${s})">${body}</g>`;

// Each piece is drawn around x = 0 with its feet on y = 0, going up (negative y).
function sofa(p, width = 700) {
  const k = width / 700;
  return group(0, 0, k, [
    rect(-300, -300, 600, 190, p.shade, 46),
    rect(-350, -230, 90, 210, p.main, 40),
    rect(260, -230, 90, 210, p.main, 40),
    rect(-270, -150, 540, 110, p.main, 34),
    rect(-250, -250, 240, 130, p.light, 34),
    rect(10, -250, 240, 130, p.light, 34),
    rect(-300, -26, 24, 26, '#5a3d28', 6),
    rect(276, -26, 24, 26, '#5a3d28', 6),
  ].join(''));
}
function armchair(p) {
  return group(0, 0, 1, [
    rect(-170, -340, 340, 230, p.shade, 60),
    rect(-205, -250, 70, 230, p.main, 34),
    rect(135, -250, 70, 230, p.main, 34),
    rect(-140, -160, 280, 110, p.main, 30),
    rect(-120, -280, 240, 130, p.light, 40),
    rect(-150, -30, 18, 30, '#5a3d28', 5),
    rect(132, -30, 18, 30, '#5a3d28', 5),
  ].join(''));
}
function floorLamp(p) {
  return group(0, 0, 1, [
    `<circle cx="0" cy="-640" r="230" fill="#fff6d6" opacity="0.45"/>`,
    `<circle cx="0" cy="-640" r="140" fill="#fff6d6" opacity="0.5"/>`,
    rect(-6, -560, 12, 560, '#5a4a3a', 4),
    `<polygon points="-110,-560 110,-560 70,-740 -70,-740" fill="${p.accent}"/>`,
    `<ellipse cx="0" cy="0" rx="90" ry="16" fill="#5a4a3a"/>`,
  ].join(''));
}
function table(p) {
  return group(0, 0, 1, [
    rect(-310, -300, 620, 34, p.main, 10),
    rect(-270, -266, 26, 266, p.shade, 6),
    rect(244, -266, 26, 266, p.shade, 6),
    rect(-250, -266, 500, 20, p.shade, 6),
    // a vase with stems, a bowl and a book
    rect(-190, -392, 54, 92, p.accent, 16),
    `<path d="M-163 -392 C-170 -470 -200 -500 -230 -520 M-163 -392 C-160 -480 -150 -520 -130 -560 M-163 -392 C-150 -450 -110 -480 -90 -500" stroke="#3f5d4a" stroke-width="7" fill="none"/>`,
    `<ellipse cx="-230" cy="-524" rx="22" ry="12" fill="#e0a458"/><ellipse cx="-128" cy="-562" rx="22" ry="12" fill="#e0a458"/><ellipse cx="-90" cy="-502" rx="22" ry="12" fill="#e0a458"/>`,
    `<path d="M40 -300 C40 -350 190 -350 190 -300 Z" fill="#f4ede4"/>`,
    rect(210, -330, 80, 30, '#27364a', 4),
    rect(214, -354, 72, 24, '#c2674a', 4),
  ].join(''));
}
function shelf(p) {
  const books = (x, y, colors) =>
    colors.map((c, i) => rect(x + i * 36, y - 90 - (i % 3) * 14, 30, 90 + (i % 3) * 14, c, 3)).join('');
  return group(0, 0, 1, [
    rect(-230, -620, 460, 620, p.shade, 14),
    rect(-210, -600, 420, 580, p.wall, 8),
    rect(-210, -420, 420, 14, p.shade),
    rect(-210, -220, 420, 14, p.shade),
    books(-190, -420, ['#c2674a', '#3f5d4a', '#e0a458', '#27364a', '#c99673']),
    rect(10, -500, 80, 80, p.accent, 10),
    `<ellipse cx="150" cy="-470" rx="30" ry="50" fill="#e0a458"/>`,
    books(-190, -220, ['#27364a', '#e0a458', '#c2674a']),
    `<path d="M80 -234 L150 -234 L140 -310 L90 -310 Z" fill="${p.main}"/>`,
    `<circle cx="115" cy="-340" r="34" fill="#3f5d4a"/><circle cx="90" cy="-326" r="26" fill="#6f8d77"/><circle cx="140" cy="-326" r="26" fill="#6f8d77"/>`,
    rect(-190, -190, 150, 170, p.main, 10),
    rect(-20, -190, 150, 170, p.light, 10),
    rect(-250, -20, 24, 20, '#5a3d28'),
    rect(226, -20, 24, 20, '#5a3d28'),
  ].join(''));
}
function bed(p) {
  return group(0, 0, 1, [
    rect(-360, -470, 720, 300, p.shade, 40),
    rect(-340, -190, 680, 150, p.main, 30),
    rect(-340, -250, 680, 110, '#f4ede4', 30),
    rect(-300, -300, 250, 110, '#ffffff', 36),
    rect(40, -300, 250, 110, '#f9efe3', 36),
    rect(-340, -140, 680, 110, p.accent, 24),
    rect(-340, -60, 680, 18, p.light, 8),
    rect(-340, -44, 34, 44, '#5a3d28', 6),
    rect(306, -44, 34, 44, '#5a3d28', 6),
  ].join(''));
}
function plant(p, s = 1) {
  const leaf = (r, x, y) => `<ellipse cx="${x}" cy="${y}" rx="26" ry="96" fill="#3f5d4a" transform="rotate(${r} ${x} ${y + 90})"/>`;
  return group(0, 0, s, [
    leaf(-40, -50, -250), leaf(-18, -22, -300), leaf(0, 0, -330), leaf(18, 22, -300), leaf(40, 50, -250),
    `<polygon points="-70,-180 70,-180 52,0 -52,0" fill="${p.accent}"/>`,
  ].join(''));
}
function rug(p) {
  return `<ellipse cx="0" cy="30" rx="440" ry="62" fill="${p.accent}" opacity="0.85"/><ellipse cx="0" cy="30" rx="380" ry="46" fill="none" stroke="#f4ede4" stroke-width="5" opacity="0.7"/>`;
}
function artwork(p, x, y, w, h, kind = 0) {
  const inner = [
    `<circle cx="${w / 2}" cy="${h * 0.42}" r="${w * 0.22}" fill="${p.accent}"/><rect x="0" y="${h * 0.7}" width="${w}" height="${h * 0.3}" fill="${p.main}"/>`,
    `<path d="M0 ${h} L${w * 0.4} ${h * 0.3} L${w * 0.7} ${h * 0.7} L${w} ${h * 0.45} L${w} ${h} Z" fill="${p.main}"/><circle cx="${w * 0.75}" cy="${h * 0.2}" r="${w * 0.1}" fill="${p.accent}"/>`,
  ][kind % 2];
  return `<g transform="translate(${x} ${y})">${rect(-14, -14, w + 28, h + 28, '#5a4a3a', 6)}${rect(0, 0, w, h, '#f4ede4')}<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg></g>`;
}
function windowPane(x, y, w, h) {
  return `<g transform="translate(${x} ${y})">${rect(-16, -16, w + 32, h + 32, '#f4ede4', 10)}${rect(0, 0, w, h, '#cfe3ee', 4)}${rect(w / 2 - 6, 0, 12, h, '#f4ede4')}${rect(0, h / 2 - 6, w, 12, '#f4ede4')}<circle cx="${w * 0.25}" cy="${h * 0.28}" r="26" fill="#fff6d6" opacity="0.9"/></g>`;
}
function saleTag(p) {
  return `<g transform="translate(790 250) rotate(12)"><circle r="150" fill="${p.accent}"/><circle r="130" fill="none" stroke="#f4ede4" stroke-width="5" stroke-dasharray="14 10"/><text x="0" y="22" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="92" fill="#faf7f2">-40%</text><text x="0" y="82" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="600" font-size="38" fill="#faf7f2">SPRING</text></g>`;
}
function ticket(p) {
  return `<g transform="translate(540 560)"><rect x="-300" y="-130" width="600" height="260" rx="30" fill="${p.accent}"/><circle cx="-300" cy="0" r="32" fill="${p.wall}"/><circle cx="300" cy="0" r="32" fill="${p.wall}"/><line x1="-230" y1="0" x2="230" y2="0" stroke="#f4ede4" stroke-width="5" stroke-dasharray="16 12"/><text x="0" y="-36" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="60" fill="#faf7f2">SPRING25</text><text x="0" y="86" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="600" font-size="40" fill="#faf7f2">25% off</text></g>`;
}
function tools(p) {
  return group(0, 0, 1, [
    // a workbench with a plane, a mallet and a plank
    rect(-340, -280, 680, 40, p.shade, 8),
    rect(-300, -240, 30, 240, p.main, 6),
    rect(270, -240, 30, 240, p.main, 6),
    rect(-250, -300, 300, 20, '#c99673', 4),
    rect(-250, -340, 120, 40, p.accent, 8),
    rect(-120, -320, 150, 20, '#f4ede4', 4),
    rect(130, -330, 24, 50, '#5a3d28', 4),
    rect(100, -380, 84, 54, p.light, 8),
    `<polygon points="190,-280 330,-280 320,-310 200,-310" fill="#9aa5ad"/>`,
  ].join(''));
}

// scene: a palette, wall decoration, then furniture as [piece, x, floor offset]
const SCENES = {
  's01-fjord-sofa': { pal: 'sand', decor: [windowPane(150, 260, 260, 360), artwork(PALETTES.sand, 650, 300, 230, 300)], items: [[rug, 540, 60], [sofa, 540, 70]] },
  's02-lumi-armchair': { pal: 'sage', decor: [artwork(PALETTES.sage, 190, 280, 230, 300, 1), windowPane(640, 250, 260, 380)], items: [[rug, 540, 70], [armchair, 520, 70], [plant, 860, 70]] },
  's03-aura-lamp': { pal: 'blush', decor: [artwork(PALETTES.blush, 170, 330, 220, 280)], items: [[sofa, 410, 70, 0.7], [floorLamp, 820, 70]] },
  's04-spring-sale': { pal: 'sun', decor: [windowPane(130, 260, 250, 340), saleTag(PALETTES.sun)], items: [[rug, 540, 70], [sofa, 520, 70], [plant, 900, 70, 0.9]] },
  's05-promo-code': { pal: 'mist', decor: [ticket(PALETTES.mist)], items: [[armchair, 270, 70], [plant, 850, 70]] },
  's06-sofa-duel': { pal: 'sand', decor: [artwork(PALETTES.sand, 450, 280, 180, 230, 1)], items: [[sofa, 300, 60, 0.66], [armchair, 800, 60, 0.8]] },
  's07-cosy-corner': { pal: 'blush', decor: [windowPane(660, 260, 250, 340), artwork(PALETTES.blush, 170, 330, 220, 280, 1)], items: [[rug, 480, 70], [armchair, 440, 70], [floorLamp, 800, 70], [plant, 140, 70, 0.9]] },
  's08-wood-quiz': { pal: 'sage', decor: [windowPane(150, 260, 250, 340)], items: [[shelf, 620, 70], [plant, 290, 70, 1.1]] },
  's09-rate-room': { pal: 'sun', decor: [artwork(PALETTES.sun, 160, 300, 230, 300), windowPane(680, 260, 250, 340)], items: [[rug, 540, 70], [sofa, 540, 70, 0.9], [floorLamp, 920, 70, 0.8]] },
  's10-oak-care': { pal: 'sand', decor: [windowPane(130, 250, 250, 360), artwork(PALETTES.sand, 700, 290, 220, 280)], items: [[table, 540, 70]] },
  's11-linen-care': { pal: 'mist', decor: [windowPane(680, 250, 250, 360)], items: [[bed, 480, 70]] },
  's12-forest-table': { pal: 'night', decor: [artwork(PALETTES.night, 160, 300, 230, 300, 1)], items: [[table, 560, 70], [plant, 900, 70]] },
  's13-workshop': { pal: 'sun', decor: [windowPane(140, 260, 260, 360)], items: [[tools, 370, 70, 0.85], [shelf, 890, 70, 0.8]] },
};

// Covers: a square crop of one scene, around its furniture.
const COVERS = {
  'c-new-arrivals': 's01-fjord-sofa',
  'c-spring-sale': 's04-spring-sale',
  'c-living-room': 's07-cosy-corner',
  'c-care-tips': 's10-oak-care',
  'c-makers': 's13-workshop',
};

function scene(name) {
  const { pal, decor, items } = SCENES[name];
  const p = PALETTES[pal];
  const pieces = items.map(([draw, x, drop, s = 1]) => {
    const body = draw === sofa ? sofa(p) : draw(p);
    return `<g transform="translate(${x} ${FLOOR + drop}) scale(${s})">${body}</g>`;
  });
  return [
    `<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.wall}"/><stop offset="1" stop-color="${p.wall2}"/></linearGradient></defs>`,
    rect(0, 0, W, H, 'url(#w)'),
    rect(0, FLOOR - 20, W, 40, p.wall2),
    rect(0, FLOOR, W, H - FLOOR, p.floor),
    ...decor,
    ...pieces,
  ].join('');
}

const page = (inner, viewBox, size) =>
  `<!doctype html><html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="${size[0]}" height="${size[1]}" viewBox="${viewBox}">${inner}</svg></body></html>`;

const browser = await chromium.launch();
try {
  for (const name of Object.keys(SCENES)) {
    const tab = await browser.newPage({ viewport: { width: W, height: H } });
    await tab.setContent(page(scene(name), `0 0 ${W} ${H}`, [W, H]));
    await tab.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 80 });
    await tab.close();
  }
  for (const [cover, from] of Object.entries(COVERS)) {
    const tab = await browser.newPage({ viewport: { width: 720, height: 720 } });
    await tab.setContent(page(scene(from), '0 130 1080 1080', [720, 720]));
    await tab.screenshot({ path: join(out, `${cover}.jpg`), type: 'jpeg', quality: 80 });
    await tab.close();
  }
} finally {
  await browser.close();
}
let total = 0;
for (const name of [...Object.keys(SCENES), ...Object.keys(COVERS)]) {
  const size = statSync(join(out, `${name}.jpg`)).size;
  total += size;
  console.log(`${name}.jpg ${size}`);
}
console.log(`total ${total} bytes`);
