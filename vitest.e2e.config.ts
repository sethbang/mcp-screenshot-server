import { defineConfig } from 'vitest/config';
import { sharedTestEnv } from './vitest.shared.config.js';

export default defineConfig({
  test: {
    ...sharedTestEnv,
    include: ['tests/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
