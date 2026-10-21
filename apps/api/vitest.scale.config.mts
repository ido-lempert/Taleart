import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

// The importer's throughput target (`nx run api:import-scale`), kept out of `api:test`.
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/api-scale',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'api-import-scale',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.scale.ts'],
    reporters: ['default'],
  },
}));
