import { defineConfig, devices } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

/**
 * The docs' end-to-end tests (`nx run docs-e2e:e2e`) and WCAG scan (`nx run docs-e2e:a11y`, the
 * `@a11y` tests), against the built docs (`docs:build`, a dependency of both targets) served as a
 * static host would by scripts/serve-docs.mjs on E2E_DOCS_PORT (default 4317), never the
 * development server.
 *
 * The API reference's Try it out is tested against a stubbed API (no database). `live.spec.ts` calls
 * a real one, only when DOCS_LIVE_API_URL, DOCS_LIVE_TOKEN, DOCS_LIVE_SITE_KEY and DOCS_LIVE_ZONE are
 * set (the story's verify run); E2E_SCREENSHOTS, when set, is a folder it saves screenshots in.
 */
const port = Number(process.env['E2E_DOCS_PORT'] || 4317);
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: './src',
  outputDir: `${workspaceRoot}/dist/.playwright/apps/docs-e2e/test-output`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: 'node apps/docs-e2e/scripts/serve-docs.mjs',
    url: origin,
    cwd: workspaceRoot,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    env: { E2E_DOCS_PORT: String(port) },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
});
