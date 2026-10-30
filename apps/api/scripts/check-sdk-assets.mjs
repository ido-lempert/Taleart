// Checks that the API build carries what it serves under /sdk/v1 (epic UX rework R13): the Web SDK
// bundle (copied from dist/libs/web-sdk, built first as an implicit dependency) and the test page.
// Run by `nx run api:check-sdk-assets`, after the build.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '../../../dist/apps/api');
const sdk = resolve(import.meta.dirname, '../../../dist/libs/web-sdk/index.js');
const failures = [];
for (const file of ['web-sdk/index.js', 'sdk-pages/test-page.html', 'sdk-pages/test-page.js', 'sdk-pages/test-page.css']) {
  try {
    if (!statSync(join(dist, file)).size) failures.push(`${file} is empty`);
  } catch {
    failures.push(`${file} is missing`);
  }
}
try {
  if (!readFileSync(join(dist, 'web-sdk/index.js')).equals(readFileSync(sdk))) {
    failures.push('web-sdk/index.js differs from dist/libs/web-sdk/index.js: the SDK was built after the API');
  }
} catch {
  // Said above.
}
// Every chunk of the bundle (the viewer, split off by the build) must be there, as the entry imports it by name.
for (const chunk of readdirSync(resolve(import.meta.dirname, '../../../dist/libs/web-sdk')).filter((f) =>
  /^[a-z][a-z0-9]*-.+\.js$/.test(f),
)) {
  try {
    if (
      !readFileSync(join(dist, 'web-sdk', chunk)).equals(
        readFileSync(resolve(import.meta.dirname, '../../../dist/libs/web-sdk', chunk)),
      )
    ) {
      failures.push(`web-sdk/${chunk} differs from dist/libs/web-sdk/${chunk}: the SDK was built after the API`);
    }
  } catch {
    failures.push(`web-sdk/${chunk} is missing: the entry imports it`);
  }
}
for (const extra of ['sdk-pages/test-page.d.ts']) {
  try {
    statSync(join(dist, extra));
    failures.push(`${extra} should not be in the build`);
  } catch {
    // Not there: good.
  }
}
if (failures.length) {
  console.error(`API build is missing its SDK files:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('API build has the Web SDK bundle and the test page.');
