import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    globalSetup: ['./src/__tests__/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    exclude: ['node_modules/**', 'dist/**'],
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
  },
});
