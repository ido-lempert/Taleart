// Renders Tale Studio's palette and inspector for the docs' Interactive components page (not shipped:
// a script for the docs' images). It runs the dashboard end-to-end harness's way: the built API and the
// dashboard are started on their e2e ports against a throwaway database, a synthetic admin signs in with
// a session written to that database (the same SQL as apps/dashboard-e2e/src/session.ts), and headless
// Chromium writes the screenshots to apps/docs/public/images. The database is dropped at the end.
//
// The dashboard is the built one (`pnpm nx run dashboard:build:development`, served here with /api proxied to
// the API), not the nx dev server: a dev server started by another nx process holds the same task.
//
// Usage (after `pnpm nx run api:build` and `pnpm nx run dashboard:build:development`):
//   E2E_DATABASE_URL=postgres://user@localhost:5432/<name>_e2e_test node apps/docs/scripts/studio-shots.mjs
// The name must end in _e2e_test and must differ from TEST_DATABASE_URL and DATABASE_URL.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
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
      [name, `studio-shots-${randomBytes(6).toString('hex')}@example.com`, 'admin', randomBytes(32).toString('base64url')],
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
  const written = [];
  let browser;
  try {
    api = start(process.execPath, [join(root, 'apps/dashboard-e2e/scripts/start-api.mjs')], env);
    await waitFor(`${apiOrigin}/api/v1/health`, 90_000);
    if (!existsSync(join(dashboardDir, 'index.csr.html'))) throw new Error(`${dashboardDir} has no build: run dashboard:build:development`);
    dashboard = await serveDashboard();

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 1, locale: 'en-US' });
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Docs studio'), url: dashboardOrigin }]);
    const page = await context.newPage();
    await page.goto(`${dashboardOrigin}/sign-in`);

    const call = async (method, path, data) => {
      const res = await context.request.fetch(`${API}${path}`, { method, data });
      if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
      return res.json();
    };
    const project = await call('post', '/projects', { name: 'Docs studio' });
    const zone = await call('post', '/zones', { name: 'Home top', projectId: project.id });
    await call('post', `/zones/${zone.id}/frame`, { type: 'bar', settings: {} });
    const group = await call('post', `/zones/${zone.id}/tale-groups`, { name: 'Summer' });
    const tale = await call('post', `/tale-groups/${group.id}/tales`, { title: 'Sale' });
    // A colour for the canvas, so the tale is not a black card in the screenshots.
    const current = await call('get', `/tales/${tale.id}/document`);
    await call('put', `/tales/${tale.id}/document`, {
      document: { ...(current.document ?? { version: 1, elements: [] }), canvas: { background: { type: 'color', color: '#6D28D9' } } },
      revision: current.revision,
    });

    const shot = async (name, locator) => {
      const path = join(imagesDir, `${name}.png`);
      if (locator) await locator.screenshot({ path });
      else await page.screenshot({ path });
      written.push(`${name}.png`);
    };

    await page.goto(`${dashboardOrigin}/tales/${tale.id}/studio`);
    await page.locator('#studio-add-heading').waitFor({ timeout: 60_000 });
    const palette = page.locator('#studio-panel-elements');
    await palette.getByRole('group', { name: 'Interactive' }).scrollIntoViewIfNeeded();
    await shot('studio-shot-palette', palette);

    // The countdown: added from its tile, its title typed, then the whole studio and the inspector.
    await page.locator('#studio-add-countdown').click();
    const inspector = page.locator('#studio-inspector');
    await inspector.getByLabel('Title', { exact: true }).fill('Sale ends in');
    await inspector.getByLabel('Text when it ends').fill('The sale is over');
    await page.waitForTimeout(600);
    await shot('studio-shot-countdown-studio');
    await shot('studio-shot-countdown-inspector', inspector);

    // The promo code: the countdown is deleted first, so the two do not overlap on the canvas.
    await inspector.getByRole('button', { name: 'Delete countdown' }).click();
    await page.locator('#studio-add-promo-code').click();
    await inspector.getByLabel('Code', { exact: true }).fill('SUMMER25');
    await inspector.getByLabel('Title', { exact: true }).fill('Your welcome gift');
    await inspector.getByLabel('Note', { exact: true }).fill('20% off sandals, until Sunday');
    await page.waitForTimeout(600);
    await shot('studio-shot-promo-code-studio');
    await shot('studio-shot-promo-code-inspector', inspector);
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
