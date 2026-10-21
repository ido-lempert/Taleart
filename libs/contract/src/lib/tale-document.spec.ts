import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyTaleDocument,
  ErrorCodes,
  ERROR_CODES,
  cleanText,
  ELEMENT_TEXT_RULE,
  hasDisallowedCharacter,
  LABEL_TEXT_RULE,
  MAX_TALE_ELEMENTS,
  MAX_TEXT_LENGTH,
  NEW_TEXT_BOX,
  readingOrder,
  elementBounds,
  isOutsideSafeArea,
  safeAreaBounds,
  TALE_DOCUMENT_V1_SCHEMA,
  TALE_DOCUMENT_VERSION,
  TALE_ELEMENT_TYPE_REGISTRY,
  TALE_SAFE_AREA,
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
    const keys: TaleElementType[] = ['text', 'image', 'video'];
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

  it('allows a line feed in text but no other control character, and none in labels', () => {
    expect(hasDisallowedCharacter('Hello\nworld', ELEMENT_TEXT_RULE)).toBe(false);
    expect(hasDisallowedCharacter('Hello\nworld', LABEL_TEXT_RULE)).toBe(true);
    expect(hasDisallowedCharacter('<b>x</b> é 😀', ELEMENT_TEXT_RULE)).toBe(false);
    for (const c of ['\u0000', '\t', '\r', '\u0007', '\u001b', '\u007f', '\u0085', '\u009f']) {
      expect(hasDisallowedCharacter(`a${c}b`, ELEMENT_TEXT_RULE)).toBe(true);
      expect(hasDisallowedCharacter(`a${c}b`, LABEL_TEXT_RULE)).toBe(true);
    }
  });

  it('refuses lone surrogates and bidi embeddings and overrides', () => {
    for (const c of ['\ud800', '\udfff', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e']) {
      expect(hasDisallowedCharacter(`a${c}b`, ELEMENT_TEXT_RULE)).toBe(true);
    }
    expect(hasDisallowedCharacter('a\ud800', ELEMENT_TEXT_RULE)).toBe(true);
  });

  it('keeps right-to-left text, bidi marks and isolates, and emoji ZWJ sequences', () => {
    const allowed = [
      'שלום עולם',
      'مرحبا بالعالم',
      'a\u200eb\u200fc',
      '\u2066שלום\u2069 world \u2067x\u2068y\u2069',
      '👩‍👩‍👧‍👦 👍🏽 🏳️‍🌈',
      'می\u200cخواهم',
    ];
    for (const text of allowed) {
      expect(hasDisallowedCharacter(text, ELEMENT_TEXT_RULE)).toBe(false);
      expect(cleanText(text, ELEMENT_TEXT_RULE)).toBe(text);
    }
  });

  it('strips what it does not allow', () => {
    expect(cleanText('a\u0007b\nc\u202ed\ud800e', ELEMENT_TEXT_RULE)).toBe('ab\ncde');
    expect(cleanText('a\nb', LABEL_TEXT_RULE)).toBe('ab');
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

  it('names the safe part of the canvas from the safe-area constants', () => {
    const safe = safeAreaBounds();
    expect(safe.x).toBeCloseTo(0.04);
    expect(safe.y).toBeCloseTo(0.12);
    expect(safe.w).toBeCloseTo(0.92);
    expect(safe.h).toBeCloseTo(0.72);
  });

  it('measures a rotated box on the 9:16 canvas', () => {
    expect(elementBounds({ x: 0.1, y: 0.2, w: 0.5, h: 0.1, rotation: 0 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.1 });
    // A quarter turn swaps the box's true width and height: 0.5 × 9 = 4.5 units, 0.1 × 16 = 1.6 units.
    const turned = elementBounds({ x: 0.25, y: 0.45, w: 0.5, h: 0.1, rotation: 90 });
    expect(turned.w).toBeCloseTo(1.6 / 9);
    expect(turned.h).toBeCloseTo(4.5 / 16);
    expect(turned.x + turned.w / 2).toBeCloseTo(0.5);
    expect(turned.y + turned.h / 2).toBeCloseTo(0.5);
    expect(elementBounds({ x: 0.25, y: 0.45, w: 0.5, h: 0.1, rotation: -90 }).h).toBeCloseTo(4.5 / 16);
  });

  it('warns about an element that reaches outside the safe areas, rotation included', () => {
    const box = { x: 0.1, y: 0.42, w: 0.8, h: 0.16, rotation: 0 };
    expect(isOutsideSafeArea(box)).toBe(false);
    expect(isOutsideSafeArea(NEW_TEXT_BOX)).toBe(false);
    // On the edges exactly: inside.
    expect(isOutsideSafeArea({ x: 0.04, y: 0.12, w: 0.92, h: 0.72, rotation: 0 })).toBe(false);
    expect(isOutsideSafeArea({ ...box, y: 0.75 })).toBe(true); // into the bottom 16%
    expect(isOutsideSafeArea({ ...box, y: 0.1 })).toBe(true); // into the top 12%
    expect(isOutsideSafeArea({ ...box, x: 0.02 })).toBe(true); // into a side
    expect(isOutsideSafeArea({ ...box, x: 0.18, w: 0.8 })).toBe(true);
    // Upright it fits; turned, its corners reach up into the top area.
    expect(isOutsideSafeArea({ x: 0.1, y: 0.13, w: 0.8, h: 0.05, rotation: 0 })).toBe(false);
    expect(isOutsideSafeArea({ x: 0.1, y: 0.13, w: 0.8, h: 0.05, rotation: 20 })).toBe(true);
  });
});
