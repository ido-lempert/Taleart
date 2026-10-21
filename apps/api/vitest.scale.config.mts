import { defineConfig } from 'vitest/config';

// The importer's throughput target (`nx run api:import-scale`), kept out of `api:test`.
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/api-scale',
  // Resolves the @taleart/* aliases from tsconfig.base.json (Vite native; replaces the deprecated nxViteTsPaths).
  resolve: { tsconfigPaths: true },
  test: {
    name: 'api-import-scale',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.scale.ts'],
    reporters: ['default'],
  },
}));
