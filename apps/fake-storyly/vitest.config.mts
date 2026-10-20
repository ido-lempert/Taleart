import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/fake-storyly',
  test: {
    name: 'fake-storyly',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.mjs'],
    reporters: ['default'],
  },
}));
