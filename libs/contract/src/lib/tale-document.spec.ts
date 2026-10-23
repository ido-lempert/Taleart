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
  firstStrongDirection,
  readingOrder,
  READING_ROW_MAX_HEIGHT,
  sameReadingRow,
  taleReadingDirection,
  elementBounds,
  isOutsideSafeArea,
  safeAreaBounds,
  TALE_DOCUMENT_V1_SCHEMA,
  TALE_DOCUMENT_VERSION,
  TALE_ELEMENT_TYPE_REGISTRY,
  TALE_TEST_ELEMENT_TYPES,
  TALE_SAFE_AREA,
  type TaleElementType,
} from '../index';

const dir = join(__dirname, '../../tale-document');
const readJson = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));

describe('tale document schemas', () => {
  it('match the JSON Schema files they are generated from', () => {
    expect(TALE_DOCUMENT_V1_SCHEMA).toEqual(readJson('v1.schema.json'));
    const registry = readJson('element-types/registry.json') as {
      types: { key: string; label: string; schema: string; testOnly?: boolean }[];
    };
    const entry = ({ key, label, schema }: { key: string; label: string; schema: string }) => ({
      key,
      label,
      schema: readJson(join('element-types', schema)),
    });
    expect(TALE_ELEMENT_TYPE_REGISTRY).toEqual(registry.types.filter((t) => !t.testOnly).map(entry));
    expect(TALE_TEST_ELEMENT_TYPES).toEqual(registry.types.filter((t) => t.testOnly).map(entry));
  });

  it('register exactly the element types the TypeScript union holds', () => {
    const keys: TaleElementType[] = [
      'text',
      'image',
      'video',
      'shape',
      'emoji',
      'sticker',
      'button',
      'image-button',
      'swipe-up',
      'poll',
      'rating',
    ];
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

  describe('readingOrder (AD-15, R12)', () => {
    const el = (id: string, x: number, y: number, w = 0.2, h = 0.05, rotation = 0, type = 'shape') => ({
      id,
      type,
      box: { x, y, w, h, rotation },
      props: {},
    });
    const text = (id: string, x: number, y: number, value: string, direction?: string) => ({
      id,
      type: 'text',
      box: { x, y, w: 0.3, h: 0.05, rotation: 0 },
      props: { text: value, ...(direction && { direction }) },
    });
    const ids = (list: { id: string }[]) => list.map((e) => e.id);

    it('reads a row placed a few pixels off as one row, left to right', () => {
      // The right one sits 1 % higher than the left one: their boxes overlap, so one row.
      const order = readingOrder([el('title', 0.1, 0.1), el('right', 0.6, 0.39), el('left', 0.1, 0.4)]);
      expect(ids(order)).toEqual(['title', 'left', 'right']);
    });

    it('puts centre-aligned elements of different heights in one row', () => {
      // A tall image (0.3 to 0.7) and a short text centred beside it (0.48 to 0.52).
      const order = readingOrder([el('text', 0.6, 0.48, 0.3, 0.04), el('image', 0.05, 0.3, 0.4, 0.4)]);
      expect(ids(order)).toEqual(['image', 'text']);
      expect(sameReadingRow({ y: 0.3, h: 0.4 }, { y: 0.48, h: 0.04 })).toBe(true);
    });

    it('rows by overlap, not by a fixed distance: 1.5 % apart without overlap is two rows, 3 % apart overlapping is one', () => {
      // Thin lines whose tops are 1.5 % apart do not overlap: two rows, read top first.
      expect(ids(readingOrder([el('lower', 0.0, 0.415, 0.3, 0.01), el('upper', 0.6, 0.4, 0.3, 0.01)]))).toEqual([
        'upper',
        'lower',
      ]);
      // Taller boxes whose tops are 3 % apart overlap by more than half: one row, left first.
      expect(ids(readingOrder([el('right', 0.6, 0.4, 0.3, 0.1), el('left', 0.0, 0.43, 0.3, 0.1)]))).toEqual([
        'left',
        'right',
      ]);
      expect(sameReadingRow({ y: 0.4, h: 0.01 }, { y: 0.415, h: 0.01 })).toBe(false);
    });

    it('reads a backdrop taller than half the canvas as a row of its own, at its top', () => {
      expect(READING_ROW_MAX_HEIGHT).toBe(0.5);
      const order = readingOrder([
        el('backdrop', 0, 0, 1, 1),
        el('low', 0.1, 0.7),
        el('right', 0.6, 0.2),
        el('left', 0.1, 0.2),
      ]);
      expect(ids(order)).toEqual(['backdrop', 'left', 'right', 'low']);
    });

    it('anchors a row on its first element, so rows do not chain down the canvas', () => {
      // b overlaps a; c overlaps b but not a: c starts its own row.
      const order = readingOrder([el('c', 0.0, 0.47, 0.2, 0.1), el('b', 0.3, 0.43, 0.2, 0.1), el('a', 0.6, 0.4, 0.2, 0.1)]);
      expect(ids(order)).toEqual(['b', 'a', 'c']);
    });

    it('reads a row of a right-to-left tale from the right, by right edges', () => {
      const order = readingOrder(
        [text('t', 0.6, 0.1, 'שלום'), el('left', 0.05, 0.4, 0.3), el('right', 0.6, 0.4, 0.3), el('wide', 0.2, 0.41, 0.7)],
      );
      // Right edges: right 0.9, wide 0.9 (tie: z-order, lower first), left 0.35.
      expect(ids(order)).toEqual(['t', 'right', 'wide', 'left']);
    });

    it("takes the direction from the tale's texts, never the page: majority, then the first text", () => {
      const row = [el('a', 0.05, 0.6), el('b', 0.6, 0.6)];
      // An English tale reads left to right, whatever page shows it.
      expect(taleReadingDirection([text('t', 0.1, 0.1, 'Summer sale'), ...row])).toBe('ltr');
      expect(ids(readingOrder([text('t', 0.1, 0.1, 'Summer sale'), ...row]))).toEqual(['t', 'a', 'b']);
      // A Hebrew tale, English words inside it included, reads right to left.
      const hebrew = [text('t', 0.1, 0.1, 'מבצע: 50% off'), text('u', 0.1, 0.2, 'קיץ'), ...row];
      expect(taleReadingDirection(hebrew)).toBe('rtl');
      expect(ids(readingOrder(hebrew))).toEqual(['t', 'u', 'b', 'a']);
      // A set direction wins over the first strong character.
      expect(taleReadingDirection([text('t', 0.1, 0.1, 'Sale 50%', 'rtl')])).toBe('rtl');
      // A tie: the first text (top, then left) decides; hidden texts do not count.
      expect(taleReadingDirection([text('t', 0.1, 0.5, 'Sale'), text('u', 0.5, 0.1, 'מבצע')])).toBe('rtl');
      expect(taleReadingDirection([{ ...text('t', 0.1, 0.1, 'מבצע'), hidden: true }, text('u', 0.1, 0.5, 'Sale')])).toBe(
        'ltr',
      );
      // No letters, or no texts: left to right (AD-15).
      expect(taleReadingDirection([text('t', 0.1, 0.1, '50% 🎉')])).toBe('ltr');
      expect(taleReadingDirection(row)).toBe('ltr');
      expect(firstStrongDirection('123 שלום')).toBe('rtl');
      expect(firstStrongDirection('مرحبا')).toBe('rtl');
      expect(firstStrongDirection('«Hi»')).toBe('ltr');
      expect(firstStrongDirection('')).toBeNull();
    });

    it('keeps the z-order, bottom first, for elements at the same place, and reads a row by left edge, then top', () => {
      expect(ids(readingOrder([el('under', 0.2, 0.2), el('over', 0.2, 0.2)]))).toEqual(['under', 'over']);
      expect(ids(readingOrder([el('under', 0.2, 0.2), el('over', 0.2, 0.2)], 'rtl'))).toEqual(['under', 'over']);
      // Two texts stacked beside a tall image: the image's row holds both, the upper first.
      const order = readingOrder([el('second', 0.6, 0.5, 0.3, 0.05), el('first', 0.6, 0.3, 0.3, 0.05), el('image', 0.05, 0.3, 0.4, 0.4)]);
      expect(ids(order)).toEqual(['image', 'first', 'second']);
    });

    it('places a rotated box by where it shows, and the swipe-up link at the bottom whatever its box', () => {
      // A wide box turned 90 degrees shows much higher than its stored top (0.5): from about 0.38.
      const turned = el('turned', 0.3, 0.5, 0.5, 0.05, 90);
      // Above it, a short element is a row of its own.
      expect(ids(readingOrder([el('flat', 0.1, 0.32), turned]))).toEqual(['flat', 'turned']);
      // Beside it, its upright bounds (from x 0.51) put it left of an element at 0.7.
      expect(ids(readingOrder([el('flat', 0.7, 0.45), turned]))).toEqual(['turned', 'flat']);
      const swipe = el('swipe', 0.2, 0.0, 0.6, 0.09, 0, 'swipe-up');
      expect(ids(readingOrder([swipe, el('text', 0.1, 0.5), el('button', 0.3, 0.8, 0.4, 0.06, 0, 'button')]))).toEqual([
        'text',
        'button',
        'swipe',
      ]);
    });
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
