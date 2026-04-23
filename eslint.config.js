import tsParser from '@typescript-eslint/parser';

export default [
  {
    name: 'mcp-screenshot/src',
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Semaphore']",
          message:
            'Do not instantiate Semaphore directly. Import puppeteerSemaphore from config/runtime.ts.',
        },
      ],
    },
  },
  {
    name: 'mcp-screenshot/semaphore-allowlist',
    files: ['src/config/runtime.ts', 'src/utils/semaphore.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
