import {
  compositeColor,
  CONTRAST_CANVAS_HEIGHT_PX,
  cssFontFamilyList,
  textCssWeight,
  DEFAULT_TEXT_STYLE,
  FONT_FAMILY_PATTERN,
  isLargeText,
  MEDIA_CONTRAST_PERCENTILE,
  MEDIA_CONTRAST_STRIPS,
  isOffCanvas,
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
    expect(font['source']['enum']).toEqual(['system', 'theme', 'name', 'project']);
    expect(new RegExp(font['fontId']['pattern'] as string).test('0f0e0d0c-0000-4000-8000-00000000000a')).toBe(true);
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
  it('fills a text without style with the defaults, the look before styling, keeping its old weight', () => {
    expect(resolveTextStyle({ text: 'Hi' })).toEqual({ ...DEFAULT_TEXT_STYLE, weight: null });
    expect(textCssWeight(null)).toBe(600);
    expect(textCssWeight('bold')).toBe(700);
    // A new text stores its weight explicitly.
    expect(DEFAULT_TEXT_STYLE.weight).toBe('bold');
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
    ['font', { source: 'project' }],
    ['font', 'serif'],
    ['fallback', 'cursive'],
    ['size', 0],
    ['size', 0.005],
    ['size', 0.5],
    ['size', Number.NaN],
    ['size', 'big'],
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

  it('keeps the old weight for an invalid one', () => {
    expect(resolveTextStyle({ text: 'x', weight: 'heavy' }).weight).toBeNull();
  });

  it('reads fonts forward compatibly: unknown keys are ignored, an unknown source draws in the fallback', () => {
    expect(readTextFont({ source: 'system', stack: 'serif', family: 'Inter' })).toEqual({
      source: 'system',
      stack: 'serif',
    });
    expect(readTextFont({ source: 'theme', weightAxis: 400 })).toEqual({ source: 'theme' });
    expect(readTextFont({ source: 'project', fontId: 'f1' }, 'serif')).toEqual({ source: 'system', stack: 'serif' });
    expect(readTextFont({ source: 'project', fontId: 'f1' }, 'cursive')).toBeNull();
    expect(
      resolveTextStyle({ text: 'x', font: { source: 'project', fontId: 'f1' }, fallback: 'rounded' }).font,
    ).toEqual({ source: 'system', stack: 'rounded' });
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

  it('reads a project font by its id, in lower case (story 7.17)', () => {
    const id = '0F0E0D0C-0000-4000-8000-00000000000A';
    expect(readTextFont({ source: 'project', fontId: id })).toEqual({ source: 'project', fontId: id.toLowerCase() });
    expect(resolveTextStyle({ text: 'x', font: { source: 'project', fontId: id, family: 'x' } }).font).toEqual({
      source: 'project',
      fontId: id.toLowerCase(),
    });
  });
});

describe('textFontFamily with a project font', () => {
  it('draws it under its alias, quoted, before the fallback stack; never under its family name', () => {
    const fontId = '0f0e0d0c-0000-4000-8000-00000000000a';
    expect(textFontFamily({ font: { source: 'project', fontId }, fallback: 'serif' })).toBe(
      `"taleart-font-${fontId}", ${SYSTEM_FONT_STACKS.serif}`,
    );
    // An id that is not one never reaches CSS.
    expect(textFontFamily({ font: { source: 'project', fontId: '"x"; color: red' }, fallback: 'sans' })).toBe(
      SYSTEM_FONT_STACKS.sans,
    );
  });
});

describe('textFontFamily', () => {
  const sans = SYSTEM_FONT_STACKS.sans;
  const serif = SYSTEM_FONT_STACKS.serif;

  it('gives a system stack as it is', () => {
    expect(textFontFamily({ font: { source: 'system', stack: 'serif' }, fallback: 'sans' })).toBe(serif);
  });

  it('puts a named font, quoted, before its fallback stack', () => {
    expect(textFontFamily({ font: { source: 'name', family: 'Inter' }, fallback: 'serif' })).toBe(`"Inter", ${serif}`);
    expect(textFontFamily({ font: { source: 'name', family: 'Source Sans 3' }, fallback: 'serif' })).toBe(
      `"Source Sans 3", ${serif}`,
    );
  });

  it('quotes each name of a list, keeps generic families bare, and normalises quotes', () => {
    expect(cssFontFamilyList('Source Sans 3')).toBe('"Source Sans 3"');
    expect(cssFontFamilyList('Noto Sans 3D, A - B')).toBe('"Noto Sans 3D", "A - B"');
    expect(cssFontFamilyList(`'Open Sans',  Arial ,sans-serif`)).toBe('"Open Sans", "Arial", sans-serif');
    expect(cssFontFamilyList('Georgia, Serif, system-ui, "serif"')).toBe('"Georgia", Serif, system-ui, "serif"');
  });

  it("uses the theme's font, quoted, or the fallback when the theme sets none", () => {
    const style = { font: { source: 'theme' } as const, fallback: 'sans' as const };
    expect(textFontFamily(style, 'Georgia, serif')).toBe(`"Georgia", serif, ${sans}`);
    expect(textFontFamily(style, 'Source Sans 3')).toBe(`"Source Sans 3", ${sans}`);
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
    // On the 540 px reference canvas: 24 px is large from 4.45 %, 18.67 px bold from 3.46 %.
    expect(CONTRAST_CANVAS_HEIGHT_PX).toBe(540);
    expect(isLargeText({ size: 0.045, weight: 'regular' })).toBe(true);
    expect(isLargeText({ size: 0.044, weight: 'regular' })).toBe(false);
    expect(isLargeText({ size: 0.035, weight: 'bold' })).toBe(true);
    expect(isLargeText({ size: 0.034, weight: 'bold' })).toBe(false);
    // The medium preset (4 %, 21.6 px) is large only when bold; text kept at the old 600 is not bold.
    expect(isLargeText({ size: 0.04, weight: 'bold' })).toBe(true);
    expect(isLargeText({ size: 0.04, weight: null })).toBe(false);
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

  it('warns about light grey on white and clears when the colour darkens (the story check)', () => {
    const white = { canvasColor: '#ffffff', overMedia: false };
    const grey = textContrast(style({ color: '#cccccc', size: 0.03 }), white);
    expect(grey).toMatchObject({ kind: 'low', against: 'canvas', minimum: 4.5 });
    if (grey.kind !== 'unknown') expect(grey.ratio).toBeCloseTo(1.61, 2);
    expect(textContrast(style({ color: '#595959', size: 0.03 }), white).kind).toBe('ok');
    // #777777 on white is 4.48:1: under 4.5:1 for small text, over 3:1 for large text.
    expect(textContrast(style({ color: '#777777', size: 0.02 }), white).kind).toBe('low');
    expect(textContrast(style({ color: '#777777', size: 0.06 }), white).kind).toBe('ok');
  });

  it('composites a translucent text colour over what lies behind it', () => {
    const white = { canvasColor: '#ffffff', overMedia: false };
    // Black at a quarter strength on white reads as #bfbfbf: too light.
    expect(textContrast(style({ color: '#00000040' }), white).kind).toBe('low');
    expect(textContrast(style({ color: '#000000ff' }), white).kind).toBe('ok');
  });

  it('judges text over media by the colours sampled behind it', () => {
    const over = (samples: readonly (readonly string[])[] | null | undefined) => ({
      canvasColor: '#000000',
      overMedia: true,
      samples,
    });
    // A dark photo: white text passes.
    expect(textContrast(style({}), over([['#101010', '#202020'], ['#000000']]))).toMatchObject({
      kind: 'ok',
      against: 'media',
    });
    // A bright photo: white text fails.
    expect(textContrast(style({}), over([['#f0f0f0', '#ffffff']]))).toMatchObject({ kind: 'low', against: 'media' });
    // Not read yet, or unreadable: unknown.
    expect(textContrast(style({}), over(undefined))).toEqual({ kind: 'unknown', reason: 'media' });
    expect(textContrast(style({}), over(null))).toEqual({ kind: 'unknown', reason: 'media' });
    expect(textContrast(style({}), over([[], []]))).toEqual({ kind: 'unknown', reason: 'media' });
  });

  it('judges each strip by the ratio most of its pixels meet, so a few bright specks do not decide', () => {
    expect(MEDIA_CONTRAST_PERCENTILE).toBe(0.1);
    expect(MEDIA_CONTRAST_STRIPS).toBe(8);
    const strip = (white: number) => [
      ...Array.from({ length: white }, () => '#ffffff'),
      ...Array.from({ length: 100 - white }, () => '#000000'),
    ];
    const strips = Array.from({ length: 8 }, () => strip(5));
    expect(textContrast(style({}), { canvasColor: '#000000', overMedia: true, samples: strips }).kind).toBe('ok');
  });

  it('reports the worst strip, so a bright band behind one line is not averaged away', () => {
    // A white band over half of one strip: 1/16 of the box. Over all pixels, 90 % are dark (ok);
    // in its strip, half are white, so that strip, and the text, is low.
    const dark = Array.from({ length: 100 }, () => '#000000');
    const band = [...Array.from({ length: 50 }, () => '#ffffff'), ...dark.slice(50)];
    const samples = [dark, dark, dark, band, dark, dark, dark, dark];
    const check = textContrast(style({}), { canvasColor: '#000000', overMedia: true, samples });
    expect(check).toMatchObject({ kind: 'low', against: 'media' });
    if (check.kind !== 'unknown') expect(check.ratio).toBeCloseTo(1, 5);
  });

  it('draws a translucent box or highlight over each sampled colour', () => {
    const bright = { canvasColor: '#000000', overMedia: true, samples: [['#ffffff', '#eeeeee']] };
    expect(textContrast(style({}), bright).kind).toBe('low');
    // A strong dark highlight over the bright photo makes white text readable.
    expect(textContrast(style({ background: 'highlight', backgroundColor: '#000000cc' }), bright)).toMatchObject({
      kind: 'ok',
      against: 'media',
    });
  });

  it('does not judge a text wholly off the canvas', () => {
    expect(textContrast(style({ color: '#000000' }), { canvasColor: '#000000', overMedia: false, offCanvas: true })).toEqual({
      kind: 'unknown',
      reason: 'off-canvas',
    });
    expect(isOffCanvas({ x: 1.05, y: 0.2, w: 0.3, h: 0.1, rotation: 0 })).toBe(true);
    expect(isOffCanvas({ x: 0.95, y: 0.2, w: 0.3, h: 0.1, rotation: 0 })).toBe(false);
    expect(isOffCanvas({ x: 0.2, y: -0.2, w: 0.3, h: 0.1, rotation: 0 })).toBe(true);
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
