import { expect, test } from '@playwright/test';
import { API_URL_KEY, openReference, operation, yamlOperations } from './reference';

// The docs' API reference (epic developer experience 10.2), on the built docs, with a stubbed API.

test('lists every path and method of openapi.yaml', async ({ page }) => {
  await openReference(page);
  const shown = await page.$$eval('.swagger-ui .opblock', (blocks) =>
    blocks.map((block) => {
      const method = block.querySelector('.opblock-summary-method')?.textContent?.trim() ?? '';
      const path = block.querySelector('.opblock-summary-path')?.getAttribute('data-path') ?? '';
      return `${method} ${path}`;
    }),
  );
  const expected = yamlOperations();
  expect(expected.length).toBeGreaterThan(80);
  expect([...shown].sort()).toEqual([...expected].sort());
});

test('groups operations by tag in the document order', async ({ page }) => {
  await openReference(page);
  const tags = await page.$$eval('.swagger-ui .opblock-tag', (els) => els.map((e) => e.getAttribute('data-tag')));
  expect(tags).toEqual([
    'Reference',
    'Projects',
    'Zones',
    'Tale groups',
    'Tales',
    'Media',
    'Theme and fonts',
    'Targeting',
    'Imports',
    'API tokens',
    'Delivery',
    'Sign-in',
  ]);
});

test('loads Swagger UI only on the API reference page', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (req) => scripts.push(req.url()));
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Getting started');
  expect(scripts.filter((u) => u.includes('swagger-ui'))).toEqual([]);
  await page.getByRole('link', { name: 'API reference' }).click();
  await expect(page.locator('.swagger-ui .opblock').first()).toBeVisible();
  expect(scripts.filter((u) => u.includes('swagger-ui-bundle.js'))).toHaveLength(1);
  await page.getByRole('link', { name: 'Concepts' }).click();
  await expect(page.locator('link[href*="swagger-ui.css"]')).toHaveCount(0);
});

test('offers a token and a site key, never the cookie session, in the Authorize dialog', async ({ page }) => {
  await openReference(page);
  const opener = page.locator('.scheme-container .btn.authorize');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Available authorizations' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.auth-container h4')).toHaveText([/token/, /siteKey/]);
  await expect(dialog).not.toContainText('taleart_session');
  // The keyboard stays in the dialog, and goes back to Authorize when it closes.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('sends Try it out to the API URL with the token, and keeps the URL', async ({ page }) => {
  const seen: { url: string; auth: string | undefined }[] = [];
  await page.route('https://api.example.com/**', (route) => {
    seen.push({ url: route.request().url(), auth: route.request().headers()['authorization'] });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' },
      body: JSON.stringify([{ id: '00000000-0000-4000-8000-000000000001', name: 'Stubbed project' }]),
    });
  });
  await openReference(page);
  const field = page.getByLabel('API URL');
  await expect(field).toHaveValue('http://localhost:3333');

  await field.fill('not a url');
  await page.getByRole('button', { name: 'Use this URL' }).click();
  await expect(field).toHaveAttribute('aria-invalid', 'true');

  await field.fill('https://api.example.com/');
  await page.getByRole('button', { name: 'Use this URL' }).click();
  await expect(page.getByRole('status')).toContainText('https://api.example.com');
  expect(await page.evaluate((key) => localStorage.getItem(key), API_URL_KEY)).toBe('https://api.example.com');

  await page.locator('.scheme-container .btn.authorize').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.auth-container').filter({ hasText: 'token' }).locator('input').fill('tat_example');
  await dialog.locator('.auth-container').filter({ hasText: 'token' }).getByRole('button', { name: 'Apply credentials' }).click();
  await dialog.getByRole('button', { name: 'Close' }).first().click();

  const projects = operation(page, 'GET', '/projects');
  await projects.locator('.opblock-summary-control').click();
  await projects.getByRole('button', { name: 'Try it out' }).click();
  await projects.getByRole('button', { name: 'Execute' }).click();
  await expect(projects.locator('.live-responses-table')).toContainText('Stubbed project');
  expect(seen).toEqual([{ url: 'https://api.example.com/api/v1/projects', auth: 'Bearer tat_example' }]);

  await page.reload();
  await expect(page.getByLabel('API URL')).toHaveValue('https://api.example.com');
});

test('prefills the Delivery zone call from the spec example', async ({ page }) => {
  await openReference(page);
  const zone = operation(page, 'GET', '/zone');
  await zone.locator('.opblock-summary-control').click();
  await zone.getByRole('button', { name: 'Try it out' }).click();
  await expect(zone.locator('tr[data-param-name="zone"] input')).toHaveValue('home-top');
});
