import { elementTypeRegistry, TALE_ELEMENT_TYPE_REGISTRY } from '@taleart/contract';
import {
  checkPublishableDocument,
  checkTaleDocument,
  deliverableTaleDocument,
  draftProblem,
  InvalidTaleDocumentError,
  setTestElementTypesEnabled,
  testElementTypesEnabled,
} from './tale-document';

// Tale Studio story 7.8: the server takes exactly the element types of the registry (R8).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const badge = (props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id: id(1),
  type: 'test-badge',
  box: { x: 0.1, y: 0.2, w: 0.4, h: 0.08, rotation: 0 },
  hidden: false,
  locked: false,
  a11y: {},
  props: { label: 'New', color: '#FF0055', tone: 'solid', ...props },
  ...extra,
});
const doc = (elements: unknown[]) => ({
  version: 1,
  canvas: { background: { type: 'color', color: '#000000' } },
  elements,
});

function refused(value: unknown): InvalidTaleDocumentError {
  try {
    checkTaleDocument(value);
  } catch (err) {
    if (err instanceof InvalidTaleDocumentError) return err;
    throw err;
  }
  throw new Error('the document was accepted');
}

afterEach(() => setTestElementTypesEnabled(false));

describe('checkTaleDocument: the element-type registry (story 7.8)', () => {
  it('refuses a type the registry does not hold', () => {
    expect(refused(doc([badge({}, { type: 'future-widget' })])).pointer).toBe('/elements/0/type');
    expect(refused(doc([badge({}, { type: 'constructor' })])).pointer).toBe('/elements/0/type');
  });

  it('refuses the test-only type by default', () => {
    expect(testElementTypesEnabled()).toBe(false);
    const err = refused(doc([badge()]));
    expect(err.pointer).toBe('/elements/0/type');
    expect(err.message).toContain('"test-badge" is not a registered element type');
  });

  it('checks the test-only type against its registered schema once configured', () => {
    setTestElementTypesEnabled(true);
    expect(checkTaleDocument(doc([badge({ count: 7 })])).elements[0].props).toEqual({
      label: 'New',
      color: '#FF0055',
      tone: 'solid',
      count: 7,
    });
    expect(refused(doc([badge({ label: '' })])).pointer).toBe('/elements/0/props/label');
    expect(refused(doc([badge({ label: 'a'.repeat(41) })])).pointer).toBe('/elements/0/props/label');
    expect(refused(doc([badge({ label: 'a‮b' })])).pointer).toBe('/elements/0/props/label');
    expect(refused(doc([badge({ color: '#FF005' })])).pointer).toBe('/elements/0/props/color');
    expect(refused(doc([badge({ tone: 'glow' })])).pointer).toBe('/elements/0/props/tone');
    expect(refused(doc([badge({ count: 1.5 })])).pointer).toBe('/elements/0/props/count');
    expect(refused(doc([badge({ onclick: 'x' })])).pointer).toBe('/elements/0/props/onclick');
    // The document's own rules still apply to it.
    expect(refused(doc([badge({}, { box: { x: 2, y: 0, w: 0.1, h: 0.1, rotation: 0 } })])).pointer).toBe(
      '/elements/0/box/x',
    );
    // Publishing and delivery take it like any element, without the editor-only fields.
    const published = checkPublishableDocument(doc([badge()]));
    expect(deliverableTaleDocument(published)?.elements[0]).toEqual({
      id: id(1),
      type: 'test-badge',
      box: { x: 0.1, y: 0.2, w: 0.4, h: 0.08, rotation: 0 },
      a11y: {},
      props: { label: 'New', color: '#FF0055', tone: 'solid' },
    });
    expect(draftProblem(refused(doc([badge({ tone: 'glow' })])), doc([badge({ tone: 'glow' })]))).toBe(
      'Layer 1 has a setting that is not valid.',
    );
  });

  it('names a type the server does not take in a draft problem', () => {
    const value = doc([badge()]);
    expect(draftProblem(refused(value), value)).toBe("Layer 1 is a type this server doesn't take.");
    // Other refusals at /type keep their words.
    setTestElementTypesEnabled(true);
    const swipe = { label: 'Up', color: '#FFFFFF', background: '#000000B3' };
    const box = { x: 0.2, y: 0.87, w: 0.6, h: 0.09, rotation: 0 };
    const two = doc([badge({}, { type: 'swipe-up', props: swipe, box }), badge({}, { id: id(2), type: 'swipe-up', props: swipe, box })]);
    expect(draftProblem(refused(two), two)).toBe('"Up" has a setting that is not valid.');
  });

  it('delivers a stored test type only while the switch is on, the cache cleared on each switch', () => {
    const stored = doc([badge()]);
    setTestElementTypesEnabled(true);
    expect(deliverableTaleDocument(stored, 'tale-1:7')?.elements).toHaveLength(1);
    setTestElementTypesEnabled(false);
    expect(deliverableTaleDocument(stored, 'tale-1:7')).toBeNull();
    setTestElementTypesEnabled(true);
    expect(deliverableTaleDocument(stored, 'tale-1:7')?.elements).toHaveLength(1);
  });

  it('refuses it again once the switch is off', () => {
    setTestElementTypesEnabled(true);
    checkTaleDocument(doc([badge()]));
    setTestElementTypesEnabled(false);
    expect(refused(doc([badge()])).pointer).toBe('/elements/0/type');
  });

  it('compiles a validator for every registered type, and no other', () => {
    for (const { key } of TALE_ELEMENT_TYPE_REGISTRY) {
      // A props value of the wrong kind is refused by that type's own schema, so each one is registered.
      expect(refused(doc([badge({}, { type: key, props: [] })])).pointer).toBe('/elements/0/props');
    }
    setTestElementTypesEnabled(true);
    for (const { key } of elementTypeRegistry({ testTypes: true })) {
      expect(refused(doc([badge({}, { type: key, props: [] })])).pointer).toBe('/elements/0/props');
    }
  });
});
