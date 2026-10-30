/// <reference types='vitest' />
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'path';
import { defineConfig, type Plugin } from 'vite';
import dts from 'vite-plugin-dts';

const outDir = path.join(import.meta.dirname, '../../dist/libs/web-sdk');

// The modules of the viewer chunk: the viewer, and the tale documents' renderers (the modules only the
// viewer draws with). The module the entry imports, bar.ts's canvas colour and media, stay in core.
const VIEWER_CHUNK =
  /libs\/web-sdk\/src\/lib\/(viewer\.ts|document\/(renderer|links|poll|quiz|rating|reaction|countdown|promo-code|shapes|text|fonts)\.ts)$/;
// The banner's variants other than the carousel (banner-variants.ts) and the bar's chip, poster and stack
// (bar-extra-layouts.ts): each loads on the first display that draws it (banner.ts, bar.ts), so the page's core
// stays at the ring and the carousel.
const BANNER_VARIANTS_CHUNK = /libs\/web-sdk\/src\/lib\/banner-variants\.ts$/;
const BAR_EXTRA_LAYOUTS_CHUNK = /libs\/web-sdk\/src\/lib\/bar-extra-layouts\.ts$/;
// The rest of the SDK and its contract, in one chunk; the entry (index.ts) stays on its own.
const CORE_CHUNK = /libs\/(web-sdk\/src\/lib|contract\/src\/lib)\//;

/** Copies the package manifest, README and the repository's LICENSE next to the bundle, for npm to publish. */
function copyPackageFiles(): Plugin {
  return {
    name: 'taleart-copy-package-files',
    apply: 'build',
    writeBundle() {
      const sources = [
        path.join(import.meta.dirname, 'package.json'),
        path.join(import.meta.dirname, 'README.md'),
        path.join(import.meta.dirname, '../../LICENSE'),
      ];
      for (const source of sources) {
        copyFileSync(source, path.join(outDir, path.basename(source)));
      }
    },
  };
}

/**
 * Gives the relative imports of the emitted declarations their `.js` extension, so they resolve under
 * `moduleResolution: nodenext` and `node16` (the `.d.ts` files are the ones TypeScript reads; `./lib/x.js`
 * finds `./lib/x.d.ts`). Runs after the declarations are written.
 */
function declarationExtensions(): Plugin {
  const specifier = /(from\s+|import\()(['"])(\.\.?\/[^'"]+)\2/g;
  const addExtension = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) addExtension(file);
      else if (entry.name.endsWith('.d.ts')) {
        const text = readFileSync(file, 'utf8');
        const fixed = text.replace(specifier, (match, head: string, quote: string, target: string) =>
          /\.[cm]?js$/.test(target) ? match : `${head}${quote}${target}.js${quote}`,
        );
        if (fixed !== text) writeFileSync(file, fixed);
      }
    }
  };
  return {
    name: 'taleart-declaration-extensions',
    apply: 'build',
    closeBundle() {
      addExtension(outDir);
    },
  };
}

/**
 * Compacts a stylesheet: comments and the whitespace between its tokens go, except inside quoted strings and where a
 * value needs a space (`calc(1px - 2px)`, `16 / 9`). The space around a `:` also goes, which no selector here needs.
 */
function compactCss(css: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      out += c;
      if (c === '\\') out += css[++i] ?? '';
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
    } else if (/\s/.test(c)) {
      if (out.length > 0 && !out.endsWith(' ')) out += ' ';
    } else {
      out += c;
    }
  }
  return out
    .replace(/ ?([{};,>]) ?/g, '$1')
    .replace(/ ?: ?/g, ':')
    .trim();
}

/**
 * Compacts the Web SDK's stylesheets at build time: each template literal named `*_STYLES` (without an
 * interpolation) is written as {@link compactCss} writes it. The source keeps its readable layout, and the
 * tests read the source, so they see the same rules.
 */
function compactStyles(): Plugin {
  const lib = path.join(import.meta.dirname, 'src', 'lib') + path.sep;
  return {
    name: 'taleart-compact-styles',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      if (!id.startsWith(lib) || !id.endsWith('.ts')) return null;
      const next = code.replace(/(const [A-Za-z_]+_STYLES = `)([^`$]*)(`)/g, (_, open: string, body: string, close: string) => open + compactCss(body) + close);
      return next === code ? null : next;
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
    compactStyles(),
    copyPackageFiles(),
    declarationExtensions(),
    moduleReport(),
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(import.meta.dirname, 'tsconfig.lib.json'),
      pathsToAliases: false,
      // Only the public API's declarations: the internal modules' types point into the contract's OpenAPI
      // schemas, which are not published. `web-sdk:types-check` checks the result.
      include: ['src/index.ts', 'src/lib/taleart-element.ts', 'src/lib/public-types.ts', 'src/lib/config.ts', 'src/lib/hooks.ts', 'src/lib/i18n.ts', 'src/lib/frequency.ts'],
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
    },
    rolldownOptions: {
      // External packages that should not be bundled into your library.
      external: [],
      // The entry keeps its exports and may take more: the lazy groups below take only their own modules, so
      // a shared module can sit in core (see includeDependenciesRecursively).
      preserveEntrySignatures: 'allow-extension',
      // One output per format: the ES build splits the viewer off (see VIEWER_CHUNK); the UMD build is a
      // single file, as UMD has no chunks, so the viewer is inlined into it.
      output: [
        {
          format: 'es',
          entryFileNames: 'index.js',
          chunkFileNames: '[name]-[hash].js',
          // The viewer (and the tale documents it draws) is a chunk of its own, loaded on the first open
          // (AD-16, viewer-loader.ts); everything else the SDK needs is in `core`, which both the entry
          // and the viewer chunk import, so the page and the viewer share one copy of the SDK's state.
          codeSplitting: {
            groups: [
              // Each lazy group takes its own modules only: a group captures a module's imports too unless told not to,
              // which would move the core modules the page needs (the bar's, the i18n) into the lazy chunk.
              { name: 'viewer', test: VIEWER_CHUNK, includeDependenciesRecursively: false },
              { name: 'banner-variants', test: BANNER_VARIANTS_CHUNK, includeDependenciesRecursively: false },
              { name: 'bar-extra-layouts', test: BAR_EXTRA_LAYOUTS_CHUNK, includeDependenciesRecursively: false },
              { name: 'core', test: CORE_CHUNK },
            ],
          },
        },
        { format: 'umd', name: 'TaleartWebSdk', entryFileNames: 'index.umd.cjs', codeSplitting: false },
      ],
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
