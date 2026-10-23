// Where the end-to-end API takes its Web SDK from and keeps the builds it served (story 8.21), so
// a test can rebuild the SDK under a running API and start another one on the same files.
import { join } from 'node:path';

/**
 * The SDK files of an e2e run, under the workspace's `dist/.playwright` (never a dev folder):
 * the bundle the API serves (`WEB_SDK_FILE`, a copy of the API build's) and its builds folder
 * (`SDK_BUILDS_DIR`). `start-api.mjs` makes them afresh on each run.
 */
export function e2eSdk(root) {
  const dir = join(root, 'dist/.playwright/apps/dashboard-e2e/sdk');
  return {
    dir,
    builtBundle: join(root, 'dist/apps/api/web-sdk/index.js'),
    bundleFile: join(dir, 'taleart.js'),
    buildsDir: join(dir, 'builds'),
  };
}
