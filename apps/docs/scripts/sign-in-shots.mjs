// Renders the sign-in methods screens for the docs' "Sign-in methods" guide (not shipped: a script for the docs' images).
//
// The built API is started by this script on its e2e port against a throwaway database, a synthetic admin signs in with a
// session written to that database (the same SQL as apps/dashboard-e2e/src/session.ts), and headless Chromium writes the
// screenshots to apps/docs/public/images (signin-shot-*.png). A local fake OpenID Connect issuer (discovery and JWKS over
// http, allowed for localhost outside production) backs the generic provider's Test. The database is dropped at the end.
//
// Only fake values reach the screens: client IDs of the form example, the secret `placeholder`, and a random
// TALEART_SECRET_KEY generated for each run (never printed). The provider's secret is shown nowhere after saving.
//
// The API runs in two phases on the same database: first without TALEART_SECRET_KEY (so the secret key notice shows),
// then with it (so a provider can be saved and tested).
//
// Usage (after `pnpm nx run api:build` and `pnpm nx run dashboard:build:development`):
//   E2E_DATABASE_URL=postgres://taleart:taleart@localhost:5432/sign_in_shots_e2e_test node apps/docs/scripts/sign-in-shots.mjs
// The name must end in _e2e_test and must differ from TEST_DATABASE_URL and DATABASE_URL. E2E_API_PORT and
// E2E_DASHBOARD_PORT pick other ports when the defaults are in use.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright';
import { e2eDatabase } from '../../dashboard-e2e/scripts/e2e-database.mjs';
import { e2eSdk } from '../../dashboard-e2e/scripts/e2e-sdk.mjs';

const root = resolve(import.meta.dirname, '../../..');
const imagesDir = join(root, 'apps/docs/public/images');
const apiPort = Number(process.env.E2E_API_PORT || 3413);
const dashboardPort = Number(process.env.E2E_DASHBOARD_PORT || 4313);
const apiOrigin = `http://localhost:${apiPort}`;
const dashboardOrigin = `http://localhost:${dashboardPort}`;
const API = `${apiOrigin}/api/v1`;
const dashboardDir = join(root, 'dist/apps/dashboard/browser');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };
const FAKE_SECRET = 'placeholder';

const database = e2eDatabase(process.env); // throws for a name that is not a throwaway one

// A child process of its own group, so the whole tree can be stopped.
function start(command, args, env, logFile) {
  const out = openSync(logFile, 'a');
  return spawn(command, args, { cwd: root, env, detached: true, stdio: ['ignore', out, out] });
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

// The fake OpenID Connect issuer: the discovery document names this issuer exactly, and the JWKS is empty (Test does not sign in).
function serveIssuer() {
  return new Promise((done) => {
    let base = '';
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', base);
      const json = (body) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/.well-known/openid-configuration') {
        return json({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          jwks_uri: `${base}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        });
      }
      if (url.pathname === '/jwks') return json({ keys: [] });
      res.writeHead(404).end();
    });
    server.listen(0, 'localhost', () => {
      base = `http://localhost:${server.address().port}`;
      done({ server, base: () => base });
    });
  });
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
async function insertUser(name, role) {
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    const { rows } = await client.query('INSERT INTO users (name, email, role, webauthn_user_id) VALUES ($1, $2, $3, $4) RETURNING id', [
      name,
      `sign-in-shots-${randomBytes(6).toString('hex')}@example.com`,
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

// The admin's password, in the same format as libs/server/access passwords.ts (scrypt N=2^15, r=8, p=1, 64 bytes).
// The password is random and never printed; the username is fixed.
async function setPassword(userId, username) {
  const { scryptSync } = await import('node:crypto');
  const salt = randomBytes(16);
  const password = randomBytes(24).toString('base64url');
  const hash = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const stored = `scrypt$32768$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    await client.query('INSERT INTO user_passwords (user_id, username, password_hash) VALUES ($1, $2, $3)', [userId, username, stored]);
  } finally {
    await client.end();
  }
}
async function removePassword(userId) {
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    await client.query('DELETE FROM user_passwords WHERE user_id = $1', [userId]);
  } finally {
    await client.end();
  }
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

async function main() {
  await mkdir(imagesDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'taleart-sign-in-shots-'));
  const logFile = join(scratch, 'api.log');
  const sdk = e2eSdk(root);
  rmSync(sdk.dir, { recursive: true, force: true });
  mkdirSync(sdk.dir, { recursive: true });
  copyFileSync(sdk.builtBundle, sdk.bundleFile);
  const secretKey = randomBytes(32).toString('base64'); // generated for this run, never printed

  const apiEnv = (withKey) => ({
    PATH: process.env.PATH ?? '',
    DATABASE_URL: database.url,
    PORT: String(apiPort),
    PUBLIC_API_URL: apiOrigin,
    RP_ORIGIN: dashboardOrigin,
    RP_ID: 'localhost',
    MEDIA_DIR: mkdtempSync(join(tmpdir(), 'taleart-sign-in-media-')),
    WEB_SDK_FILE: sdk.bundleFile,
    SDK_BUILDS_DIR: sdk.buildsDir,
    ...(withKey ? { TALEART_SECRET_KEY: secretKey } : {}),
  });

  let api;
  let issuer;
  let dashboard;
  let browser;
  const written = [];
  try {
    await createDatabase();
    issuer = await serveIssuer();
    if (!existsSync(join(dashboardDir, 'index.csr.html'))) throw new Error(`${dashboardDir} has no build: run dashboard:build:development`);
    dashboard = await serveDashboard();

    // Phase 1: no key. The methods page shows the secret key notice.
    api = start(process.execPath, [join(root, 'dist/apps/api/main.js')], apiEnv(false), logFile);
    await waitFor(`${apiOrigin}/api/v1/health`, 90_000);

    const admin = await insertUser('Ada Admin', 'admin');
    await insertUser('Sam Example', 'content_manager');
    await setPassword(admin, 'ada.admin');
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1, locale: 'en-US' });
    await context.addCookies([{ name: 'taleart_session', value: await sessionFor(admin), url: dashboardOrigin }]);
    const page = await context.newPage();

    const call = async (method, path, data) => {
      const res = await context.request.fetch(`${API}${path}`, { method, data });
      if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
      return res.json();
    };
    const project = await call('post', '/projects', { name: 'Shop' });

    const shot = async (name, take) => {
      const path = join(imagesDir, `signin-shot-${name}.png`);
      await take(path);
      written.push(`signin-shot-${name}.png`);
      console.log('wrote', `signin-shot-${name}.png`);
    };
    const methods = `${dashboardOrigin}/settings/sign-in-methods`;

    // Step 1: the methods page, with the notice that the key is missing.
    await page.goto(methods);
    await page.getByRole('heading', { name: 'Sign-in methods' }).waitFor({ timeout: 60_000 });
    await page.getByText('Provider secrets cannot be saved yet').waitFor();
    await shot('01-methods', (path) => page.screenshot({ path }));

    // Step 2: username and password on.
    await page.getByRole('switch', { name: 'Username and password sign-in' }).click();
    await page.waitForTimeout(800);
    await shot('02-password', (path) => page.screenshot({ path }));

    // Restart with the key: the secret can be saved from now on.
    await stop(api);
    api = start(process.execPath, [join(root, 'dist/apps/api/main.js')], apiEnv(true), logFile);
    await waitFor(`${apiOrigin}/api/v1/health`, 90_000);
    await page.goto(methods);
    await page.getByRole('heading', { name: 'Sign-in methods' }).waitFor({ timeout: 60_000 });

    // Step 3: the Google drawer, filled with placeholders, not saved.
    await page.getByRole('button', { name: 'Add a provider' }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('radio', { name: 'Google' }).check();
    await drawer.getByLabel('Client ID').fill('1234567890-example.apps.googleusercontent.com');
    await drawer.getByLabel('Client secret').fill(FAKE_SECRET);
    await shot('03-google-drawer', (path) => drawer.screenshot({ path }));
    await drawer.getByRole('button', { name: 'Cancel' }).click();

    // Step 4: a generic OpenID Connect provider, saved, then tested against the fake issuer.
    await page.getByRole('button', { name: 'Add a provider' }).click();
    await drawer.getByRole('radio', { name: 'Generic OpenID Connect' }).check();
    await drawer.getByLabel('Button name').fill('Company SSO');
    await drawer.getByLabel('Slug').fill('company-sso');
    await drawer.getByLabel('Issuer URL').fill(issuer.base());
    await drawer.getByLabel('Client ID').fill('example-client-id');
    await drawer.getByLabel('Client secret').fill(FAKE_SECRET);
    await drawer.getByRole('button', { name: 'Save provider' }).click();
    // Saved: the drawer closes. Test lives in the drawer of the saved provider, so open it again.
    await page.getByRole('button', { name: 'Edit Company SSO' }).click();
    await drawer.getByRole('button', { name: 'Test', exact: true }).click();
    await drawer.getByText("The provider's settings work.").waitFor({ timeout: 30_000 });
    // The drawer is as tall as the window: scroll its scrollable parts to the bottom so the result shows above the footer.
    await drawer.evaluate((root) => root.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 2) el.scrollTop = el.scrollHeight; }));
    await shot('04-oidc-test', (path) => drawer.screenshot({ path }));
    await drawer.getByRole('button', { name: 'Cancel' }).click();

    // Step 5: the Apple drawer, filled with placeholders, not saved.
    await page.getByRole('button', { name: 'Add a provider' }).click();
    await drawer.getByRole('radio', { name: 'Apple' }).check();
    await drawer.getByLabel('Button name').fill('Apple');
    await drawer.getByLabel('Client ID').fill('com.example.signin');
    await drawer.getByLabel('Team ID').fill('EXAMPLE123');
    await drawer.getByLabel('Key ID').fill('EXAMPLE456');
    await drawer.getByLabel('Private key (.p8)').fill(FAKE_SECRET);
    await shot('05-apple-drawer', (path) => drawer.screenshot({ path }));
    await drawer.getByRole('button', { name: 'Cancel' }).click();
    await page.keyboard.press('Escape');

    // Step 6: the sign-in page of a signed-out browser, with the enabled methods.
    const signedOut = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1, locale: 'en-US' });
    const outside = await signedOut.newPage();
    await outside.goto(`${dashboardOrigin}/sign-in`);
    await outside.getByText('Continue with Company SSO', { exact: true }).waitFor({ timeout: 60_000 });
    await shot('06-sign-in', (path) => outside.screenshot({ path }));

    // Step 7 has no screenshot yet: a fresh /invite/:token page offers only the passkey, because nothing loads the
    // sign-in methods on that route (apps/dashboard/src/app/app.routes.ts has no guard that calls auth.ensure()).
    await signedOut.close();

    // Step 8: the signed-in admin's own methods.
    await page.goto(`${dashboardOrigin}/settings/my-sign-in-methods`);
    await page.getByRole('heading', { name: 'My sign-in methods' }).waitFor({ timeout: 60_000 });
    await page.getByText('Linked providers', { exact: true }).first().waitFor({ timeout: 60_000 });
    await shot('08-my-methods', (path) => page.screenshot({ path }));

    // Step 9: a reset link issued for Sam Example, shown once.
    await page.goto(`${dashboardOrigin}/settings/users`);
    const row = page.getByRole('row').filter({ hasText: 'Sam Example' });
    await row.getByRole('button', { name: 'Issue reset link' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create link' }).click();
    await page.getByLabel('Password reset link').waitFor({ timeout: 30_000 });
    // The link is blurred: it is one-time and its database is dropped after the run, but it is still a link.
    await page.getByLabel('Password reset link').evaluate((el) => (el.style.filter = 'blur(5px)'));
    await shot('09-reset-link', (path) => page.getByRole('dialog').screenshot({ path }));
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

    // Step 10: the admin's only way in is the passkey, and turning the passkey off would leave no way to sign in.
    await removePassword(admin);
    await page.goto(methods);
    await page.getByRole('switch', { name: 'Passkey sign-in' }).click();
    await page.getByText('That would leave an admin with no way to sign in.').waitFor({ timeout: 30_000 });
    await shot('10-lockout', (path) => page.screenshot({ path }));

  } finally {
    if (browser) await browser.close();
    if (dashboard) await new Promise((done) => dashboard.close(done));
    if (issuer) await new Promise((done) => issuer.server.close(done));
    await stop(api);
    await dropDatabase();
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`wrote ${written.join(', ')} to ${imagesDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
