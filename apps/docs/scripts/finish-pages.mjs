// Finishes the GitHub Pages build of the docs (`nx run docs:build-pages`): GitHub Pages serves the
// folder as it is, so it gets a `.nojekyll` (no Jekyll processing, which would drop files and
// folders it ignores) and a `404.html`, the prerendered not-found page, which Pages serves for any
// unknown path. Every page is already prerendered to its own `index.html`.
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist/apps/docs-pages/browser');
const notFound = join(dir, 'not-found/index.html');
if (!existsSync(notFound)) {
  console.error(`${notFound} is missing: build the docs first (nx run docs:build:github-pages).`);
  process.exit(1);
}
writeFileSync(join(dir, '.nojekyll'), '');
copyFileSync(notFound, join(dir, '404.html'));
console.log(`GitHub Pages files ready in ${dir}`);
