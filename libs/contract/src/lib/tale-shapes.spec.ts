import Ajv2020 from 'ajv/dist/2020';
import {
  assertEmojiCheckSupported,
  documentMediaRefs,
  elementName,
  emojiFontSize,
  isEmojiGlyph,
  isMediaElement,
  MAX_EMOJI_LENGTH,
  MAX_SHAPE_RADIUS,
  MAX_STROKE_WIDTH,
  mediaElementName,
  missingAltText,
  NEW_EMOJI_BOX,
  NEW_LINE_BOX,
  NEW_SHAPE_BOX,
  NEW_STICKER_BOX,
  newShapeProps,
  isOutsideSafeArea,
  resolveDocumentMedia,
  resolveShapeStyle,
  SHAPE_KINDS,
  TALE_ELEMENT_TYPE_REGISTRY,
  textBackdropAt,
  type TaleDocument,
} from '../index';

type Schema = { [key: string]: unknown };
const schemaOf = (key: string) => TALE_ELEMENT_TYPE_REGISTRY.find((t) => t.key === key)?.schema as Schema;
const ajv = new Ajv2020();
const validate = (key: string) => ajv.compile(schemaOf(key));

const STICKER = 'media/0b7c9d4e-1111-4222-8333-944455556666.png';

const element = (type: string, props: unknown, extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  type,
  box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8, rotation: 0 },
  hidden: false,
  locked: false,
  a11y: {},
  props,
  ...extra,
});

describe('shape schema', () => {
  const shape = validate('shape');

  it('states the contract values', () => {
    const props = schemaOf('shape')['properties'] as Record<string, Schema>;
    expect(props['shape']['enum']).toEqual(SHAPE_KINDS);
    expect(props['strokeWidth']['maximum']).toBe(MAX_STROKE_WIDTH);
    expect(props['radius']['maximum']).toBe(MAX_SHAPE_RADIUS);
    expect(schemaOf('shape')['additionalProperties']).toBe(false);
  });

  it('accepts a rounded rectangle, an ellipse, a line and every new shape', () => {
    expect(shape({ shape: 'rectangle', fill: '#ff000080', stroke: '#000000', strokeWidth: 0.01, radius: 0.05 })).toBe(
      true,
    );
    expect(shape({ shape: 'ellipse', fill: '#00ff00', opacity: 0.5 })).toBe(true);
    expect(shape({ shape: 'line', stroke: '#ffffff', strokeWidth: 0.004 })).toBe(true);
    for (const kind of SHAPE_KINDS) expect(shape(newShapeProps(kind))).toBe(true);
  });

  it.each([
    ['an unknown shape', { shape: 'star' }],
    ['a named colour', { shape: 'rectangle', fill: 'red' }],
    ['CSS in a colour', { shape: 'rectangle', fill: '#fff;background:url(x)' }],
    ['a radius on an ellipse', { shape: 'ellipse', radius: 0.1 }],
    ['a fill on a line', { shape: 'line', stroke: '#ffffff', strokeWidth: 0.01, fill: '#000000' }],
    ['a line without a stroke', { shape: 'line', strokeWidth: 0.01 }],
    ['a line of no width', { shape: 'line', stroke: '#ffffff', strokeWidth: 0 }],
    ['a stroke too wide', { shape: 'rectangle', stroke: '#ffffff', strokeWidth: 0.2 }],
    ['an opacity over 1', { shape: 'rectangle', opacity: 1.5 }],
    ['SVG markup', { shape: 'rectangle', svg: '<svg onload="x()"/>' }],
  ])('refuses %s', (_, props) => {
    expect(shape(props)).toBe(false);
  });
});

describe('emoji and sticker schemas', () => {
  it('hold one emoji, and a PNG, WebP or GIF key', () => {
    const emoji = validate('emoji');
    expect(emoji({ emoji: '😀' })).toBe(true);
    expect(emoji({ emoji: '' })).toBe(false);
    expect(emoji({ emoji: '😀', url: 'https://cdn.example/x.png' })).toBe(false);
    expect((schemaOf('emoji')['properties'] as Record<string, Schema>)['emoji']['maxLength']).toBe(MAX_EMOJI_LENGTH);
    const sticker = validate('sticker');
    for (const ext of ['png', 'webp', 'gif']) expect(sticker({ mediaKey: `media/abc.${ext}` })).toBe(true);
    for (const ext of ['jpg', 'mp4', 'webm']) expect(sticker({ mediaKey: `media/abc.${ext}` })).toBe(false);
    expect(sticker({ mediaKey: STICKER, fit: 'cover' })).toBe(false);
    expect(sticker({ mediaKey: 'https://cdn.example/x.png' })).toBe(false);
  });
});

describe('isEmojiGlyph', () => {
  it.each(['😀', '👩🏽‍💻', '🇮🇱', '❤️', '1️⃣', '👍🏽', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'])('accepts %s', (value) => {
    expect(isEmojiGlyph(value)).toBe(true);
  });

  it.each(['', 'abc', '😀😀', '<b>', '😀‮', '#', ' 😀', 42, null])('refuses %j', (value) => {
    expect(isEmojiGlyph(value)).toBe(false);
  });

  it(`refuses more than ${MAX_EMOJI_LENGTH} code units, even a valid-looking start`, () => {
    expect(isEmojiGlyph('😀'.repeat(MAX_EMOJI_LENGTH))).toBe(false);
    expect(isEmojiGlyph(`👍🏽${'‍'.repeat(MAX_EMOJI_LENGTH)}`)).toBe(false);
  });

  describe('on a runtime without the RegExp v flag', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.resetModules();
    });

    async function withoutVFlag() {
      const Native = RegExp;
      vi.stubGlobal(
        'RegExp',
        new Proxy(Native, {
          construct(target, args: [string, string?]) {
            if (args[1]?.includes('v')) throw new SyntaxError('Invalid flags supplied to RegExp constructor');
            return new target(...args);
          },
        }),
      );
      vi.resetModules();
      return import('./tale-document');
    }

    it('fails closed with a clear error, never a looser check', async () => {
      const contract = await withoutVFlag();
      expect(() => contract.assertEmojiCheckSupported()).toThrow(contract.EmojiCheckUnsupportedError);
      expect(() => contract.assertEmojiCheckSupported()).toThrow(/Node\.js 22 or later/);
      expect(() => contract.isEmojiGlyph('😀')).toThrow(contract.EmojiCheckUnsupportedError);
    });

    it('refuses an over-long value before the pattern runs', async () => {
      const contract = await withoutVFlag();
      expect(contract.isEmojiGlyph('😀'.repeat(MAX_EMOJI_LENGTH))).toBe(false);
      expect(contract.isEmojiGlyph('')).toBe(false);
    });
  });

  it('is supported on this runtime', () => {
    expect(() => assertEmojiCheckSupported()).not.toThrow();
  });
});

describe('elementName', () => {
  it('names every element as the studio and refusals do', () => {
    const elements = [
      element('text', { text: '  Big   sale ' }),
      element('text', { text: '' }),
      element('shape', { shape: 'rectangle' }),
      element('shape', { shape: 'ellipse' }),
      element('shape', { shape: 'rectangle' }),
      element('shape', { shape: 'line' }, { a11y: { label: 'Divider' } }),
      element('emoji', { emoji: '🎉' }, { a11y: { label: 'party popper' } }),
      element('emoji', { emoji: '😀' }),
      element('sticker', { mediaKey: STICKER }),
      element('image', { mediaKey: STICKER, fit: 'cover' }, { a11y: { label: 'A cat' } }),
      element('shape', { shape: 'constructor' }),
      element('future-widget', {}),
    ];
    expect(elements.map((_, i) => elementName(elements, i))).toEqual([
      'Big sale',
      'Empty text',
      'Rectangle 1',
      'Ellipse 1',
      'Rectangle 2',
      'Divider',
      '🎉 party popper',
      '😀',
      'Sticker 1',
      'A cat',
      'Shape 1',
      'Layer 12',
    ]);
  });
});

describe('resolveShapeStyle', () => {
  it('reads every value', () => {
    expect(
      resolveShapeStyle({
        shape: 'rectangle',
        fill: '#112233',
        stroke: '#445566',
        strokeWidth: 0.01,
        radius: 0.1,
        opacity: 0.5,
      }),
    ).toEqual({ shape: 'rectangle', fill: '#112233', stroke: '#445566', strokeWidth: 0.01, radius: 0.1, opacity: 0.5 });
  });

  it('checks every value again and falls back', () => {
    expect(resolveShapeStyle({ shape: 'circle' })).toBeNull();
    expect(resolveShapeStyle(null)).toBeNull();
    expect(
      resolveShapeStyle({ shape: 'ellipse', fill: 'url(x)', stroke: 'red', strokeWidth: 9, radius: 0.2, opacity: -1 }),
    ).toEqual({ shape: 'ellipse', fill: null, stroke: null, strokeWidth: 0, radius: 0, opacity: 1 });
    expect(resolveShapeStyle({ shape: 'line', fill: '#ffffff', stroke: '#000000', strokeWidth: Infinity })).toEqual({
      shape: 'line',
      fill: null,
      stroke: '#000000',
      strokeWidth: 0,
      radius: 0,
      opacity: 1,
    });
  });
});

describe('new shapes, emoji and stickers', () => {
  it('go inside the safe areas, emoji and stickers in a square box', () => {
    for (const box of [NEW_SHAPE_BOX, NEW_LINE_BOX, NEW_EMOJI_BOX, NEW_STICKER_BOX]) {
      expect(isOutsideSafeArea(box)).toBe(false);
    }
    expect(NEW_EMOJI_BOX.w * 9).toBeCloseTo(NEW_EMOJI_BOX.h * 16);
    expect(NEW_STICKER_BOX.w * 9).toBeCloseTo(NEW_STICKER_BOX.h * 16);
  });

  it('size an emoji to the shorter side of its box', () => {
    expect(emojiFontSize({ w: 0.25, h: 0.140625 })).toBe('11.25cqh');
    expect(emojiFontSize({ w: 0.1, h: 0.5 })).toBe('4.5cqh');
    expect(emojiFontSize({ w: 1, h: 0.1 })).toBe('8cqh');
  });
});

describe('image stickers are media', () => {
  const doc = (elements: unknown[]) =>
    ({ version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements }) as TaleDocument;

  it('are referenced, named and resolved as media', () => {
    const sticker = element('sticker', { mediaKey: STICKER });
    const d = doc([element('shape', { shape: 'ellipse' }), element('emoji', { emoji: '😀' }), sticker]);
    expect(isMediaElement(sticker)).toBe(true);
    expect(isMediaElement({ type: 'shape' })).toBe(false);
    expect(documentMediaRefs(d)).toEqual([
      { key: STICKER, pointer: '/elements/2/props/mediaKey', kind: 'image', visible: true },
    ]);
    expect(mediaElementName(d.elements, 2)).toBe('Sticker 1');
    const delivered = resolveDocumentMedia(d, (key) => `https://cdn.example/${key}`);
    expect(delivered.elements[2]).toMatchObject({ props: { url: `https://cdn.example/${STICKER}` } });
    expect(delivered.elements[2].props).not.toHaveProperty('mediaKey');
    expect(resolveDocumentMedia(d, () => null).elements.map((e) => (e as { type: string }).type)).toEqual([
      'shape',
      'emoji',
    ]);
  });

  it('need alt text or the decorative mark to publish; shapes and emoji do not', () => {
    const shapes = [element('shape', { shape: 'ellipse' }), element('emoji', { emoji: '😀' })];
    expect(missingAltText(doc(shapes))).toBeNull();
    expect(missingAltText(doc([...shapes, element('sticker', { mediaKey: STICKER })]))).toEqual({
      index: 2,
      name: 'Sticker 1',
      type: 'sticker',
    });
    expect(missingAltText(doc([element('sticker', { mediaKey: STICKER }, { a11y: { decorative: true } })]))).toBeNull();
    expect(missingAltText(doc([element('sticker', { mediaKey: STICKER }, { hidden: true })]))).toBeNull();
  });
});

describe('textBackdropAt', () => {
  const base = { canvasColor: '#000000', overMedia: false };
  const text = (box = { x: 0.3, y: 0.3, w: 0.4, h: 0.1, rotation: 0 }) => element('text', { text: 'Hi' }, { box });
  const rect = (props: Record<string, unknown>, box = { x: 0.1, y: 0.2, w: 0.8, h: 0.3, rotation: 0 }) =>
    element('shape', { shape: 'rectangle', ...props }, { box });

  it('is the canvas with nothing below the text', () => {
    expect(textBackdropAt([text()], 0, base)).toEqual(base);
    expect(textBackdropAt([text(), rect({ fill: '#ffffff' })], 0, base)).toEqual(base);
  });

  it("is an opaque rectangle's fill when it covers the text", () => {
    expect(textBackdropAt([rect({ fill: '#FFFFFF' }), text()], 1, base)).toEqual({
      canvasColor: '#ffffff',
      overMedia: false,
    });
    // Over the tale's media too: the rectangle hides it.
    expect(textBackdropAt([rect({ fill: '#ffffff' }), text()], 1, { ...base, overMedia: true })).toEqual({
      canvasColor: '#ffffff',
      overMedia: false,
    });
  });

  it('draws a translucent rectangle over the canvas', () => {
    expect(textBackdropAt([rect({ fill: '#ffffff', opacity: 0.5 }), text()], 1, base).canvasColor).toBe('#808080');
    expect(textBackdropAt([rect({ fill: '#ffffff80' }), text()], 1, { ...base, overMedia: true }).overMedia).toBe(true);
  });

  it('cannot be known over media, emoji, other shapes or a part cover', () => {
    const unknown = { ...base, overMedia: true };
    expect(textBackdropAt([element('image', { mediaKey: STICKER, fit: 'cover' }), text()], 1, base)).toEqual(unknown);
    expect(textBackdropAt([element('emoji', { emoji: '😀' }), text()], 1, base)).toEqual(unknown);
    expect(textBackdropAt([element('shape', { shape: 'ellipse', fill: '#ffffff' }), text()], 1, base)).toEqual(unknown);
    const small = { x: 0.35, y: 0.3, w: 0.2, h: 0.1, rotation: 0 };
    expect(textBackdropAt([rect({ fill: '#ffffff' }, small), text()], 1, base)).toEqual(unknown);
    const turned = { x: 0.1, y: 0.2, w: 0.8, h: 0.3, rotation: 10 };
    expect(textBackdropAt([rect({ fill: '#ffffff' }, turned), text()], 1, base)).toEqual(unknown);
    // Rounded corners that reach into the text.
    const tight = { x: 0.3, y: 0.3, w: 0.4, h: 0.1, rotation: 0 };
    expect(textBackdropAt([rect({ fill: '#ffffff', radius: 0.05 }, tight), text()], 1, base)).toEqual(unknown);
  });

  it('skips hidden elements and shapes that draw nothing', () => {
    expect(textBackdropAt([element('emoji', { emoji: '😀' }, { hidden: true }), text()], 1, base)).toEqual(base);
    expect(textBackdropAt([rect({}), text()], 1, base)).toEqual(base);
  });
});
