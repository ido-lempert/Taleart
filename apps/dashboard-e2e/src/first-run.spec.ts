import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { axeViolations } from './axe';
import { drawPngs } from './media';

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

// The tale group's items on a page that places the zone (bar items, in the SDK's Shadow DOM).
const barItems = (page: Page) => page.locator('taleart-view button.item');

test.describe.serial('first run and the Install tab (story 8.13)', () => {
  let context: BrowserContext;
  let page: Page;
  let testPage: Page;
  // Set by the first run: the issued zone key and the snippet with it.
  let zoneKey = '';
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

    // Install: issue the zone key; the drawer shows it once, with the snippet and the test page.
    await act('Open the Install tab', () => page.getByRole('tab', { name: 'Install' }).click());
    await shot(page, '02-install-tab-before-key');
    expect(await axeViolations(page)).toEqual([]);
    await act('Issue zone key', () => page.locator('#zone-key-issue').click());
    const keyDrawer = page.getByRole('dialog', { name: 'Issue zone key' });
    zoneKey = await keyDrawer.getByLabel('Zone key').inputValue();
    expect(zoneKey).toMatch(/^tak_/);
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

    // The key came in the fragment and left the address bar at once.
    expect(testPage.url()).not.toContain('#');
    expect(testPage.url()).not.toContain(zoneKey);

    // The snippet with the key, as Copy snippet puts it on the clipboard.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    await keyDrawer.getByRole('button', { name: 'Copy snippet' }).click();
    await expect(keyDrawer.getByText('Snippet with the key copied')).toBeVisible();
    snippet = await page.evaluate(() => navigator.clipboard.readText());
    expect(snippet).toContain(`zone-key="${zoneKey}"`);
    expect(snippet).not.toContain('zone="');
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
    await pasted.goto(testPageUrl.origin + testPageUrl.pathname);
    await expect(pasted.getByRole('status')).toHaveText('Paste a zone key to show the zone.');
    await expect(barItems(pasted)).toHaveCount(0);
    await pasted.getByLabel('Zone key').fill(zoneKey);
    await pasted.getByRole('button', { name: 'Show zone' }).click();
    await expect(barItems(pasted)).toHaveCount(1, { timeout: 20_000 });
    await expect(pasted.getByLabel('Zone key')).toHaveValue('');
    await shot(pasted, '07-test-page-pasted-key');

    // The key went only to the Delivery API, as a bearer token; never in a URL.
    const withKey = sent.filter((r) => r.authorization?.includes(zoneKey));
    expect(withKey.length).toBeGreaterThan(0);
    for (const r of withKey) expect(new URL(r.url).pathname).toBe('/delivery/v1/zone');
    for (const r of sent) expect(r.url).not.toContain(zoneKey);
    // Nothing stored.
    const stored = await pasted.evaluate(() => ({
      local: Object.keys(localStorage).map((k) => localStorage.getItem(k)),
      session: Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)),
      cookie: document.cookie,
    }));
    expect(JSON.stringify(stored)).not.toContain(zoneKey);
    await pasted.close();
  });

  test('an unknown key, a page without a key and a revoked key show nothing', async () => {
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

    const unknown = await open(`${base}#zoneKey=tak_unknownunknownunknownunknown`);
    await expect(unknown.p.locator('taleart-view')).toHaveCount(1);
    await expect.poll(() => unknown.errors.length).toBe(1);
    await expect(barItems(unknown.p)).toHaveCount(0);
    expect(unknown.others).toEqual([]);
    await unknown.p.close();

    // Not a key: the element refuses it, one error, and nothing reflected into the page.
    const bad = await open(`${base}#zoneKey=%3Cimg%20src%3Dx%3E`);
    await expect(bad.p.locator('taleart-view')).toHaveCount(1);
    await expect.poll(() => bad.errors.length).toBe(1);
    await expect(barItems(bad.p)).toHaveCount(0);
    await expect(bad.p.locator('img')).toHaveCount(0);
    expect(bad.others).toEqual([]);
    await bad.p.close();

    // Revoke the key (as the Install tab does): the test page shows nothing and says why in one error.
    await page.getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('dialog', { name: 'Revoke zone key' }).getByRole('button', { name: 'Revoke key' }).click();
    await expect(page.locator('#zone-key-issue')).toBeVisible();
    const revoked = await open(`${base}#zoneKey=${zoneKey}`);
    await expect.poll(() => revoked.errors.length).toBe(1);
    await expect(barItems(revoked.p)).toHaveCount(0);
    expect(revoked.others).toEqual([]);
    await shot(revoked.p, '08-test-page-revoked-key');
    await revoked.p.close();
  });
});
