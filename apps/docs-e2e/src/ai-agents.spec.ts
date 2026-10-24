import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { expect, test } from '@playwright/test';

// The docs' "AI agents" page (epic developer experience 10.4), on the built docs: the skill's files
// download as they are in skills/taleart, the page reads without JavaScript and reflows on a phone.
// E2E_SCREENSHOTS, when set, is a folder the page's screenshots are saved in (the story's verify run).

const SKILL_FILES = ['SKILL.md', 'reference/setup.md', 'reference/concepts.md', 'reference/recipes.md', 'reference/troubleshooting.md'];
const shots = process.env['E2E_SCREENSHOTS'];

const onDisk = (path: string) => readFileSync(join(workspaceRoot, 'skills/taleart', path), 'utf8');

test('is in the navigation, after API reference', async ({ page }) => {
  await page.goto('/ai-agents');
  const nav = page.getByRole('navigation', { name: 'Docs' });
  await expect(nav.getByRole('link', { name: 'AI agents' })).toHaveAttribute('aria-current', 'page');
  const labels = (await nav.getByRole('link').allTextContents()).map((l) => l.trim());
  expect(labels[labels.indexOf('API reference') + 1]).toBe('AI agents');
  await expect(page.getByRole('heading', { level: 1, name: 'AI agents' })).toBeVisible();
});

test('offers every skill file for download, as it is in skills/taleart', async ({ page, request }) => {
  await page.goto('/ai-agents');
  const links = page.locator('.downloads a');
  await expect(links).toHaveCount(SKILL_FILES.length);
  for (const [i, path] of SKILL_FILES.entries()) {
    const href = await links.nth(i).getAttribute('href');
    expect(href).toBe(`/skill/taleart/${path}`);
    const answer = await request.get(href ?? '');
    expect(answer.status()).toBe(200);
    expect(await answer.text()).toBe(onDisk(path));
  }
});

test('shows SKILL.md open and each reference file on demand', async ({ page }) => {
  await page.goto('/ai-agents');
  const skill = page.getByRole('region', { name: 'The skill file SKILL.md' });
  await expect(skill).toBeVisible();
  await expect.poll(() => skill.textContent()).toBe(onDisk('SKILL.md'));
  const recipes = page.getByRole('region', { name: 'The skill file reference/recipes.md' });
  await expect(recipes).toBeHidden();
  await page.locator('summary', { hasText: 'reference/recipes.md' }).click();
  await expect(recipes).toBeVisible();
  await expect.poll(() => recipes.textContent()).toBe(onDisk('reference/recipes.md'));
});

test('reads without JavaScript (prerendered)', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/ai-agents');
  await expect(page.getByRole('heading', { level: 1, name: 'AI agents' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Install the skill with the CLI' })).toContainText('taleart skill install --project');
  await expect(page.getByRole('region', { name: 'Commands the agent ran, step 3' })).toContainText('$ taleart groups on Summer --project "Shop" --json');
  await expect(page.getByRole('region', { name: 'The skill file SKILL.md' })).toContainText('name: taleart');
  await context.close();
});

test('reflows at 320 CSS px: only code blocks scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/ai-agents');
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
});

test('screenshots for the verify run', async ({ browser }) => {
  test.skip(!shots, 'E2E_SCREENSHOTS is not set');
  for (const [name, options] of [
    ['ai-agents-light', { colorScheme: 'light' as const, viewport: { width: 1280, height: 900 } }],
    ['ai-agents-dark', { colorScheme: 'dark' as const, viewport: { width: 1280, height: 900 } }],
    ['ai-agents-phone', { colorScheme: 'light' as const, viewport: { width: 390, height: 844 } }],
  ] as const) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.goto('/ai-agents');
    await page.screenshot({ path: join(shots ?? '', `${name}.png`), fullPage: name !== 'ai-agents-phone' });
    if (name === 'ai-agents-light') {
      await page.getByRole('heading', { name: 'An example session' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(shots ?? '', 'ai-agents-session.png') });
    }
    await context.close();
  }
});
