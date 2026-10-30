// Checks the built Web SDK against its size budget (NFR-006; epic Tale Studio R15, AD-16): all its ES
// chunks at most 100 KB gzipped, and the chunk the page loads at most 40 KB (past that, the viewer and
// renderers move to a chunk loaded on first open). Reports every chunk, and, while the SDK is one
// chunk, what that split would move. See size-budget.mjs.
// Run through `nx run web-sdk:size`, which builds first. The argument is the build folder (or its index.js).
import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { judge, readChunks } from './size-budget.mjs';

const arg = resolve(process.argv[2] ?? 'dist/libs/web-sdk');
const dir = statSync(arg).isDirectory() ? arg : dirname(arg);
const { lines, failures } = judge(readChunks(dir));

console.log(`Web SDK in ${dir}:`);
for (const line of lines) console.log(line);
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
