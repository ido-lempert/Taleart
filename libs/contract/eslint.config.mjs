import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  { ignores: ['**/src/generated/**'] },
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vitest.config.{js,ts,mjs,mts}',
            // Build-time generators (contract:generate), not shipped with the package.
            '{projectRoot}/scripts/**',
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
