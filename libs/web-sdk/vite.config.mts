/// <reference types='vitest' />
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';
import { copyFileSync, rmSync } from 'node:fs';
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

/**
 * Rolls the emitted declarations up into one self-contained `index.d.ts`, with the contract types the SDK uses
 * inlined: `@taleart/contract` is not a dependency of the published package. vite-plugin-dts' own `rollupTypes`
 * reads the entry from `package.json` relative to the source folder, which here describes the dist folder.
 */
function rollupDeclarations(emittedFiles: Map<string, string>): void {
  const entry = path.join(outDir, 'index.d.ts');
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: import.meta.dirname,
      mainEntryPointFilePath: entry,
      bundledPackages: ['@taleart/contract'],
      compiler: { tsconfigFilePath: path.join(import.meta.dirname, 'tsconfig.lib.json') },
      apiReport: { enabled: false, reportFileName: '<unscopedPackageName>.api.md' },
      docModel: { enabled: false },
      tsdocMetadata: { enabled: false },
      dtsRollup: { enabled: true, untrimmedFilePath: entry },
      messages: {
        extractorMessageReporting: { default: { logLevel: 'none' } },
        compilerMessageReporting: { default: { logLevel: 'warning' } },
        tsdocMessageReporting: { default: { logLevel: 'none' } },
      },
    },
    configObjectFullPath: undefined,
    packageJsonFullPath: path.join(import.meta.dirname, 'package.json'),
  });
  const result = Extractor.invoke(config, { localBuild: true, showVerboseMessages: false });
  if (!result.succeeded) throw new Error(`Rolling up the Web SDK declarations failed (${result.errorCount} errors).`);
  for (const file of emittedFiles.keys()) if (path.resolve(file) !== entry) rmSync(file);
  rmSync(path.join(outDir, 'lib'), { recursive: true, force: true });
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
      afterBuild: rollupDeclarations,
    }),
  ],
  // See: https://vite.dev/guide/build.html#library-mode
  build: {
    outDir: '../../dist/libs/web-sdk',
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
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/web-sdk',
      provider: 'v8' as const,
    },
  },
}));
