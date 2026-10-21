/// <reference types='vitest' />
import { copyFileSync } from 'node:fs';
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

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/web-sdk',
  // Resolves the @taleart/* aliases from tsconfig.base.json (Vite native; replaces the deprecated nxViteTsPaths).
  resolve: { tsconfigPaths: true },
  plugins: [
    copyPackageFiles(),
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
