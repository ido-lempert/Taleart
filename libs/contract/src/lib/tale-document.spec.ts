import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyTaleDocument,
  ErrorCodes,
  ERROR_CODES,
  hasTextControlCharacter,
  MAX_TALE_ELEMENTS,
  MAX_TEXT_LENGTH,
  NEW_TEXT_BOX,
  readingOrder,
  TALE_DOCUMENT_V1_SCHEMA,
  TALE_DOCUMENT_VERSION,
  TALE_ELEMENT_TYPE_REGISTRY,
  TALE_SAFE_AREA,
  textLength,
  type TaleElementType,
} from '../index';

const dir = join(__dirname, '../../tale-document');
const readJson = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));

describe('tale document schemas', () => {
  it('match the JSON Schema files they are generated from', () => {
    expect(TALE_DOCUMENT_V1_SCHEMA).toEqual(readJson('v1.schema.json'));
    const registry = readJson('element-types/registry.json') as {
      types: { key: string; label: string; schema: string }[];
    };
    expect(TALE_ELEMENT_TYPE_REGISTRY).toEqual(
      registry.types.map(({ key, label, schema }) => ({ key, label, schema: readJson(join('element-types', schema)) })),
    );
  });

  it('register exactly the element types the TypeScript union holds', () => {
    const keys: TaleElementType[] = ['text'];
    expect(TALE_ELEMENT_TYPE_REGISTRY.map((type) => type.key)).toEqual(keys);
  });

  it('use the limits the contract names', () => {
    const properties = TALE_DOCUMENT_V1_SCHEMA['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['version']['const']).toBe(TALE_DOCUMENT_VERSION);
    expect(properties['elements']['maxItems']).toBe(MAX_TALE_ELEMENTS);
    const text = TALE_ELEMENT_TYPE_REGISTRY[0].schema['properties'] as Record<string, Record<string, unknown>>;
    expect(text['text']['maxLength']).toBe(MAX_TEXT_LENGTH);
  });

  it('name the document error codes', () => {
    for (const code of [ErrorCodes.invalidTaleDocument, ErrorCodes.taleDocumentTooLarge, ErrorCodes.staleRevision]) {
      expect(ERROR_CODES).toContain(code);
    }
  });
});

describe('tale document helpers', () => {
  it('starts an empty version 1 document on black', () => {
    expect(emptyTaleDocument()).toEqual({
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [],
    });
  });

  it('places a new text box inside the safe areas', () => {
    expect(NEW_TEXT_BOX.y).toBeGreaterThanOrEqual(TALE_SAFE_AREA.top);
    expect(NEW_TEXT_BOX.y + NEW_TEXT_BOX.h).toBeLessThanOrEqual(1 - TALE_SAFE_AREA.bottom);
    expect(NEW_TEXT_BOX.x).toBeGreaterThanOrEqual(TALE_SAFE_AREA.side);
    expect(NEW_TEXT_BOX.x + NEW_TEXT_BOX.w).toBeLessThanOrEqual(1 - TALE_SAFE_AREA.side);
  });

  it('allows a line feed but no other control character in text', () => {
    expect(hasTextControlCharacter('Hello\nworld')).toBe(false);
    expect(hasTextControlCharacter('<b>x</b> é 😀')).toBe(false);
    for (const c of ['\u0000', '\t', '\r', '\u0007', '\u001b', '\u007f', '\u0085', '\u009f']) {
      expect(hasTextControlCharacter(`a${c}b`)).toBe(true);
    }
  });

  it('counts characters as code points', () => {
    expect(textLength('abc')).toBe(3);
    expect(textLength('😀😀')).toBe(2);
    expect(textLength('\ud800')).toBe(1);
  });

  it('orders elements top to bottom, then left to right, keeping z-order for ties', () => {
    const at = (id: string, x: number, y: number) => ({ id, box: { x, y } });
    const ordered = readingOrder([
      at('low', 0, 0.8),
      at('right', 0.5, 0.1),
      at('left', 0.1, 0.1),
      at('left2', 0.1, 0.1),
    ]);
    expect(ordered.map((e) => e.id)).toEqual(['left', 'left2', 'right', 'low']);
  });
});
