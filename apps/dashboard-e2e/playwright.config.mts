import { defineConfig, devices } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

/**
 * The dashboard's end-to-end tests (`nx run dashboard-e2e:e2e`): the first run from sign-up to a
 * visible tale (epic UX rework, story 8.13).
 *
 * They start their own servers, never the development ones:
 * - the built API on E2E_API_PORT (default 3413), on a fresh database named by E2E_DATABASE_URL,
 *   which must end in `_e2e_test` and differ from TEST_DATABASE_URL and DATABASE_URL
 *   (scripts/start-api.mjs drops and creates it; scripts/e2e-database.mjs guards it);
 * - the dashboard on E2E_DASHBOARD_PORT (default 4313), its /api proxied to that API.
 *
 * E2E_SCREENSHOTS, when set, is a folder the tests save screenshots in.
 */
const apiPort = Number(process.env['E2E_API_PORT'] || 3413);
const dashboardPort = Number(process.env['E2E_DASHBOARD_PORT'] || 4313);
const apiOrigin = `http://localhost:${apiPort}`;
const dashboardOrigin = `http://localhost:${dashboardPort}`;

export default defineConfig({
  testDir: './src',
  outputDir: `${workspaceRoot}/dist/.playwright/apps/dashboard-e2e/test-output`,
  // One install, used in order: the tests run one after another.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: dashboardOrigin,
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
  },
  webServer: [
    {
      command: 'node apps/dashboard-e2e/scripts/start-api.mjs',
      url: `${apiOrigin}/api/v1/health`,
      cwd: workspaceRoot,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      env: {
        E2E_DATABASE_URL: process.env['E2E_DATABASE_URL'] ?? '',
        PORT: String(apiPort),
        PUBLIC_API_URL: apiOrigin,
        // Passkeys are bound to the dashboard's origin.
        RP_ORIGIN: dashboardOrigin,
        RP_ID: 'localhost',
      },
    },
    {
      // E2E_BUILT_DASHBOARD=1 serves the built bundle instead of the dev server (no Nx task lock on
      // dashboard:serve:development). It needs `nx run dashboard:build:development` first.
      command: process.env['E2E_BUILT_DASHBOARD'] === '1'
        ? 'node apps/dashboard-e2e/scripts/serve-built-dashboard.mjs'
        : 'node apps/dashboard-e2e/scripts/serve-dashboard.mjs',
      url: dashboardOrigin,
      cwd: workspaceRoot,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: 'ignore',
      env: { E2E_API_PORT: String(apiPort), E2E_DASHBOARD_PORT: String(dashboardPort) },
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
});
