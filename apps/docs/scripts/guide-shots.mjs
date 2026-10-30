// Renders the 22 screenshots of the docs' guides (apps/docs/public/guides/images), with the current dashboard and the
// current Web SDK on the demo page (not shipped: a script for the docs' images).
//
// The built API is started by this script on its own port against a throwaway database, the built dashboard is served
// with /api proxied to the API (as the other docs scripts do), and headless Chromium takes each screen. The first-run
// screen (01-setup) is taken on the empty database, before the admin exists; then a synthetic admin signs in with a
// session written to that database (the same SQL as apps/dashboard-e2e/src/session.ts). Content (a project, zones, tale
// groups, tales with generated art uploaded through the media API, a poll, a countdown) goes through the Management API.
// The demo page (apps/docs/public/guides/demo-furniture-site.html) is served from this script's own port with the SDK of
// the throwaway API and a zone key issued in the dashboard. The database is dropped at the end.
//
// Only fake values reach the screens: the store is invented ("Furniture store", "Oak & Linen" on the demo page), the
// admin is "Ada Admin" with an example.com address, and every zone key is masked before a screenshot (first 8 characters).
//
// Usage (after `pnpm nx run api:build` and `pnpm nx run dashboard:build:development`):
//   E2E_DATABASE_URL=postgres://taleart:taleart@localhost:5432/guide_shots_e2e_test node apps/docs/scripts/guide-shots.mjs
// The name must end in _e2e_test and must differ from TEST_DATABASE_URL and DATABASE_URL. E2E_API_PORT, E2E_DASHBOARD_PORT
// and E2E_DEMO_PORT pick other ports when the defaults are in use. Images over 380 KB are written as lossless WebP (PIL).
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright';
import { e2eDatabase } from '../../dashboard-e2e/scripts/e2e-database.mjs';
import { copySdkFiles, e2eSdk } from '../../dashboard-e2e/scripts/e2e-sdk.mjs';

const root = resolve(import.meta.dirname, '../../..');
const imagesDir = join(root, 'apps/docs/public/guides/images');
const demoFile = join(root, 'apps/docs/public/guides/demo-furniture-site.html');
const apiPort = Number(process.env.E2E_API_PORT || 3513);
const dashboardPort = Number(process.env.E2E_DASHBOARD_PORT || 4513);
const demoPort = Number(process.env.E2E_DEMO_PORT || 4514);
const apiOrigin = `http://localhost:${apiPort}`;
const dashboardOrigin = `http://localhost:${dashboardPort}`;
const demoOrigin = `http://localhost:${demoPort}`;
const API = `${apiOrigin}/api/v1`;
const dashboardDir = join(root, 'dist/apps/dashboard/browser');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };
const PHONE = { width: 430, height: 800 };
// Inter, a variable font under the SIL Open Font License, from the repo's dependencies (48 KB, under the 500 KB limit).
const INTER_WOFF2 = join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
const DESKTOP = { width: 1280, height: 800 };
const MAX_BYTES = 380 * 1024;

// The image each screen becomes: the same file name and extension as the guides already link.
const NAMES = {
  setup: '01-setup.png',
  dashboard: '02-dashboard.png',
  zoneNew: '03-zone-new.png',
  groups: '04-tale-groups.png',
  install: '05-install-tab.png',
  display: '06-display-tab.png',
  demoSite: '07-demo-site.png',
  demoViewer: '08-demo-viewer.webp',
  taleGroup: '09-tale-group.png',
  talePanel: '10-tale-panel.png',
  studio: '11-tale-studio.png',
  studioLowContrast: '12-studio-heading-low-contrast.png',
  demoHeading: '13-viewer-with-heading.webp',
  studioFixed: '14-studio-heading-fixed.webp',
  zones: '15-zones.png',
  groupMenu: '16-group-menu.png',
  schedule: '17-schedule.png',
  theme: '18-theme.png',
  fonts: '19-fonts.png',
  projects: '20-projects.png',
  importPage: '21-import.png',
  visibility: '22-groups-visibility.png',
};

const database = e2eDatabase(process.env); // throws for a name that is not a throwaway one
const scratch = mkdtempSync(join(tmpdir(), 'taleart-guide-shots-'));
const logFile = join(scratch, 'api.log');
const written = [];

// A child process of its own group, so the whole tree can be stopped.
function start(command, args, env, cwd = root) {
  const out = openSync(logFile, 'a');
  return spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', out, out] });
}
function stop(child) {
  return new Promise((done) => {
    if (!child || child.exitCode !== null) return done();
    child.once('exit', () => done());
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      done();
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      done();
    }, 10_000).unref();
  });
}
async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} did not answer within ${timeoutMs} ms`);
}

// The built dashboard on its port: its files, the app's entry for every other path, and /api proxied to the API.
function serveDashboard() {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/')) {
      const proxied = httpRequest({ host: 'localhost', port: apiPort, path: req.url, method: req.method, headers: req.headers }, (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      });
      proxied.on('error', () => res.writeHead(502).end());
      return req.pipe(proxied);
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const file = normalize(join(dashboardDir, decodeURIComponent(url.pathname)));
    const served = file.startsWith(dashboardDir) && existsSync(file) && statSync(file).isFile() ? file : join(dashboardDir, 'index.csr.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(served)] ?? 'application/octet-stream' });
    createReadStream(served).pipe(res);
  });
  return new Promise((done) => server.listen(dashboardPort, 'localhost', () => done(server)));
}

// The demo page: the file of the docs with this stack's SDK and a zone key (the page itself is not changed).
function serveDemo(zoneKey) {
  const html = readFileSync(demoFile, 'utf8')
    .replace(/src="[^"]*\/sdk\/v1\/taleart\.js"/, `src="${apiOrigin}/sdk/v1/taleart.js"`)
    .replace(/<taleart-view[^>]*><\/taleart-view>/, `<taleart-view zone-key="${zoneKey}"></taleart-view>`);
  if (!html.includes(zoneKey)) throw new Error('The demo page has no <taleart-view> to give the zone key');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((done) => server.listen(demoPort, 'localhost', () => done(server)));
}

// The same SQL as apps/dashboard-e2e/src/session.ts: a user and a session whose token is stored as its hash.
async function insertUser(name, role) {
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    const { rows } = await client.query('INSERT INTO users (name, email, role, webauthn_user_id) VALUES ($1, $2, $3, $4) RETURNING id', [
      name,
      `guide-shots-${randomBytes(6).toString('hex')}@example.com`,
      role,
      randomBytes(32).toString('base64url'),
    ]);
    return rows[0].id;
  } finally {
    await client.end();
  }
}
async function sessionFor(userId) {
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    const token = randomBytes(32).toString('base64url');
    await client.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '2 hours')", [
      userId,
      createHash('sha256').update(token, 'utf8').digest('hex'),
    ]);
    return token;
  } finally {
    await client.end();
  }
}
async function withAdmin(url, fn) {
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}
async function createDatabase() {
  const url = new URL(database.url);
  url.pathname = '/postgres';
  await withAdmin(url, async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS "${database.name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${database.name}"`);
  });
}
async function dropDatabase() {
  const url = new URL(database.url);
  url.pathname = '/postgres';
  await withAdmin(url, (admin) => admin.query(`DROP DATABASE IF EXISTS "${database.name}" WITH (FORCE)`));
}

// The art of the demo tales: drawn in Chromium (canvas), PNG or JPEG, 720 x 1280 (9:16). Each scene is a plain
// illustration of furniture, not a product photo.
function drawArt(names) {
  const W = 720;
  const H = 1280;
  const scenes = {
    sofa(ctx) {
      // Light cream: white heading text on it is low contrast (the Tale Studio warning in the guides).
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#fbf5ea');
      g.addColorStop(1, '#e3d0b0');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(540, 300, 170, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d6bf9a';
      ctx.fillRect(0, 960, W, H - 960);
      ctx.fillStyle = '#6f4e33';
      ctx.beginPath();
      ctx.roundRect(120, 760, 480, 200, 48);
      ctx.fill();
      ctx.fillStyle = '#9b7150';
      ctx.beginPath();
      ctx.roundRect(90, 640, 540, 230, 70);
      ctx.fill();
      ctx.fillStyle = '#bb9169';
      ctx.beginPath();
      ctx.roundRect(150, 690, 200, 150, 36);
      ctx.roundRect(370, 690, 200, 150, 36);
      ctx.fill();
      ctx.fillStyle = '#3d2a1c';
      ctx.fillRect(140, 955, 34, 70);
      ctx.fillRect(546, 955, 34, 70);
    },
    terracotta(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#d9764a');
      g.addColorStop(1, '#5e2512');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#f7c979';
      ctx.beginPath();
      ctx.arc(360, 760, 210, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a1a0d';
      ctx.beginPath();
      ctx.roundRect(230, 900, 260, 90, 30);
      ctx.fill();
      ctx.fillRect(250, 990, 22, 120);
      ctx.fillRect(448, 990, 22, 120);
    },
    dining(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#b7cbab');
      g.addColorStop(1, '#3f5d4b');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#e9e2d0';
      ctx.beginPath();
      ctx.ellipse(360, 760, 250, 60, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8a6440';
      ctx.fillRect(200, 760, 320, 26);
      ctx.fillRect(215, 786, 26, 260);
      ctx.fillRect(479, 786, 26, 260);
      ctx.fillStyle = '#c7a57b';
      for (const x of [140, 580]) ctx.beginPath(), ctx.roundRect(x - 40, 820, 80, 130, 22), ctx.fill();
    },
    reading(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#9db2d8');
      g.addColorStop(1, '#27395e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#f4d58d';
      ctx.beginPath();
      ctx.arc(600, 260, 90, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2f4f7a';
      ctx.beginPath();
      ctx.roundRect(170, 700, 380, 320, 90);
      ctx.fill();
      ctx.fillStyle = '#4a6d9c';
      ctx.beginPath();
      ctx.roundRect(120, 610, 110, 280, 50);
      ctx.fill();
      ctx.fillStyle = '#e5e7ee';
      ctx.fillRect(560, 1010, 140, 22);
      ctx.fillRect(572, 968, 120, 22);
    },
    poll(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#f1e9f8');
      g.addColorStop(1, '#c9b4e0');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#a58bc9';
      ctx.beginPath();
      ctx.ellipse(230, 1000, 170, 110, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e7dcf3';
      ctx.beginPath();
      ctx.ellipse(500, 1040, 150, 100, 0, 0, Math.PI * 2);
      ctx.fill();
    },
    countdown(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1c1a26');
      g.addColorStop(1, '#3a2a4f');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#e8b65a';
      ctx.lineWidth = 26;
      ctx.beginPath();
      ctx.arc(360, 760, 200, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#f2d59a';
      ctx.beginPath();
      ctx.roundRect(300, 730, 120, 60, 12);
      ctx.fill();
    },
  };
  return names.map(([name, type]) => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    scenes[name](ctx);
    const mime = type === 'jpeg' ? 'image/jpeg' : 'image/png';
    return { name, mime, data: canvas.toDataURL(mime, 0.9).split(',')[1] };
  });
}

// Converts an image to lossless WebP with PIL (the guides' larger images are WebP, as before).
function toLosslessWebp(source, target) {
  const code = 'from PIL import Image; import sys; Image.open(sys.argv[1]).save(sys.argv[2], "WEBP", lossless=True, method=6)';
  const result = spawnSync('python3', ['-I', '-c', code, source, target], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`WebP conversion failed: ${result.stderr}`);
}

// Writes one screen: PNG when it fits the size cap, lossless WebP otherwise. The name fixes the extension.
async function save(key, page, { locator, fullPage = false } = {}) {
  const name = NAMES[key];
  const png = join(scratch, `${key}.png`);
  if (locator) await locator.screenshot({ path: png });
  else await page.screenshot({ path: png, fullPage });
  const target = join(imagesDir, name);
  if (name.endsWith('.webp')) toLosslessWebp(png, target);
  else if (statSync(png).size > MAX_BYTES) toLosslessWebp(png, target.replace(/\.png$/, '.webp'));
  else copyFileSync(png, target);
  written.push(name);
  console.log('wrote', name, statSync(target.endsWith('.png') || target.endsWith('.webp') ? target : png).size, 'bytes');
}

// The key on the zone's Install tab is masked in the picture. The card shows the key's prefix (10 characters, then an
// ellipsis): the picture keeps its first 8 characters only. A whole key, if it were shown, becomes its first 8 and dots.
async function maskKey(page, key) {
  const pairs = [
    [key, key.slice(0, 8) + '•'.repeat(24)],
    [key.slice(0, 10), key.slice(0, 8)],
  ];
  await page.evaluate((list) => {
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          for (const [secret, replacement] of list) if (child.textContent.includes(secret)) child.textContent = child.textContent.split(secret).join(replacement);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          for (const [secret, replacement] of list) if (typeof child.value === 'string' && child.value.includes(secret)) child.value = child.value.split(secret).join(replacement);
          walk(child);
        }
      }
    };
    walk(document.body);
  }, pairs);
  const left = await page.evaluate((prefix) => document.body.innerText.includes(prefix), key.slice(0, 10));
  if (left) throw new Error('The key prefix is still on the page');
}

// Tale art and tale documents, through the Management API (the same calls the dashboard makes).
const elementId = () => randomUUID();
function textElement(text, box, { size, weight = 'bold', color = '#FFFFFF', background = 'none', backgroundColor, align = 'start' }, label) {
  return {
    id: elementId(),
    type: 'text',
    box: { ...box, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: { label: label ?? text },
    props: { text, font: { source: 'system', stack: 'sans' }, size, weight, color, align, lineHeight: 1.15, background, ...(backgroundColor ? { backgroundColor } : {}) },
  };
}
function buttonElement(label, box, { color, fill, variant = 'filled' }) {
  return {
    id: elementId(),
    type: 'button',
    box: { ...box, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: { label },
    props: { label, href: 'https://example.com/furniture', newTab: false, variant, color, fill },
  };
}

// The demo content: three groups in the Home top zone, each with its tales.
const GROUPS = [
  {
    name: 'Summer sale',
    tales: [
      { title: 'Sofa sale', art: 'sofa', type: 'png', elements: (c) => [buttonElement('Shop the sofas', { x: 0.2, y: 0.8, w: 0.6, h: 0.07 }, { color: '#FFFFFF', fill: '#2D4A3E' })] },
      {
        title: 'Summer sale 30 percent',
        art: 'terracotta',
        type: 'png',
        elements: () => [
          textElement('Summer sale', { x: 0.08, y: 0.1, w: 0.84, h: 0.14 }, { size: 0.075, weight: 'bold', color: '#FFFFFF' }),
          textElement('30% off outdoor furniture until Sunday.', { x: 0.08, y: 0.26, w: 0.84, h: 0.1 }, { size: 0.03, weight: 'regular', color: '#FFFFFF' }),
          buttonElement('Shop now', { x: 0.2, y: 0.8, w: 0.6, h: 0.07 }, { color: '#2A1208', fill: '#F7C979' }),
        ],
      },
    ],
  },
  {
    name: 'New arrivals',
    tales: [
      {
        title: 'Dining tables',
        art: 'dining',
        type: 'jpeg',
        elements: () => [
          textElement('Dining tables', { x: 0.08, y: 0.1, w: 0.84, h: 0.12 }, { size: 0.065, weight: 'bold', color: '#FFFFFF' }),
          textElement('Solid oak, seats six. Delivered in two weeks.', { x: 0.08, y: 0.24, w: 0.84, h: 0.1 }, { size: 0.03, weight: 'regular', color: '#FFFFFF' }),
          buttonElement('See the tables', { x: 0.2, y: 0.8, w: 0.6, h: 0.07 }, { color: '#1F2A22', fill: '#F3EBDD' }),
        ],
      },
      {
        title: 'Reading corner',
        art: 'reading',
        type: 'jpeg',
        elements: () => [
          textElement('Reading corner', { x: 0.08, y: 0.1, w: 0.84, h: 0.12 }, { size: 0.065, weight: 'bold', color: '#FFFFFF' }),
          textElement('Armchairs and lamps, picked for long afternoons.', { x: 0.08, y: 0.24, w: 0.84, h: 0.1 }, { size: 0.03, weight: 'regular', color: '#FFFFFF' }),
          buttonElement('Browse armchairs', { x: 0.2, y: 0.8, w: 0.6, h: 0.07 }, { color: '#FFFFFF', fill: '#27395E' }),
        ],
      },
    ],
  },
  {
    name: 'Staff picks',
    tales: [
      {
        title: 'Which sofa?',
        art: 'poll',
        type: 'png',
        elements: () => [
          {
            id: elementId(),
            type: 'poll',
            box: { x: 0.08, y: 0.3, w: 0.84, h: 0.4, rotation: 0 },
            hidden: false,
            locked: false,
            a11y: { label: 'Which sofa?' },
            props: {
              title: 'Staff picks',
              question: 'Which sofa is your favourite?',
              options: [
                { id: 'linen', label: 'Linen' },
                { id: 'oak', label: 'Oak' },
              ],
              theme: 'light',
            },
          },
        ],
      },
      {
        title: 'Sale ends in',
        art: 'countdown',
        type: 'png',
        elements: () => {
          const endsAt = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
          return [
            {
              id: elementId(),
              type: 'countdown',
              box: { x: 0.1, y: 0.42, w: 0.8, h: 0.22, rotation: 0 },
              hidden: false,
              locked: false,
              a11y: { label: 'Sale ends in' },
              props: { title: 'Sale ends in', endsAt, endedText: 'The sale is over', theme: 'dark' },
            },
          ];
        },
      },
    ],
  },
];

// Lets transitions and the first data calls finish before a screen is taken.
async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
}

async function main() {
  mkdirSync(imagesDir, { recursive: true });
  const sdk = e2eSdk(root);
  rmSync(sdk.dir, { recursive: true, force: true });
  mkdirSync(sdk.dir, { recursive: true });
  copySdkFiles(sdk);
  if (!existsSync(join(dashboardDir, 'index.csr.html'))) throw new Error(`${dashboardDir} has no build: run dashboard:build:development`);

  const apiEnv = {
    PATH: process.env.PATH ?? '',
    DATABASE_URL: database.url,
    PORT: String(apiPort),
    PUBLIC_API_URL: apiOrigin,
    RP_ORIGIN: dashboardOrigin,
    RP_ID: 'localhost',
    MEDIA_DIR: mkdtempSync(join(tmpdir(), 'taleart-guide-media-')),
    WEB_SDK_FILE: sdk.bundleFile,
    SDK_BUILDS_DIR: sdk.buildsDir,
  };

  let api;
  let dashboard;
  let demo;
  let browser;
  try {
    await createDatabase();
    dashboard = await serveDashboard();
    api = start(process.execPath, [join(root, 'dist/apps/api/main.js')], apiEnv);
    console.log('api pid', api.pid);
    await waitFor(`${apiOrigin}/api/v1/health`, 90_000);

    browser = await chromium.launch();
    const newContext = (viewport) => browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'light' });
    const context = await newContext(DESKTOP);
    const page = await context.newPage();

    // 01: the first-run screen, on the empty database and before the admin exists.
    await page.goto(`${dashboardOrigin}/`);
    await page.getByRole('heading', { name: 'Set up TaleArt' }).waitFor({ timeout: 60_000 });
    await settle(page);
    await save('setup', page);

    // The admin, signed in with a session, and the project of the store.
    const adminId = await insertUser('Ada Admin', 'admin');
    await context.addCookies([{ name: 'taleart_session', value: await sessionFor(adminId), url: dashboardOrigin }]);
    const call = async (method, path, data) => {
      const res = await context.request.fetch(`${API}${path}`, { method, data });
      if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
      return res.json();
    };
    const upload = async (path, mime, bytes) => {
      const res = await context.request.fetch(`${API}${path}`, { method: 'PUT', headers: { 'Content-Type': mime }, data: bytes });
      if (!res.ok()) throw new Error(`PUT ${path}: ${res.status()} ${await res.text()}`);
      return res.json();
    };
    const project = await call('post', '/projects', { name: 'Furniture store' });

    // 02: the dashboard after setup, with no zones yet.
    await page.goto(`${dashboardOrigin}/`);
    await page.getByRole('button', { name: 'New zone' }).first().waitFor({ timeout: 60_000 });
    await settle(page);
    await save('dashboard', page);

    // 03: the first zone, made in the dashboard (Stories bar), not visible yet.
    await page.getByRole('button', { name: 'New zone' }).first().click();
    const zoneDrawer = page.getByRole('dialog', { name: 'New zone' });
    await zoneDrawer.getByLabel('Zone name').fill('Home top');
    await zoneDrawer.getByText('Stories bar', { exact: true }).click();
    await zoneDrawer.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('heading', { name: 'Home top' }).waitFor({ timeout: 60_000 });
    const zoneId = /\/zones\/([0-9a-f-]{36})/.exec(page.url())?.[1];
    if (!zoneId) throw new Error(`No zone id in ${page.url()}`);
    await settle(page);
    await save('zoneNew', page);

    // The art: drawn in Chromium, PNG or JPEG, uploaded with each tale.
    const artPage = await browser.newPage();
    const arts = new Map(
      (await artPage.evaluate(drawArt, [...new Set(GROUPS.flatMap((g) => g.tales.map((t) => [t.art, t.type])))])).map((a) => [a.name, a]),
    );
    await artPage.close();

    // The tale groups and their tales: the media, a document with its elements, published, and the group On.
    const tales = {};
    for (const group of GROUPS) {
      const created = await call('post', `/zones/${zoneId}/tale-groups`, { name: group.name });
      for (const spec of group.tales) {
        const tale = await call('post', `/tale-groups/${created.id}/tales`, { title: spec.title });
        const art = arts.get(spec.art);
        await upload(`/tales/${tale.id}/media`, art.mime, Buffer.from(art.data, 'base64'));
        const current = await call('get', `/tales/${tale.id}/document`);
        const base = current.document ?? { version: 1, canvas: { background: { type: 'color', color: '#1F1A17' } }, elements: [] };
        const document = { ...base, elements: [...base.elements, ...spec.elements()] };
        const saved = await call('put', `/tales/${tale.id}/document`, {
          document,
          revision: current.revision,
          sawTaleMedia: base.elements.some((e) => e.props?.taleMedia === true),
        });
        await call('post', `/tales/${tale.id}/document/publish`, {
          revision: saved.revision,
          publishedRevision: current.published?.revision ?? 0,
        });
        tales[spec.title] = tale.id;
      }
      await call('put', `/tale-groups/${created.id}/status`, { status: 'live' });
      group.id = created.id;
    }
    // Two more zones for the zone list: a promo banner and a blank zone.
    await call('post', '/zones', { name: 'Sale banner', projectId: project.id, template: 'promo-banner' });
    await call('post', '/zones', { name: 'Category page', projectId: project.id, template: 'blank' });

    // 05: the Install tab, with the zone key issued: the key is masked in the picture.
    await page.goto(`${dashboardOrigin}/zones/${zoneId}`);
    await page.getByRole('tab', { name: 'Install' }).click();
    await page.locator('#zone-key-issue').click();
    const keyDrawer = page.getByRole('dialog', { name: 'Issue zone key' });
    const zoneKey = await keyDrawer.getByLabel('Zone key').inputValue();
    if (!/^tak_/.test(zoneKey)) throw new Error('The zone key was not issued');
    await keyDrawer.getByRole('button', { name: 'Done' }).click();
    await settle(page);
    await maskKey(page, zoneKey);
    await save('install', page);

    // 04: the three groups, all On and visible on site.
    await page.goto(`${dashboardOrigin}/tale-groups`);
    await page.getByRole('switch', { name: 'Summer sale on site' }).waitFor({ timeout: 60_000 });
    await settle(page);
    await save('groups', page);

    // 06: the Display tab of the zone.
    await page.goto(`${dashboardOrigin}/zones/${zoneId}`);
    await page.getByRole('tab', { name: 'Display' }).click();
    await settle(page);
    await save('display', page);

    // 07, 08: the example store page with the SDK and the zone key, on a phone-sized window.
    demo = await serveDemo(zoneKey);
    const phone = await newContext(PHONE);
    const shop = await phone.newPage();
    await shop.goto(`${demoOrigin}/demo-furniture-site.html`);
    await shop.getByRole('button', { name: 'Summer sale', exact: true }).waitFor({ timeout: 60_000 });
    await settle(shop);
    await save('demoSite', shop);
    await shop.getByRole('button', { name: 'New arrivals', exact: true }).click();
    await shop.getByRole('dialog', { name: 'New arrivals' }).waitFor();
    await settle(shop);
    await save('demoViewer', shop);

    // 09, 10: the tale group with its tales, and a tale's panel.
    await page.goto(`${dashboardOrigin}/tale-groups`);
    await page.getByRole('button', { name: 'Summer sale', exact: true }).click();
    const groupView = page.getByRole('dialog', { name: 'Summer sale' });
    await groupView.getByRole('button', { name: 'Add tale to Summer sale' }).waitFor({ timeout: 60_000 });
    await settle(page);
    await save('taleGroup', page);
    await groupView.getByRole('button', { name: 'Open tale Sofa sale' }).click();
    await settle(page);
    await save('talePanel', page);

    // 11: Tale Studio, opened from the tale panel.
    await page.getByText('Edit in Tale Studio', { exact: true }).click();
    await page.waitForURL(/\/tales\/[0-9a-f-]+\/studio/, { timeout: 60_000 });
    await page.locator('#studio-add-heading').waitFor({ timeout: 60_000 });
    await settle(page);
    await save('studio', page);

    // 12: the heading, white on the light photo: the low-contrast warning, once Studio has saved the draft.
    const inspector = page.locator('#studio-inspector');
    await page.locator('#studio-add-heading').click();
    await inspector.getByLabel('Text', { exact: true }).fill('Sofas for slow weekends');
    await page.getByText('All changes saved', { exact: false }).first().waitFor({ timeout: 30_000 });
    // The panel's contrast line (#ts-contrast, under the text style): the warning, then the ratio once it is fine.
    const contrastLine = page.locator('#ts-contrast');
    await page.waitForFunction(() => /^Low contrast/.test(document.querySelector('#ts-contrast')?.textContent.trim() ?? ''), null, { timeout: 30_000 });
    await contrastLine.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await save('studioLowContrast', page);

    // 14: the fix: a highlight behind each line (black), the text box at Top 36% and Height 24%, then Update tale.
    await inspector.getByLabel('Background', { exact: true }).selectOption({ label: 'Highlight behind each line' });
    await inspector.getByLabel('Top (%)', { exact: true }).fill('36');
    await inspector.getByLabel('Height (%)', { exact: true }).fill('24');
    await page.waitForTimeout(800);
    await page.locator('#studio-update').click();
    await page.getByText('Tale updated', { exact: false }).first().waitFor({ timeout: 60_000 });
    await settle(page);
    await page.waitForFunction(() => /^Contrast /.test(document.querySelector('#ts-contrast')?.textContent.trim() ?? ''), null, { timeout: 30_000 });
    await contrastLine.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await save('studioFixed', page);

    // 13: the fixed heading in the viewer on the example store page (reloaded, so it shows the published tale).
    await shop.goto(`${demoOrigin}/demo-furniture-site.html`);
    await shop.getByRole('button', { name: 'Summer sale', exact: true }).click();
    await shop.getByRole('dialog', { name: 'Summer sale' }).waitFor();
    await settle(shop);
    await save('demoHeading', shop);

    // 15: the zone list.
    await page.goto(`${dashboardOrigin}/zones`);
    await page.getByRole('button', { name: 'Home top' }).or(page.getByText('Home top', { exact: true })).first().waitFor({ timeout: 60_000 });
    await settle(page);
    await save('zones', page);

    // 16, 17: the group's menu, and its Schedule panel.
    await page.goto(`${dashboardOrigin}/tale-groups`);
    await page.getByRole('switch', { name: 'Summer sale on site' }).waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'More for Summer sale' }).click();
    await settle(page);
    await save('groupMenu', page);
    await page.getByRole('menuitem', { name: /^Schedule/ }).click();
    await settle(page);
    await page.evaluate(() => document.activeElement?.blur());
    await save('schedule', page);
    await page.keyboard.press('Escape');

    // 18, 19, 20, 21: the project pages.
    await page.goto(`${dashboardOrigin}/projects/${project.id}/theme`);
    await settle(page);
    await save('theme', page);
    // The font: Inter (SIL Open Font License), from the repo's dependencies, uploaded as the Fonts page asks.
    await page.goto(`${dashboardOrigin}/projects/${project.id}/fonts`);
    await page.locator('input[type=file]').first().setInputFiles(INTER_WOFF2);
    await page.getByLabel('Family name').fill('Inter');
    await page.getByRole('checkbox', { name: /I confirm/ }).check();
    await page.getByRole('button', { name: 'Upload font' }).click();
    await page.getByText('Inter', { exact: true }).first().waitFor({ timeout: 60_000 });
    // Taller than the usual window, so the page and its sidebar show the whole list.
    await page.setViewportSize({ width: 1280, height: 1100 });
    await settle(page);
    await save('fonts', page);
    await page.setViewportSize(DESKTOP);
    await page.goto(`${dashboardOrigin}/projects`);
    await settle(page);
    await save('projects', page);
    await page.goto(`${dashboardOrigin}/projects/${project.id}/import`);
    await settle(page);
    await save('importPage', page);

    // 22: a group switched Off: its row says why it is not visible.
    await page.goto(`${dashboardOrigin}/tale-groups`);
    await page.getByRole('switch', { name: 'Staff picks on site' }).click();
    await page.getByText('Not visible', { exact: false }).first().waitFor({ timeout: 60_000 });
    await settle(page);
    await save('visibility', page);
  } finally {
    if (browser) await browser.close();
    if (demo) await new Promise((done) => demo.close(done));
    if (dashboard) await new Promise((done) => dashboard.close(done));
    await stop(api);
    await dropDatabase();
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`wrote ${written.length} images to ${imagesDir}: ${written.join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
