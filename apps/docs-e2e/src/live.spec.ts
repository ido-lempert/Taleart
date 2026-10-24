import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openReference, operation } from './reference';

/**
 * The story's verify run against a real API (epic developer experience 10.2): authorize with an API
 * token and try GET /api/v1/projects, then with the project's site key and try the Delivery zone
 * call. Runs only when DOCS_LIVE_API_URL, DOCS_LIVE_TOKEN, DOCS_LIVE_SITE_KEY and DOCS_LIVE_ZONE are
 * set; E2E_SCREENSHOTS, when set, is a folder for the screenshots.
 */
const apiUrl = process.env['DOCS_LIVE_API_URL'] ?? '';
const token = process.env['DOCS_LIVE_TOKEN'] ?? '';
const siteKey = process.env['DOCS_LIVE_SITE_KEY'] ?? '';
const zoneSlug = process.env['DOCS_LIVE_ZONE'] ?? '';
const shots = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage });
}

async function authorize(page: Page, scheme: 'token' | 'siteKey', value: string): Promise<void> {
  await page.locator('.scheme-container .btn.authorize').click();
  const dialog = page.getByRole('dialog', { name: 'Available authorizations' });
  const section = dialog.locator('.auth-container').filter({ has: page.locator('h4', { hasText: scheme }) });
  await section.locator('input').fill(value);
  if (scheme === 'token') await shot(page, '3-authorize-dialog');
  await section.getByRole('button', { name: 'Apply credentials' }).click();
  await expect(section.getByRole('button', { name: 'Remove authorization' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toBeHidden();
}

test.skip(!apiUrl || !token || !siteKey || !zoneSlug, 'set DOCS_LIVE_API_URL, DOCS_LIVE_TOKEN, DOCS_LIVE_SITE_KEY and DOCS_LIVE_ZONE');

test('tries the Management API with a token and the Delivery API with a site key', async ({ page }) => {
  await openReference(page);
  await page.getByLabel('API URL').fill(apiUrl);
  await page.getByRole('button', { name: 'Use this URL' }).click();
  await expect(page.getByRole('status')).toContainText(apiUrl);
  await shot(page, '1-overview');

  await authorize(page, 'token', token);
  const projects = operation(page, 'GET', '/projects');
  await projects.locator('.opblock-summary-control').click();
  await projects.getByRole('button', { name: 'Try it out' }).click();
  await projects.scrollIntoViewIfNeeded();
  await shot(page, '2-operation-expanded');
  const fromApi = await page.request.get(`${apiUrl}/api/v1/projects`, { headers: { Authorization: `Bearer ${token}` } });
  const expected = (await fromApi.json()) as { id: string; name: string }[];
  expect(expected.length).toBeGreaterThan(0);
  await projects.getByRole('button', { name: 'Execute' }).click();
  const live = projects.locator('.live-responses-table');
  await expect(live.locator('tbody .response-col_status').first()).toHaveText('200');
  for (const project of expected) await expect(live).toContainText(project.id);
  await expect(projects.locator('.request-url')).toContainText(`${apiUrl}/api/v1/projects`);
  await live.scrollIntoViewIfNeeded();
  await shot(page, '4-real-response-projects');

  await authorize(page, 'siteKey', siteKey);
  const zone = operation(page, 'GET', '/zone');
  await zone.locator('.opblock-summary-control').click();
  await zone.getByRole('button', { name: 'Try it out' }).click();
  await zone.locator('tr[data-param-name="zone"] input').fill(zoneSlug);
  await zone.getByRole('button', { name: 'Execute' }).click();
  const zoneLive = zone.locator('.live-responses-table');
  await expect(zoneLive.locator('tbody .response-col_status').first()).toHaveText('200');
  await expect(zoneLive).toContainText(`"slug": "${zoneSlug}"`);
  await expect(zone.locator('.request-url')).toContainText(`${apiUrl}/delivery/v1/zone?zone=${zoneSlug}`);
  await zoneLive.scrollIntoViewIfNeeded();
  await shot(page, '5-real-response-delivery-zone');
});
