import { defineConfig } from 'vitest/config';
import { sharedCoverageConfig, sharedTestEnv } from './vitest.shared.config.js';

export default defineConfig({
  test: {
    ...sharedTestEnv,
    include: ['tests/**/*.test.ts', 'tests/**/*.integration.test.ts', 'tests/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    coverage: sharedCoverageConfig,
  },
});
