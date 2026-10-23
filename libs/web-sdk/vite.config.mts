/// <reference types='vitest' />
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'path';
import { defineConfig, type Plugin } from 'vite';
import dts from 'vite-plugin-dts';

const outDir = path.join(import.meta.dirname, '../../dist/libs/web-sdk');

/** Copies the package manifest and README next to the bundle, for `nx release` to publish. */
function copyPackageFiles(): Plugin {
  return {
    name: 'taleart-copy-package-files',
    apply: 'build',
    writeBundle() {
      for (const file of ['package.json', 'README.md']) {
        copyFileSync(path.join(import.meta.dirname, file), path.join(outDir, file));
      }
    },
  };
}

// Each ES chunk's modules with their rendered code, for `web-sdk:size` (scripts/size-budget.mjs) to
// report what the AD-16 split would move. Written next to the package folder, so it is never published.
const MODULE_REPORT = path.join(outDir, '../web-sdk-modules.json');

/** Writes MODULE_REPORT: `{ chunks: { [file]: { id, code }[] } }`, ids relative to the workspace. */
function moduleReport(): Plugin {
  const root = path.join(import.meta.dirname, '../..');
  return {
    name: 'taleart-module-report',
    apply: 'build',
    // A failed build leaves no report of the previous one behind. Once per build command: buildStart
    // runs again for each output format, after the ES one has written the report.
    configResolved() {
      rmSync(MODULE_REPORT, { force: true });
    },
    generateBundle(options, bundle) {
      if (options.format !== 'es') return;
      const chunks: Record<string, { id: string; code: string }[]> = {};
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        chunks[chunk.fileName] = Object.entries(chunk.modules).map(([id, m]) => ({
          id: path.relative(root, id).split(path.sep).join('/'),
          code: m.code ?? '',
        }));
      }
      mkdirSync(path.dirname(MODULE_REPORT), { recursive: true });
      writeFileSync(MODULE_REPORT, JSON.stringify({ chunks }));
    },
  };
}

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/web-sdk',
  // Resolves the @taleart/* aliases from tsconfig.base.json (Vite native; replaces the deprecated nxViteTsPaths).
  resolve: { tsconfigPaths: true },
  plugins: [
    copyPackageFiles(),
    moduleReport(),
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(import.meta.dirname, 'tsconfig.lib.json'),
      pathsToAliases: false,
      // Only the public API's declarations: the internal modules' types point into the contract's OpenAPI
      // schemas, which are not published. `web-sdk:types-check` checks the result.
      include: ['src/index.ts', 'src/lib/taleart-element.ts', 'src/lib/public-types.ts'],
    }),
  ],
  // See: https://vite.dev/guide/build.html#library-mode
  build: {
    outDir,
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: 'src/index.ts',
      name: 'TaleartWebSdk',
      fileName: 'index',
      formats: ['es' as const, 'umd' as const],
    },
    rolldownOptions: {
      // External packages that should not be bundled into your library.
      external: [],
    },
  },
  test: {
    name: 'web-sdk',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Type-level tests (`*.spec-d.ts`), e.g. the public types against the contract's schema types.
    typecheck: { enabled: true, tsconfig: './tsconfig.typetest.json', include: ['src/**/*.spec-d.ts'] },
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/web-sdk',
      provider: 'v8' as const,
    },
  },
}));
