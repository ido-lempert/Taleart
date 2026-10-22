// The element-type registry's checks (epic Tale Studio R8), shared by generate-tale-document-schemas.mjs
// and its tests. `readJson(file)` reads a file under libs/contract/tale-document/.
import Ajv2020 from 'ajv/dist/2020.js';

// A schema file is a plain file name in element-types/: no folders, no way out of it.
const SCHEMA_FILE = /^[a-z0-9][a-z0-9-]*\.schema\.json$/;

/**
 * The registry's entries, each with its props schema, split into its own types and its `testOnly`
 * ones. Throws, naming the entry, when an entry or its schema breaks a rule: a key, a non-empty
 * label and a schema file in element-types/; no other field but `testOnly` (a boolean); a key the
 * document schema accepts, registered once; a props schema that is a closed object whose
 * `required` names its own properties, and that Ajv (draft 2020-12, unknown keywords refused) compiles.
 */
export function readRegistry(readJson) {
  const document = readJson('v1.schema.json');
  const keyPattern = new RegExp(document.$defs.ElementType.pattern);
  const registry = readJson('element-types/registry.json');
  if (!Array.isArray(registry.types)) throw new Error('element-types/registry.json must list types');
  const ajv = new Ajv2020({ allErrors: false, logger: false });
  const seen = new Set();
  const entries = registry.types.map((entry) => {
    const { key, label, schema, testOnly, ...rest } = entry ?? {};
    if (typeof key !== 'string' || typeof label !== 'string' || typeof schema !== 'string') {
      throw new Error('Every element type needs a key, a label and a schema file');
    }
    if (label.trim() === '') throw new Error(`Element type "${key}" needs a label`);
    if (!SCHEMA_FILE.test(schema)) {
      throw new Error(`Element type "${key}": its schema is a file name in element-types/, such as "${key}.schema.json"`);
    }
    if (Object.keys(rest).length > 0) {
      throw new Error(`Element type "${key}" has unknown fields: ${Object.keys(rest).join(', ')}`);
    }
    if (testOnly !== undefined && typeof testOnly !== 'boolean') throw new Error(`"${key}": testOnly is a boolean`);
    if (!keyPattern.test(key)) throw new Error(`Element type "${key}" does not match the document's ElementType pattern`);
    if (seen.has(key)) throw new Error(`Element type "${key}" is registered twice`);
    seen.add(key);
    const props = readJson(`element-types/${schema}`);
    if (props?.type !== 'object' || props.additionalProperties !== false) {
      throw new Error(`${schema}: props are an object with "additionalProperties": false (R14)`);
    }
    const properties = props.properties ?? {};
    for (const name of props.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(properties, name)) {
        throw new Error(`${schema}: "${name}" is required but not among its properties`);
      }
    }
    try {
      ajv.compile(props);
    } catch (err) {
      throw new Error(`${schema}: ${err.message}`);
    }
    return { key, label, schema: props, testOnly: testOnly === true };
  });
  const strip = ({ key, label, schema }) => ({ key, label, schema });
  return {
    document,
    types: entries.filter((t) => !t.testOnly).map(strip),
    testTypes: entries.filter((t) => t.testOnly).map(strip),
  };
}
