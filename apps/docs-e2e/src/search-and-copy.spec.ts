import { expect, test } from '@playwright/test';
import { axeFindings } from './axe';

/**
 * The docs' search (the "/" and Ctrl/Cmd+K dialog), the code blocks' Copy buttons and the figures' lightbox, on the
 * built docs. The search dialog is also in the a11y scan (`@a11y`): its open state has no violation.
 */
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('the search index is served next to the pages', async ({ request }) => {
  const response = await request.get('/search-index.json');
  expect(response.status()).toBe(200);
  const index = (await response.json()) as { v: number; pages: unknown[]; s: unknown[] };
  expect(index.v).toBe(1);
  expect(index.pages.length).toBeGreaterThan(30);
  expect(index.s.length).toBeGreaterThan(100);
});

test('"/" opens the search, a query finds a section, Enter opens it and closes the dialog', async ({ page }) => {
  await page.goto('/concepts');
  await page.keyboard.press('/');
  const dialog = page.locator('dialog.search');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Search the docs' })).toBeFocused();
  await page.keyboard.type('zone key');
  await expect(page.getByRole('status').filter({ hasText: /results?$|More than/ })).toBeVisible();
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/[a-z/-]*(#[a-z0-9-]+)?$/);
  await expect(page.locator('main h1')).toBeFocused();
});

test('Ctrl+K opens the search from a field, Escape closes it and returns the focus', async ({ page }) => {
  await page.goto('/concepts');
  const trigger = page.getByRole('button', { name: 'Search', exact: true });
  await trigger.focus();
  await page.keyboard.press('Control+k');
  await expect(page.locator('dialog.search')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.search')).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('a query with no match says so', async ({ page }) => {
  await page.goto('/concepts');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.keyboard.type('qqzzxxyy');
  await expect(page.getByRole('status')).toHaveText('No results for “qqzzxxyy”.');
});

test('a click on a result opens its page', async ({ page }) => {
  await page.goto('/guides/web');
  await page.keyboard.press('/');
  await page.keyboard.type('hooks');
  await page.getByRole('option').first().click();
  await expect(page.locator('dialog.search')).toBeHidden();
  await expect(page.locator('main h1')).toBeFocused();
});

test('a code block copies its text and says Copied, then clears it', async ({ page }) => {
  await page.goto('/guides/web');
  const block = page.locator('.code-block').first();
  const code = await block.locator('pre code').innerText();
  await block.getByRole('button', { name: 'Copy code' }).click();
  await expect(block.getByRole('status')).toHaveText('Copied');
  expect((await page.evaluate(() => navigator.clipboard.readText())).trim()).toBe(code.trim());
  await expect(block.getByRole('status')).toHaveText('', { timeout: 4000 });
});

test('a figure opens in the lightbox; Escape closes it and returns the focus to the image', async ({ page }) => {
  await page.goto('/guides/web');
  const zoom = page.locator('.figure-zoom').first();
  await zoom.click();
  const lightbox = page.locator('dialog.lightbox');
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator('figcaption')).toHaveText(/./);
  await page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();
  await expect(zoom).toBeFocused();
});

test('the open search has no WCAG 2.2 AA violation @a11y', async ({ page }) => {
  await page.goto('/concepts');
  await page.keyboard.press('/');
  await page.keyboard.type('zone');
  await expect(page.getByRole('option').first()).toBeVisible();
  expect(await axeFindings(page)).toEqual([]);
});
