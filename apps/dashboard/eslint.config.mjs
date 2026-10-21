import nx from "@nx/eslint-plugin";
import baseConfig from "../../eslint.config.mjs";

export default [
    ...nx.configs["flat/angular"],
    ...nx.configs["flat/angular-template"],
    ...baseConfig,
    {
        files: [
            "**/*.ts"
        ],
        rules: {
            "@angular-eslint/directive-selector": [
                "error",
                {
                    type: "attribute",
                    prefix: "app",
                    style: "camelCase"
                }
            ],
            "@angular-eslint/component-selector": [
                "error",
                {
                    type: "element",
                    prefix: "app",
                    style: "kebab-case"
                }
            ]
        }
    },
    {
        // The initial bundle stays under its 500 kB budget only while eager code never reaches the
        // contract code that only lazy pages use. esbuild loads every module a barrel re-exports along
        // with the importer, even unused ones, so the dashboard never imports the root barrel, and
        // only the lazy Tale Studio, theme and font pages (and their helpers) import the narrow
        // lazy-only entry points' values; types from them are fine anywhere.
        files: [
            "**/*.ts"
        ],
        ignores: [
            "src/app/pages/tale-*.ts",
            "src/app/pages/theme.ts",
            "src/app/pages/fonts.ts",
            "src/app/tale-document.service.ts",
            "src/app/theme.service.ts"
        ],
        rules: {
            "@typescript-eslint/no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "@taleart/contract",
                            message: "Import @taleart/contract/core or a narrow entry point: the root barrel pulls lazy-only code into the initial bundle."
                        },
                        ...["tale-document", "text-style", "theme", "project-fonts"].map((entry) => ({
                            name: `@taleart/contract/${entry}`,
                            allowTypeImports: true,
                            message: "Only the lazy Tale Studio, theme and font pages import these values; anywhere else they land in the initial bundle."
                        }))
                    ]
                }
            ]
        }
    },
    {
        files: [
            "src/app/pages/tale-*.ts",
            "src/app/pages/theme.ts",
            "src/app/pages/fonts.ts",
            "src/app/tale-document.service.ts",
            "src/app/theme.service.ts"
        ],
        rules: {
            "@typescript-eslint/no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "@taleart/contract",
                            message: "Import @taleart/contract/core or a narrow entry point: the root barrel pulls lazy-only code into the initial bundle."
                        }
                    ]
                }
            ]
        }
    },
    {
        files: [
            "**/*.html"
        ],
        // Override or add rules here
        rules: {}
    }
];
