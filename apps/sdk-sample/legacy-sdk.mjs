// Builds the Web SDK as it was at an earlier commit, for before/after comparisons in the sample-page
// review (a11y-review.mjs): the SDK's and contract's sources at that commit are taken from git into a
// temporary folder made for this run, which shares this checkout's node_modules, bundled with Vite
// (ES module only, no declarations), read, and the folder removed. Plain Node and the repo's own
// tools; nothing is installed.
//
// A checkout without that commit (such as a shallow clone) gets null, so the review skips the
// comparison with a message; with TALEART_REQUIRE_LEGACY_SDK=1 (CI) that is an error instead.
//
//   node apps/sdk-sample/legacy-sdk.mjs <commit>   prints the bundle's size, or why there is none
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

/** True when git has `commit` in this checkout. */
function hasCommit(commit) {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The Web SDK bundle at `commit`, built afresh in a folder of this run's own, or null when the
 * commit is not in this checkout (an error when TALEART_REQUIRE_LEGACY_SDK=1).
 */
export function buildLegacySdk(commit) {
  if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error(`Not a commit id: ${commit}`);
  if (!hasCommit(commit)) {
    if (process.env.TALEART_REQUIRE_LEGACY_SDK === '1') {
      throw new Error(`Commit ${commit} is not in this checkout, and TALEART_REQUIRE_LEGACY_SDK=1 requires it`);
    }
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), `taleart-legacy-sdk-${commit}-`));
  try {
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
  cacheDir: ${JSON.stringify(join(dir, '.vite'))},
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
      { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] },
    );
    return readFileSync(join(dir, 'out', 'index.js'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === import.meta.filename) {
  const bundle = buildLegacySdk(process.argv[2] ?? '');
  console.log(bundle ? `${bundle.length} bytes` : 'commit not in this checkout');
}
