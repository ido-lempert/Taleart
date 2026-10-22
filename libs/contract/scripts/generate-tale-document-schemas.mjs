// Copies the tale document's JSON Schema files (AD-15) into a TypeScript module, so the server's
// validator and the dashboard read the same schemas without importing JSON files. The JSON files in
// libs/contract/tale-document/ stay the source; run through `nx run contract:generate`.
// Entries marked `testOnly` in the registry go to TALE_TEST_ELEMENT_TYPES instead (epic Tale
// Studio R8): servers and editors take them only when configured to, and no SDK renders them.
// The registry's checks live in tale-document-registry.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readRegistry } from './tale-document-registry.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'tale-document');
const OUT = join(ROOT, 'src/generated/tale-document-schemas.ts');

const { document, types, testTypes } = readRegistry((file) => JSON.parse(readFileSync(join(DIR, file), 'utf8')));

const json = (value) => JSON.stringify(value, null, 2);
writeFileSync(
  OUT,
  `// Generated from libs/contract/tale-document/ by scripts/generate-tale-document-schemas.mjs; do not edit.
// Run \`npm exec nx -- run contract:generate\` after changing a schema file.

/** \`tale-document/v1.schema.json\`: the tale document's envelope (AD-15). */
export const TALE_DOCUMENT_V1_SCHEMA: { readonly [key: string]: unknown } = ${json(document)};

/** \`tale-document/element-types/registry.json\`, each entry with its props schema. */
export const TALE_ELEMENT_TYPE_REGISTRY: readonly {
  readonly key: string;
  readonly label: string;
  readonly schema: { readonly [key: string]: unknown };
}[] = ${json(types)};

/**
 * The registry's \`testOnly\` entries, each with its props schema (epic Tale Studio R8): taken only
 * where configured (\`elementTypeRegistry({ testTypes: true })\`), never by a production build.
 */
export const TALE_TEST_ELEMENT_TYPES: readonly {
  readonly key: string;
  readonly label: string;
  readonly schema: { readonly [key: string]: unknown };
}[] = ${json(testTypes)};
`,
);
console.log(`Wrote ${OUT}`);
