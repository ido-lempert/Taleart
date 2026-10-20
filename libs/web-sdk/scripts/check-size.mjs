// Fails when the gzipped ES bundle of the Web SDK exceeds its budget (NFR-006: 50 KB).
// Run through `nx run web-sdk:size`, which builds first.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT_BYTES = 50 * 1024;
const file = resolve(process.argv[2] ?? 'dist/libs/web-sdk/index.js');
const gzipped = gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(2)} KB`;

if (gzipped > LIMIT_BYTES) {
  console.error(`Web SDK bundle ${file} is ${kb(gzipped)} gzipped, over the ${kb(LIMIT_BYTES)} budget.`);
  process.exit(1);
}
console.log(`Web SDK bundle ${file} is ${kb(gzipped)} gzipped (budget ${kb(LIMIT_BYTES)}).`);
