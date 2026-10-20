import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vitest.config.*.timestamp*',
      '**/vite.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          // AD-1: clients depend only on the contract; the API and domain
          // modules depend on modules' public interfaces and the contract;
          // the contract depends on nothing.
          depConstraints: [
            {
              sourceTag: 'scope:api',
              onlyDependOnLibsWithTags: ['type:server-module', 'type:contract'],
            },
            {
              sourceTag: 'type:server-module',
              onlyDependOnLibsWithTags: ['type:server-module', 'type:contract'],
            },
            {
              sourceTag: 'scope:dashboard',
              onlyDependOnLibsWithTags: ['type:contract'],
            },
            {
              sourceTag: 'type:sdk',
              onlyDependOnLibsWithTags: ['type:contract'],
            },
            {
              sourceTag: 'type:contract',
              onlyDependOnLibsWithTags: [],
            },
          ],
        },
      ],
      // AD-1: another lib is reached only through its index.ts. Relative
      // paths into another project are caught above; this catches deep paths
      // under a workspace alias, such as @taleart/server-zones/src/lib/frames.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@taleart/*/**'],
              message: "Import another lib only through its public interface (its package name), never a file inside it.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
