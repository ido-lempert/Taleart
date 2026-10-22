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
              // The Web SDK only for the Tale Studio preview, through its preview entry point (AD-16).
              sourceTag: 'scope:dashboard',
              onlyDependOnLibsWithTags: ['type:contract', 'type:sdk'],
            },
            {
              // The docs app shows the contract's install snippet (epic UX rework R17).
              sourceTag: 'scope:docs',
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
      // AD-1: another lib is reached only through its index.ts, or an entry
      // point its package.json `exports` declares (the contract's narrow ones), or the Web SDK's
      // workspace-only preview entry point for the Tale Studio preview (AD-16; not published).
      // Relative paths into another project are caught above; this catches deep
      // paths under a workspace alias, such as @taleart/server-zones/src/lib/frames.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@taleart/*/**',
                '!@taleart/contract/core',
                '!@taleart/contract/project-fonts',
                '!@taleart/contract/tale-document',
                '!@taleart/contract/text-style',
                '!@taleart/contract/theme',
                '!@taleart/web-sdk/preview',
              ],
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
