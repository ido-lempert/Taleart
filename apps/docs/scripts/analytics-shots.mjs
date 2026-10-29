// Renders the zone Analytics tab for the docs' "Read your analytics" guide (not shipped: a script for the docs' images).
//
// The built API and the built dashboard are started on their e2e ports against a throwaway database, a synthetic admin
// signs in with a session written to that database (the same SQL as apps/dashboard-e2e/src/session.ts), a project with a
// zone, four tale groups with two tales each, is filled with 30 days of events, and headless Chromium writes the
// screenshots to apps/docs/public/images (analytics-shot-*.png). The database is dropped at the end.
//
// The events: the last 7 UTC days go through the real Delivery API (POST /delivery/v1/events, one request per visitor,
// with the zone key and the visitor header); the 23 days before that are inserted into the throwaway database's
// analytics_events table, because the API accepts events only up to 7 days old. The same generator makes both, so the
// chart has a weekday pattern and a launch spike two weeks ago.
//
// Usage (after `pnpm nx run api:build` and `pnpm nx run dashboard:build:development`):
//   E2E_DATABASE_URL=postgres://taleart:taleart@localhost:5432/analytics_shots_e2e_test node apps/docs/scripts/analytics-shots.mjs
// The name must end in _e2e_test and must differ from TEST_DATABASE_URL and DATABASE_URL. E2E_API_PORT and
// E2E_DASHBOARD_PORT pick other ports when the defaults are in use.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright';
// The harness's guard for the database name (shared with the e2e tests).
import { e2eDatabase } from '../../dashboard-e2e/scripts/e2e-database.mjs';

const root = resolve(import.meta.dirname, '../../..');
const imagesDir = join(root, 'apps/docs/public/images');
const apiPort = Number(process.env.E2E_API_PORT || 3413);
const dashboardPort = Number(process.env.E2E_DASHBOARD_PORT || 4313);
const apiOrigin = `http://localhost:${apiPort}`;
const dashboardOrigin = `http://localhost:${dashboardPort}`;
const API = `${apiOrigin}/api/v1`;
const dashboardDir = join(root, 'dist/apps/dashboard/browser');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };

// The generator's shape: visitors per day, how many days, and the endpoint's share (the last 7 days, today included).
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = 30;
const ENDPOINT_DAYS = 7;
const BASE_VISITORS_PER_DAY = 300;
const VISITOR_POOL = 3500;
const CLICK_RATE = 0.14; // of tale views
const OPEN_RATE = 0.2; // of group impressions
// Days before today (ago) on which the launch's extra visitors come: a spike two weeks ago, fading out.
const LAUNCH_SPIKE = { 14: 2.6, 13: 1.9, 12: 1.5, 11: 1.25 };

// The tale groups of the demo zone. `from` is the first day (days ago) with events; "Launch week" starts with the launch.
const CATALOGUE = [
  { name: 'Summer sale', from: 29, weight: 1.4, tales: [['Sandals', '#F59E0B'], ['Swim', '#0EA5E9'], ['Linen', '#F97316']] },
  { name: 'New arrivals', from: 29, weight: 1.0, tales: [['Denim edit', '#1E3A8A'], ['Knitwear', '#7C2D12']] },
  { name: 'Trips', from: 29, weight: 0.8, tales: [['Lisbon', '#0F766E'], ['Kyoto', '#BE185D']] },
  { name: 'Launch week', from: 14, weight: 1.2, tales: [['Teaser', '#6D28D9'], ['Full collection', '#DB2777']] },
];

// A seeded generator, so every run makes the same events.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

const database = e2eDatabase(process.env); // throws for a name that is not a throwaway one

// A child process of its own group, so the whole tree can be stopped.
function start(command, args, env, cwd = root) {
  return spawn(command, args, { cwd, env, detached: true, stdio: 'ignore' });
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

// The same SQL as apps/dashboard-e2e/src/session.ts: an admin and a session whose token is stored as its hash.
async function signIn(name) {
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    const { rows } = await client.query(
      'INSERT INTO users (name, email, role, webauthn_user_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, `analytics-shots-${randomBytes(6).toString('hex')}@example.com`, 'admin', randomBytes(32).toString('base64url')],
    );
    const token = randomBytes(32).toString('base64url');
    await client.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '2 hours')", [
      rows[0].id,
      createHash('sha256').update(token, 'utf8').digest('hex'),
    ]);
    return token;
  } finally {
    await client.end();
  }
}

async function dropDatabase() {
  const url = new URL(database.url);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${database.name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

// The events of the demo: one list per UTC day ago (0 = today), each event { ms, visitor, type, group, tale }.
// `group` and `tale` are indexes into the demo's groups (CATALOGUE order) and their tales.
function generate(now, visitors) {
  const rng = seeded(20261029);
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cap = now.getTime() - 60_000; // no event is later than a minute ago
  const events = [];
  for (let ago = DAYS - 1; ago >= 0; ago--) {
    const dayStart = todayMs - ago * DAY_MS;
    const dayEnd = ago === 0 ? Math.min(dayStart + DAY_MS, now.getTime() - 5 * 60_000) : dayStart + DAY_MS;
    if (dayEnd <= dayStart) continue;
    const dow = new Date(dayStart).getUTCDay();
    const weekday = dow === 0 || dow === 6 ? 1.3 : dow === 5 ? 1.1 : 0.85; // the weekend is busiest
    const growth = 0.8 + (0.4 * (DAYS - 1 - ago)) / (DAYS - 1); // the zone grows over the month
    const visitorsToday = Math.round(BASE_VISITORS_PER_DAY * weekday * growth * (LAUNCH_SPIKE[ago] ?? 1));
    const active = CATALOGUE.map((g, index) => ({ g, index })).filter(({ g }) => ago <= g.from);
    const total = active.reduce((sum, { g }) => sum + g.weight, 0);
    for (let n = 0; n < visitorsToday; n++) {
      const visitor = Math.floor(rng() * visitors.length);
      // A visitor sees one group, sometimes two or three.
      const seen = 1 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.2 ? 1 : 0);
      const picked = new Set();
      for (let s = 0; s < seen; s++) {
        let roll = rng() * total;
        const choice = active.find(({ g }) => (roll -= g.weight) < 0) ?? active[active.length - 1];
        if (picked.has(choice.index)) continue;
        picked.add(choice.index);
        const at = dayStart + rng() * (dayEnd - dayStart);
        events.push({ ms: at, visitor, type: 'impression', group: choice.index, tale: null });
        if (rng() >= OPEN_RATE) continue;
        const opened = at + 3_000 + rng() * 40_000;
        events.push({ ms: opened, visitor, type: 'open', group: choice.index, tale: null });
        const views = rng() < 0.35 ? 2 : 1;
        for (let v = 0; v < views; v++) {
          const tales = CATALOGUE[choice.index].tales;
          const tale = Math.floor(rng() * tales.length);
          const shown = opened + 2_000 + rng() * 20_000;
          events.push({ ms: shown, visitor, type: 'view', group: choice.index, tale });
          if (rng() < CLICK_RATE) events.push({ ms: shown + 1_000 + rng() * 30_000, visitor, type: 'click', group: choice.index, tale });
        }
      }
    }
  }
  for (const event of events) event.ms = Math.min(event.ms, cap);
  return events;
}

// POST /delivery/v1/events with one visitor's events, waiting out the rate limit's Retry-After when it answers 429.
async function postEvents(key, visitor, events) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${apiOrigin}/delivery/v1/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-TaleArt-Visitor': visitor },
      body: JSON.stringify({ events }),
    });
    if (res.status === 202) return res.json();
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 1) * 1000 + 100));
      continue;
    }
    throw new Error(`POST /delivery/v1/events: ${res.status} ${await res.text()}`);
  }
  throw new Error('POST /delivery/v1/events kept answering 429');
}

async function main() {
  await mkdir(imagesDir, { recursive: true });
  const env = {
    PATH: process.env.PATH ?? '',
    E2E_DATABASE_URL: database.url,
    PORT: String(apiPort),
    PUBLIC_API_URL: apiOrigin,
    RP_ORIGIN: dashboardOrigin,
    RP_ID: 'localhost',
  };
  let api;
  let dashboard;
  let browser;
  const written = [];
  try {
    api = start(process.execPath, [join(root, 'apps/dashboard-e2e/scripts/start-api.mjs')], env);
    await waitFor(`${apiOrigin}/api/v1/health`, 90_000);
    if (!existsSync(join(dashboardDir, 'index.csr.html'))) throw new Error(`${dashboardDir} has no build: run dashboard:build:development`);
    dashboard = await serveDashboard();

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1, locale: 'en-US' });
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Analytics shots'), url: dashboardOrigin }]);
    const page = await context.newPage();
    await page.goto(`${dashboardOrigin}/sign-in`);

    const call = async (method, path, data) => {
      const res = await context.request.fetch(`${API}${path}`, { method, data });
      if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
      return res.json();
    };

    // The project, its zone with a display, and four tale groups of two tales each, live, each tale with its own colour.
    const project = await call('post', '/projects', { name: 'Analytics shots' });
    const zone = await call('post', '/zones', { name: 'Home top', projectId: project.id });
    await call('post', `/zones/${zone.id}/frame`, { type: 'bar', settings: {} });
    const groups = [];
    for (const spec of CATALOGUE) {
      const group = await call('post', `/zones/${zone.id}/tale-groups`, { name: spec.name });
      const tales = [];
      for (const [title, color] of spec.tales) {
        const tale = await call('post', `/tale-groups/${group.id}/tales`, { title });
        const current = await call('get', `/tales/${tale.id}/document`);
        await call('put', `/tales/${tale.id}/document`, {
          document: { ...(current.document ?? { version: 1, elements: [] }), canvas: { background: { type: 'color', color } } },
          revision: current.revision,
        });
        tales.push(tale);
      }
      await call('put', `/tale-groups/${group.id}/status`, { status: 'live' });
      groups.push({ id: group.id, tales: tales.map((t) => t.id) });
    }
    const { key } = await call('post', `/zones/${zone.id}/key`, {});
    // A second zone with nothing counted in it, for the empty state.
    const quiet = await call('post', '/zones', { name: 'Quiet zone', projectId: project.id });
    await call('post', `/zones/${quiet.id}/frame`, { type: 'bar', settings: {} });

    // The events: one visitor pool, the last 7 days through the endpoint and the older days in the table.
    const visitors = Array.from({ length: VISITOR_POOL }, () => randomUUID());
    const events = generate(new Date(), visitors);
    const now = Date.now();
    const recent = events.filter((e) => e.ms >= now - (ENDPOINT_DAYS - 1) * DAY_MS - 12 * 60 * 60 * 1000);
    const older = events.filter((e) => !recent.includes(e));
    const toRow = (e) => ({
      group: groups[e.group].id,
      tale: e.tale === null ? null : groups[e.group].tales[e.tale],
      type: e.type,
      at: new Date(e.ms).toISOString(),
    });

    // The older events, straight into the throwaway database (the API would drop them as too old).
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      const { rows } = await client.query('SELECT id FROM projects WHERE id = $1', [project.id]);
      if (rows.length !== 1) throw new Error('The project is not in the throwaway database');
      const CHUNK = 5000;
      for (let i = 0; i < older.length; i += CHUNK) {
        const part = older.slice(i, i + CHUNK);
        const rowsOut = part.map((e) => ({ ...toRow(e), hash: createHash('sha256').update(`${project.id}:${visitors[e.visitor]}`).digest('hex') }));
        await client.query(
          `INSERT INTO analytics_events (project_id, zone_id, group_id, tale_id, type, visitor_hash, at)
           SELECT $1::uuid, $2::uuid, e.group_id, e.tale_id, e.type, e.visitor_hash, e.at
           FROM unnest($3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::timestamptz[])
             AS e(group_id, tale_id, type, visitor_hash, at)`,
          [
            project.id,
            zone.id,
            rowsOut.map((r) => r.group),
            rowsOut.map((r) => r.tale),
            rowsOut.map((r) => r.type),
            rowsOut.map((r) => r.hash),
            rowsOut.map((r) => r.at),
          ],
        );
      }
    } finally {
      await client.end();
    }

    // The recent events, through the Delivery API: one request per visitor (in batches of 50), with the zone key.
    const byVisitor = new Map();
    for (const e of recent) {
      if (!byVisitor.has(e.visitor)) byVisitor.set(e.visitor, []);
      byVisitor.get(e.visitor).push(e);
    }
    let accepted = 0;
    let dropped = 0;
    for (const [index, list] of byVisitor) {
      list.sort((a, b) => a.ms - b.ms);
      for (let i = 0; i < list.length; i += 50) {
        const answer = await postEvents(key, visitors[index], list.slice(i, i + 50).map(toRow).map(({ group, tale, type, at }) => (tale === null ? { type, groupId: group, at } : { type, groupId: group, taleId: tale, at })));
        accepted += answer.accepted;
        dropped += answer.dropped;
      }
    }
    console.log(`events: ${older.length} inserted directly, ${recent.length} through the API (${accepted} accepted, ${dropped} dropped)`);

    const shot = async (name, take) => {
      const path = join(imagesDir, `${name}.png`);
      await take(path);
      written.push(`${name}.png`);
    };

    // The zone's Analytics tab, with its data: the picker, the tiles and the chart.
    await page.goto(`${dashboardOrigin}/zones/${zone.id}?tab=analytics&period=30d`);
    await page.locator('.analytics-tiles[data-state="ready"]').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(500);
    const section = page.locator('section.analytics');
    // The clip is in page coordinates: the viewport's offset is added to the boxes' viewport ones.
    const scrollY = await page.evaluate(() => window.scrollY);
    const box = await section.boundingBox();
    const chartBox = await page.locator('.analytics-chart').boundingBox();
    await shot('analytics-shot-tab', (path) =>
      page.screenshot({
        path,
        fullPage: true,
        clip: { x: box.x, y: box.y + scrollY, width: box.width, height: chartBox.y + chartBox.height + 12 - box.y },
      }),
    );

    // A tile's definition, opened: the Engagement rate tile.
    await page.locator('[data-metric="engagementRate"] summary').click();
    await page.waitForTimeout(300);
    await shot('analytics-shot-definition', (path) => page.locator('.analytics-tiles').screenshot({ path }));

    // The two tables: by tale group and by tale.
    await shot('analytics-shot-tables', (path) => page.locator('.analytics-tables').screenshot({ path }));

    // The empty state: a zone with nothing counted.
    await page.goto(`${dashboardOrigin}/zones/${quiet.id}?tab=analytics&period=30d`);
    await page.locator('[data-state="empty"]').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(300);
    await shot('analytics-shot-empty', (path) => section.screenshot({ path }));

    // The totals, read back through the management API, for the report.
    const totals30 = (await call('get', `/zones/${zone.id}/analytics?period=30d`)).totals;
    const totals7 = (await call('get', `/zones/${zone.id}/analytics?period=7d`)).totals;
    console.log('30d totals', JSON.stringify(totals30));
    console.log('7d totals', JSON.stringify(totals7));
  } finally {
    if (browser) await browser.close();
    if (dashboard) await new Promise((done) => dashboard.close(done));
    await stop(api);
    await dropDatabase();
  }
  console.log(`wrote ${written.join(', ')} to ${imagesDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
