import { defineConfig } from 'vitest/config';
import { sharedCoverageConfig, sharedTestEnv } from './vitest.shared.config.js';

export default defineConfig({
  test: {
    ...sharedTestEnv,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.integration.test.ts', 'tests/**/*.e2e.test.ts'],
    coverage: sharedCoverageConfig,
  },
});
