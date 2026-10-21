import {
  compositeColor,
  DEFAULT_TEXT_STYLE,
  FONT_FAMILY_PATTERN,
  isLargeText,
  readTextFont,
  resolveTextStyle,
  SYSTEM_FONT_STACK_KEYS,
  SYSTEM_FONT_STACKS,
  TALE_ELEMENT_TYPE_REGISTRY,
  TEXT_COLOR_PATTERN,
  TEXT_LINE_HEIGHT_RANGE,
  TEXT_SIZE_PRESETS,
  TEXT_SIZE_RANGE,
  textContrast,
  textFontFamily,
  textSizePreset,
  type TextStyle,
} from '../index';

type Schema = { [key: string]: unknown };
const textSchema = TALE_ELEMENT_TYPE_REGISTRY.find((t) => t.key === 'text')?.schema as Schema;
const prop = (name: string) => (textSchema['properties'] as Record<string, Schema>)[name];

describe('text style schema', () => {
  it('states the same values and ranges as the contract helpers', () => {
    const font = prop('font')['properties'] as Record<string, Schema>;
    expect(font['stack']['enum']).toEqual(SYSTEM_FONT_STACK_KEYS);
    expect(prop('fallback')['enum']).toEqual(SYSTEM_FONT_STACK_KEYS);
    expect(font['family']['pattern']).toBe(FONT_FAMILY_PATTERN.source);
    expect(font['family']['maxLength']).toBe(200);
    expect(prop('size')).toMatchObject({ minimum: TEXT_SIZE_RANGE.min, maximum: TEXT_SIZE_RANGE.max });
    expect(prop('lineHeight')).toMatchObject({
      minimum: TEXT_LINE_HEIGHT_RANGE.min,
      maximum: TEXT_LINE_HEIGHT_RANGE.max,
    });
    expect(prop('color')['pattern']).toBe(TEXT_COLOR_PATTERN.source);
    expect(prop('backgroundColor')['pattern']).toBe(TEXT_COLOR_PATTERN.source);
    expect(prop('weight')['enum']).toEqual(['regular', 'medium', 'bold']);
    expect(prop('align')['enum']).toEqual(['start', 'center', 'end']);
    expect(prop('direction')['enum']).toEqual(['auto', 'rtl', 'ltr']);
    expect(prop('background')['enum']).toEqual(['none', 'box', 'highlight']);
    expect(textSchema['required']).toEqual(['text']);
    expect(textSchema['additionalProperties']).toBe(false);
  });

  it('keeps every preset inside the size range', () => {
    for (const size of Object.values(TEXT_SIZE_PRESETS)) {
      expect(size).toBeGreaterThanOrEqual(TEXT_SIZE_RANGE.min);
      expect(size).toBeLessThanOrEqual(TEXT_SIZE_RANGE.max);
    }
  });

  it('has system stacks that cannot leave a font-family declaration', () => {
    for (const key of SYSTEM_FONT_STACK_KEYS) expect(SYSTEM_FONT_STACKS[key]).toMatch(/^[A-Za-z0-9 ,"-]+$/);
  });
});

describe('resolveTextStyle', () => {
  it('fills a text without style with the defaults, the look before styling', () => {
    expect(resolveTextStyle({ text: 'Hi' })).toEqual(DEFAULT_TEXT_STYLE);
    expect(DEFAULT_TEXT_STYLE).toMatchObject({ size: 0.04, lineHeight: 1.25, color: '#ffffff', align: 'center' });
    expect(DEFAULT_TEXT_STYLE.direction).toBe('auto');
  });

  it('keeps every valid field', () => {
    const style: TextStyle = {
      font: { source: 'name', family: 'Inter' },
      fallback: 'serif',
      size: 0.12,
      weight: 'regular',
      italic: true,
      color: '#ff0000cc',
      align: 'start',
      direction: 'rtl',
      lineHeight: 1.6,
      background: 'highlight',
      backgroundColor: '#ffcc00',
    };
    expect(resolveTextStyle({ text: 'x', ...style })).toEqual(style);
  });

  it.each([
    ['font', { source: 'name', family: 'inherit' }],
    ['font', { source: 'name', family: 'x;color:red' }],
    ['font', { source: 'name', family: 'a'.repeat(201) }],
    ['font', { source: 'system', stack: 'fantasy' }],
    ['font', { source: 'system', stack: 'serif', family: 'Inter' }],
    ['font', { source: 'theme', stack: 'serif' }],
    ['font', { source: 'project' }],
    ['font', 'serif'],
    ['fallback', 'cursive'],
    ['size', 0],
    ['size', 0.005],
    ['size', 0.5],
    ['size', Number.NaN],
    ['size', 'big'],
    ['weight', 'heavy'],
    ['italic', 'yes'],
    ['color', 'red; background:url(x)'],
    ['color', 'red'],
    ['color', '#12345'],
    ['align', 'left'],
    ['direction', 'up'],
    ['lineHeight', 0.5],
    ['lineHeight', 4],
    ['background', 'gradient'],
    ['backgroundColor', 'url(x)'],
  ])('replaces an invalid %s (%j) with its default', (field, value) => {
    const resolved = resolveTextStyle({ text: 'x', [field]: value }) as unknown as Record<string, unknown>;
    expect(resolved[field]).toEqual((DEFAULT_TEXT_STYLE as unknown as Record<string, unknown>)[field]);
  });

  it('reads each font source', () => {
    expect(readTextFont({ source: 'system', stack: 'rounded' })).toEqual({ source: 'system', stack: 'rounded' });
    expect(readTextFont({ source: 'theme' })).toEqual({ source: 'theme' });
    expect(readTextFont({ source: 'name', family: '"Open Sans", Arial' })).toEqual({
      source: 'name',
      family: '"Open Sans", Arial',
    });
    expect(readTextFont(null)).toBeNull();
  });
});

describe('textFontFamily', () => {
  const sans = SYSTEM_FONT_STACKS.sans;
  const serif = SYSTEM_FONT_STACKS.serif;

  it('gives a system stack as it is', () => {
    expect(textFontFamily({ font: { source: 'system', stack: 'serif' }, fallback: 'sans' })).toBe(serif);
  });

  it('puts a named font before its fallback stack', () => {
    expect(textFontFamily({ font: { source: 'name', family: 'Inter' }, fallback: 'serif' })).toBe(`Inter, ${serif}`);
  });

  it("uses the theme's font, or the fallback when the theme sets none", () => {
    const style = { font: { source: 'theme' } as const, fallback: 'sans' as const };
    expect(textFontFamily(style, 'Georgia, serif')).toBe(`Georgia, serif, ${sans}`);
    expect(textFontFamily(style, null)).toBe(sans);
    expect(textFontFamily(style, 'x;color:red')).toBe(sans);
    expect(textFontFamily(style)).toBe(`var(--ta-font, ${sans}), ${sans}`);
  });
});

describe('text size presets', () => {
  it('names a preset size, else custom', () => {
    expect(textSizePreset(0.03)).toBe('small');
    expect(textSizePreset(0.04)).toBe('medium');
    expect(textSizePreset(0.06)).toBe('large');
    expect(textSizePreset(0.05)).toBe('custom');
  });
});

describe('textContrast', () => {
  const style = (over: Partial<TextStyle>): TextStyle => ({ ...DEFAULT_TEXT_STYLE, ...over });
  const black = { canvasColor: '#000000', overMedia: false };

  it('composites a translucent colour over an opaque one', () => {
    expect(compositeColor('#ffffff80', '#000000')).toBe('#808080');
    expect(compositeColor('#123456', '#ffffff')).toBe('#123456');
  });

  it('passes white on the black canvas', () => {
    const check = textContrast(style({}), black);
    expect(check).toMatchObject({ kind: 'ok', against: 'canvas' });
  });

  it('warns about white on a yellow box, with its ratio and minimum', () => {
    const check = textContrast(style({ size: 0.02, background: 'box', backgroundColor: '#ffff00' }), black);
    expect(check.kind).toBe('low');
    if (check.kind !== 'unknown') {
      expect(check.against).toBe('box');
      expect(check.minimum).toBe(4.5);
      expect(check.ratio).toBeCloseTo(1.07, 2);
    }
  });

  it('takes 3:1 for large text', () => {
    // #666666 on black is about 3.7:1, which large text passes and small text fails.
    expect(textContrast(style({ color: '#666666', size: 0.06 }), black)).toMatchObject({ kind: 'ok', minimum: 3 });
    expect(textContrast(style({ color: '#666666', size: 0.02 }), black)).toMatchObject({ kind: 'low', minimum: 4.5 });
    expect(isLargeText({ size: 0.03, weight: 'bold' })).toBe(true);
    expect(isLargeText({ size: 0.03, weight: 'regular' })).toBe(false);
  });

  it("cannot check text over the tale's media, unless an opaque box covers it", () => {
    const media = { canvasColor: '#000000', overMedia: true };
    expect(textContrast(style({}), media)).toEqual({ kind: 'unknown', reason: 'media' });
    expect(textContrast(style({ background: 'highlight', backgroundColor: '#00000080' }), media).kind).toBe('unknown');
    expect(textContrast(style({ background: 'highlight', backgroundColor: '#000000' }), media)).toMatchObject({
      kind: 'ok',
      against: 'highlight',
    });
  });

  it('draws a translucent canvas over the black stage and a translucent box over the canvas', () => {
    expect(textContrast(style({}), { canvasColor: '#ffffff00', overMedia: false }).kind).toBe('ok');
    const boxed = textContrast(style({ background: 'box', backgroundColor: '#ffffff00' }), {
      canvasColor: '#ffffff',
      overMedia: false,
    });
    expect(boxed).toMatchObject({ kind: 'low', against: 'box' });
  });
});
