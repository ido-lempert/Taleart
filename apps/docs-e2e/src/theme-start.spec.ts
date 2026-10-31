import { expect, test, type Page } from '@playwright/test';

/**
 * The first colour theme follows the system from the first paint. With no saved choice, a dark system must
 * never show the light colours (no flash), with JavaScript or without it, and the header toggle must show the
 * right icon straight away. A saved choice wins over the system. Colours are the tokens in apps/docs/src/styles.css.
 */
const LIGHT_BG = 'rgb(255, 255, 255)';
const DARK_BG = 'rgb(15, 17, 22)';

/** Records body's background on every animation frame from the very start of the document. */
async function sampleBackgrounds(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __bg: string[] }).__bg = seen;
    const sample = () => {
      if (document.body) seen.push(getComputedStyle(document.body).backgroundColor);
      if (seen.length < 40) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    new MutationObserver(() => {
      if (document.body) seen.push(getComputedStyle(document.body).backgroundColor);
    }).observe(document, { childList: true, subtree: true });
  });
}

const sunDisplay = (page: Page) => page.locator('.theme-toggle__sun').evaluate((el) => getComputedStyle(el).display);
const moonDisplay = (page: Page) => page.locator('.theme-toggle__moon').evaluate((el) => getComputedStyle(el).display);

for (const scheme of ['dark', 'light'] as const) {
  const expected = scheme === 'dark' ? DARK_BG : LIGHT_BG;

  test(`the first paint follows a ${scheme} system with no saved choice`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    await sampleBackgrounds(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(expected);
    await expect(page.locator('.theme-toggle[aria-pressed]')).toHaveAttribute('aria-pressed', scheme === 'dark' ? 'true' : 'false');
    await page.waitForTimeout(500);
    const seen = await page.evaluate(() => (window as unknown as { __bg: string[] }).__bg);
    expect(seen.length).toBeGreaterThan(0);
    expect([...new Set(seen)]).toEqual([expected]);
    expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBeUndefined();
    expect(await sunDisplay(page)).toBe(scheme === 'dark' ? 'block' : 'none');
    expect(await moonDisplay(page)).toBe(scheme === 'dark' ? 'none' : 'block');
    await context.close();
  });

  test(`the prerendered page paints for a ${scheme} system without JavaScript`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(expected);
    expect(await sunDisplay(page)).toBe(scheme === 'dark' ? 'block' : 'none');
    await context.close();
  });
}

test('a saved light choice wins in a dark system, and the toggle switches and remembers', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('taleart-docs-theme', 'light');
      sessionStorage.setItem('seeded', '1');
    }
  });
  const page = await context.newPage();
  await sampleBackgrounds(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const seen = await page.evaluate(() => (window as unknown as { __bg: string[] }).__bg);
  expect([...new Set(seen)]).toEqual([LIGHT_BG]);
  const toggle = page.locator('.theme-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(DARK_BG);
  expect(await sunDisplay(page)).toBe('block');
  await page.reload();
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(DARK_BG);
  await context.close();
});
