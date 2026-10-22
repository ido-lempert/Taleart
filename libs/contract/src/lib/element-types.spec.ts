import Ajv2020 from 'ajv/dist/2020';
import {
  elementTypeEntry,
  elementTypeRegistry,
  propSchema,
  propValueProblem,
  TALE_DOCUMENT_V1_SCHEMA,
  TALE_DOCUMENT_VERSION,
  TALE_ELEMENT_TYPE_REGISTRY,
  TALE_TEST_ELEMENT_TYPES,
} from '../index';

const ajv = new Ajv2020();
const testBadge = TALE_TEST_ELEMENT_TYPES.find((t) => t.key === 'test-badge');
const validBadge = { label: 'New', color: '#FF0055', tone: 'solid', count: 3 };

describe('element-type registry (epic Tale Studio R8)', () => {
  it('keeps test-only types out of the default registry', () => {
    expect(elementTypeRegistry()).toBe(TALE_ELEMENT_TYPE_REGISTRY);
    expect(elementTypeRegistry().some((t) => t.key === 'test-badge')).toBe(false);
    expect(elementTypeEntry('test-badge')).toBeNull();
    expect(elementTypeEntry('button')?.label).toBe('Button');
  });

  it('adds the test types, after the others, when asked', () => {
    const keys = elementTypeRegistry({ testTypes: true }).map((t) => t.key);
    expect(keys).toEqual([...TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key), 'test-badge']);
    expect(elementTypeEntry('test-badge', { testTypes: true })?.label).toBe('Test badge');
  });

  it('registers keys the document schema accepts, each once, with closed props schemas', () => {
    const defs = TALE_DOCUMENT_V1_SCHEMA['$defs'] as Record<string, { pattern: string }>;
    const pattern = new RegExp(defs['ElementType'].pattern);
    const all = elementTypeRegistry({ testTypes: true });
    expect(new Set(all.map((t) => t.key)).size).toBe(all.length);
    for (const { key, schema } of all) {
      expect(pattern.test(key)).toBe(true);
      expect(schema['type']).toBe('object');
      expect(schema['additionalProperties']).toBe(false);
    }
  });

  it('adds a type without a document version change', () => {
    expect(TALE_DOCUMENT_VERSION).toBe(1);
    const validate = ajv.compile(TALE_DOCUMENT_V1_SCHEMA);
    const doc = {
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          type: 'test-badge',
          box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props: validBadge,
        },
      ],
    };
    expect(validate(doc)).toBe(true);
  });

  describe('the test badge schema', () => {
    const validate = ajv.compile(testBadge?.schema ?? {});

    it('accepts a valid badge, with or without a count', () => {
      expect(validate(validBadge)).toBe(true);
      expect(validate({ label: 'x', color: '#000000', tone: 'outline' })).toBe(true);
    });

    it.each([
      ['an empty label', { ...validBadge, label: '' }],
      ['a label of 41 characters', { ...validBadge, label: 'a'.repeat(41) }],
      ['a line feed in the label', { ...validBadge, label: 'a\nb' }],
      ['a bidi override in the label', { ...validBadge, label: 'a‮b' }],
      ['a colour that is not hex', { ...validBadge, color: 'red' }],
      ['a colour with alpha', { ...validBadge, color: '#FF0055AA' }],
      ['an unknown tone', { ...validBadge, tone: 'glow' }],
      ['a count of 100', { ...validBadge, count: 100 }],
      ['a fractional count', { ...validBadge, count: 1.5 }],
      ['an unknown prop', { ...validBadge, html: '<b>x</b>' }],
      ['no tone', { label: 'x', color: '#000000' }],
    ])('refuses %s', (_, props) => {
      expect(validate(props)).toBe(false);
    });
  });
});

describe('propValueProblem', () => {
  const schema = testBadge?.schema ?? {};
  const prop = (name: string) => {
    const found = propSchema(schema, name);
    if (!found) throw new Error(name);
    return found;
  };

  it('finds a prop and whether it is required', () => {
    expect(prop('label').required).toBe(true);
    expect(prop('count').required).toBe(false);
    expect(propSchema(schema, 'nope')).toBeNull();
    expect(propSchema(schema, 'constructor')).toBeNull();
  });

  it('agrees with the schema on every value it checks', () => {
    const validate = ajv.compile(schema);
    const samples: [string, unknown[]][] = [
      ['label', ['', 'a', 'a'.repeat(40), 'a'.repeat(41), '🎉'.repeat(40), 'a\tb', 'a‪b', 7]],
      ['color', ['#FFFFFF', '#ffffff', '#FFF', '#FFFFFFFF', 'red', '']],
      ['tone', ['solid', 'outline', 'glow', '']],
      ['count', [0, 99, 100, -1, 1.5, '3', Number.NaN]],
    ];
    for (const [name, values] of samples) {
      const { schema: s, required } = prop(name);
      for (const value of values) {
        const accepted = validate({ ...validBadge, [name]: value });
        expect({ name, value, ok: propValueProblem(s, value, required) === null }).toEqual({
          name,
          value,
          ok: accepted,
        });
      }
    }
  });

  it('says why in words', () => {
    expect(propValueProblem(prop('label').schema, '', true)).toBe('Enter some text.');
    expect(propValueProblem(prop('label').schema, 'a'.repeat(41), true)).toBe('Use at most 40 characters.');
    expect(propValueProblem(prop('tone').schema, 'glow', true)).toBe('Choose one of the options.');
    expect(propValueProblem(prop('count').schema, 100, false)).toBe('Enter a number from 0 to 99.');
    expect(propValueProblem(prop('count').schema, 1.5, false)).toBe('Enter a whole number.');
    expect(propValueProblem(prop('count').schema, undefined, false)).toBeNull();
    expect(propValueProblem(prop('label').schema, undefined, true)).toBe('This is required.');
    expect(propValueProblem({ type: 'boolean' }, 'yes', false)).toBe('Choose yes or no.');
  });
});
