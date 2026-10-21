import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  CORNER_RADIUS_RANGE,
  cleanThemeSettings,
  contrastRatio,
  DEFAULT_THEME,
  FONT_FAMILY_PATTERN,
  isFontFamily,
  MAX_FONT_FAMILY_LENGTH,
  resolveTheme,
  RING_COLORS_RANGE,
  RING_STYLES,
  RING_WIDTH_RANGE,
  THEME_COLOR_PATTERN,
  THEME_FIELDS,
  themeContrastIssues,
  themeSettingsError,
} from './theme';

describe('theme', () => {
  it('passes WCAG 2.2 AA with the default theme', () => {
    expect(themeSettingsError(DEFAULT_THEME)).toBeNull();
    expect(themeContrastIssues(DEFAULT_THEME)).toEqual([]);
  });

  it('accepts a partial theme and an empty one', () => {
    expect(themeSettingsError({})).toBeNull();
    expect(
      themeSettingsError({ ringStyle: 'solid', ringColors: ['#0055FF'], cornerRadius: 0, fontFamily: 'Georgia, serif' }),
    ).toBeNull();
    expect(themeSettingsError({ fontFamily: `"Playfair Display", 'Times New Roman', -apple-system, serif` })).toBeNull();
  });

  it.each([
    [{ titleColor: 'red' }, 'theme.titleColor must be a colour as #rrggbb'],
    [{ titleColor: '#12345' }, 'theme.titleColor must be a colour as #rrggbb'],
    [{ titleColor: '#123456;x' }, 'theme.titleColor must be a colour as #rrggbb'],
    [{ backgroundColor: '#fff' }, 'theme.backgroundColor must be a colour as #rrggbb'],
    [{ accentColor: 'url(x)' }, 'theme.accentColor must be a colour as #rrggbb'],
    [{ seenRingColor: null }, 'theme.seenRingColor must be a colour as #rrggbb'],
    [{ ringColors: [] }, 'theme.ringColors must hold 1 to 3 colours'],
    [{ ringColors: ['#000000', '#000000', '#000000', '#000000'] }, 'theme.ringColors must hold 1 to 3 colours'],
    [{ ringColors: '#000000' }, 'theme.ringColors must hold 1 to 3 colours'],
    [{ ringColors: ['#000000', 'blue'] }, 'theme.ringColors must hold colours as #rrggbb'],
    [{ ringWidth: 5 }, 'theme.ringWidth must be at most 4'],
    [{ ringWidth: 0 }, 'theme.ringWidth must be at least 1'],
    [{ ringWidth: 2.5 }, 'theme.ringWidth must be a whole number'],
    [{ ringWidth: '2' }, 'theme.ringWidth must be a whole number'],
    [{ cornerRadius: -1 }, 'theme.cornerRadius must be at least 0'],
    [{ cornerRadius: 33 }, 'theme.cornerRadius must be at most 32'],
    [{ ringStyle: 'dots' }, 'theme.ringStyle must be one of: gradient, solid, none'],
    [{ size: 1 }, 'theme has unknown field "size"'],
    [[], 'theme must be an object'],
    [null, 'theme must be an object'],
  ])('refuses %j', (value, message) => {
    expect(themeSettingsError(value)).toBe(message);
  });

  it.each([
    'a;}b{',
    'url(x)',
    'Arial; color: red',
    'Arial, ',
    '"Arial',
    'a\\62 c',
    'Arial</style>',
    'var(--x)',
    'Arial /* x */',
    '',
    ' ',
    'x'.repeat(MAX_FONT_FAMILY_LENGTH + 1),
  ])('refuses the font-family %j', (value) => {
    expect(isFontFamily(value)).toBe(false);
    expect(themeSettingsError({ fontFamily: value })).toMatch(/^theme\.fontFamily /);
  });

  it('checks a long font-family quickly', () => {
    const value = `${'a '.repeat(99)}!`;
    const start = performance.now();
    expect(isFontFamily(value)).toBe(false);
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('resolves stored fields over defaults and drops invalid or unknown ones', () => {
    expect(resolveTheme(undefined)).toEqual(DEFAULT_THEME);
    expect(resolveTheme([1])).toEqual(DEFAULT_THEME);
    const resolved = resolveTheme({ ringStyle: 'solid', ringWidth: 9, titleColor: 'red;x', cornerRadius: 0, extra: 1 });
    expect(resolved).toEqual({ ...DEFAULT_THEME, ringStyle: 'solid', cornerRadius: 0 });
    expect(cleanThemeSettings({ ringStyle: 'solid', ringWidth: 9, extra: 1 })).toEqual({ ringStyle: 'solid' });
  });

  it('never shares the default ring colours with a resolved theme', () => {
    const resolved = resolveTheme({});
    resolved.ringColors.push('#000000');
    expect(DEFAULT_THEME.ringColors).toHaveLength(3);
  });

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('names each failing colour pair', () => {
    const theme = resolveTheme({
      titleColor: '#cccccc',
      ringStyle: 'gradient',
      ringColors: ['#000000', '#eeeeee'],
      seenRingColor: '#f0f0f0',
      accentColor: '#111111',
    });
    expect(themeContrastIssues(theme).map((issue) => issue.pair)).toEqual([
      'Title on background',
      'Ring colour 2 on background',
      'Seen ring on background',
      "Accent on the viewer's black",
    ]);
    // Only the first colour draws a solid ring; no ring draws nothing.
    expect(themeContrastIssues({ ...theme, ringStyle: 'solid' }).map((i) => i.pair)).not.toContain('Ring colour 2 on background');
    expect(themeContrastIssues({ ...theme, ringStyle: 'none' }).map((i) => i.field)).toEqual(['titleColor', 'accentColor']);
  });
});

describe('theme schema in the OpenAPI document', () => {
  const doc = parse(readFileSync(join(__dirname, '../../openapi/openapi.yaml'), 'utf8')) as {
    components: { schemas: Record<string, Record<string, unknown>> };
  };
  const schemas = doc.components.schemas;
  const settings = schemas['ThemeSettings'] as { properties: Record<string, Record<string, unknown>>; additionalProperties: boolean };

  it('lists the same fields, defaults and rules as the validator', () => {
    expect(Object.keys(settings.properties)).toEqual(THEME_FIELDS);
    expect(settings.additionalProperties).toBe(false);
    expect((schemas['Theme'] as { required: string[] }).required).toEqual(THEME_FIELDS);
    const defaults = Object.fromEntries(Object.entries(settings.properties).map(([k, v]) => [k, v['default']]));
    expect(defaults).toEqual(DEFAULT_THEME);
    expect(schemas['RingStyle']['enum']).toEqual(RING_STYLES);
    expect(schemas['ThemeColor']['pattern']).toBe(THEME_COLOR_PATTERN.source);
    const p = settings.properties;
    expect([p['ringColors']['minItems'], p['ringColors']['maxItems']]).toEqual([RING_COLORS_RANGE.min, RING_COLORS_RANGE.max]);
    expect([p['ringWidth']['minimum'], p['ringWidth']['maximum']]).toEqual([RING_WIDTH_RANGE.min, RING_WIDTH_RANGE.max]);
    expect([p['cornerRadius']['minimum'], p['cornerRadius']['maximum']]).toEqual([
      CORNER_RADIUS_RANGE.min,
      CORNER_RADIUS_RANGE.max,
    ]);
    expect(p['fontFamily']['pattern']).toBe(FONT_FAMILY_PATTERN.source);
    expect(p['fontFamily']['maxLength']).toBe(MAX_FONT_FAMILY_LENGTH);
  });
});
