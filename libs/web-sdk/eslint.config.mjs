import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vite.config.{js,ts,mjs,mts}',
            '{projectRoot}/src/**/*.spec-d.ts',
            '{projectRoot}/tests/**',
          ],
          // The published package has no dependencies: the few runtime values the SDK
          // takes from the contract (`cleanText`, `ELEMENT_TEXT_RULE`,
          // `TEXT_ELEMENT_STYLE`, `readingOrder`) are bundled into it, the rest are
          // types, and its public declarations use its own types (`public-types.ts`).
          // `web-sdk:types-check` fails if a published .d.ts names the contract.
          ignoredDependencies: ['@taleart/contract'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
