// Copies the tale document's JSON Schema files (AD-15) into a TypeScript module, so the server's
// validator and the dashboard read the same schemas without importing JSON files. The JSON files in
// libs/contract/tale-document/ stay the source; run through `nx run contract:generate`.
// Entries marked `testOnly` in the registry go to TALE_TEST_ELEMENT_TYPES instead (epic Tale
// Studio R8): servers and editors take them only when configured to, and no SDK renders them.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'tale-document');
const OUT = join(ROOT, 'src/generated/tale-document-schemas.ts');

const readJson = (file) => JSON.parse(readFileSync(join(DIR, file), 'utf8'));

const document = readJson('v1.schema.json');
const keyPattern = new RegExp(document.$defs.ElementType.pattern);
const registry = readJson('element-types/registry.json');
if (!Array.isArray(registry.types)) throw new Error('element-types/registry.json must list types');
const seen = new Set();
const entries = registry.types.map((entry) => {
  const { key, label, schema, testOnly, ...rest } = entry;
  if (typeof key !== 'string' || typeof label !== 'string' || typeof schema !== 'string') {
    throw new Error('Every element type needs a key, a label and a schema file');
  }
  if (Object.keys(rest).length > 0) throw new Error(`Element type "${key}" has unknown fields: ${Object.keys(rest)}`);
  if (testOnly !== undefined && typeof testOnly !== 'boolean') throw new Error(`"${key}": testOnly is a boolean`);
  if (!keyPattern.test(key)) throw new Error(`Element type "${key}" does not match the document's ElementType pattern`);
  if (seen.has(key)) throw new Error(`Element type "${key}" is registered twice`);
  seen.add(key);
  const props = readJson(join('element-types', schema));
  if (props.type !== 'object' || props.additionalProperties !== false) {
    throw new Error(`${schema}: props are an object with "additionalProperties": false (R14)`);
  }
  return { key, label, schema: props, testOnly: testOnly === true };
});
const types = entries.filter((t) => !t.testOnly).map(({ key, label, schema }) => ({ key, label, schema }));
const testTypes = entries.filter((t) => t.testOnly).map(({ key, label, schema }) => ({ key, label, schema }));

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
