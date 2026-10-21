import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/server/zones',
  // Resolves the @taleart/* aliases from tsconfig.base.json (Vite native; replaces the deprecated nxViteTsPaths).
  resolve: { tsconfigPaths: true },
  test: {
    name: 'server-zones',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/server/zones',
      provider: 'v8' as const,
    },
  },
}));
