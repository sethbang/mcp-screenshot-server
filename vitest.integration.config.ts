import { defineConfig } from 'vitest/config';
import { sharedTestEnv } from './vitest.shared.config.js';

export default defineConfig({
  test: {
    ...sharedTestEnv,
    include: ['tests/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
