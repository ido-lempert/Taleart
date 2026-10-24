import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/cli',
  // Resolves the @taleart/* aliases from tsconfig.base.json.
  resolve: { tsconfigPaths: true },
  test: {
    name: 'cli',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // The integration test starts the built API and runs the built CLI.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/cli',
      provider: 'v8' as const,
    },
  },
}));
