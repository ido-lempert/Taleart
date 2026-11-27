// Renders the 8 Team screenshots of the docs' roles and projects pages (apps/docs/public/images/team-shot-*.png), with the
// current dashboard. The viewer's screenshot (team-shot-viewer-readonly.png) is taken by guide-shots.mjs, not here.
//
// The built API is started by this script on its own port against a throwaway database, the built dashboard is served
// with /api proxied to the API, and headless Chromium takes each screen at 1280 x 800. The team is seeded through the
// Management API with the same calls the dashboard makes (members, invitations, the activity they leave), so the activity
// log holds real entries; the admin and the editor sign in with sessions written to that database (the same SQL as
// apps/dashboard-e2e/src/session.ts). Three things are set in the database, where the API has no call for them: the project
// creator's Admin membership (no activity line), Noa Katz's access end in the past (the API refuses a past date), and nothing
// else. The site key, which the Studio needs to say "not visible: not updated yet", is issued through the API after the team
// screens. The database is dropped at the end.
//
// The people and projects are the ones the pages' text names: Dana Levi (admin, the install admin), Alex Rivera (Publisher),
// Sam Cohen (Editor), Kim Park (Viewer, until 12 Dec 2026), Noa Katz (Editor, expired), in the project Spring Campaign,
// with Sam Cohen as a Viewer of Autumn Lookbook. Every address is at example.com.
//
// The invitations are made today, so their "link expires" dates are seven days from the run, not the dates the text
// once showed; the text now describes that rule. Access dates are fixed.
//
// Usage (after `pnpm nx run api:build` and `pnpm nx run dashboard:build:development`):
//   E2E_DATABASE_URL=postgres://taleart:dummypass@127.0.0.1:55470/team_shots_e2e_test node apps/docs/scripts/team-shots.mjs
// The name must end in _e2e_test and must differ from TEST_DATABASE_URL and DATABASE_URL. E2E_API_PORT and
// E2E_DASHBOARD_PORT pick other ports when the defaults (3433 and 4433) are in use.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright';
import { e2eDatabase } from '../../dashboard-e2e/scripts/e2e-database.mjs';
import { copySdkFiles, e2eSdk } from '../../dashboard-e2e/scripts/e2e-sdk.mjs';

const root = resolve(import.meta.dirname, '../../..');
const imagesDir = join(root, 'apps/docs/public/images');
const apiPort = Number(process.env.E2E_API_PORT || 3433);
const dashboardPort = Number(process.env.E2E_DASHBOARD_PORT || 4433);
const apiOrigin = `http://localhost:${apiPort}`;
const dashboardOrigin = `http://localhost:${dashboardPort}`;
const API = `${apiOrigin}/api/v1`;
const dashboardDir = join(root, 'dist/apps/dashboard/browser');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };
const DESKTOP = { width: 1280, height: 800 };

const database = e2eDatabase(process.env); // throws for a name that is not a throwaway one
const scratch = mkdtempSync(join(tmpdir(), 'taleart-team-shots-'));
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

// The same SQL as apps/dashboard-e2e/src/session.ts: a user and a session whose token is stored as its hash.
async function withDb(fn) {
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
async function insertUser(name, email, role) {
  return withDb(async (client) => {
    const { rows } = await client.query('INSERT INTO users (name, email, role, webauthn_user_id) VALUES ($1, $2, $3, $4) RETURNING id', [
      name,
      email,
      role,
      randomBytes(32).toString('base64url'),
    ]);
    return rows[0].id;
  });
}
async function sessionFor(userId) {
  return withDb(async (client) => {
    const token = randomBytes(32).toString('base64url');
    await client.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '2 hours')", [
      userId,
      createHash('sha256').update(token, 'utf8').digest('hex'),
    ]);
    return token;
  });
}
// Two rows the API does not write: Noa Katz's access ended on 25 Oct 2026, which the API refuses as a date (so the end is
// set here), and the project's creator is a member as an Admin, the first row, as the Members table of the docs shows.
function endAccessInDb(projectId, userId, endsAt) {
  return withDb((client) => client.query('UPDATE project_members SET expires_at = $3 WHERE project_id = $1 AND user_id = $2', [projectId, userId, endsAt]));
}
function addAdminInDb(projectId, userId) {
  return withDb((client) => client.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'admin')", [projectId, userId]));
}
async function createDatabase() {
  const url = new URL(database.url);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${database.name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${database.name}"`);
  } finally {
    await admin.end();
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

// Tale art: a plain background colour and a heading, as the tale's document, through the Management API.
const elementId = () => randomUUID();
function textElement(text, box, { size, weight = 'bold', color = '#FFFFFF' }) {
  return {
    id: elementId(),
    type: 'text',
    box: { ...box, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: { label: text },
    props: { text, font: { source: 'system', stack: 'sans' }, size, weight, color, align: 'start', lineHeight: 1.15, background: 'none' },
  };
}
const HEADING = { x: 0.08, y: 0.38, w: 0.84, h: 0.14 };

// The Spring collection's tales. The first is Sam Cohen's (an Editor) new tale, never published: its draft is saved below and
// the Studio reads "not visible: not updated yet". The other two are published.
const TALES = [
  { title: 'Fresh arrivals', color: '#4F1DFC', published: null },
  { title: 'Weekend picks', color: '#14213D', published: 'Weekend picks' },
  { title: 'Sale ends Sunday', color: '#0F5E4F', published: 'Sale ends Sunday' },
];

// Lets transitions and the first data calls finish before a screen is taken.
async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(800);
}

// Scrolls the dashboard's own scrolling element (not the window) so the card under the heading starts at `top` pixels
// from the top of the viewport, or, when `top` is 'bottom', to the end of the page, as the docs' screens show it.
async function placeSection(page, heading, top) {
  await page.evaluate(
    ([text, y]) => {
      const title = [...document.querySelectorAll('h2, h3')].find((h) => h.textContent.trim() === text);
      if (!title) throw new Error(`No heading ${text}`);
      const section = title.closest('section') ?? title;
      let scroller = section.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
        scroller = scroller.parentElement;
      }
      if (y === 'bottom') {
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        else window.scrollTo(0, document.body.scrollHeight);
        return;
      }
      const delta = section.getBoundingClientRect().top - y;
      if (scroller) scroller.scrollTop += delta;
      else window.scrollBy(0, delta);
    },
    [heading, top],
  );
}

// One screen: the file of the docs' image, the same size as before (1280 x 800 PNG).
async function save(name, page) {
  const png = join(scratch, name);
  await page.screenshot({ path: png });
  const target = join(imagesDir, name);
  copyFileSync(png, target);
  written.push(name);
  console.log('wrote', name, statSync(target).size, 'bytes');
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
    MEDIA_DIR: mkdtempSync(join(tmpdir(), 'taleart-team-media-')),
    WEB_SDK_FILE: sdk.bundleFile,
    SDK_BUILDS_DIR: sdk.buildsDir,
  };

  let api;
  let dashboard;
  let browser;
  try {
    await createDatabase();
    dashboard = await serveDashboard();
    api = start(process.execPath, [join(root, 'dist/apps/api/main.js')], apiEnv);
    console.log('api pid', api.pid);
    await waitFor(`${apiOrigin}/api/v1/health`, 90_000);

    browser = await chromium.launch();
    const newContext = (viewport) => browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'light' });

    // The people. Dana Levi is the install admin; the others are content managers, as the Users page shows.
    const danaId = await insertUser('Dana Levi', 'dana.levi@example.com', 'admin');
    const samId = await insertUser('Sam Cohen', 'sam.cohen@example.com', 'content_manager');
    const kimId = await insertUser('Kim Park', 'kim.park@example.com', 'content_manager');
    const noaId = await insertUser('Noa Katz', 'noa.katz@example.com', 'content_manager');
    const alexId = await insertUser('Alex Rivera', 'alex.rivera@example.com', 'content_manager');

    // Dana's browser: the admin's session, every request below is a real dashboard call.
    const context = await newContext(DESKTOP);
    await context.addCookies([{ name: 'taleart_session', value: await sessionFor(danaId), url: dashboardOrigin }]);
    const call = async (method, path, data) => {
      const res = await context.request.fetch(`${API}${path}`, { method, data });
      if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
      return res.status() === 204 ? null : res.json();
    };

    const project = await call('post', '/projects', { name: 'Spring Campaign' });
    const autumn = await call('post', '/projects', { name: 'Autumn Lookbook' });
    await addAdminInDb(project.id, danaId);
    // A zone with a display (the Stories bar template): the Studio says "not visible yet", not "no display".
    const zone = await call('post', '/zones', { name: 'Home top', projectId: project.id, template: 'stories-bar' });
    const group = await call('post', `/zones/${zone.id}/tale-groups`, { name: 'Spring collection' });

    // Tales with their documents, published (the first one's heading is changed by Sam Cohen below).
    const taleIds = {};
    for (const spec of TALES) {
      const tale = await call('post', `/tale-groups/${group.id}/tales`, { title: spec.title });
      taleIds[spec.title] = tale.id;
      if (spec.published === null) continue;
      const current = await call('get', `/tales/${tale.id}/document`);
      const base = current.document ?? { version: 1, canvas: { background: { type: 'color', color: '#1F1A17' } }, elements: [] };
      const document = {
        ...base,
        canvas: { ...base.canvas, background: { type: 'color', color: spec.color } },
        // The heading's size is a fraction of the tale's width; 0.04 is the size of the docs' picture.
        elements: [...base.elements, textElement(spec.published, HEADING, { size: 0.04 })],
      };
      const saved = await call('put', `/tales/${tale.id}/document`, { document, revision: current.revision, sawTaleMedia: false });
      await call('post', `/tales/${tale.id}/document/publish`, { revision: saved.revision, publishedRevision: current.published?.revision ?? 0 });
    }

    // The members, in the order they joined (the Members table is sorted by it) and the activity they leave, oldest first.
    const add = (email, role, expiresAt) => call('post', `/projects/${project.id}/members`, { email, role, ...(expiresAt ? { expiresAt } : {}) });
    const changeRole = (userId, role) => call('patch', `/projects/${project.id}/members/${userId}`, { role });

    await add('alex.rivera@example.com', 'publisher');
    await changeRole(alexId, 'viewer');
    await changeRole(alexId, 'publisher');
    await add('sam.cohen@example.com', 'editor');
    await changeRole(samId, 'publisher');
    await changeRole(samId, 'editor');
    await add('kim.park@example.com', 'viewer', '2026-12-12T23:59:59Z');
    await add('noa.katz@example.com', 'editor', '2026-12-31T23:59:59Z');
    await endAccessInDb(project.id, noaId, '2026-10-25T12:00:00Z');

    // Two pending invitations: an Editor with permanent access, then a Viewer until 31 Dec 2026 (listed newest first).
    await call('post', `/projects/${project.id}/invitations`, { email: 'pending.editor@example.com', role: 'editor' });
    await call('post', `/projects/${project.id}/invitations`, { email: 'pending.viewer@example.com', role: 'viewer', accessExpiresAt: '2026-12-31T23:59:59Z' });

    // Sam Cohen is also a Viewer of Autumn Lookbook (the Users page lists it).
    await call('post', `/projects/${autumn.id}/members`, { email: 'sam.cohen@example.com', role: 'viewer' });

    // The group is On (live), so the tale's state is the draft's alone: the toolbar reads "not updated yet".
    await call('put', `/tale-groups/${group.id}/status`, { status: 'live' });

    // Sam Cohen's draft: the heading of the first tale changed, not published (1 change, Not visible).
    const samCtx = await newContext(DESKTOP);
    await samCtx.addCookies([{ name: 'taleart_session', value: await sessionFor(samId), url: dashboardOrigin }]);
    const samCall = async (method, path, data) => {
      const res = await samCtx.request.fetch(`${API}${path}`, { method, data });
      if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
      return res.json();
    };
    const freshId = taleIds['Fresh arrivals'];
    const draftBase = await samCall('get', `/tales/${freshId}/document`);
    const base = draftBase.document ?? { version: 1, canvas: { background: { type: 'color', color: '#1F1A17' } }, elements: [] };
    const draftDocument = {
      ...base,
      canvas: { ...base.canvas, background: { type: 'color', color: TALES[0].color } },
      elements: [...base.elements, textElement('Fresh arrivals', HEADING, { size: 0.04 })],
    };
    await samCall('put', `/tales/${freshId}/document`, { document: draftDocument, revision: draftBase.revision, sawTaleMedia: false });

    // Screens. Dana (Admin) first: the Users page, then the Team page sections in the order of the page.
    const page = await context.newPage();
    await page.goto(`${dashboardOrigin}/settings/users`);
    await page.getByRole('heading', { name: 'Users' }).waitFor({ timeout: 60_000 });
    await settle(page);
    await save('team-shot-users-roles.png', page);

    await page.goto(`${dashboardOrigin}/settings/team`);
    await page.getByText('Who works in').waitFor({ timeout: 60_000 });
    await settle(page);
    await save('team-shot-members.png', page);

    await placeSection(page, 'What each role can do', 72);
    await settle(page);
    await save('team-shot-roles-matrix.png', page);

    await placeSection(page, 'Pending invitations', 72);
    await settle(page);
    await save('team-shot-pending-invitations.png', page);

    await placeSection(page, 'Activity', 'bottom');
    await settle(page);
    await save('team-shot-activity.png', page);

    // One more invitation, by the drawer: the link is shown once, then Done. The Members card sits where the docs' picture has it.
    await page.goto(`${dashboardOrigin}/settings/team`);
    await page.getByText('Who works in').waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Add or invite' }).click();
    const invite = page.getByRole('dialog', { name: 'Add or invite' });
    await invite.getByLabel('Create a one-time invitation link').check();
    await invite.getByLabel('Email').fill('invitee.editor@example.com');
    await invite.getByLabel('Role').selectOption({ label: 'Editor' });
    await invite.getByLabel('Access ends (optional)').fill('2027-01-31');
    await invite.getByRole('button', { name: 'Create link' }).click();
    await invite.getByLabel('Invitation link').waitFor({ timeout: 60_000 });
    await placeSection(page, 'Members', 47);
    await settle(page);
    await save('team-shot-invitation-link.png', page);
    await invite.getByRole('button', { name: 'Done' }).click();

    // The add drawer for an existing account: the email typed, not sent (the drawer is not submitted).
    await page.goto(`${dashboardOrigin}/settings/team`);
    await page.getByText('Who works in').waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Add or invite' }).click();
    const add2 = page.getByRole('dialog', { name: 'Add or invite' });
    await add2.getByLabel('Email').fill('maya.stern@example.com');
    await add2.getByLabel('Role').selectOption({ label: 'Publisher' });
    await placeSection(page, 'Members', 47);
    await settle(page);
    await save('team-shot-add-or-invite.png', page);
    await page.keyboard.press('Escape');

    // Sam Cohen (Editor): the tale studio with the draft. The project's site key is issued after the team screens, so it is
    // not in their activity; without it the Studio says the zone is not installed, not "not updated yet".
    await call('post', `/projects/${project.id}/site-key`, {});
    const samPage = await samCtx.newPage();
    await samPage.goto(`${dashboardOrigin}/tales/${freshId}/studio`);
    await samPage.locator('#studio-add-heading').waitFor({ timeout: 60_000 });
    await samPage.getByText('All changes saved', { exact: false }).first().waitFor({ timeout: 60_000 });
    await settle(samPage);
    await save('team-shot-editor-draft.png', samPage);
  } finally {
    if (browser) await browser.close();
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
