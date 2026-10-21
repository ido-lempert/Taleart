// Copies the tale document's JSON Schema files (AD-15) into a TypeScript module, so the server's
// validator and the dashboard read the same schemas without importing JSON files. The JSON files in
// libs/contract/tale-document/ stay the source; run through `nx run contract:generate`.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'tale-document');
const OUT = join(ROOT, 'src/generated/tale-document-schemas.ts');

const readJson = (file) => JSON.parse(readFileSync(join(DIR, file), 'utf8'));

const document = readJson('v1.schema.json');
const registry = readJson('element-types/registry.json');
if (!Array.isArray(registry.types)) throw new Error('element-types/registry.json must list types');
const types = registry.types.map(({ key, label, schema }) => {
  if (typeof key !== 'string' || typeof label !== 'string' || typeof schema !== 'string') {
    throw new Error('Every element type needs a key, a label and a schema file');
  }
  return { key, label, schema: readJson(join('element-types', schema)) };
});

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
`,
);
console.log(`Wrote ${OUT}`);
