import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { e2eDatabase } from '../scripts/e2e-database.mjs';
import { e2eSdk } from '../scripts/e2e-sdk.mjs';
import { axeViolations } from './axe';
import { emptyInstall, signIn } from './session';

/**
 * Pinned SDK URLs keep working after a release (story 8.21): a page pins the SDK with Subresource
 * Integrity from the Install tab; the SDK is rebuilt under the running API and another API is
 * started on the changed SDK (a restart); the pinned page still loads its build with SRI, the stable
 * URL serves the new one, and the Install tab shows the new pinned URL.
 *
 * The e2e API serves a copy of the built SDK with its own builds folder (scripts/e2e-sdk.mjs), so
 * the test changes that copy, never the build.
 */

const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  await new Promise((resolve) => setTimeout(resolve, 500));
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

// What a rebuilt SDK sets, so a page can tell which build it loaded.
const MARKER = 'taleartE2eBuild';

/**
 * A host page on 127.0.0.1 (another origin, on this machine: Local Network Access) that loads the
 * SDK with exactly this script tag, then says whether the SDK ran and which build it was.
 */
async function hostPage(scriptTag: string): Promise<{ url: string; server: Server }> {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pinned SDK</title></head><body>
<h1>A page that pins the TaleArt SDK</h1>
<pre id="tag" style="white-space: pre-wrap; overflow-wrap: anywhere"></pre>
<p id="result">Loading…</p>
${scriptTag}
<script type="module">
  document.getElementById('tag').textContent = ${JSON.stringify(scriptTag).replace(/</g, '\\u003c')};
  const defined = await Promise.race([
    customElements.whenDefined('taleart-view').then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  document.getElementById('result').textContent = defined
    ? 'SDK loaded: ' + (globalThis.${MARKER} ?? 'first build')
    : 'SDK not loaded';
</script>
</body></html>`;
  const server = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, server };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test.describe.serial('pinned SDK URLs keep working after a release (story 8.21)', () => {
  const sdk = e2eSdk(workspaceRoot);
  let context: BrowserContext;
  let page: Page;
  let zoneId = '';
  let first = { url: '', integrity: '', tag: '' };
  let restarted: ChildProcess | null = null;
  const servers: Server[] = [];

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    await context.addCookies([{ name: 'taleart_session', value: await signIn('Pinned SDK'), url: baseURL ?? '' }]);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL ?? '' });
    page = await context.newPage();
    const api = async <T>(path: string, data: unknown): Promise<T> => {
      const res = await page.request.post(`/api/v1${path}`, { data });
      expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBe(true);
      return (await res.json()) as T;
    };
    const project = await api<{ id: string }>('/projects', { name: 'Pinned SDK' });
    zoneId = (await api<{ id: string }>('/zones', { name: 'Home top', projectId: project.id })).id;
  });

  test.afterAll(async () => {
    restarted?.kill('SIGTERM');
    for (const server of servers) server.close();
    await context.close();
    await emptyInstall();
  });

  // The Install tab's pinned URL and integrity, and the tag Copy pinned script tag puts on the clipboard.
  async function readInstallTab(): Promise<{ url: string; integrity: string; tag: string }> {
    await page.goto(`/zones/${zoneId}`);
    await page.getByRole('tab', { name: 'Install' }).click();
    const url = await page.getByLabel('Pinned URL').inputValue();
    const integrity = await page.getByLabel('Integrity').inputValue();
    await page.getByRole('button', { name: 'Copy pinned script tag' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Pinned script tag copied' })).toHaveCount(1);
    const tag = await page.evaluate(() => navigator.clipboard.readText());
    return { url, integrity, tag };
  }

  async function loads(scriptTag: string, name?: string): Promise<string> {
    const host = await hostPage(scriptTag);
    servers.push(host.server);
    const p = await context.newPage();
    const said: string[] = [];
    p.on('console', (m) => said.push(`${m.type()}: ${m.text()}`));
    p.on('pageerror', (e) => said.push(`pageerror: ${e.message}`));
    await p.goto(host.url);
    await expect(p.locator('#result'), said.join('\n')).not.toHaveText('Loading…', { timeout: 15_000 });
    const result = (await p.locator('#result').textContent()) ?? '';
    if (name) await shot(p, name);
    await p.close();
    return result;
  }

  test('the Install tab shows the pinned URL and integrity, and a page pinned with them loads the SDK', async () => {
    first = await readInstallTab();
    expect(first.url).toMatch(/\/sdk\/v1\/taleart\.[\w-]{16}\.js$/);
    expect(first.integrity).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
    expect(first.tag).toBe(`<script type="module" src="${first.url}" integrity="${first.integrity}" crossorigin="anonymous"></script>`);
    await page.getByRole('button', { name: 'Copy URL' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first.url);
    await page.getByRole('button', { name: 'Copy integrity' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first.integrity);
    await page.locator('#pinned-sdk-title').scrollIntoViewIfNeeded();
    await shot(page, '01-install-tab-pinned-first-build');
    expect(await axeViolations(page)).toEqual([]);
    // At phone width the pinned section fits, with no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#pinned-sdk-title').scrollIntoViewIfNeeded();
    await shot(page, '01b-install-tab-pinned-phone');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });

    expect(await loads(first.tag, '02-pinned-page-first-build')).toBe('SDK loaded: first build');
    // The integrity is checked: the same URL with another digest does not run.
    const wrong = first.tag.replace(first.integrity, `sha384-${'A'.repeat(64)}`);
    expect(await loads(wrong)).toBe('SDK not loaded');
  });

  test('after a rebuild and a restart with a changed SDK, the pinned page still loads its build', async () => {
    // Rebuild: the bundle the running API serves changes.
    appendFileSync(sdk.bundleFile, `\nglobalThis.${MARKER} = 'rebuilt';\n`);

    // The Install tab now shows the new build's pinned URL and integrity.
    const second = await readInstallTab();
    expect(second.url).not.toBe(first.url);
    expect(second.integrity).not.toBe(first.integrity);
    await page.locator('#pinned-sdk-title').scrollIntoViewIfNeeded();
    await shot(page, '03-install-tab-pinned-after-rebuild');

    // Restart: a new API process on the changed SDK and the same builds folder.
    const port = await freePort();
    const apiUrl = `http://localhost:${port}`;
    const media = mkdtempSync(join(tmpdir(), 'taleart-e2e-media-'));
    restarted = spawn(process.execPath, [join(workspaceRoot, 'dist/apps/api/main.js')], {
      cwd: workspaceRoot,
      stdio: 'ignore',
      env: {
        PATH: process.env['PATH'] ?? '',
        DATABASE_URL: e2eDatabase(process.env).url,
        PORT: String(port),
        PUBLIC_API_URL: apiUrl,
        RP_ORIGIN: 'http://localhost:1',
        RP_ID: 'localhost',
        MEDIA_DIR: media,
        WEB_SDK_FILE: sdk.bundleFile,
        SDK_BUILDS_DIR: sdk.buildsDir,
      },
    });
    await expect
      .poll(async () => (await fetch(`${apiUrl}/api/v1/health`).catch(() => null))?.status, { timeout: 30_000 })
      .toBe(200);

    // The first build at its pinned URL on the restarted API: its own bytes, immutable.
    const pinnedPath = new URL(first.url).pathname;
    const old = await fetch(`${apiUrl}${pinnedPath}`);
    expect(old.status).toBe(200);
    expect(old.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const original = readFileSync(sdk.builtBundle);
    expect(Buffer.from(await old.arrayBuffer()).equals(original)).toBe(true);

    // A page pinned to the first build (its tag, on the restarted API) still loads it with SRI.
    const pinnedOnRestart = first.tag.replace(first.url, `${apiUrl}${pinnedPath}`);
    expect(await loads(pinnedOnRestart, '04-pinned-page-after-restart')).toBe('SDK loaded: first build');
    // The stable URL serves the new build, and so does the new pinned one.
    expect(await loads(`<script type="module" src="${apiUrl}/sdk/v1/taleart.js"></script>`)).toBe('SDK loaded: rebuilt');
    const secondOnRestart = second.tag.replace(second.url, `${apiUrl}${new URL(second.url).pathname}`);
    expect(await loads(secondOnRestart, '05-new-pinned-page-after-restart')).toBe('SDK loaded: rebuilt');
    // An unknown build answers 404.
    expect((await fetch(`${apiUrl}/sdk/v1/taleart.AAAAAAAAAAAAAAAA.js`)).status).toBe(404);

    restarted.kill('SIGTERM');
    restarted = null;
    // The SDK as built, for the specs after this one.
    copyFileSync(sdk.builtBundle, sdk.bundleFile);
  });
});
