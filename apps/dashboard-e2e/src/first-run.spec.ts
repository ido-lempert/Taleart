import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { axeViolations } from './axe';

/**
 * The first run (epic UX rework, Done when; story 8.13): a new user goes from sign-up to a tale
 * visible on the test page in at most 15 actions, with no tale published by hand. An action is
 * one click, one typed field or one file choice; waiting and looking are not actions. Then the
 * Install tab's promises: the copied snippet renders the zone on a blank page, and the test page
 * keeps the key to itself.
 */

const MAX_ACTIONS = 15;
const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  // Past the drawers' and the viewer's opening transitions.
  await new Promise((resolve) => setTimeout(resolve, 700));
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

// Two small PNGs, drawn in the browser: the media the user picks.
async function drawPngs(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer }[]> {
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

// The tale group's items on a page that places the zone (bar items, in the SDK's Shadow DOM).
const barItems = (page: Page) => page.locator('taleart-view button.item');

test.describe.serial('first run and the Install tab (story 8.13)', () => {
  let context: BrowserContext;
  let page: Page;
  let testPage: Page;
  // Set by the first run: the zone's slug, the issued site key and the snippet with it.
  let slug = '';
  let siteKey = '';
  let snippet = '';

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    // A platform passkey that says yes: the passkey prompt is not an action of its own.
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
  });

  test.afterAll(async () => {
    await context.close();
  });

  test(`reaches a visible tale in at most ${MAX_ACTIONS} actions`, async () => {
    const actions: string[] = [];
    const act = async (label: string, run: () => Promise<unknown>) => {
      actions.push(label);
      await run();
    };

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Set up TaleArt' })).toBeVisible();
    const media = await drawPngs(page);

    // Sign up: the first project is "My project" unless typed otherwise.
    await act('Type your name', () => page.getByLabel('Name').fill('Ada Admin'));
    await act('Type your email', () => page.getByLabel('Email').fill('ada@example.test'));
    await act('Create passkey', () => page.getByRole('button', { name: 'Create passkey' }).click());
    await expect(page).toHaveURL(/\/zones$/);

    // A zone from the preselected "Stories bar" template; its page opens.
    await act('New zone', () => page.getByRole('button', { name: 'New zone' }).first().click());
    const zoneDrawer = page.getByRole('dialog', { name: 'New zone' });
    await act('Type the zone name', () => zoneDrawer.getByLabel('Zone name').fill('Home top'));
    await act('Create', () => zoneDrawer.getByRole('button', { name: 'Create', exact: true }).click());
    await expect(page).toHaveURL(/\/zones\/[^/?]+$/);
    await expect(page.getByRole('heading', { name: 'Home top' })).toBeVisible();

    // A tale group with two tales from media, in one drawer.
    await act('New tale group', () => page.getByRole('button', { name: 'New tale group' }).first().click());
    const groupDrawer = page.getByRole('dialog', { name: 'New tale group' });
    await act('Type the group name', () => groupDrawer.getByLabel('Tale group name').fill('Summer sale'));
    await act('Choose two images', () => groupDrawer.getByLabel('Images or videos (optional)').setInputFiles(media));
    await act('Create', () => groupDrawer.getByRole('button', { name: 'Create', exact: true }).click());
    await expect(groupDrawer).toBeHidden({ timeout: 30_000 });

    await act('Turn the group On', () => page.getByRole('switch', { name: 'Summer sale on site' }).click());
    await expect(page.getByRole('switch', { name: 'Summer sale on site' })).toHaveAttribute('aria-checked', 'true');
    await shot(page, '01-zone-page-group-on');

    // Install: issue the site key; the drawer shows it once, with the snippet and the test page.
    await act('Open the Install tab', () => page.getByRole('tab', { name: 'Install' }).click());
    await shot(page, '02-install-tab-before-key');
    expect(await axeViolations(page)).toEqual([]);
    await act('Issue site key', () => page.locator('#site-key-issue').click());
    const keyDrawer = page.getByRole('dialog', { name: 'Issue site key' });
    siteKey = await keyDrawer.getByLabel('Site key').inputValue();
    expect(siteKey).toMatch(/^tas_/);
    await shot(page, '03-site-key-issued');
    expect(await axeViolations(page)).toEqual([]);
    const opened = context.waitForEvent('page');
    await act('Open test page', () => keyDrawer.getByRole('link', { name: /Open test page/ }).click());
    testPage = await opened;
    await expect(barItems(testPage)).toHaveCount(1, { timeout: 20_000 });
    await expect(barItems(testPage).first()).toBeVisible();
    await shot(testPage, '04a-test-page-zone');
    expect(await axeViolations(testPage)).toEqual([]);

    // Watch the tale: the group opens in the viewer with its two tales, the first one showing.
    await act('Open the tale', () => barItems(testPage).first().click());
    const viewer = testPage.getByRole('dialog', { name: 'Summer sale' });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.segment')).toHaveCount(2);
    await expect(viewer.locator('img').first()).toBeVisible();
    await shot(testPage, '04b-test-page-tale-visible');

    console.log(`First run in ${actions.length} actions:\n${actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}`);
    expect(actions.length).toBeLessThanOrEqual(MAX_ACTIONS);

    slug = new URL(testPage.url()).searchParams.get('zone') ?? '';
    expect(slug).toBe('home-top');
    // The key came in the fragment and left the address bar at once.
    expect(testPage.url()).not.toContain('#');
    expect(testPage.url()).not.toContain(siteKey);

    // The snippet with the key, as Copy snippet puts it on the clipboard.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    await keyDrawer.getByRole('button', { name: 'Copy snippet' }).click();
    await expect(keyDrawer.getByText('Snippet with the key copied')).toBeVisible();
    snippet = await page.evaluate(() => navigator.clipboard.readText());
    expect(snippet).toContain(`site-key="${siteKey}"`);
    expect(snippet).toContain(`zone="${slug}"`);
    await keyDrawer.getByRole('button', { name: 'Done' }).click();
    await shot(page, '05-install-tab-after-key');
    expect(await axeViolations(page)).toEqual([]);
    // At phone width the tab and its snippet fit, with no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, '05b-install-tab-phone');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test('the copied snippet shows the zone on a blank HTML page, as the test page does', async () => {
    // A page on another origin with nothing but the snippet, served from this machine (a page the
    // browser takes for a public site may not call the API on localhost: Local Network Access).
    const html = `<!doctype html><html><head><title>Blank</title></head><body>\n${snippet}\n</body></html>`;
    const server = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const blankUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const blank = await context.newPage();
    const errors: string[] = [];
    blank.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await blank.goto(blankUrl);
    await expect(barItems(blank), `console errors: ${errors.join('; ')}`).toHaveCount(1, { timeout: 20_000 });
    await expect(barItems(blank).first()).toBeVisible();
    // The same group as on the test page (where it is also marked seen, since it was opened there).
    await expect(barItems(blank).first()).toHaveAttribute('aria-label', 'Summer sale');
    await expect(barItems(testPage).first()).toHaveAttribute('aria-label', /^Summer sale/);
    await shot(blank, '06-blank-page-with-snippet');
    expect(errors).toEqual([]);
    await blank.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('the test page takes a pasted key and sends it only in the Authorization header', async () => {
    const pasted = await context.newPage();
    const sent: { url: string; authorization: string | undefined }[] = [];
    pasted.on('request', (r) => sent.push({ url: r.url(), authorization: r.headers()['authorization'] }));
    const testPageUrl = new URL(testPage.url());
    await pasted.goto(`${testPageUrl.origin}${testPageUrl.pathname}?zone=${slug}`);
    await expect(pasted.getByRole('status')).toHaveText('Paste a site key to show the zone.');
    await expect(barItems(pasted)).toHaveCount(0);
    await pasted.getByLabel('Site key').fill(siteKey);
    await pasted.getByRole('button', { name: 'Show zone' }).click();
    await expect(barItems(pasted)).toHaveCount(1, { timeout: 20_000 });
    await expect(pasted.getByLabel('Site key')).toHaveValue('');
    await shot(pasted, '07-test-page-pasted-key');

    // The key went only to the Delivery API, as a bearer token; never in a URL.
    const withKey = sent.filter((r) => r.authorization?.includes(siteKey));
    expect(withKey.length).toBeGreaterThan(0);
    for (const r of withKey) expect(new URL(r.url).pathname).toBe('/delivery/v1/zone');
    for (const r of sent) expect(r.url).not.toContain(siteKey);
    // Nothing stored.
    const stored = await pasted.evaluate(() => ({
      local: Object.keys(localStorage).map((k) => localStorage.getItem(k)),
      session: Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)),
      cookie: document.cookie,
    }));
    expect(JSON.stringify(stored)).not.toContain(siteKey);
    await pasted.close();
  });

  test('an unknown slug, a page without a zone and a revoked key show nothing', async () => {
    const testPageUrl = new URL(testPage.url());
    const base = `${testPageUrl.origin}${testPageUrl.pathname}`;
    // The SDK's console errors, and any other console error but the browser's own line for the
    // refused request (a 401 from the Delivery API).
    const open = async (url: string) => {
      const p = await context.newPage();
      const errors: string[] = [];
      const others: string[] = [];
      p.on('console', (m) => {
        if (m.type() !== 'error') return;
        if (m.text().startsWith('TaleArt:')) errors.push(m.text());
        else if (!/status of 401/.test(m.text())) others.push(m.text());
      });
      await p.goto(url);
      await p.waitForLoadState('load');
      return { p, errors, others };
    };

    const unknown = await open(`${base}?zone=nope#siteKey=${siteKey}`);
    await expect(unknown.p.locator('taleart-view')).toHaveCount(1);
    await expect.poll(() => unknown.errors.length).toBe(1);
    await expect(barItems(unknown.p)).toHaveCount(0);
    expect(unknown.others).toEqual([]);
    await unknown.p.close();

    // Not a slug: no element and a sentence, nothing reflected.
    const bad = await open(`${base}?zone=%3Cimg%20src%3Dx%3E#siteKey=${siteKey}`);
    await expect(bad.p.getByText('This page needs a zone.')).toBeVisible();
    await expect(bad.p.locator('taleart-view, img')).toHaveCount(0);
    expect([...bad.errors, ...bad.others]).toEqual([]);
    await bad.p.close();

    // Revoke the key (as the Install tab does): the test page shows nothing and says why in one error.
    await page.getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('dialog', { name: 'Revoke site key' }).getByRole('button', { name: 'Revoke key' }).click();
    await expect(page.locator('#site-key-issue')).toBeVisible();
    const revoked = await open(`${base}?zone=${slug}#siteKey=${siteKey}`);
    await expect.poll(() => revoked.errors.length).toBe(1);
    await expect(barItems(revoked.p)).toHaveCount(0);
    expect(revoked.others).toEqual([]);
    await shot(revoked.p, '08-test-page-revoked-key');
    await revoked.p.close();
  });
});
