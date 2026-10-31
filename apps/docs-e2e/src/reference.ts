import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { expect, type Page } from '@playwright/test';

/** The docs' pages, by path, as the navigation lists them (apps/docs/src/app/app.routes.ts). */
export const DOCS_PATHS = ['/', '/concepts', '/coverage-and-limits', '/guides-install', '/install', '/guides-connect-website', '/guides-create-campaign', '/zones-and-displays', '/tale-groups-and-tales', '/tale-studio', '/interactive-components', '/theme-and-fonts', '/visibility', '/targeting', '/guides/analytics', '/projects-and-team', '/guides/sign-in-methods', '/guides/web', '/android-guide', '/ios-guide', '/reference/web-sdk', '/reference/performance', '/reference/android-sdk', '/reference/ios-sdk', '/reference/analytics', '/reference/sign-in-methods', '/api-reference', '/api-tokens', '/cli', '/ai-agents', '/moving-from-stages'];

/** The localStorage key of the API reference's API URL (`API_URL_STORAGE_KEY` in api-reference-spec.ts). */
export const API_URL_KEY = 'taleart-docs:api-reference:api-url';

/**
 * Every operation of `libs/contract/openapi/openapi.yaml` as `METHOD /path`, read from the YAML text
 * itself (two-space path keys under `paths:`, four-space method keys under each), so the test does not
 * trust the generated JSON the page loads.
 */
export function yamlOperations(): string[] {
  const yaml = readFileSync(join(workspaceRoot, 'libs/contract/openapi/openapi.yaml'), 'utf8');
  const paths = yaml.slice(yaml.indexOf('\npaths:\n'), yaml.indexOf('\ncomponents:\n'));
  const operations: string[] = [];
  let path = '';
  for (const line of paths.split('\n')) {
    const key = /^ {2}(\/\S*):$/.exec(line);
    if (key) path = key[1];
    const method = /^ {4}(get|put|post|delete|options|head|patch|trace):$/.exec(line);
    if (method) operations.push(`${method[1].toUpperCase()} ${path}`);
  }
  return operations;
}

/** Opens the API reference and waits for Swagger UI to list the operations. */
export async function openReference(page: Page): Promise<void> {
  await page.goto('/api-reference');
  await expect(page.locator('.swagger-ui .opblock').first()).toBeVisible({ timeout: 30_000 });
}

/** The operation's block on the page, by method and path. */
export function operation(page: Page, method: string, path: string) {
  return page.locator(`.opblock-${method.toLowerCase()}`).filter({
    has: page.locator(`.opblock-summary-path[data-path="${path}"]`),
  });
}
