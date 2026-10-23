import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { drawPngs } from './media';
import { onTop, scan, settle, type ScanOptions } from './wcag';

/**
 * The WCAG 2.2 AA scan of the reworked dashboard (epic UX rework R18, story 8.17), run with
 * `nx run dashboard-e2e:a11y`. On a fresh install it signs up with a virtual passkey (with a long
 * project name, the top bar's worst case), builds a zone with tale groups in every state the Tale
 * groups filters name, and scans each screen and state: axe-core (wcag2a, 2aa, 21a, 21aa, 22aa) plus
 * the targeted checks of `wcag.ts` (2.4.7, 2.4.11, 2.5.8 everywhere; 1.4.10 at 320 px and 1.4.12 once
 * per screen). It also checks by keyboard what R18 names: tabs, the ⋯ menu button, switches, reorder
 * and their announcements, and a form error. Every state is reported; the run fails if any has a
 * finding.
 *
 * E2E_SCREENSHOTS, when set, is a folder it saves screenshots in (one per state, one per finding and
 * one at 320 px per screen); E2E_A11Y_REPORT, when set, a file it writes every state's findings and
 * Tab stops to as JSON.
 */

const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });
const API = '/api/v1';
const PROJECT = 'Northwind Traders International Marketing';

test.describe.serial('WCAG 2.2 AA scan of the dashboard (story 8.17) @a11y', () => {
  let context: BrowserContext;
  let page: Page;
  const results: Record<string, string[]> = {};
  /** Each state's Tab stops, for the report: what the walk reached. */
  const walked: Record<string, string[]> = {};
  let zoneId = '';
  let taleId = '';

  /** Scans the page as it stands and records the findings under `state`. */
  async function check(state: string, options: ScanOptions = {}, on: Page = page): Promise<void> {
    await settle(on);
    const prefix = `a11y-${String(Object.keys(results).length + 1).padStart(2, '0')}-${state}`;
    if (shots) await on.screenshot({ path: join(shots, `${prefix}.png`) });
    // A screenshot of each finding, while the page shows it.
    let found = 0;
    const evidence = async (label: string) => {
      if (shots)
        await on.screenshot({ path: join(shots, `${prefix}--${++found}-${label}.png`), animations: 'disabled' });
    };
    // Judged at the end, so one state's findings do not stop the scan of the others.
    const stops: string[] = [];
    results[state] = await scan(on, { ...options, stops, evidence });
    walked[state] = stops;
  }

  /** Focuses a control as the keyboard would; it must be on screen and on top (2.4.11). */
  async function focusShot(target: Locator, name: string): Promise<void> {
    await target.focus();
    await expect(target).toBeFocused();
    await settle(page);
    await expect(target).toBeInViewport();
    expect(await onTop(target), `${name}: focused control on top`).toBe(true);
    if (shots) await page.screenshot({ path: join(shots, `a11y-${name}.png`), animations: 'disabled' });
  }

  async function api<T>(method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, { method, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  /** The zone page's live region (the group view has its own). */
  const zoneLive = () => page.locator('.page > p[aria-live=polite]');

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
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
    const report = process.env['E2E_A11Y_REPORT'];
    if (report) writeFileSync(report, JSON.stringify({ findings: results, tabStops: walked }, null, 2));
    const total = Object.values(results).reduce((n, f) => n + f.length, 0);
    console.log(`WCAG scan: ${Object.keys(results).length} states, ${total} findings`);
    for (const [state, findings] of Object.entries(results)) {
      const stops = walked[state]?.length ?? 0;
      console.log(
        `${findings.length === 0 ? 'pass' : 'FAIL'} ${state} (${stops} Tab stops)${findings.map((f) => `\n    ${f}`).join('')}`,
      );
    }
    await context.close();
  });

  test('sign-up, zones list and the New zone drawer with a form error', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Set up TaleArt' })).toBeVisible();
    await check('setup', { layout: true });
    await page.getByLabel('Name').fill('Ada Admin');
    await page.getByLabel('Email').fill('ada@example.test');
    await page.getByLabel('First project').fill(PROJECT);
    await page.getByRole('button', { name: 'Create passkey' }).click();
    await expect(page).toHaveURL(/\/zones$/);
    await check('zones-list-empty', { layout: true });

    await page.getByRole('button', { name: 'New zone' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'New zone' });
    await expect(drawer).toBeVisible();
    await check('new-zone-drawer', { layout: true });

    // 3.3.1: Create with no name, by keyboard: the error is an alert, tied to the field, which has focus.
    const name = drawer.getByLabel('Zone name');
    await drawer.getByRole('button', { name: 'Create', exact: true }).focus();
    await page.keyboard.press('Enter');
    const error = drawer.getByRole('alert');
    await expect(error).not.toBeEmpty();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAttribute('aria-describedby', /create-error/);
    await expect(name).toBeFocused();
    await check('new-zone-drawer-error');

    await name.fill('Home top');
    await drawer.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/zones\/[^/?]+$/);
    zoneId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  });

  test('zone page: setup checklist, New tale group drawer and the Tale groups tab', async () => {
    await expect(page.getByRole('heading', { name: 'Home top' })).toBeVisible();
    await check('zone-groups-tab-checklist-empty', { layout: true });

    const media = await drawPngs(page);
    await page.getByRole('button', { name: 'New tale group' }).first().click();
    const drawer = page.getByRole('dialog', { name: 'New tale group' });
    await expect(drawer).toBeVisible();
    await check('new-tale-group-drawer', { layout: true });
    await drawer.getByLabel('Tale group name').fill('Summer sale');
    await drawer.getByLabel('Images or videos (optional)').setInputFiles(media);
    await drawer.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(drawer).toBeHidden({ timeout: 30_000 });

    // Groups in each state the Tale groups filters name: Off, scheduled, in no zone, archived.
    type Group = { id: string };
    const [project] = await api<{ id: string }[]>('get', '/projects');
    await api<Group>('post', `/zones/${zoneId}/tale-groups`, { name: 'Autumn' });
    const later = await api<Group>('post', `/zones/${zoneId}/tale-groups`, { name: 'Winter preview' });
    await api('put', `/tale-groups/${later.id}/status`, { status: 'live' });
    const start = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
    await api('put', `/tale-groups/${later.id}/schedule`, { startsAt: start, endsAt: null });
    await api<Group>('post', `/projects/${project.id}/tale-groups`, { name: 'Loose ideas' });
    const old = await api<Group>('post', `/projects/${project.id}/tale-groups`, { name: 'Spring 2025' });
    await api('put', `/tale-groups/${old.id}/status`, { status: 'archived' });
    const groups = await api<{ name: string; tales: { id: string }[] }[]>('get', `/zones/${zoneId}/tale-groups`);
    taleId = groups.find((g) => g.name === 'Summer sale')?.tales[0]?.id ?? '';
    expect(taleId).not.toBe('');
    await page.reload();

    await page.getByRole('switch', { name: 'Summer sale on site' }).click();
    await expect(page.getByRole('switch', { name: 'Summer sale on site' })).toHaveAttribute('aria-checked', 'true');
    await check('zone-groups-tab', { layout: true });
    // The two-row top bar at 320 px: a walk of the whole page there (2.4.11 under the sticky bars).
    await page.setViewportSize({ width: 320, height: 640 });
    await check('zone-groups-tab-320');
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole('button', { name: 'More for Summer sale' }).first().click();
    await expect(page.getByRole('menu')).toBeVisible();
    // Tab leaves a menu (it closes): the open menu is scanned without the walk.
    await check('zone-group-menu-open', { walk: false });
    await page.keyboard.press('Escape');
  });

  test('keyboard: tabs, the ⋯ menu button, a switch and reorder, with their announcements (R18)', async () => {
    // Tabs (WAI-ARIA tabs, automatic activation): arrows move focus and select, wrapping; Home, End.
    const tab = (name: string) => page.getByRole('tab', { name });
    await tab('Tale groups').focus();
    for (const [key, name] of [
      ['ArrowRight', 'Display'],
      ['ArrowRight', 'Install'],
      ['ArrowRight', 'Tale groups'],
      ['ArrowLeft', 'Install'],
      ['Home', 'Tale groups'],
      ['End', 'Install'],
      ['Home', 'Tale groups'],
    ] as const) {
      await page.keyboard.press(key);
      await expect(tab(name), `${key} → ${name}`).toBeFocused();
      await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel')).toHaveAttribute(
        'aria-labelledby',
        (await tab(name).getAttribute('id')) ?? '',
      );
    }

    // The ⋯ menu button: Enter opens on the first item with a visible focus; Down moves; Escape
    // closes and returns focus to the button.
    const trigger = page.getByRole('button', { name: 'More for Summer sale' }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const items = page.getByRole('menu').getByRole('menuitem');
    await expect(items.first()).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await settle(page);
    const box = await items.first().boundingBox();
    expect(box).not.toBeNull();
    const clip = { x: box!.x - 4, y: box!.y - 4, width: box!.width + 8, height: box!.height + 8 };
    const focusedItem = await page.screenshot({ clip, animations: 'disabled' });
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await settle(page);
    expect(
      focusedItem.equals(await page.screenshot({ clip, animations: 'disabled' })),
      'menu item focus is visible',
    ).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(trigger).toBeFocused();

    // A switch by Space: its state and an announcement of the new status; then back Off.
    const autumn = page.getByRole('switch', { name: 'Autumn on site' });
    await autumn.focus();
    await page.keyboard.press('Space');
    await expect(autumn).toHaveAttribute('aria-checked', 'true');
    await expect(zoneLive()).toHaveText(/^Autumn is now on\b/);
    await expect(autumn).toBeFocused();
    await expect(autumn).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Space');
    await expect(autumn).toHaveAttribute('aria-checked', 'false');
    await expect(zoneLive()).toHaveText(/^Autumn is now off\b/);

    // Reorder by keyboard: announced, focus kept on the group's move controls.
    await page.getByRole('button', { name: 'Move Summer sale later' }).focus();
    await page.keyboard.press('Enter');
    await expect(zoneLive()).toHaveText('Summer sale moved to position 2 of 3');
    await expect(page.getByRole('button', { name: 'Move Summer sale later' })).toBeFocused();
    await page.getByRole('button', { name: 'Move Summer sale earlier' }).focus();
    await page.keyboard.press('Enter');
    await expect(zoneLive()).toHaveText('Summer sale moved to position 1 of 3');
    // First again: Earlier is disabled, so focus moved to Later.
    await expect(page.getByRole('button', { name: 'Move Summer sale earlier' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Move Summer sale later' })).toBeFocused();
  });

  test('zone page: Display and Install tabs, the site-key drawer and the test page', async () => {
    await page.getByRole('tab', { name: 'Display' }).click();
    await check('zone-display-tab', { layout: true });
    await page.getByRole('tab', { name: 'Install' }).click();
    await check('zone-install-tab', { layout: true });

    await page.locator('#site-key-issue').click();
    const keyDrawer = page.getByRole('dialog', { name: 'Issue site key' });
    await expect(keyDrawer.getByLabel('Site key')).toBeVisible();
    await check('site-key-issue-drawer', { layout: true });

    const opened = context.waitForEvent('page');
    await keyDrawer.getByRole('link', { name: /Open test page/ }).click();
    const testPage = await opened;
    await expect(testPage.locator('taleart-view button.item')).toHaveCount(1, { timeout: 20_000 });
    await check('test-page', { layout: true }, testPage);
    await testPage.close();
    await keyDrawer.getByRole('button', { name: 'Done' }).click();
    await expect(keyDrawer).toBeHidden();
    await check('zone-install-tab-key-issued');
  });

  test('group view (desktop and phone), reordering its tales, and the tale drawer', async () => {
    await page.getByRole('tab', { name: 'Tale groups' }).click();
    await page.getByRole('button', { name: 'Summer sale', exact: true }).click();
    const view = page.getByRole('dialog', { name: 'Summer sale' });
    await expect(view).toBeVisible();
    await check('group-view-desktop', { layout: true });

    // Walk step 3.8: reorder the two tales by keyboard. Moving the first one later makes it last,
    // so Later is disabled and focus goes to Earlier; moving it back does the opposite.
    // (A disabled move button is also hidden here, so it is found by its label, not its role.)
    const live = view.locator('[aria-live=polite]').first();
    const move = (dir: string) => view.locator(`button[aria-label="Move beach day ${dir}"]`);
    await move('later').focus();
    await page.keyboard.press('Enter');
    await expect(live).toHaveText('beach day moved to position 2 of 2');
    await expect(move('later')).toBeDisabled();
    await expect(move('earlier')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(live).toHaveText('beach day moved to position 1 of 2');
    await expect(move('earlier')).toBeDisabled();
    await expect(move('later')).toBeFocused();

    await view
      .getByRole('button', { name: /^Open tale / })
      .first()
      .click();
    const taleDrawer = page.getByRole('dialog').last();
    await expect(taleDrawer).not.toHaveAttribute('id', /^group-view-/);
    await check('tale-drawer', { layout: true });
    await page.keyboard.press('Escape');
    await expect(view).toBeVisible();

    // A tale's Delete asks first (story 8.20); cancelled here, so the tale stays for the states after.
    await view.getByRole('button', { name: /^More for / }).nth(1).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirmDelete = page.getByRole('alertdialog', { name: 'Delete tale' });
    await expect(confirmDelete.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await check('delete-tale-confirmation', { layout: true });
    await page.keyboard.press('Escape');
    await expect(confirmDelete).toBeHidden();
    await expect(view).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await check('group-view-phone');
    await page.keyboard.press('Escape');
    await check('zone-groups-tab-phone');
    // The last row's indicator, focused: clear of the fixed bottom bar (2.4.11).
    await focusShot(page.locator('.groups button.visibility__line').last(), 'focus-last-indicator-phone');
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test('Tale groups page with each filter', async () => {
    test.setTimeout(300_000);
    for (const filter of ['all', 'visible', 'off', 'scheduled', 'unplaced', 'archived']) {
      await page.goto(`/tale-groups${filter === 'all' ? '' : `?filter=${filter}`}`);
      await expect(page.getByRole('heading', { name: 'Tale groups' }).first()).toBeVisible();
      await check(`tale-groups-${filter}`, { layout: filter === 'all' });
    }
    // A group in no zone opens in the group view on this page (story 8.19).
    await page.goto('/tale-groups?filter=unplaced');
    await page.getByRole('button', { name: 'Loose ideas', exact: true }).click();
    const view = page.getByRole('dialog', { name: 'Loose ideas' });
    await expect(view).toBeVisible();
    await expect(view.getByText('Not in a zone.')).toBeVisible();
    await check('tale-groups-group-view');
    await page.keyboard.press('Escape');
    await expect(view).toBeHidden();
  });

  test('zones list with a zone', async () => {
    await page.goto('/zones');
    await expect(page.getByRole('link', { name: /Home top/ }).first()).toBeVisible();
    await check('zones-list', { layout: true });
  });

  test('Tale Studio: status bar and preview pane', async () => {
    test.setTimeout(300_000);
    await page.goto(`/tales/${taleId}/studio`);
    await expect(page.locator('#studio-preview')).toBeVisible({ timeout: 30_000 });
    await check('tale-studio', { layout: true, maxStops: 60 });
    // An image that fills the canvas, focused: its ring shows inside the canvas edge (2.4.7).
    await focusShot(page.locator('[id^=studio-el-]').first(), 'focus-canvas-image');
    await page.locator('#studio-preview').click();
    await expect(page.locator('#studio-preview-pane')).toBeVisible();
    await check('tale-studio-preview', { maxStops: 60 });
  });

  test('every state has no WCAG 2.2 AA finding', () => {
    expect(Object.keys(results).length).toBeGreaterThanOrEqual(27);
    for (const [state, findings] of Object.entries(results)) expect.soft(findings, state).toEqual([]);
  });
});
