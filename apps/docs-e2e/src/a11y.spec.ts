import { expect, test, type Page } from '@playwright/test';
import { axeFindings, type Finding } from './axe';
import { DOCS_PATHS, openReference, operation } from './reference';

/**
 * The docs' WCAG 2.2 AA scan with axe (epic developer experience 10.2), in the light and the dark
 * theme: every page, and the API reference in each of its states (the list, an operation open with
 * Try it out and a response, the Authorize dialog), plus reflow at 320 CSS px.
 *
 * Swagger UI's own markup is fixed where the docs can (apps/docs/public/api-reference/theme.css and
 * `labelSwaggerControls` in the page), so axe finds nothing, with no exception. What axe cannot see
 * and the docs cannot fix (a response is not announced; the lock buttons' wording) is listed on the
 * page under "Accessibility" and in the story's plan.
 */
function unexpected(findings: Finding[]): string[] {
  return findings.map((f) => `${f.rule}: ${f.target}`);
}

async function stubApi(page: Page): Promise<void> {
  await page.route('http://localhost:3333/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify([{ id: '00000000-0000-4000-8000-000000000001', name: 'Acme' }]),
    }),
  );
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`docs in the ${scheme} theme @a11y`, () => {
    test.use({ colorScheme: scheme });

    for (const path of DOCS_PATHS) {
      test(`${path} has no WCAG 2.2 AA violation`, async ({ page }) => {
        if (path === '/api-reference') await openReference(page);
        else await page.goto(path);
        expect(unexpected(await axeFindings(page))).toEqual([]);
      });
    }

    test('the API reference with an operation open, tried, and the Authorize dialog', async ({ page }) => {
      await stubApi(page);
      await openReference(page);
      const projects = operation(page, 'GET', '/projects');
      await projects.locator('.opblock-summary-control').click();
      await projects.getByRole('button', { name: 'Try it out' }).click();
      await projects.getByRole('button', { name: 'Execute' }).click();
      await expect(projects.locator('.live-responses-table')).toBeVisible();
      expect(unexpected(await axeFindings(page))).toEqual([]);

      await page.locator('.scheme-container .btn.authorize').click();
      await expect(page.locator('.dialog-ux .modal-ux')).toBeVisible();
      expect(unexpected(await axeFindings(page))).toEqual([]);
    });

    test('the API reference reflows at 320 CSS px with an operation open', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await openReference(page);
      const zone = operation(page, 'GET', '/zone');
      await zone.locator('.opblock-summary-control').click();
      await zone.getByRole('button', { name: 'Try it out' }).click();
      const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(width[0]).toBeLessThanOrEqual(width[1]);
    });
  });
}
