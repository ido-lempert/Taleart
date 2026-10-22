// Tale Studio story 7.8 (R8): the checks contract:generate runs on the element-type registry.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRegistry } from '../../scripts/tale-document-registry.mjs';
import { TALE_ELEMENT_TYPE_REGISTRY, TALE_TEST_ELEMENT_TYPES } from '../generated/tale-document-schemas';

const dir = join(import.meta.dirname, '../../tale-document');
const real = (file) => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const closed = { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } };

// A registry of the given entries and schema files, over the real document schema.
function fake(types, schemas = { 'poll.schema.json': closed }) {
  return (file) => {
    if (file === 'v1.schema.json') return real(file);
    if (file === 'element-types/registry.json') return { types };
    const name = file.replace('element-types/', '');
    if (!(name in schemas)) throw new Error(`no file ${file}`);
    return schemas[name];
  };
}
const poll = { key: 'poll', label: 'Poll', schema: 'poll.schema.json' };

describe('the registry generator', () => {
  it('reads the real registry as generated', () => {
    const { types, testTypes } = readRegistry(real);
    expect(types).toEqual(TALE_ELEMENT_TYPE_REGISTRY);
    expect(testTypes).toEqual(TALE_TEST_ELEMENT_TYPES);
  });

  it('splits test-only entries off', () => {
    const { types, testTypes } = readRegistry(fake([poll, { ...poll, key: 'quiz', testOnly: true }]));
    expect(types.map((t) => t.key)).toEqual(['poll']);
    expect(testTypes.map((t) => t.key)).toEqual(['quiz']);
  });

  it.each([
    ['no label', [{ ...poll, label: undefined }], 'needs a key, a label and a schema file'],
    ['an empty label', [{ ...poll, label: '  ' }], 'needs a label'],
    ['a schema outside element-types/', [{ ...poll, schema: '../v1.schema.json' }], 'a file name in element-types/'],
    ['a schema in a folder', [{ ...poll, schema: 'x/poll.schema.json' }], 'a file name in element-types/'],
    ['an unknown field', [{ ...poll, renderer: 'x' }], 'unknown fields: renderer'],
    ['testOnly that is not a boolean', [{ ...poll, testOnly: 'yes' }], 'testOnly is a boolean'],
    ['a key the document refuses', [{ ...poll, key: 'Poll' }], 'ElementType pattern'],
    ['a key twice', [poll, poll], 'registered twice'],
  ])('refuses %s', (_, types, message) => {
    expect(() => readRegistry(fake(types))).toThrow(message);
  });

  it.each([
    ['an open schema', { ...closed, additionalProperties: true }, 'additionalProperties'],
    ['a schema that is not an object', { type: 'string' }, 'props are an object'],
    ['a required prop it does not have', { ...closed, required: ['b'] }, '"b" is required but not among its properties'],
    ['a schema Ajv does not compile', { ...closed, properties: { a: { type: 'strng' } } }, 'poll.schema.json:'],
    ['an unknown keyword', { ...closed, properties: { a: { type: 'string', maxLenght: 3 } } }, 'poll.schema.json:'],
  ])('refuses %s', (_, schema, message) => {
    expect(() => readRegistry(fake([poll], { 'poll.schema.json': schema }))).toThrow(message);
  });
});
