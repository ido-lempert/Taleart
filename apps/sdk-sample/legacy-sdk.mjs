// Builds the Web SDK as it was at an earlier commit, for before/after comparisons in the sample-page
// review (a11y-review.mjs): the SDK's and contract's sources at that commit are taken from git into a
// temporary folder, which shares this checkout's node_modules, and bundled with Vite (ES module only,
// no declarations). Plain Node and the repo's own tools; nothing is installed.
//
//   node apps/sdk-sample/legacy-sdk.mjs <commit>   prints the bundle's path
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

/** The bundle of the Web SDK at `commit` (built once per commit into the OS temp folder), as a path. */
export function buildLegacySdk(commit) {
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error(`Not a commit id: ${commit}`);
  const dir = join(tmpdir(), `taleart-legacy-sdk-${commit}`);
  const bundle = join(dir, 'out', 'index.js');
  if (existsSync(bundle)) return bundle;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const archive = execFileSync(
    'git',
    ['archive', commit, 'libs/web-sdk', 'libs/contract', 'tsconfig.base.json', 'package.json'],
    { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 },
  );
  execFileSync('tar', ['-x', '-C', dir], { input: archive });
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(
    join(dir, 'legacy.vite.config.mjs'),
    `import { defineConfig } from 'vite';
export default defineConfig({
  root: ${JSON.stringify(join(dir, 'libs/web-sdk'))},
  resolve: { tsconfigPaths: true },
  logLevel: 'warn',
  build: {
    outDir: ${JSON.stringify(join(dir, 'out'))},
    emptyOutDir: true,
    lib: { entry: 'src/index.ts', fileName: 'index', formats: ['es'] },
  },
});
`,
  );
  execFileSync(
    process.execPath,
    [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'legacy.vite.config.mjs'],
    {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  if (!existsSync(bundle)) throw new Error(`The SDK at ${commit} did not build`);
  return bundle;
}

if (process.argv[1] === import.meta.filename) console.log(buildLegacySdk(process.argv[2] ?? ''));
