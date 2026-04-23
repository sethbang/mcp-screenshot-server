// Shared building blocks for the per-tier vitest configs.
// Keep one source of truth for coverage thresholds and the common test env.

export const sharedCoverageConfig = {
  provider: 'v8' as const,
  include: ['src/**/*.ts'],
  // src/index.ts is the stdio entry; exercised end-to-end, not in unit tests.
  exclude: ['src/index.ts'],
  thresholds: {
    // Floors set ~2pp below current measured coverage (74.94 / 75.94 / 75.86 / 76.47
    // as of v1.1.2) so that meaningful regressions trip CI but a single removed
    // line that nicks an uncovered branch doesn't flake. Raise these as new tests
    // land.
    lines: 74,
    branches: 68,
    functions: 73,
    statements: 73,
  },
};

export const sharedTestEnv = {
  globals: true,
  environment: 'node' as const,
};
